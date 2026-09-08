# IBVAP — Test & Acceptance Report

> **Execution Date: March 2026**  
> **Environment: Windows 11 | Python 3.14 | Node.js v25.9.0 | Intel Core i3 (CPU-Only)**

---

## 1. Executive Summary

| Test Suite | Total Tests | Passed | Failed | Status |
|---|---|---|---|---|
| **Python Regression (pytest)** | 75 | 75 | 0 | **100% PASS** |
| **Frontend Production Build (Vite)** | 1980 modules | Clean | 0 | **100% PASS** |
| **RTSP Ingestion (MediaMTX)** | Real-time loop | Active | 0 | **100% PASS** |
| **Webcam Adapter (`WEBCAM-01`)** | OpenCV Capture | Active | 0 | **100% PASS** |
| **Evidence SHA-256 Ledger** | Hash Chain | Verified | 0 | **100% PASS** |

---

## 2. Test Breakdown by Subsystem

### A. Video Ingestion (`tests/test_ingestion.py` - 7 tests)
- FrameBuffer thread-safe queue: PASS
- Oldest-frame dropping under backpressure: PASS
- RTSP reconnection logic with backoff: PASS
- MockSource synthetic frame generator: PASS
- CameraManager lifecycle (start/stop/stats): PASS

### B. Object Detection (`tests/test_detection.py` - 6 tests)
- Bounding box normalization [0, 1] validation: PASS
- YOLOAdapter interface adherence: PASS
- MockDetector deterministic inference: PASS
- Detection batch serialization: PASS

### C. Multi-Object Tracking (`tests/test_tracking.py` - 6 tests)
- Track ID generation and persistence: PASS
- Trajectory calculation: PASS
- Lost track expiration after max_age frames: PASS
- Active track counter verification: PASS

### D. Spatial Rules & Geometry (`tests/test_rules.py` - 13 tests)
- Ray-casting point-in-polygon algorithm: PASS
- Line segment crossing detection: PASS
- Virtual fence entry/exit state transitions: PASS
- Activity posture classification: PASS

### E. Event Correlation & Incidents (`tests/test_event_correlator.py` - 8 tests)
- Severity scoring (CRITICAL/HIGH/MEDIUM/LOW/INFO): PASS
- Camera health alert suppression: PASS
- Incident deduplication: PASS

### F. Security & Tamper Evidence (`tests/test_tamper_evidence.py` - 6 tests)
- SHA-256 calculation for snapshot files: PASS
- Chronological hash chain block linkage: PASS
- Tamper detection on modified file content: PASS

### G. Database & Repositories (`tests/test_database.py` - 8 tests)
- SQLite async session operations: PASS
- CRUD on cameras, zones, events, incidents, evidence, audit logs: PASS
- Foreign key integrity: PASS

### H. ML Dataset & Quality Suite (`tests/test_dataset_quality.py`, `tests/test_ml_pipeline.py` - 21 tests)
- YOLO annotation syntax and coordinate boundary validation: PASS
- Train/Val/Test stratified dataset splitter: PASS
- Dataset schema validation: PASS
- Model candidate state transition: PASS

---

## 3. Verification Commands Executed
```powershell
# Pytest execution
C:\Python314\python.exe -m pytest tests/ -q
# Output: 75 passed in 6.98s

# Frontend Build
cd apps\frontend
npm.cmd run build
# Output: 1980 modules transformed. dist/ built cleanly in 33.52s.
```
