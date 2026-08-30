from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://agrobot:agrobot@localhost:5432/agrobot"
    internal_api_token: str = Field(default="local-development-token", min_length=16)
    celery_broker_url: str = "redis://localhost:6379/0"
    worker_interval_seconds: float = Field(default=10, gt=0)
    db_pool_size: int = Field(default=5, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_pool_timeout_seconds: float = Field(default=5, gt=0)
    db_command_timeout_seconds: float = Field(default=10, gt=0)
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
