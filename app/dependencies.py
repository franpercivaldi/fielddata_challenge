import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import User

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_user(
    session: SessionDep,
    x_user_id: Annotated[uuid.UUID | None, Header(alias="X-User-ID")] = None,
) -> User:
    if x_user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-User-ID header is required")
    user = await session.scalar(select(User).where(User.id == x_user_id))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_internal_token(
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
) -> None:
    if x_internal_token is None or not secrets.compare_digest(
        x_internal_token, settings.internal_api_token
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal token")


InternalAccess = Annotated[None, Depends(require_internal_token)]
