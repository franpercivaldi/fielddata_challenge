FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/service/.venv PATH="/service/.venv/bin:$PATH"
WORKDIR /service

COPY --from=ghcr.io/astral-sh/uv:0.11.30 /uv /uvx /bin/
COPY pyproject.toml uv.lock README.md ./
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN uv sync --frozen --no-dev --no-editable


FROM base AS test
COPY tests ./tests
RUN uv sync --frozen --all-extras --no-editable
CMD ["pytest", "-q"]


FROM base AS runtime
RUN groupadd --system agrobot && useradd --system --gid agrobot --home /service agrobot \
    && chown -R agrobot:agrobot /service
USER agrobot
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
