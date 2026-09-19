import os
import sys
import time
import uuid
import hashlib
import yaml
import asyncio
import cv2
import numpy as np
from datetime import datetime, timezone
from typing import Optional, List, Dict
import structlog
import httpx
import psutil

# Ensure IBVAP root is on python path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from services.ingestion.camera_source import CameraSource
from services.ingestion.rtsp_source import RTSPSource
from services.ingestion.webcam_source import WebcamSource
from services.ingestion.shared_frame_buffer import SharedFrameWriter
from services.detection.yolo_adapter import YOLOAdapter
from services.detection.model_selector import ModelSelector
from services.detection.model_orchestrator import ModelOrchestrator, HierarchicalObjectRouter
from services.tracking.bytetrack_adapter import FallbackIoUTracker
from services.rules.rule_engine import RuleEngine
from services.rules.schemas import Zone, ZoneType, Point, EventType
from services.incidents.event_correlator import EventCorrelator
from apps.backend.database.connection import AsyncSessionLocal, init_db
from apps.backend.database.models import Incident, Event, Evidence, Camera, ANPRObservation as DBANPRObservation, HashChainBlock
from services.anpr.schemas import ANPRConfig, ANPRObservation, PlateStatus
from services.anpr.anpr_pipeline import ANPRPipeline
from services.evidence.hash_chain import HashChainLedger
from services.tracking.remembrance_store import LongTermRemembranceStore
from services.rules.temporal_event_engine import (
    TemporalEventEngine,
    TemporalEngineConfig,
    TemporalEventType,
    EventSeverity
)
from services.tracking.track_analytics import analyze_track

logger = structlog.get_logger()

# ── Module-level worker registry for metrics API (Phase 19) ─────────────────
_active_workers: Dict[str, "MainInferenceWorker"] = {}

def _register_worker(worker: "MainInferenceWorker") -> None:
    _active_workers[worker.camera_id] = worker

def get_worker_metrics() -> Dict:
    """Return aggregated metrics from all active inference workers. (Phase 19)"""
    result = {}
    for camera_id, w in _active_workers.items():
        avg_latency = (
            sum(w._latency_history) / len(w._latency_history)
            if w._latency_history else 0.0
        )
        result[camera_id] = {
            "frames_received": w.frames_received,
            "frames_processed": w.frames_processed,
            "frames_dropped": w.dropped_frames,
            "inference_fps": round(w.measured_fps, 2),
            "avg_latency_ms": round(avg_latency, 2),
            "last_latency_ms": round(w.last_latency_ms, 2),
            "total_detections": w.total_detections,
            "total_incidents": w.total_incidents,
            "reconnect_count": w.reconnect_count,
            "running": w.running,
        }
    return result


