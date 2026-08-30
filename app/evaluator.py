from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, Notification, WeatherForecast


async def evaluate_alerts(session: AsyncSession, today: date | None = None) -> int:
    """Persist newly-triggered notifications and return the number inserted.

    PostgreSQL's unique constraint plus ON CONFLICT makes this safe when multiple
    worker processes evaluate the same forecasts concurrently.
    """
    evaluation_date = today or datetime.now(UTC).date()
    candidates = (
        select(
            func.gen_random_uuid(),
            Alert.id,
            WeatherForecast.id,
            WeatherForecast.event_type,
            WeatherForecast.forecast_date,
            WeatherForecast.probability,
            Alert.threshold,
        )
        .join(
            WeatherForecast,
            (WeatherForecast.field_id == Alert.field_id)
            & (WeatherForecast.event_type == Alert.event_type),
        )
        .where(
            Alert.is_active.is_(True),
            WeatherForecast.forecast_date >= evaluation_date,
            WeatherForecast.probability >= Alert.threshold,
        )
    )
    statement = (
        insert(Notification)
        .from_select(
            [
                Notification.id,
                Notification.alert_id,
                Notification.forecast_id,
                Notification.event_type,
                Notification.forecast_date,
                Notification.probability,
                Notification.threshold,
            ],
            candidates,
        )
        .on_conflict_do_nothing(constraint="uq_notification_alert_forecast")
        .returning(Notification.id)
    )
    result = await session.execute(statement)
    inserted = len(result.scalars().all())
    await session.commit()
    return inserted
