from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List

class Settings(BaseSettings):
    APP_NAME: str = "IBVAP"
    APP_ENV: str = "development"
    API_VERSION: str = "1.0.0"
    
    # Auth
    JWT_SECRET_KEY: str = "super_secret_dev_key_change_in_prod"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    
    # DB
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/ibvap_dev.db"
    
    # Paths
    CAMERAS_CONFIG_PATH: str = "../../configs/cameras.yaml"
    EVIDENCE_STORAGE_PATH: str = "./data/evidence"
    
    # ML
    DETECTION_MODEL: str = "yolov8n"
    DETECTION_MODEL_PATH: str = "../../ml/models/weights/yolov8n.pt"
    DETECTION_DEVICE: str = "cpu"
    DETECTION_CONFIDENCE_THRESHOLD: float = 0.4
    
    CORS_ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    class Config:
        env_file = "../../.env"
        extra = "ignore"

@lru_cache()
def get_settings():
    return Settings()
