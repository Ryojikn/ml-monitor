from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./mlmonitor.db"
    upload_dir: Path = Path("./uploads")
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    @property
    def upload_path(self) -> Path:
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        return self.upload_dir


settings = Settings()
