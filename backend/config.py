"""
Configuration settings for Sherpa API
"""

import os
from typing import List


class Settings:
    """Application settings"""

    # Server configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "True").lower() == "true"

    # Session configuration
    SESSION_EXPIRE_SECONDS: int = int(os.getenv("SESSION_EXPIRE_SECONDS", "3600"))

    # CORS configuration
    CORS_ORIGINS: List[str] = os.getenv("CORS_ORIGINS", "*").split(",")

    # API information
    API_TITLE: str = "Sherpa API"
    API_DESCRIPTION: str = "Voice-controlled web navigation API"
    API_VERSION: str = "1.0.0"

    # Future: External service API keys
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GOOGLE_VERTEX_AI_API_KEY: str = os.getenv("GOOGLE_VERTEX_AI_API_KEY", "")
    GOOGLE_SPEECH_API_KEY: str = os.getenv("GOOGLE_SPEECH_API_KEY", "")
    ASSEMBLYAI_API_KEY: str = os.getenv("ASSEMBLYAI_API_KEY", "")

    # Future: Redis configuration
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_PASSWORD: str = os.getenv("REDIS_PASSWORD", "")
    REDIS_DB: int = int(os.getenv("REDIS_DB", "0"))

    # Future: Database configuration
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")


settings = Settings()
