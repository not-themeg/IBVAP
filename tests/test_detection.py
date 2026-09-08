"""
IBVAP — Detection Engine & Schema Tests
=======================================
Verifies BBox normalization and property calculation,
Detection validation, and MockDetector batch outputs.
"""

import pytest
from datetime import datetime, timezone
from services.detection.schemas import BBox, Detection, DetectionBatch
from services.detection.mock_detector import MockDetector


def test_bbox_valid_geometry():
    bbox = BBox(x1=0.1, y1=0.2, x2=0.5, y2=0.8)
    assert pytest.approx(bbox.width) == 0.4
    assert pytest.approx(bbox.height) == 0.6
    assert pytest.approx(bbox.center_x) == 0.3
    assert pytest.approx(bbox.center_y) == 0.5
    assert pytest.approx(bbox.area) == 0.24


def test_bbox_invalid_coordinates_raises():
    with pytest.raises(ValueError):
        BBox(x1=0.5, y1=0.2, x2=0.1, y2=0.8) # x1 >= x2

    with pytest.raises(ValueError):
        BBox(x1=-0.1, y1=0.2, x2=0.5, y2=0.8) # negative


def test_detection_confidence_bounds():
    bbox = BBox(x1=0.1, y1=0.2, x2=0.5, y2=0.8)
    det = Detection(bbox=bbox, class_name="vehicle", confidence=0.85, subclass="car")
    assert det.class_name == "vehicle"
    assert det.subclass == "car"

    with pytest.raises(ValueError):
        Detection(bbox=bbox, confidence=1.5)


def test_mock_detector_generates_valid_batches():
    mock = MockDetector()
    mock.load_model()
    assert mock.is_loaded() is True

    import numpy as np
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    now = datetime.now(timezone.utc)

    batch = mock.detect(frame=frame, camera_id="CAM-TEST", frame_id=42, timestamp=now)
    assert isinstance(batch, DetectionBatch)
    assert batch.camera_id == "CAM-TEST"
    assert batch.frame_id == 42
    assert len(batch.detections) >= 0