class MainInferenceWorker:
    """
    Connects CAM-01 RTSP stream to:
    RTSPSource -> DetectionEngine (YOLOv8) -> Tracker (IoU) -> RuleEngine -> EventCorrelator -> SQLite & Evidence & Live Telemetry WebSocket.
    """
    def __init__(

        self,
        camera_id: str = "CAM-01",
        rtsp_url: str = "rtsp://127.0.0.1:8554/CAM-01",
        zones_config_path: str = "configs/zones.yaml",
        anpr_config_path: str = "configs/anpr.yaml",
        evidence_dir: str = "data/evidence",
        backend_url: str = "http://127.0.0.1:8000",
        debug_mode: bool = False,
        conf_thresh: float = None,
        input_size: int = None
    ):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.zones_config_path = zones_config_path
        self.anpr_config_path = anpr_config_path
        self.evidence_dir = evidence_dir
        self.backend_url = backend_url
        self.debug_mode = debug_mode
        self.running = False

        if "8554" in str(self.rtsp_url) and not self.camera_id.startswith("WEBCAM"):
            import socket
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.3)
                    if s.connect_ex(("127.0.0.1", 8554)) != 0:
                        raw_video = os.path.join(PROJECT_ROOT, "data", "raw", "test_video.mp4")
                        if os.path.exists(raw_video):
                            logger.info("MediaMTX RTSP port 8554 inactive; falling back to local simulation video", video_path=raw_video)
                            self.rtsp_url = raw_video
            except Exception:
                pass

        os.makedirs(self.evidence_dir, exist_ok=True)

        if conf_thresh is None:
            settings_path = os.path.join(PROJECT_ROOT, "configs", "system_settings.json")
            if os.path.exists(settings_path):
                try:
                    with open(settings_path, "r", encoding="utf-8") as sf:
                        s_data = json.load(sf)
                        conf_thresh = s_data.get("confidence_threshold", 0.25)
                except Exception:
                    pass

        self.conf_thresh = conf_thresh if conf_thresh is not None else 0.25
        self.input_size = input_size if input_size is not None else 640

        # 1. Ingestion: RTSP CCTV or Local Laptop Webcam Adapter
        if self.camera_id.startswith("WEBCAM") or str(self.rtsp_url).lower().startswith("webcam"):
            device_idx = 0
            if ":" in str(self.rtsp_url):
                try:
                    device_idx = int(str(self.rtsp_url).split(":")[-1])
                except ValueError:
                    device_idx = 0
            self.camera_source = WebcamSource(
                camera_id=self.camera_id,
                config={
                    "device_index": device_idx,
                    "fps_limit": 15,
                    "width": 640,
                    "height": 480,
                    "buffer_size": 20
                }
            )
            logger.info("Initialized local WebcamSource adapter", camera_id=self.camera_id, device=device_idx)
        else:
            is_phone = self.camera_id.startswith("PHONE") or "8080" in str(self.rtsp_url) or "4747" in str(self.rtsp_url)
            self.camera_source = RTSPSource(
                camera_id=self.camera_id,
                config={
                    "rtsp_url": self.rtsp_url,
                    "fps_limit": 30 if is_phone else 15,
                    "buffer_size": 15,
                    "reconnect_delay_seconds": 2.0
                }
            )

        # 2. Detection (YOLOv8 with dynamic ModelSelector & CUDA hardware acceleration)
        try:
            import torch
            target_device = "cuda:0" if torch.cuda.is_available() else "cpu"
        except Exception:
            target_device = "cpu"

        self.model_selector = ModelSelector()
        resolved_model_path, resolved_version, _ = self.model_selector.resolve()
        self.detector = YOLOAdapter({
            "model_path": resolved_model_path,
            "device": target_device,
            "confidence_threshold": self.conf_thresh,
            "input_size": self.input_size
        })
        self.model_version = resolved_version

        # Zero-Disk-I/O RAM Frame Bus
        self.shm_writer = SharedFrameWriter(self.camera_id)
        self._last_disk_preview_write = 0.0
        self._last_disk_ann_write = 0.0

        # 3. Tracking (Class-aware multi-object tracking with 0.20 IoU matching threshold)
        self.tracker = FallbackIoUTracker(max_age=30, iou_threshold=0.20)

        # 4. Rules & Zones
        self.rule_engine = RuleEngine()
        self._load_zones()

        # 5. Incident Correlation
        self.correlator = EventCorrelator()

        # 6. ANPR & Vehicle Analytics Pipeline
        self.anpr_config = self._load_anpr_config()
        self.anpr_pipeline = ANPRPipeline(config=self.anpr_config)
        self.total_anpr_reads = 0

        # Anti-spam cooldown per track: track_id -> timestamp
        self.cooldowns: Dict[int, float] = {}
        self.cooldown_period_sec = 15.0

        # Telemetry metrics
        self.frames_received = 0
        self.frames_processed = 0
        self.dropped_frames = 0
        self.total_detections = 0
        self.total_incidents = 0
        self.last_latency_ms = 0.0
        self.last_fps_calc_time = time.time()
        self.fps_counter = 0
        self.measured_fps = 0.0
        self.reconnect_count: Dict[str, int] = {}  # Phase 2 — per-camera reconnect counter
        self._latency_history: list = []  # Phase 2 — rolling latency buffer (last 100)

        # Register camera with health monitor — Phase 16
        try:
            from services.ingestion.camera_health import camera_health_monitor
            camera_health_monitor.register(self.camera_id)
            self._health_monitor = camera_health_monitor
        except Exception:
            self._health_monitor = None

        # Register this instance for metrics API — Phase 19
        _register_worker(self)

        # 7. Software-defined Face Detector (FRS - SIH PS-26187)
        try:
            from services.detection.face_detector import SoftwareFaceDetector
            self.face_detector = SoftwareFaceDetector()
            logger.info("Initialized SoftwareFaceDetector (zero hardware constraint)")
        except Exception as e:
            logger.warning("SoftwareFaceDetector not available", error=str(e))
            self.face_detector = None
            
        # 8. Long-Term Cross-Camera Remembrance & Re-ID Store
        self.remembrance_store = LongTermRemembranceStore.get_instance()
        logger.info("Initialized LongTermRemembranceStore")

        # 9. Temporal Event Engine (Phase 6 / Grand Finale)
        self.temporal_event_queue = asyncio.Queue(maxsize=500)
        self.temporal_engine = TemporalEventEngine(
            event_queue=self.temporal_event_queue,
            config=TemporalEngineConfig(
                cooldown_seconds=15.0,
                dedup_window_seconds=5.0,
                loitering_threshold_seconds=15.0,
                repeated_entry_threshold=3,
                night_start_hour=22,
                night_end_hour=5
            )
        )
        self._track_zone_entry_time: Dict[Tuple[int, str], float] = {}
        self.http_client: Optional[httpx.AsyncClient] = None
        self._last_telemetry_time = 0.0

        # 10. Model Orchestrator & Hierarchical Router (Phases D, E, F, G)
        self.router = HierarchicalObjectRouter(
            anpr_pipeline=self.anpr_pipeline,
            face_detector=self.face_detector
        )
        self.orchestrator = ModelOrchestrator(
            primary_detector=self.detector,
            router=self.router
        )

        # 11. Async Non-Blocking Incident Persistence Queue (Phases H & I)
        self.incident_persistence_queue = asyncio.Queue(maxsize=200)
        self._persistence_task: Optional[asyncio.Task] = None

    async def _incident_persistence_loop(self):
        """Asynchronous background worker draining incident persistence queue."""
        logger.info("Started async incident persistence queue worker", camera_id=self.camera_id)
        while self.running:
            try:
                item = await self.incident_persistence_queue.get()
                inc_data, evidence_frame = item
                await self._save_incident_to_db(inc_data, evidence_frame)
                self.incident_persistence_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in incident persistence worker", error=str(e))
                await asyncio.sleep(0.5)

    def _get_http_client(self) -> httpx.AsyncClient:
        if self.http_client is None or self.http_client.is_closed:
            self.http_client = httpx.AsyncClient(timeout=2.0)
        return self.http_client


    def _load_zones(self):
        full_path = os.path.join(PROJECT_ROOT, self.zones_config_path)
        if not os.path.exists(full_path):
            logger.warning("Zones config not found, creating default restricted polygon", path=full_path)
            default_zone = Zone(
                zone_id="RESTRICTED_ZONE_01",
                name="Perimeter Sector Alpha",
                camera_id=self.camera_id,
                zone_type=ZoneType.RESTRICTED_ZONE,
                points=[Point(0.50, 0.50), Point(0.90, 0.50), Point(0.90, 0.95), Point(0.50, 0.95)],
                enabled=True,
                color="#FF0000"
            )
            self.rule_engine.add_zone(default_zone)
            return

        with open(full_path, "r") as f:
            data = yaml.safe_load(f) or {}

        for z_data in data.get("zones", []):
            points = [Point(p["x"], p["y"]) for p in z_data.get("points", [])]
            z_type = ZoneType[z_data.get("zone_type", "RESTRICTED_ZONE")]
            zone = Zone(
                zone_id=z_data["zone_id"],
                name=z_data.get("name", z_data["zone_id"]),
                camera_id=z_data.get("camera_id", self.camera_id),
                zone_type=z_type,
                points=points,
                enabled=z_data.get("enabled", True),
                color=z_data.get("color", "#FF0000")
            )
            self.rule_engine.add_zone(zone)
            logger.info("Loaded restricted zone", zone_id=zone.zone_id, points_count=len(points))

    def _load_anpr_config(self) -> ANPRConfig:
        full_path = os.path.join(PROJECT_ROOT, self.anpr_config_path)
        if not os.path.exists(full_path):
            logger.warning("ANPR config not found, using defaults", path=full_path)
            return ANPRConfig()
        try:
            with open(full_path, "r") as f:
                data = yaml.safe_load(f) or {}
            anpr_opts = data.get("anpr", {})
            return ANPRConfig(
                enabled=anpr_opts.get("enabled", True),
                min_plate_confidence=float(anpr_opts.get("min_plate_confidence", 0.40)),
                min_ocr_confidence=float(anpr_opts.get("min_ocr_confidence", 0.50)),
                min_plate_width=int(anpr_opts.get("min_plate_width", 35)),
                min_plate_height=int(anpr_opts.get("min_plate_height", 12)),
                ocr_interval_seconds=float(anpr_opts.get("ocr_interval_seconds", 1.0)),
                plate_detection_interval_seconds=float(anpr_opts.get("plate_detection_interval_seconds", 0.5)),
                anpr_cooldown_seconds=float(anpr_opts.get("anpr_cooldown_seconds", 20.0)),
                ocr_engine=anpr_opts.get("ocr_engine", "easyocr"),
                min_consistent_frames=int(anpr_opts.get("min_consistent_frames", 2))
            )
        except Exception as e:
            logger.error("Failed to parse ANPR config, using defaults", error=str(e))
            return ANPRConfig()

    async def _save_anpr_to_db(self, anpr_obs: ANPRObservation, frame: np.ndarray) -> bool:
        """Persists ANPRObservation, saves evidence crop/frame, computes SHA-256, and dispatches WebSocket event."""
        now = datetime.now(timezone.utc)
        obs_id = anpr_obs.observation_id

        evidence_filename = f"evidence_anpr_{obs_id}.jpg"
        evidence_filepath = os.path.join(PROJECT_ROOT, self.evidence_dir, evidence_filename)
        cv2.imwrite(evidence_filepath, frame)

        with open(evidence_filepath, "rb") as f:
            sha256_hash = hashlib.sha256(f.read()).hexdigest()

        anpr_obs.evidence_path = evidence_filepath
        anpr_obs.evidence_sha256 = sha256_hash

        async with AsyncSessionLocal() as session:
            cam = await session.get(Camera, self.camera_id)
            if not cam:
                cam = Camera(
                    id=self.camera_id,
                    name="Perimeter Gate (Live CAM-01)",
                    scenario="vehicle_anpr",
                    enabled=True,
                    rtsp_url_hash="sha256_cam01"
                )
                session.add(cam)

            db_obs = DBANPRObservation(
                id=obs_id,
                camera_id=self.camera_id,
                track_id=anpr_obs.track_id,
                vehicle_class=anpr_obs.vehicle_class,
                plate_text=anpr_obs.plate_text,
                plate_confidence=anpr_obs.plate_confidence,
                plate_bbox_json=anpr_obs.plate_bbox.to_dict() if anpr_obs.plate_bbox else None,
                status=anpr_obs.status.value if isinstance(anpr_obs.status, PlateStatus) else str(anpr_obs.status),
                consistent_readings=anpr_obs.consistent_readings,
                timestamp=now,
                evidence_path=evidence_filepath,
                evidence_sha256=sha256_hash,
                model_version=anpr_obs.model_version,
                ocr_engine=anpr_obs.ocr_engine
            )
            session.add(db_obs)
            await session.commit()

        self.total_anpr_reads += 1
        logger.info(
            "ANPR observation saved to database",
            obs_id=obs_id,
            track_id=anpr_obs.track_id,
            plate=anpr_obs.plate_text,
            status=anpr_obs.status.value if isinstance(anpr_obs.status, PlateStatus) else str(anpr_obs.status),
            confidence=round(anpr_obs.plate_confidence, 2),
            sha256=sha256_hash[:12] + "..."
        )

        try:
            ws_payload = {
                "type": "vehicle_anpr",
                "observation_id": obs_id,
                "camera_id": self.camera_id,
                "track_id": anpr_obs.track_id,
                "vehicle_class": anpr_obs.vehicle_class,
                "plate_text": anpr_obs.plate_text,
                "plate_confidence": round(anpr_obs.plate_confidence, 2),
                "status": anpr_obs.status.value if isinstance(anpr_obs.status, PlateStatus) else str(anpr_obs.status),
                "consistent_readings": anpr_obs.consistent_readings,
                "timestamp": now.isoformat(),
                "evidence_url": f"/evidence/{evidence_filename}",
                "sha256": sha256_hash
            }
            client = self._get_http_client()
            await client.post(f"{self.backend_url}/api/v1/internal/anpr_event", json=ws_payload)
        except Exception as e:
            logger.warning("WebSocket ANPR event broadcast failed", error=str(e))

        return True

    async def _save_incident_to_db(self, incident_data: dict, frame: np.ndarray) -> bool:
        """Persists Event, Incident, Evidence, and computes SHA-256."""
        now = datetime.now(timezone.utc)
        incident_id = incident_data["incident_id"]
        event_id = incident_data["event_id"]

        evidence_filename = f"evidence_{incident_id}.jpg"
        evidence_filepath = os.path.join(PROJECT_ROOT, self.evidence_dir, evidence_filename)
        cv2.imwrite(evidence_filepath, frame)

        with open(evidence_filepath, "rb") as f:
            sha256_hash = hashlib.sha256(f.read()).hexdigest()

        file_size = os.path.getsize(evidence_filepath)

        async with AsyncSessionLocal() as session:
            cam = await session.get(Camera, self.camera_id)
            if not cam:
                cam = Camera(
                    id=self.camera_id,
                    name="Perimeter Gate (Live CAM-01)",
                    scenario="zone_intrusion",
                    enabled=True,
                    rtsp_url_hash="sha256_cam01"
                )
                session.add(cam)

            db_event = Event(
                id=event_id,
                camera_id=self.camera_id,
                track_id=incident_data["track_id"],
                zone_id=incident_data["zone_id"],
                event_type=incident_data["event_type"],
                severity=incident_data["severity"],
                confidence=incident_data["confidence"],
                explanation=incident_data["explanation"],
                contributing_signals_json=["RESTRICTED_ZONE_01_ENTRY"],
                model_name=self.detector.model_name,
                model_version=self.detector.model_version,
                timestamp=now
            )
            session.add(db_event)

            db_incident = Incident(
                id=incident_id,
                camera_id=self.camera_id,
                event_id=event_id,
                timestamp=now,
                event_type=incident_data["event_type"],
                severity=incident_data["severity"],
                model_version=self.detector.model_version,
                confidence=incident_data["confidence"],
                evidence_reference=evidence_filepath,
                sha256=sha256_hash,
                acknowledged=False
            )
            session.add(db_incident)

            db_evidence = Evidence(
                id=str(uuid.uuid4()),
                incident_id=incident_id,
                file_path=evidence_filepath,
                file_type="image/jpeg",
                sha256=sha256_hash,
                file_size_bytes=file_size,
                created_at=now
            )
            session.add(db_evidence)

            # Append to immutable cryptographic hash chain ledger
            chain_payload = {
                "incident_id": incident_id,
                "event_id": event_id,
                "camera_id": self.camera_id,
                "event_type": incident_data["event_type"],
                "severity": incident_data["severity"],
                "confidence": incident_data["confidence"],
                "explanation": incident_data["explanation"],
                "track_id": incident_data.get("track_id"),
                "zone_id": incident_data.get("zone_id")
            }
            await HashChainLedger.add_block(
                session=session,
                incident_id=incident_id,
                event_id=event_id,
                evidence_sha256=sha256_hash,
                camera_id=self.camera_id,
                payload_data=chain_payload,
                timestamp=now
            )

            await session.commit()

        logger.info(
            "Incident saved to database",
            incident_id=incident_id,
            evidence=evidence_filename,
            sha256=sha256_hash[:12] + "..."
        )

        try:
            ws_payload = {
                "type": "alert",
                "incident_id": incident_id,
                "camera_id": self.camera_id,
                "timestamp": now.isoformat(),
                "event_type": incident_data["event_type"],
                "severity": incident_data["severity"],
                "track_id": incident_data["track_id"],
                "confidence": round(incident_data["confidence"], 2),
                "explanation": incident_data["explanation"],
                "evidence_url": f"/evidence/{evidence_filename}",
                "sha256": sha256_hash
            }
            client = self._get_http_client()
            await client.post(f"{self.backend_url}/api/v1/internal/broadcast_alert", json=ws_payload)
        except Exception as e:
            logger.warning("WebSocket alert broadcast failed", error=str(e))

        return True

    async def _broadcast_live_telemetry(self, tracking_result, batch, t_inference_ms):
        """Pushes live bounding boxes, active tracks with trajectories, and system performance metrics to React UI."""
        now = time.time()
        # Throttle telemetry broadcast to ~8 FPS (125ms interval) to avoid socket/network overload
        if now - self._last_telemetry_time < 0.125:
            return
        self._last_telemetry_time = now

        self.fps_counter += 1
        if now - self.last_fps_calc_time >= 1.0:
            self.measured_fps = round(self.fps_counter / (now - self.last_fps_calc_time), 1)
            self.fps_counter = 0
            self.last_fps_calc_time = now

        tracks_payload = []
        for tr in tracking_result.active_tracks:
            # Trajectory points: list of [x, y]
            traj_pts = [[round(p.center_x, 3), round(p.center_y, 3)] for p in tr.trajectory[-10:]]
            reid_id = getattr(tr, 'reid_id', None)
            track_dict = {
                "track_id": tr.track_id,
                "reid_id": reid_id,
                "class_name": tr.class_name,
                "subclass": getattr(tr, 'subclass', None) or tr.class_name,
                "confidence": round(tr.avg_confidence, 2),
                "bbox": {
                    "x1": round(tr.bbox.x1, 3),
                    "y1": round(tr.bbox.y1, 3),
                    "x2": round(tr.bbox.x2, 3),
                    "y2": round(tr.bbox.y2, 3)
                },
                "center": [round(tr.center_x, 3), round(tr.center_y, 3)],
                "trajectory": traj_pts
            }
            if tr.class_name == "vehicle":
                anpr_meta = self.anpr_pipeline.get_track_telemetry(tr.track_id)
                track_dict.update(anpr_meta)
            tracks_payload.append(track_dict)

        cpu_percent = psutil.cpu_percent()
        ram_percent = psutil.virtual_memory().percent

        telemetry_payload = {
            "type": "telemetry",
            "camera_id": self.camera_id,
            "frame_id": batch.frame_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metrics": {
                "fps": self.measured_fps or round(self.camera_source.get_stats().fps_measured, 1),
                "latency_ms": round(t_inference_ms, 1),
                "dropped_frames": self.camera_source.buffer.dropped_count,
                "cpu_percent": cpu_percent,
                "ram_percent": ram_percent,
                "active_tracks_count": len(tracking_result.active_tracks),
                "camera_health": self.camera_source.get_stats().health.value
            },
            "tracks": tracks_payload
        }

        try:
            client = self._get_http_client()
            await client.post(f"{self.backend_url}/api/v1/internal/telemetry", json=telemetry_payload)
        except Exception:
            pass

    async def run(self, max_frames: Optional[int] = None):
        """Main processing loop."""
        logger.info("Initializing inference worker...", camera_id=self.camera_id)
        await init_db()
        self.detector.load_model()
        self.camera_source.start()

        self.running = True
        self._persistence_task = asyncio.create_task(self._incident_persistence_loop())
        logger.info("Inference worker started. Reading live RTSP stream...")

        try:
            last_empty_telemetry_time = 0.0
            while self.running:
                camera_frame = self.camera_source.get_latest_frame()
                if camera_frame is None:
                    # Periodically broadcast telemetry if camera is degraded or disconnected
                    now_empty = time.time()
                    if now_empty - last_empty_telemetry_time >= 1.0:
                        last_empty_telemetry_time = now_empty
                        cam_stats = self.camera_source.get_stats()
                        if cam_stats.health.value != "CONNECTED":
                            telemetry_payload = {
                                "type": "telemetry",
                                "camera_id": self.camera_id,
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "metrics": {
                                    "fps": 0.0,
                                    "latency_ms": 0.0,
                                    "dropped_frames": cam_stats.dropped_frames,
                                    "cpu_percent": psutil.cpu_percent(),
                                    "ram_percent": psutil.virtual_memory().percent,
                                    "active_tracks_count": 0,
                                    "camera_health": cam_stats.health.value
                                },
                                "tracks": []
                            }
                            try:
                                async with httpx.AsyncClient(timeout=1.0) as client:
                                    await client.post(f"{self.backend_url}/api/v1/internal/telemetry", json=telemetry_payload)
                            except Exception:
                                pass
                    await asyncio.sleep(0.05)
                    continue

                self.frames_received += 1
                frame = camera_frame.frame
                frame_id = camera_frame.frame_id
                now_ts = camera_frame.timestamp

                # Night-time / low-light enhancement (CLAHE in LAB color space)
                try:
                    if np.mean(frame) < 65.0:
                        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
                        l, a, b = cv2.split(lab)
                        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
                        frame = cv2.cvtColor(cv2.merge((clahe.apply(l), a, b)), cv2.COLOR_LAB2BGR)
                except Exception:
                    pass

                # Throttled clean live preview disk save (every 2.5s) to eliminate disk I/O bottleneck
                now_sec = time.time()
                if now_sec - self._last_disk_preview_write > 2.5:
                    self._last_disk_preview_write = now_sec
                    try:
                        preview_path = os.path.join(self.evidence_dir, f"live_{self.camera_id}.jpg")
                        cv2.imwrite(preview_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    except Exception:
                        pass

                t0 = time.time()

                # 2. Run Model Orchestrator & Hierarchical Router (Phases D, E, F, G)
                batch = self.orchestrator.process_frame(frame, self.camera_id, frame_id, now_ts)
                valid_detections = batch.detections
                batch.detections = valid_detections
                self.total_detections += len(valid_detections)

                # 3. Update Tracking (Class-aware FallbackIoUTracker)
                tracking_result = self.tracker.update(batch)

                # Software Face Detection on detected persons (SIH PS-26187 FRS) - throttled to every 5th frame for low CPU usage
                detected_faces = []
                if self.face_detector and (frame_id % 5 == 0):
                    try:
                        for tr in tracking_result.active_tracks:
                            if tr.class_name.lower() == "person":
                                pbox = {"x1": tr.bbox.x1, "y1": tr.bbox.y1, "x2": tr.bbox.x2, "y2": tr.bbox.y2}
                                faces = self.face_detector.detect_faces(frame, person_bbox=pbox)
                                for f in faces:
                                    f["parent_track_id"] = tr.track_id
                                    detected_faces.append(f)
                    except Exception:
                        pass

                # Save authoritative annotated frame matching tracker output exactly
                try:
                    annotated_preview = frame.copy()
                    h_p, w_p = frame.shape[:2]
                    for tr in tracking_result.active_tracks:
                        bx1 = max(0, int(tr.bbox.x1 * w_p))
                        by1 = max(0, int(tr.bbox.y1 * h_p))
                        bx2 = min(w_p - 1, int(tr.bbox.x2 * w_p))
                        by2 = min(h_p - 1, int(tr.bbox.y2 * h_p))

                        sub = (getattr(tr, 'subclass', None) or tr.class_name).lower()
                        anpr_meta = self.anpr_pipeline.get_track_telemetry(tr.track_id) if tr.class_name == "vehicle" else {}
                        plate_val = anpr_meta.get("plate_number")
                        plate_conf = anpr_meta.get("ocr_confidence")

                        # Long-Term Sighting & Re-ID Registration
                        prof = self.remembrance_store.record_sighting(
                            camera_id=self.camera_id,
                            track_id=tr.track_id,
                            class_name=tr.class_name,
                            subclass=sub,
                            bbox={"x1": tr.bbox.x1, "y1": tr.bbox.y1, "x2": tr.bbox.x2, "y2": tr.bbox.y2},
                            confidence=tr.avg_confidence,
                            plate=plate_val,
                            plate_conf=plate_conf
                        )
                        tr.reid_id = prof.global_id

                        # Distinctive Military/Operational High-Contrast Colors
                        if sub == "truck":
                            color = (0, 140, 255)      # BGR: Vivid Amber/Orange for TRUCK
                        elif sub in ("motorcycle", "bicycle"):
                            color = (0, 225, 255)      # BGR: Golden Yellow for MOTORCYCLE / BIKES
                        elif sub == "bus":
                            color = (220, 100, 0)      # BGR: Deep Royal Blue for BUS
                        elif sub == "car":
                            color = (30, 200, 30)      # BGR: Emerald Green for CAR
                        elif tr.class_name.lower() == "person":
                            color = (235, 130, 10)     # BGR: Dodger Blue for PERSON
                        else:
                            color = (0, 160, 255)      # BGR: Amber for other objects

                        cv2.rectangle(annotated_preview, (bx1, by1), (bx2, by2), color, 2)
                        display_name = sub.upper()
                        lbl = f"{display_name} #{tr.track_id} [{prof.global_id}] | {tr.avg_confidence:.2f}"
                        
                        (text_w, text_h), baseline = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.46, 2)
                        badge_y1 = max(0, by1 - text_h - 8)
                        badge_y2 = max(text_h + 4, by1)
                        cv2.rectangle(annotated_preview, (bx1, badge_y1), (min(w_p - 1, bx1 + text_w + 6), badge_y2), color, -1)
                        cv2.putText(annotated_preview, lbl, (bx1 + 3, max(text_h + 2, badge_y2 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 255, 255), 1, cv2.LINE_AA)

                        # Draw License Plate Badge beneath vehicle box if verified or observed
                        active_plate = prof.license_plate or plate_val
                        if active_plate:
                            plate_str = f"PLATE: {active_plate}"
                            (pw, ph), _ = cv2.getTextSize(plate_str, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 2)
                            p_y1 = min(h_p - 1, by2)
                            p_y2 = min(h_p - 1, by2 + ph + 8)
                            cv2.rectangle(annotated_preview, (bx1, p_y1), (min(w_p - 1, bx1 + pw + 8), p_y2), (0, 0, 0), -1)
                            cv2.rectangle(annotated_preview, (bx1, p_y1), (min(w_p - 1, bx1 + pw + 8), p_y2), (0, 255, 255), 1)
                            cv2.putText(annotated_preview, plate_str, (bx1 + 4, p_y2 - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)

                    # Draw detected faces with high-contrast magenta border
                    for f in detected_faces:
                        fb = f["bbox"]
                        fx1 = max(0, int(fb["x1"] * w_p))
                        fy1 = max(0, int(fb["y1"] * h_p))
                        fx2 = min(w_p - 1, int(fb["x2"] * w_p))
                        fy2 = min(h_p - 1, int(fb["y2"] * h_p))
                        cv2.rectangle(annotated_preview, (fx1, fy1), (fx2, fy2), (255, 0, 255), 2)
                        cv2.putText(annotated_preview, f"FACE #{f.get('parent_track_id', 1)}", (fx1, max(18, fy1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 0, 255), 1, cv2.LINE_AA)

                    # Ultra-low latency in-memory SharedMemory frame write (<0.1ms) - Clean stream without AI overlay
                    try:
                        _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        jpeg_bytes = buf.tobytes()
                        self.shm_writer.write_frame(jpeg_bytes)

                        # Throttled disk write backup (every 2.0s) as cold-start fallback
                        if now_sec - self._last_disk_ann_write > 2.0:
                            self._last_disk_ann_write = now_sec
                            ann_path = os.path.join(self.evidence_dir, f"live_annotated_{self.camera_id}.jpg")
                            with open(ann_path, "wb") as f_out:
                                f_out.write(jpeg_bytes)
                    except Exception:
                        pass
                except Exception:
                    pass

                # 4. Evaluate Restricted Polygon Rule
                spatial_events = self.rule_engine.evaluate(tracking_result)

                # 5. Correlate Events
                correlated = self.correlator.correlate(
                    spatial_events=spatial_events,
                    activity_assessments=[],
                    camera_health={self.camera_id: self.camera_source.get_stats().health},
                    model_name=self.detector.model_name,
                    model_version=self.detector.model_version
                )

                t_inf = (time.time() - t0) * 1000
                self.last_latency_ms = t_inf
                self.frames_processed += 1

                # 6. Process Vehicle Analytics & ANPR Pipeline
                if self.anpr_config.enabled:
                    active_track_ids = [tr.track_id for tr in tracking_result.active_tracks]
                    self.anpr_pipeline.cleanup_lost_tracks(active_track_ids)
                    for tr in tracking_result.active_tracks:
                        if tr.class_name == "vehicle":
                            anpr_obs = self.anpr_pipeline.process_vehicle_track(tr, frame, self.camera_id)
                            if anpr_obs is not None:
                                await self._save_anpr_to_db(anpr_obs, frame)

                # Broadcast live telemetry (bounding boxes, tracks, trajectories, plate readings, metrics)
                await self._broadcast_live_telemetry(tracking_result, batch, t_inf)

                # 7. Temporal Event Engine Evaluation (Phase 6 / Grand Finale)
                now_dt = now_ts if isinstance(now_ts, datetime) else datetime.now(timezone.utc)
                if now_dt.tzinfo is None:
                    now_dt = now_dt.replace(tzinfo=timezone.utc)
                now_time = time.time()
                tracks_by_id = {tr.track_id: tr for tr in tracking_result.active_tracks}

                # Evaluate Zone Entry / Exit transitions for Temporal Engine
                for se in spatial_events:
                    if se.event_type == EventType.ZONE_ENTRY:
                        self._track_zone_entry_time[(se.track_id, se.zone_id)] = now_time
                        tr_match = tracks_by_id.get(se.track_id)
                        c_name = tr_match.class_name if tr_match else "person"
                        c_conf = tr_match.avg_confidence if tr_match else se.confidence
                        self.temporal_engine.process_intrusion(
                            self.camera_id, se.track_id, c_name, se.zone_id, c_conf, now_dt
                        )
                    elif se.event_type == EventType.ZONE_EXIT:
                        self._track_zone_entry_time.pop((se.track_id, se.zone_id), None)

                # Clean up lost tracks from dwell map
                for tid in tracking_result.lost_tracks:
                    keys_to_del = [k for k in self._track_zone_entry_time if k[0] == tid]
                    for k in keys_to_del:
                        self._track_zone_entry_time.pop(k, None)

                # Evaluate active tracks for LOITERING, DIRECTION_VIOLATION, and NIGHT_MOVEMENT
                disallowed_directions = {"N", "NORTH", "NW", "NORTH_WEST", "NE", "NORTH_EAST"}
                for tr in tracking_result.active_tracks:
                    analytics = analyze_track(tr)

                    # Dwell & Loitering (dwell_time >= 15s in zone)
                    current_zones = self.rule_engine.track_presence.get(tr.track_id, set())
                    for zid in current_zones:
                        entry_time = self._track_zone_entry_time.get((tr.track_id, zid))
                        if entry_time is None:
                            self._track_zone_entry_time[(tr.track_id, zid)] = now_time - analytics.dwell_seconds
                            entry_time = self._track_zone_entry_time[(tr.track_id, zid)]
                        zone_dwell = max(now_time - entry_time, analytics.dwell_seconds)
                        self.temporal_engine.process_dwell(
                            self.camera_id, tr.track_id, tr.class_name, zid, zone_dwell, tr.avg_confidence, now_dt
                        )

                    # Direction Violation (movement toward perimeter / boundary)
                    if analytics.direction in disallowed_directions:
                        self.temporal_engine.process_direction_violation(
                            self.camera_id,
                            tr.track_id,
                            tr.class_name,
                            analytics.direction,
                            disallowed_directions,
                            tr.avg_confidence,
                            now_dt,
                            boundary_name="international boundary"
                        )

                    # Night Movement (curfew 22:00-05:00 IST)
                    self.temporal_engine.process_night_movement(
                        self.camera_id,
                        tr.track_id,
                        tr.class_name,
                        tr.avg_confidence,
                        now_dt
                    )

                # 8. Process Real Breaches (Deduplicated: Trigger primarily on ZONE_ENTRY transitions)
                for ce in correlated:
                    if ce.event_type == EventType.ZONE_ENTRY.value:
                        tr_match = tracks_by_id.get(ce.track_id)
                        # Temporal Persistence Filter: Require track to be observed for >= 2 frames to eliminate flicker
                        if tr_match and tr_match.age_frames < 2:
                            continue

                        last_t = self.cooldowns.get(ce.track_id, 0.0)
                        if (time.time() - last_t) > self.cooldown_period_sec:
                            self.cooldowns[ce.track_id] = time.time()
                            self.total_incidents += 1

                            inc_data = {
                                "incident_id": str(uuid.uuid4()),
                                "event_id": ce.event_id,
                                "track_id": ce.track_id,
                                "zone_id": ce.zone_id,
                                "event_type": "RESTRICTED_ZONE_INTRUSION",
                                "severity": "CRITICAL",
                                "confidence": ce.confidence,
                                "explanation": f"Tracked {ce.contributing_signals} (ID #{ce.track_id}) entered restricted zone '{ce.zone_id}'."
                            }

                            evidence_frame = frame.copy()
                            cv2.putText(
                                evidence_frame,
                                f"BREACH: Track #{ce.track_id} | Conf: {ce.confidence:.2f}",
                                (30, 40),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.8,
                                (0, 0, 255),
                                2
                            )

                            try:
                                self.incident_persistence_queue.put_nowait((inc_data, evidence_frame))
                            except asyncio.QueueFull:
                                logger.warning("Incident persistence queue full, shedding write")

                # Process Emitted Temporal Events (LOITERING, DIRECTION_VIOLATION, NIGHT_MOVEMENT, REPEATED_ENTRY)
                while not self.temporal_event_queue.empty():
                    try:
                        tev = self.temporal_event_queue.get_nowait()
                        # Avoid duplicating the RESTRICTED_ZONE_INTRUSION handled above
                        if tev.event_type == TemporalEventType.ZONE_INTRUSION:
                            continue

                        # Direction violation handling: emit WebSocket alert AND persist to DB with rate-limit
                        if tev.event_type == TemporalEventType.DIRECTION_VIOLATION:
                            try:
                                ws_payload = {
                                    "type": "alert",
                                    "incident_id": str(uuid.uuid4()),
                                    "camera_id": self.camera_id,
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "event_type": "DIRECTION_VIOLATION",
                                    "severity": "LOW",
                                    "track_id": tev.track_id,
                                    "confidence": round(tev.confidence, 2),
                                    "explanation": tev.reason,
                                    "evidence_url": "",
                                    "sha256": ""
                                }
                                client = self._get_http_client()
                                await client.post(f"{self.backend_url}/api/v1/internal/broadcast_alert", json=ws_payload)
                            except Exception:
                                pass

                            # Persist to database so incident feed panel records it
                            last_tev_t = self.cooldowns.get(tev.track_id, 0.0)
                            if (time.time() - last_tev_t) > 6.0:
                                self.cooldowns[tev.track_id] = time.time()
                                self.total_incidents += 1
                                inc_data = {
                                    "incident_id": str(uuid.uuid4()),
                                    "event_id": str(uuid.uuid4()),
                                    "track_id": tev.track_id,
                                    "zone_id": getattr(tev, "zone_id", "PHONE_RESTRICTED_01") or "PHONE_RESTRICTED_01",
                                    "event_type": "DIRECTION_VIOLATION",
                                    "severity": "LOW",
                                    "confidence": tev.confidence,
                                    "explanation": tev.reason
                                }
                                evidence_frame = frame.copy()
                                cv2.putText(evidence_frame, f"DIR_VIOLATION: #{tev.track_id} | {tev.confidence:.2f}", (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
                                try:
                                    self.incident_persistence_queue.put_nowait((inc_data, evidence_frame))
                                except asyncio.QueueFull:
                                    pass
                            continue

                        self.total_incidents += 1
                        inc_data = {
                            "incident_id": str(uuid.uuid4()),
                            "event_id": str(uuid.uuid4()),
                            "track_id": tev.track_id,
                            "zone_id": tev.zone_id,
                            "event_type": tev.event_type.value,
                            "severity": tev.severity.value,
                            "confidence": tev.confidence,
                            "explanation": tev.reason
                        }

                        evidence_frame = frame.copy()
                        tev_color = (0, 0, 255) if tev.severity.value in ("HIGH", "CRITICAL") else (0, 165, 255)
                        cv2.putText(
                            evidence_frame,
                            f"{tev.event_type.value}: #{tev.track_id} | {tev.confidence:.2f}",
                            (30, 40),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.75,
                            tev_color,
                            2
                        )
                        try:
                            self.incident_persistence_queue.put_nowait((inc_data, evidence_frame))
                        except asyncio.QueueFull:
                            logger.warning("Incident persistence queue full, shedding write")
                    except asyncio.QueueEmpty:
                        break

                # Debug window if explicitly requested
                if self.debug_mode:
                    h, w = frame.shape[:2]
                    zones = self.rule_engine.get_zones(self.camera_id)
                    for z in zones:
                        pts = np.array([[int(p.x * w), int(p.y * h)] for p in z.points], np.int32)
                        cv2.polylines(frame, [pts], True, (0, 0, 255), 2)
                    for tr in tracking_result.active_tracks:
                        cx, cy = int(tr.center_x * w), int(tr.center_y * h)
                        cv2.circle(frame, (cx, cy), 5, (0, 255, 0), -1)
                        cv2.putText(frame, f"{tr.class_name.upper()} #{tr.track_id}", (cx - 10, cy - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    cv2.imshow("IBVAP Live Real Inference (Debug)", frame)
                    if cv2.waitKey(1) & 0xFF == ord('q'):
                        break

                if max_frames and self.frames_processed >= max_frames:
                    break

                # Responsive sleep: fast 25-30 FPS for live phone/webcam streams, paced 15 FPS for RTSP
                sleep_sec = 0.015 if (self.camera_id.startswith("PHONE") or "8080" in str(self.rtsp_url) or "4747" in str(self.rtsp_url)) else 0.04
                await asyncio.sleep(sleep_sec)

        except (asyncio.CancelledError, KeyboardInterrupt):
            logger.info("Worker received cancellation/interrupt, stopping gracefully...")
        except Exception as e:
            logger.error("Inference worker encountered unexpected error", error=str(e), exc_info=True)
        finally:
            if self.http_client and not self.http_client.is_closed:
                try:
                    await self.http_client.aclose()
                except Exception:
                    pass
            self.stop()

    def stop(self):
        self.running = False
        if self._persistence_task and not self._persistence_task.done():
            self._persistence_task.cancel()
        self.camera_source.stop()
        if hasattr(self, 'shm_writer') and self.shm_writer is not None:
            try:
                self.shm_writer.close()
            except Exception:
                pass
        if self.debug_mode:
            cv2.destroyAllWindows()
        logger.info(
            "Worker stopped",
            processed=self.frames_processed,
            detections=self.total_detections,
            incidents=self.total_incidents,
            anpr_reads=self.total_anpr_reads
        )

if __name__ == "__main__":
    import argparse
    import signal
    parser = argparse.ArgumentParser(description="IBVAP Real Inference Worker")
    parser.add_argument("--camera", default="CAM-01", help="Camera ID")
    parser.add_argument("--rtsp", default="rtsp://127.0.0.1:8554/CAM-01", help="RTSP URL")
    parser.add_argument("--max-frames", type=int, default=None, help="Max frames to process")
    parser.add_argument("--debug", action="store_true", help="Enable OpenCV debug window")
    parser.add_argument("--conf-thresh", type=float, default=None, help="Confidence threshold")
    parser.add_argument("--input-size", type=int, default=None, help="YOLO input size")
    args = parser.parse_args()

    worker = MainInferenceWorker(
        camera_id=args.camera,
        rtsp_url=args.rtsp,
        debug_mode=args.debug,
        conf_thresh=args.conf_thresh,
        input_size=args.input_size
    )

    def _sig_handler(sig, frame_):
        logger.info(f"Worker received OS signal {sig}, terminating gracefully...")
        worker.stop()
        sys.exit(0)

    for s in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
        if s is not None:
            try:
                signal.signal(s, _sig_handler)
            except Exception:
                pass

    asyncio.run(worker.run(max_frames=args.max_frames))
