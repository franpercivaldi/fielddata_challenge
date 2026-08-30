import asyncio
import logging
import time

from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.celery_app import celery_app
from app.config import settings
from app.evaluator import evaluate_alerts
from app.logging import configure_logging

logger = logging.getLogger(__name__)
TRANSIENT_DATABASE_ERRORS = (OperationalError, InterfaceError)


async def evaluate_with_isolated_engine() -> int:
    """Run once without sharing a connection pool across Celery event loops or forks."""
    engine = create_async_engine(
        settings.database_url,
        poolclass=NullPool,
        connect_args={"command_timeout": settings.db_command_timeout_seconds},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            return await evaluate_alerts(session)
    finally:
        await engine.dispose()


@celery_app.task(
    bind=True,
    name="app.tasks.evaluate_weather_alerts",
    ignore_result=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=TRANSIENT_DATABASE_ERRORS,
    retry_backoff=2,
    retry_backoff_max=30,
    retry_jitter=True,
    max_retries=5,
    soft_time_limit=25,
    time_limit=30,
)
def evaluate_weather_alerts(self) -> int:
    configure_logging()
    logger.disabled = False
    logger.propagate = True
    started = time.monotonic()
    task_id = self.request.id
    attempt = self.request.retries + 1
    try:
        inserted = asyncio.run(evaluate_with_isolated_engine())
    except Exception:
        logger.exception(
            "alert_evaluation_failed",
            extra={"task_id": task_id, "attempt": attempt},
        )
        raise
    logger.info(
        "alert_evaluation_completed",
        extra={
            "task_id": task_id,
            "attempt": attempt,
            "notifications_created": inserted,
            "duration_ms": round((time.monotonic() - started) * 1000, 2),
        },
    )
    return inserted
