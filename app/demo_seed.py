import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy.dialects.postgresql import insert

from app.db import SessionFactory, engine
from app.models import Alert, Field, User, WeatherForecast

DEMO_USER_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")
DEMO_FIELD_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
DEMO_ALERT_ID = uuid.UUID("30000000-0000-0000-0000-000000000001")


async def seed() -> None:
    today = datetime.now(UTC).date()
    # Estos datos representan la tabla que normalmente alimentaría el job
    # meteorológico externo. Hay fechas pasadas, hoy y días futuros para poder
    # demostrar el filtro temporal del evaluador desde la primera ejecución.
    forecast_rows = [
        ("rain", -3, "0.9000"),  # supera el umbral, pero ya pasó: no alerta
        ("rain", 0, "0.8500"),  # único caso que genera notificación
        ("rain", 1, "0.6500"),  # futuro, pero debajo del umbral
        ("rain", 3, "0.5500"),
        ("rain", 7, "0.6000"),
        ("frost", -1, "0.8000"),
        ("frost", 2, "0.4500"),
        ("hail", 1, "0.3000"),
        ("wind", 4, "0.7500"),
    ]
    async with SessionFactory() as session:
        await session.execute(
            insert(User)
            .values(id=DEMO_USER_ID, name="Demo Farmer")
            .on_conflict_do_update(index_elements=[User.id], set_={"name": "Demo Farmer"})
        )
        await session.execute(
            insert(Field)
            .values(id=DEMO_FIELD_ID, user_id=DEMO_USER_ID, name="Lote Norte")
            .on_conflict_do_update(index_elements=[Field.id], set_={"name": "Lote Norte"})
        )
        await session.execute(
            insert(Alert)
            .values(
                id=DEMO_ALERT_ID,
                field_id=DEMO_FIELD_ID,
                event_type="rain",
                threshold=Decimal("0.7000"),
                is_active=True,
            )
            .on_conflict_do_update(
                index_elements=[Alert.id],
                set_={"threshold": Decimal("0.7000"), "is_active": True},
            )
        )
        for event_type, days_from_today, probability in forecast_rows:
            await session.execute(
                insert(WeatherForecast)
                .values(
                    id=uuid.uuid4(),
                    field_id=DEMO_FIELD_ID,
                    event_type=event_type,
                    forecast_date=today + timedelta(days=days_from_today),
                    probability=Decimal(probability),
                )
                .on_conflict_do_update(
                    constraint="uq_forecast_field_event_date",
                    set_={
                        "probability": Decimal(probability),
                        "updated_at": datetime.now(UTC),
                    },
                )
            )
        await session.commit()
    print(f"Demo ready. Use X-User-ID: {DEMO_USER_ID}")
    date_range = f"{today - timedelta(days=3)} to {today + timedelta(days=7)}"
    print(f"Forecasts loaded: {len(forecast_rows)} ({date_range})")


async def main() -> None:
    try:
        await seed()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
