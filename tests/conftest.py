import os

os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://agrobot:agrobot@localhost:5432/agrobot_test",
)
os.environ.setdefault("INTERNAL_API_TOKEN", "test-internal-token-123")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.db import Base, SessionFactory, engine, get_session
from app.main import app

if not (make_url(os.environ["DATABASE_URL"]).database or "").endswith("_test"):
    raise RuntimeError("Tests refuse to run unless the database name ends in '_test'")


@pytest.fixture(scope="session", autouse=True)
async def database_schema():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_database(database_schema):
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE notifications, alerts, weather_forecasts, fields, users "
                "RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture
async def session():
    async with SessionFactory() as value:
        yield value


@pytest.fixture
async def client():
    async def override_session():
        async with SessionFactory() as value:
            yield value

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value
    app.dependency_overrides.clear()
