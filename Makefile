.PHONY: up down migrate seed test test-clean test-local frontend-check lint worker-ping evaluate smoke

up:
	docker compose up --build

down:
	docker compose down

migrate:
	docker compose run --rm migrate

seed:
	docker compose exec api python -m app.demo_seed

worker-ping:
	docker compose exec celery-worker celery -A app.celery_app.celery_app inspect ping --timeout 3

evaluate:
	docker compose exec celery-worker celery -A app.celery_app.celery_app call app.tasks.evaluate_weather_alerts --queue alert-evaluation

smoke:
	./scripts/smoke_test.sh

test:
	docker compose --profile test build test
	docker compose --profile test run --rm test

test-clean:
	docker compose --profile test stop test-db
	docker compose --profile test rm -f test-db

test-local:
	uv run pytest -q

frontend-check:
	cd frontend && npm run lint && npm test && npm run build

lint:
	uv run ruff check .
