#!/bin/sh
set -eu

demo_alert_id="30000000-0000-0000-0000-000000000001"

docker compose up --build -d db redis migrate api celery-worker celery-beat
docker compose exec -T api python -m app.demo_seed

notification_count="0"
attempt="1"
while [ "$attempt" -le 20 ]; do
  notification_count="$(docker compose exec -T db psql -U agrobot -d agrobot -Atc \
    "SELECT count(*) FROM notifications WHERE alert_id = '$demo_alert_id';")"
  if [ "$notification_count" = "1" ]; then
    break
  fi
  sleep 1
  attempt="$((attempt + 1))"
done

if [ "$notification_count" != "1" ]; then
  docker compose logs --tail=100 celery-beat celery-worker
  echo "Smoke test failed: expected one notification, found $notification_count" >&2
  exit 1
fi

docker compose restart celery-worker
sleep 12

notification_count="$(docker compose exec -T db psql -U agrobot -d agrobot -Atc \
  "SELECT count(*) FROM notifications WHERE alert_id = '$demo_alert_id';")"

if [ "$notification_count" != "1" ]; then
  docker compose logs --tail=100 celery-beat celery-worker
  echo "Smoke test failed after restart: expected one notification, found $notification_count" >&2
  exit 1
fi

docker compose exec -T celery-worker \
  celery -A app.celery_app.celery_app inspect ping --timeout 3
echo "Smoke test passed: Celery created exactly one idempotent notification."

