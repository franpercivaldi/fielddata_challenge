import asyncio

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError

from app.celery_app import EVALUATION_QUEUE, EVALUATION_TASK, celery_app
from app.models import Notification
from app.tasks import TRANSIENT_DATABASE_ERRORS, evaluate_weather_alerts
from tests.test_evaluator import add_scenario


def test_beat_schedule_and_delivery_guarantees():
    schedule = celery_app.conf.beat_schedule["evaluate-weather-alerts"]

    assert schedule["task"] == EVALUATION_TASK
    assert schedule["schedule"] == 10
    assert schedule["options"]["queue"] == EVALUATION_QUEUE
    assert celery_app.conf.timezone == "UTC"
    assert celery_app.conf.task_ignore_result is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert celery_app.conf.result_backend is None


def test_only_transient_database_errors_are_retried():
    assert OperationalError in TRANSIENT_DATABASE_ERRORS
    assert InterfaceError in TRANSIENT_DATABASE_ERRORS
    assert IntegrityError not in TRANSIENT_DATABASE_ERRORS
    assert evaluate_weather_alerts.autoretry_for == TRANSIENT_DATABASE_ERRORS
    assert evaluate_weather_alerts.retry_backoff == 2
    assert evaluate_weather_alerts.retry_jitter is True
    assert evaluate_weather_alerts.max_retries == 5
    assert evaluate_weather_alerts.soft_time_limit == 25
    assert evaluate_weather_alerts.time_limit == 30


async def test_celery_task_runs_async_evaluator_idempotently(session):
    await add_scenario(session)

    first = await asyncio.to_thread(evaluate_weather_alerts.run)
    second = await asyncio.to_thread(evaluate_weather_alerts.run)

    assert (first, second) == (1, 0)
    assert await session.scalar(select(func.count()).select_from(Notification)) == 1
