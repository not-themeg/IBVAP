"""
Temporal Event Engine — PHASE 6 / GRAND FINALE.

Produces explainable, deduplicated, severity-scored events from tracking + rule data.

Every emitted event contains:
  camera_id, track_id, timestamp, event_type, confidence, reason, rule_version

Rules implemented:
  ZONE_INTRUSION      — person/vehicle enters a restricted zone
  LOITERING           — dwell_time > threshold inside any zone
  DIRECTION_VIOLATION — movement toward a restricted zone / sensitive heading
  NIGHT_MOVEMENT      — movement detected in night hours (22:00–05:00 local)
  REPEATED_ENTRY      — same track_id enters zone > N times in session

Configurability:
  All thresholds (cooldown, loitering seconds, repeated entry count, night window)
  are configurable via TemporalEngineConfig and constructor kwargs.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Dict, List, Optional, Tuple, Set
import structlog

logger = structlog.get_logger()

RULE_VERSION = "1.1.0"


class TemporalEventType(str, Enum):
    ZONE_INTRUSION = "ZONE_INTRUSION"
    LOITERING = "LOITERING"
    DIRECTION_VIOLATION = "DIRECTION_VIOLATION"
    NIGHT_MOVEMENT = "NIGHT_MOVEMENT"
    REPEATED_ENTRY = "REPEATED_ENTRY"


class EventSeverity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass
class TemporalEngineConfig:
    cooldown_seconds: float = 30.0
    dedup_window_seconds: float = 5.0
    loitering_threshold_seconds: float = 20.0
    repeated_entry_threshold: int = 3
    night_start_hour: int = 22   # 10 PM IST
    night_end_hour: int = 5      # 5 AM IST


@dataclass
class TemporalEvent:
    camera_id: str
    track_id: int
    timestamp: datetime
    event_type: TemporalEventType
    confidence: float       # 0.0–1.0
    reason: str             # human-readable explanation
    rule_version: str
    severity: EventSeverity
    zone_id: Optional[str] = None
    class_name: Optional[str] = None
    dwell_seconds: Optional[float] = None

    def to_dict(self) -> Dict:
        return {
            "camera_id": self.camera_id,
            "track_id": self.track_id,
            "timestamp": self.timestamp.isoformat(),
            "event_type": self.event_type.value,
            "confidence": round(self.confidence, 3),
            "reason": self.reason,
            "rule_version": self.rule_version,
            "severity": self.severity.value,
            "zone_id": self.zone_id,
            "class_name": self.class_name,
            "dwell_seconds": self.dwell_seconds,
        }


def _is_night(dt: datetime, start_hour: int = 22, end_hour: int = 5) -> bool:
    """Return True if datetime is in the night window (approx IST +5:30)."""
    hour = dt.hour
    ist_hour = (hour + 5) % 24
    return ist_hour >= start_hour or ist_hour < end_hour


def _severity(event_type: TemporalEventType, is_night: bool) -> EventSeverity:
    if event_type == TemporalEventType.ZONE_INTRUSION:
        return EventSeverity.HIGH if is_night else EventSeverity.MEDIUM
    if event_type == TemporalEventType.REPEATED_ENTRY:
        return EventSeverity.HIGH
    if event_type == TemporalEventType.LOITERING:
        return EventSeverity.MEDIUM
    if event_type == TemporalEventType.NIGHT_MOVEMENT:
        return EventSeverity.HIGH
    return EventSeverity.LOW


class TemporalEventEngine:
    """
    Stateful engine. Feed track + zone data each frame; collects emitted events
    into an asyncio.Queue that the incident writer can consume.
    """

    def __init__(
        self,
        event_queue: Optional[asyncio.Queue] = None,
        config: Optional[TemporalEngineConfig] = None,
        **kwargs
    ):
        self.config = config or TemporalEngineConfig()
        # Override config attributes from kwargs if provided
        for k, v in kwargs.items():
            if hasattr(self.config, k):
                setattr(self.config, k, v)

        # {(track_id, event_type): last_emit_time}
        self._cooldown_map: Dict[Tuple[int, str], datetime] = {}
        # {(track_id, event_type, zone_id): last_emit_time} for dedup
        self._dedup_map: Dict[Tuple[int, str, Optional[str]], datetime] = {}
        # zone entry count per track
        self._entry_counts: Dict[Tuple[int, str], int] = {}
        # track dwell start per (track_id, zone_id)
        self._dwell_start: Dict[Tuple[int, str], datetime] = {}

        self.event_queue: asyncio.Queue = event_queue or asyncio.Queue(maxsize=500)
        self._total_emitted = 0
        self._total_suppressed = 0

    def _in_cooldown(self, track_id: int, event_type: str, now: datetime) -> bool:
        key = (track_id, event_type)
        last = self._cooldown_map.get(key)
        if last and (now - last).total_seconds() < self.config.cooldown_seconds:
            return True
        return False

    def _is_duplicate(
        self, track_id: int, event_type: str, zone_id: Optional[str], now: datetime
    ) -> bool:
        key = (track_id, event_type, zone_id)
        last = self._dedup_map.get(key)
        if last and (now - last).total_seconds() < self.config.dedup_window_seconds:
            return True
        return False

    def _record_emit(
        self, track_id: int, event_type: str, zone_id: Optional[str], now: datetime
    ) -> None:
        self._cooldown_map[(track_id, event_type)] = now
        self._dedup_map[(track_id, event_type, zone_id)] = now

    def _emit(self, event: TemporalEvent) -> None:
        try:
            self.event_queue.put_nowait(event)
            self._total_emitted += 1
            logger.info(
                "TemporalEvent emitted",
                type=event.event_type.value,
                severity=event.severity.value,
                track_id=event.track_id,
                camera_id=event.camera_id,
                reason=event.reason,
            )
        except asyncio.QueueFull:
            self._total_suppressed += 1
            logger.warning("TemporalEvent queue full — event dropped")

    # ------------------------------------------------------------------ #
    # Public API — call once per frame per track                         #
    # ------------------------------------------------------------------ #

    def process_intrusion(
        self,
        camera_id: str,
        track_id: int,
        class_name: str,
        zone_id: str,
        confidence: float,
        timestamp: datetime,
    ) -> None:
        """Call when RuleEngine detects a zone intrusion."""
        now = timestamp
        night = _is_night(now, self.config.night_start_hour, self.config.night_end_hour)

        # Track entry counts
        count_key = (track_id, zone_id)
        self._entry_counts[count_key] = self._entry_counts.get(count_key, 0) + 1
        entry_count = self._entry_counts[count_key]

        # REPEATED_ENTRY rule
        if entry_count >= self.config.repeated_entry_threshold:
            et = TemporalEventType.REPEATED_ENTRY
            if not self._in_cooldown(track_id, et.value, now) and not self._is_duplicate(
                track_id, et.value, zone_id, now
            ):
                ev = TemporalEvent(
                    camera_id=camera_id,
                    track_id=track_id,
                    timestamp=now,
                    event_type=et,
                    confidence=min(confidence + 0.1, 1.0),
                    reason=f"Track {track_id} entered zone '{zone_id}' {entry_count} times",
                    rule_version=RULE_VERSION,
                    severity=_severity(et, night),
                    zone_id=zone_id,
                    class_name=class_name,
                )
                self._record_emit(track_id, et.value, zone_id, now)
                self._emit(ev)

        # ZONE_INTRUSION rule
        et = TemporalEventType.ZONE_INTRUSION
        if not self._in_cooldown(track_id, et.value, now) and not self._is_duplicate(
            track_id, et.value, zone_id, now
        ):
            reason = f"{class_name} (track {track_id}) entered restricted zone '{zone_id}'"
            if night:
                reason += " [NIGHT]"
            ev = TemporalEvent(
                camera_id=camera_id,
                track_id=track_id,
                timestamp=now,
                event_type=et,
                confidence=confidence,
                reason=reason,
                rule_version=RULE_VERSION,
                severity=_severity(et, night),
                zone_id=zone_id,
                class_name=class_name,
            )
            self._record_emit(track_id, et.value, zone_id, now)
            self._emit(ev)

    def process_dwell(
        self,
        camera_id: str,
        track_id: int,
        class_name: str,
        zone_id: str,
        dwell_seconds: float,
        confidence: float,
        timestamp: datetime,
    ) -> None:
        """Call every frame a track is inside a zone to check loitering."""
        if dwell_seconds < self.config.loitering_threshold_seconds:
            return
        now = timestamp
        night = _is_night(now, self.config.night_start_hour, self.config.night_end_hour)
        et = TemporalEventType.LOITERING
        if not self._in_cooldown(track_id, et.value, now) and not self._is_duplicate(
            track_id, et.value, zone_id, now
        ):
            ev = TemporalEvent(
                camera_id=camera_id,
                track_id=track_id,
                timestamp=now,
                event_type=et,
                confidence=confidence,
                reason=(
                    f"{class_name} (track {track_id}) loitering in zone '{zone_id}' "
                    f"for {dwell_seconds:.1f}s"
                ),
                rule_version=RULE_VERSION,
                severity=_severity(et, night),
                zone_id=zone_id,
                class_name=class_name,
                dwell_seconds=dwell_seconds,
            )
            self._record_emit(track_id, et.value, zone_id, now)
            self._emit(ev)

    def process_direction_violation(
        self,
        camera_id: str,
        track_id: int,
        class_name: str,
        direction: str,
        disallowed_directions: Set[str],
        confidence: float,
        timestamp: datetime,
        boundary_name: str = "international boundary"
    ) -> None:
        """Emits DIRECTION_VIOLATION if track heading matches restricted vectors."""
        if direction not in disallowed_directions:
            return
        now = timestamp
        et = TemporalEventType.DIRECTION_VIOLATION
        if not self._in_cooldown(track_id, et.value, now) and not self._is_duplicate(
            track_id, et.value, boundary_name, now
        ):
            ev = TemporalEvent(
                camera_id=camera_id,
                track_id=track_id,
                timestamp=now,
                event_type=et,
                confidence=confidence,
                reason=f"{class_name} (track {track_id}) moving {direction} toward {boundary_name}",
                rule_version=RULE_VERSION,
                severity=EventSeverity.LOW,
                class_name=class_name,
            )
            self._record_emit(track_id, et.value, boundary_name, now)
            self._emit(ev)

    def process_night_movement(
        self,
        camera_id: str,
        track_id: int,
        class_name: str,
        confidence: float,
        timestamp: datetime,
    ) -> None:
        """Emit night movement event if timestamp is in night window."""
        if not _is_night(timestamp, self.config.night_start_hour, self.config.night_end_hour):
            return
        now = timestamp
        et = TemporalEventType.NIGHT_MOVEMENT
        if not self._in_cooldown(track_id, et.value, now) and not self._is_duplicate(
            track_id, et.value, None, now
        ):
            ev = TemporalEvent(
                camera_id=camera_id,
                track_id=track_id,
                timestamp=now,
                event_type=et,
                confidence=confidence,
                reason=f"{class_name} (track {track_id}) detected during night hours",
                rule_version=RULE_VERSION,
                severity=_severity(et, True),
                class_name=class_name,
            )
            self._record_emit(track_id, et.value, None, now)
            self._emit(ev)

    def get_stats(self) -> Dict:
        return {
            "total_emitted": self._total_emitted,
            "total_suppressed": self._total_suppressed,
            "active_cooldowns": len(self._cooldown_map),
            "entry_count_records": len(self._entry_counts),
        }
