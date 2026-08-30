import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.db import SessionFactory
from app.evaluator import evaluate_alerts
from app.models import Alert, Field, Notification, User, WeatherForecast


async def add_scenario(
    session,
    *,
    probability="0.8000",
    threshold="0.7000",
    active=True,
    alert_event="rain",
    forecast_event="rain",
    forecast_date=None,
):
    user = User(name="Farmer")
    field = Field(user=user, name="South")
    alert = Alert(
        field=field, event_type=alert_event, threshold=Decimal(threshold), is_active=active
    )
    forecast = WeatherForecast(
        id=uuid.uuid4(),
        field=field,
        event_type=forecast_event,
        forecast_date=forecast_date or datetime.now(UTC).date() + timedelta(days=1),
        probability=Decimal(probability),
    )
    session.add_all([user, alert, forecast])
    await session.commit()
    return user, alert, forecast


async def test_threshold_match_and_idempotency(session):
    await add_scenario(session, probability="0.7000", threshold="0.7000")
    assert await evaluate_alerts(session) == 1
    assert await evaluate_alerts(session) == 0
    assert await session.scalar(select(func.count()).select_from(Notification)) == 1


async def test_below_threshold_inactive_and_past_are_ignored(session):
    await add_scenario(session, probability="0.6999", threshold="0.7000")
    await add_scenario(session, probability="0.9000", threshold="0.7000", active=False)
    await add_scenario(
        session,
        probability="0.9000",
        threshold="0.7000",
        forecast_date=datetime.now(UTC).date() - timedelta(days=1),
    )
    await add_scenario(
        session,
        probability="0.9000",
        threshold="0.7000",
        alert_event="frost",
        forecast_event="rain",
    )
    assert await evaluate_alerts(session) == 0


async def test_concurrent_evaluations_create_one_notification(session):
    await add_scenario(session)

    async def run_once():
        async with SessionFactory() as worker_session:
            return await evaluate_alerts(worker_session)

    results = await asyncio.gather(run_once(), run_once())
    assert sorted(results) == [0, 1]
    assert await session.scalar(select(func.count()).select_from(Notification)) == 1


async def test_notification_listing_read_state_and_isolation(client, session):
    user, _, _ = await add_scenario(session)
    other = User(name="Other")
    session.add(other)
    await session.commit()
    assert await evaluate_alerts(session) == 1

    headers = {"X-User-ID": str(user.id)}
    notifications = (await client.get("/notifications?unread_only=true", headers=headers)).json()
    assert len(notifications) == 1
    notification_id = notifications[0]["id"]

    read = await client.patch(f"/notifications/{notification_id}/read", headers=headers)
    assert read.status_code == 200
    assert read.json()["read_at"] is not None
    assert (await client.get("/notifications?unread_only=true", headers=headers)).json() == []
    assert (await client.get("/notifications", headers={"X-User-ID": str(other.id)})).json() == []
