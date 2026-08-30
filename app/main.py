import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import engine, get_session
from app.dependencies import CurrentUser, InternalAccess, SessionDep
from app.logging import configure_logging
from app.models import Alert, Field, Notification, User, WeatherForecast
from app.schemas import (
    AlertCreate,
    AlertRead,
    AlertUpdate,
    FieldCreate,
    FieldRead,
    ForecastRead,
    ForecastUpsert,
    NotificationRead,
    Readiness,
    UserCreate,
    UserRead,
)

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("api_started")
    yield
    await engine.dispose()
    logger.info("api_stopped")


app = FastAPI(
    title="Agrobot Weather Alerts",
    version="0.1.0",
    description="Weather alert evaluation service for agricultural fields.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-User-ID", "X-Internal-Token", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request_failed",
            extra={"request_id": request_id, "method": request.method, "path": request.url.path},
        )
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round((time.monotonic() - started) * 1000, 2),
        },
    )
    return response


@app.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED, tags=["users"])
async def create_user(payload: UserCreate, session: SessionDep) -> User:
    user = User(name=payload.name.strip())
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@app.get("/users", response_model=list[UserRead], tags=["users"])
async def list_users(session: SessionDep) -> list[User]:
    result = await session.scalars(select(User).order_by(User.created_at, User.name))
    return list(result)


@app.post("/fields", response_model=FieldRead, status_code=status.HTTP_201_CREATED, tags=["fields"])
async def create_field(payload: FieldCreate, user: CurrentUser, session: SessionDep) -> Field:
    field = Field(user_id=user.id, name=payload.name.strip())
    session.add(field)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A field with that name already exists"
        ) from exc
    await session.refresh(field)
    return field


@app.get("/fields", response_model=list[FieldRead], tags=["fields"])
async def list_fields(user: CurrentUser, session: SessionDep) -> list[Field]:
    result = await session.scalars(
        select(Field).where(Field.user_id == user.id).order_by(Field.created_at)
    )
    return list(result)


@app.post("/alerts", response_model=AlertRead, status_code=status.HTTP_201_CREATED, tags=["alerts"])
async def create_alert(payload: AlertCreate, user: CurrentUser, session: SessionDep) -> Alert:
    owned_field = await session.scalar(
        select(Field).where(Field.id == payload.field_id, Field.user_id == user.id)
    )
    if owned_field is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    alert = Alert(
        field_id=payload.field_id,
        event_type=payload.event_type.value,
        threshold=payload.threshold,
    )
    session.add(alert)
    await session.commit()
    await session.refresh(alert)
    return alert


def _owned_alert_query(alert_id: uuid.UUID, user_id: uuid.UUID):
    return select(Alert).join(Field).where(Alert.id == alert_id, Field.user_id == user_id)


@app.get("/alerts", response_model=list[AlertRead], tags=["alerts"])
async def list_alerts(
    user: CurrentUser,
    session: SessionDep,
    active_only: Annotated[bool, Query()] = False,
) -> list[Alert]:
    statement = select(Alert).join(Field).where(Field.user_id == user.id)
    if active_only:
        statement = statement.where(Alert.is_active.is_(True))
    result = await session.scalars(statement.order_by(Alert.created_at))
    return list(result)


@app.patch("/alerts/{alert_id}", response_model=AlertRead, tags=["alerts"])
async def update_alert(
    alert_id: uuid.UUID,
    payload: AlertUpdate,
    user: CurrentUser,
    session: SessionDep,
) -> Alert:
    alert = await session.scalar(_owned_alert_query(alert_id, user.id))
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for key, value in changes.items():
        setattr(alert, key, value)
    await session.commit()
    await session.refresh(alert)
    return alert


@app.delete("/alerts/{alert_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["alerts"])
async def deactivate_alert(alert_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    alert = await session.scalar(_owned_alert_query(alert_id, user.id))
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    alert.is_active = False
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/notifications", response_model=list[NotificationRead], tags=["notifications"])
async def list_notifications(
    user: CurrentUser,
    session: SessionDep,
    unread_only: Annotated[bool, Query()] = False,
) -> list[Notification]:
    statement = (
        select(Notification)
        .join(Alert)
        .join(Field)
        .where(Field.user_id == user.id)
        .order_by(Notification.created_at.desc())
    )
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    result = await session.scalars(statement)
    return list(result)


@app.patch(
    "/notifications/{notification_id}/read",
    response_model=NotificationRead,
    tags=["notifications"],
)
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> Notification:
    notification = await session.scalar(
        select(Notification)
        .join(Alert)
        .join(Field)
        .where(Notification.id == notification_id, Field.user_id == user.id)
    )
    if notification is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(notification)
    return notification


@app.put(
    "/internal/weather-forecasts",
    response_model=ForecastRead,
    tags=["internal"],
)
async def upsert_forecast(
    payload: ForecastUpsert,
    _: InternalAccess,
    session: SessionDep,
) -> WeatherForecast:
    if await session.get(Field, payload.field_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found")
    statement = (
        insert(WeatherForecast)
        .values(
            id=uuid.uuid4(),
            field_id=payload.field_id,
            event_type=payload.event_type.value,
            forecast_date=payload.forecast_date,
            probability=payload.probability,
        )
        .on_conflict_do_update(
            constraint="uq_forecast_field_event_date",
            set_={"probability": payload.probability, "updated_at": datetime.now(UTC)},
        )
        .returning(WeatherForecast)
    )
    forecast = (await session.execute(statement)).scalar_one()
    await session.commit()
    return forecast


@app.get("/health/live", response_model=Readiness, tags=["health"])
async def liveness() -> Readiness:
    return Readiness(status="ok")


@app.get("/health/ready", response_model=Readiness, tags=["health"])
async def readiness(session: Annotated[AsyncSession, Depends(get_session)]) -> Readiness:
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("database_readiness_failed", exc_info=exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable") from exc
    return Readiness(status="ok", database="ok")
