from celery import Celery, signals

from app.config import settings
from app.logging import configure_logging

EVALUATION_TASK = "app.tasks.evaluate_weather_alerts"
EVALUATION_QUEUE = "alert-evaluation"

celery_app = Celery(
    "agrobot_weather_alerts",
    broker=settings.celery_broker_url,
    include=["app.tasks"],
)
celery_app.conf.update(
    accept_content=["json"],
    task_serializer="json",
    enable_utc=True,
    timezone="UTC",
    result_backend=None,
    task_ignore_result=True,
    task_default_queue=EVALUATION_QUEUE,
    task_routes={EVALUATION_TASK: {"queue": EVALUATION_QUEUE}},
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry=True,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,
    broker_transport_options={
        "visibility_timeout": 60,
        "socket_connect_timeout": 5,
        "socket_timeout": 5,
    },
    task_soft_time_limit=25,
    task_time_limit=30,
    beat_schedule={
        "evaluate-weather-alerts": {
            "task": EVALUATION_TASK,
            "schedule": settings.worker_interval_seconds,
            "options": {"queue": EVALUATION_QUEUE},
        }
    },
)


@signals.setup_logging.connect
def setup_celery_logging(**_: object) -> None:
    """Use the same structured JSON logging in API, Beat and Celery workers."""
    configure_logging()
