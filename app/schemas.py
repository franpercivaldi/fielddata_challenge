import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models import WeatherEventType


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UserRead(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class FieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class FieldRead(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    created_at: datetime


class AlertCreate(BaseModel):
    field_id: uuid.UUID
    event_type: WeatherEventType
    threshold: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)


class AlertUpdate(BaseModel):
    threshold: Decimal | None = Field(default=None, ge=0, le=1, max_digits=5, decimal_places=4)
    is_active: bool | None = None


class AlertRead(ORMModel):
    id: uuid.UUID
    field_id: uuid.UUID
    event_type: WeatherEventType
    threshold: Decimal
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ForecastUpsert(BaseModel):
    field_id: uuid.UUID
    event_type: WeatherEventType
    forecast_date: date
    probability: Decimal = Field(ge=0, le=1, max_digits=5, decimal_places=4)


class ForecastRead(ORMModel):
    id: uuid.UUID
    field_id: uuid.UUID
    event_type: WeatherEventType
    forecast_date: date
    probability: Decimal
    created_at: datetime
    updated_at: datetime


class NotificationRead(ORMModel):
    id: uuid.UUID
    alert_id: uuid.UUID
    forecast_id: uuid.UUID
    event_type: WeatherEventType
    forecast_date: date
    probability: Decimal
    threshold: Decimal
    created_at: datetime
    read_at: datetime | None


class Readiness(BaseModel):
    status: str
    database: str | None = None
