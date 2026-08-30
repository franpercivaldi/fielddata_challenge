import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class WeatherEventType(StrEnum):
    RAIN = "rain"
    FROST = "frost"
    HAIL = "hail"
    WIND = "wind"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    fields: Mapped[list["Field"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Field(TimestampMixin, Base):
    __tablename__ = "fields"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_fields_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    user: Mapped[User] = relationship(back_populates="fields")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="field")
    forecasts: Mapped[list["WeatherForecast"]] = relationship(back_populates="field")


class WeatherForecast(TimestampMixin, Base):
    __tablename__ = "weather_forecasts"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('rain', 'frost', 'hail', 'wind')", name="ck_forecasts_event_type"
        ),
        CheckConstraint("probability >= 0 AND probability <= 1", name="ck_forecasts_probability"),
        UniqueConstraint(
            "field_id", "event_type", "forecast_date", name="uq_forecast_field_event_date"
        ),
        Index("ix_forecasts_evaluation", "forecast_date", "field_id", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fields.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    forecast_date: Mapped[date] = mapped_column(Date, nullable=False)
    probability: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)

    field: Mapped[Field] = relationship(back_populates="forecasts")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="forecast")


class Alert(TimestampMixin, Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('rain', 'frost', 'hail', 'wind')", name="ck_alerts_event_type"
        ),
        CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_alerts_threshold"),
        Index("ix_alerts_evaluation", "is_active", "field_id", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fields.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )

    field: Mapped[Field] = relationship(back_populates="alerts")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="alert")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("alert_id", "forecast_id", name="uq_notification_alert_forecast"),
        Index("ix_notifications_alert_created", "alert_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False
    )
    forecast_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weather_forecasts.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    forecast_date: Mapped[date] = mapped_column(Date, nullable=False)
    probability: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    alert: Mapped[Alert] = relationship(back_populates="notifications")
    forecast: Mapped[WeatherForecast] = relationship(back_populates="notifications")
