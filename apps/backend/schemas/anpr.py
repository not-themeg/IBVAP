from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any

class ANPRObservationResponse(BaseModel):
    id: str
    camera_id: str
    track_id: int
    vehicle_class: str
    plate_text: Optional[str] = None
    plate_confidence: float
    plate_bbox_json: Optional[Dict[str, Any]] = None
    status: str
    consistent_readings: int = 1
    timestamp: datetime
    evidence_path: Optional[str] = None
    evidence_sha256: Optional[str] = None
    model_version: str
    ocr_engine: str

    class Config:
        from_attributes = True

class ANPRObservationCreate(BaseModel):
    camera_id: str
    track_id: int
    vehicle_class: str
    plate_text: Optional[str] = None
    plate_confidence: float
    plate_bbox_json: Optional[Dict[str, Any]] = None
    status: str = "CANDIDATE"
    consistent_readings: int = 1
    evidence_path: Optional[str] = None
    evidence_sha256: Optional[str] = None
    model_version: str = "1.0.0"
    ocr_engine: str = "easyocr"
