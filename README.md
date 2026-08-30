# Agrobot — Sistema de Alertas Climáticas

Aplicación web y backend para configurar alertas por campo y generar notificaciones a partir de
pronósticos meteorológicos ya almacenados. La solución prioriza idempotencia, concurrencia y una
separación clara entre la interfaz, la API y el trabajo en segundo plano.

## Arquitectura

```text
                    ┌──────────────────┐
 navegador ─────────▶│ React / Sites    │
                     │ localhost:3000   │
                     └────────┬─────────┘
                              │ HTTP + X-User-ID
                              ▼
                     ┌──────────────────┐
                     │ FastAPI          │
                     │ campos/alertas/  │
                     │ notificaciones   │
                     └────────┬─────────┘
                              │
 ingesta existente ──▶ endpoint interno│
                              ▼
                    ┌──────────────────┐
                    │ PostgreSQL       │◀──── Celery worker
                    │ source of truth  │       async SQLAlchemy
                    └──────────────────┘              ▲
                                                      │ tarea
                    Celery Beat ──cada 10 s──▶ Redis ─┘
```

El endpoint interno mockea el límite del job de ingesta que ya existe en Agrobot. Celery Beat
agenda evaluaciones, Redis las transporta y uno o más workers las ejecutan fuera de FastAPI.
PostgreSQL conserva la garantía de idempotencia aun si la cola entrega una tarea más de una vez.

## Inicio rápido desde cero

Requisitos: Docker Desktop abierto y Docker Compose. Los puertos `3000`, `5432` y `8000` deben
estar disponibles.

```bash
cp .env.example .env
docker compose up --build -d
```

El servicio `migrate` aplica las migraciones y carga automáticamente una semilla idempotente: crea
`Demo Farmer`, `Lote Norte`, una alerta de lluvia al 70 % y varios pronósticos mock (fechas pasadas,
hoy y días futuros). El pronóstico de hoy supera el umbral y genera una notificación; los pasados
se ignoran y los futuros bajo el umbral no notifican. Celery Beat publica una evaluación cada 10
segundos en Compose.

La semilla también puede repetirse manualmente con `make seed`; no duplica filas. El endpoint
`PUT /internal/weather-forecasts` continúa disponible para agregar o actualizar pronósticos a mano
desde el panel **Clima demo** o mediante `curl`.

Abrir [http://localhost:3000](http://localhost:3000), elegir **Demo Farmer** y consultar la
notificación. La API y su documentación interactiva siguen disponibles en
[http://localhost:8000/docs](http://localhost:8000/docs).

La interfaz incluye cuatro áreas:

- Resumen de campos, alertas activas y notificaciones no leídas.
- Administración de campos y umbrales por evento climático.
- Notificaciones con actualización automática cada cinco segundos.
- Panel técnico **Clima demo** para cargar pronósticos mock. En el entorno local usa el token
  `local-development-token`; el valor sólo se mantiene en memoria mientras la página está abierta.

```bash
curl -H 'X-User-ID: 10000000-0000-0000-0000-000000000001' \
  http://localhost:8000/notifications
```

Los logs pueden verse con
`docker compose logs -f frontend api celery-beat celery-worker` y el entorno se detiene con
`docker compose down`.

> Si la semilla se ejecuta justo después de levantar Compose, el primer resultado puede estar
> vacío hasta la siguiente evaluación (máximo 10 segundos).

Para comprobar que todos los servicios estén listos:

```bash
docker compose ps
curl http://localhost:8000/health/ready
make worker-ping
```

### Solución de problemas local

- Si Docker responde que no puede conectarse al daemon, abrir Docker Desktop y esperar a que
  indique que el motor está activo.
- Si un puerto ya está ocupado, detener el proceso o contenedor que use `3000`, `5432` u `8000`
  antes de volver a ejecutar Compose.
- Para reconstruir sólo la aplicación sin borrar datos: `docker compose up --build -d`.
- Para reiniciar completamente la demo, incluyendo PostgreSQL: `docker compose down -v` y repetir
  los tres comandos de inicio rápido. Este último comando elimina únicamente el volumen local de
  esta aplicación.

## Flujo manual

Crear un usuario y conservar su `id`:

```bash
curl -X POST http://localhost:8000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ana"}'
```

Usando ese UUID en `X-User-ID`, crear campo y alerta:

```bash
curl -X POST http://localhost:8000/fields \
  -H 'Content-Type: application/json' \
  -H 'X-User-ID: <USER_ID>' \
  -d '{"name":"Lote Norte"}'

curl -X POST http://localhost:8000/alerts \
  -H 'Content-Type: application/json' \
  -H 'X-User-ID: <USER_ID>' \
  -d '{"field_id":"<FIELD_ID>","event_type":"frost","threshold":0.60}'
```

Mockear un pronóstico futuro (usar una fecha actual o futura):

```bash
curl -X PUT http://localhost:8000/internal/weather-forecasts \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Token: local-development-token' \
  -d '{"field_id":"<FIELD_ID>","event_type":"frost","forecast_date":"<YYYY-MM-DD>","probability":0.75}'
```

Los eventos aceptados son `rain`, `frost`, `hail` y `wind`; probabilidades y umbrales se expresan
entre `0` y `1`. También están disponibles:

- `GET /fields`
- `GET /users`
- `GET /alerts?active_only=true`
- `PATCH /alerts/{id}` y `DELETE /alerts/{id}`
- `GET /notifications?unread_only=true`
- `PATCH /notifications/{id}/read`
- `GET /health/live` y `GET /health/ready`

## Decisiones técnicas

### Idempotencia y concurrencia

La evaluación usa una sola sentencia `INSERT ... SELECT ... ON CONFLICT DO NOTHING`. La tabla
`notifications` tiene una restricción única por `(alert_id, forecast_id)`. PostgreSQL es, por lo
tanto, la autoridad de idempotencia: reiniciar un worker, repetir una task o levantar varios
workers simultáneos genera como máximo una notificación por alerta y pronóstico. Celery usa ACK
tardío, reencolado ante pérdida del proceso y retries con backoff para errores transitorios. La
semántica es “al menos una vez” con un efecto final idempotente, no “exactamente una vez”.

La notificación guarda un snapshot de evento, fecha, probabilidad y umbral. Así conserva el dato
que la disparó aunque luego cambien el pronóstico o la configuración.

### Fechas y porcentajes

Cada pronóstico representa un evento en un campo y día determinados. La combinación es única y
la ingesta hace upsert. Se evalúan fechas iguales o posteriores al día actual. Los timestamps se
guardan con zona horaria (UTC desde la aplicación) y los porcentajes como `NUMERIC(5,4)`, evitando
errores de punto flotante.

### Identidad y seguridad

`X-User-ID` simula la identidad que normalmente entregaría el canal WhatsApp o un gateway de
autenticación. Todas las consultas de recursos del usuario incluyen la propiedad del campo. El
endpoint de ingesta usa un token interno comparado en tiempo constante. Los valores por defecto
son sólo para desarrollo y deben cambiarse en un despliegue real.

### Borrado de alertas

`DELETE /alerts/{id}` desactiva la alerta en lugar de borrarla físicamente. Esto preserva sus
notificaciones históricas y permite auditar por qué se notificó al usuario.

## Desarrollo y tests

La forma reproducible no necesita Python local; levanta una base PostgreSQL efímera separada:

```bash
make test
make test-clean
```

Para ejecutar directamente, instalar Python 3.12, `uv` y crear la base `agrobot_test`, luego:

```bash
uv sync --frozen --all-extras
export TEST_DATABASE_URL=postgresql+asyncpg://agrobot:agrobot@localhost:5432/agrobot_test
uv run alembic upgrade head
make test-local
uv run ruff check .
make frontend-check
```

Los tests crean y limpian el esquema de una base PostgreSQL dedicada. No deben apuntarse a una
base con información útil; además, la suite se niega a correr si el nombre no termina en `_test`.
CI ejecuta lint, migraciones desde cero, la suite contra PostgreSQL 16, los tests del cliente web,
el build de producción y un smoke test real de Redis, Beat y worker. Se cubren validación,
propiedad, CORS, upsert, configuración de Celery, umbral inclusivo, lectura, retries permitidos,
repetición y evaluaciones concurrentes.

## Configuración

| Variable | Descripción | Default local |
|---|---|---|
| `DATABASE_URL` | URL asyncpg de PostgreSQL | `...@localhost:5432/agrobot` |
| `INTERNAL_API_TOKEN` | Credencial del endpoint de ingesta | `local-development-token` |
| `CELERY_BROKER_URL` | Broker de tareas de Celery | `redis://redis:6379/0` en Compose |
| `WORKER_INTERVAL_SECONDS` | Frecuencia de publicación de Beat | `10` |
| `DB_POOL_SIZE` | Conexiones persistentes base de la API | `5` |
| `DB_MAX_OVERFLOW` | Conexiones extra permitidas en picos | `10` |
| `DB_POOL_TIMEOUT_SECONDS` | Espera máxima por una conexión del pool | `5` |
| `DB_COMMAND_TIMEOUT_SECONDS` | Timeout de comandos PostgreSQL | `10` |
| `LOG_LEVEL` | Nivel de logs JSON | `INFO` |
| `CORS_ORIGINS` | Orígenes autorizados para la interfaz | `["http://localhost:3000"]` |
| `VITE_API_BASE_URL` | URL pública de la API usada por el navegador | `http://localhost:8000` |

## Fuera de alcance y evolución

- Un adaptador de entrega a WhatsApp consumiría las notificaciones persistidas, con estados de
  envío y reintentos; aquí “notificar” significa crear el registro consultable por API.
- Autenticación JWT, rate limiting y rotación de secretos pertenecerían al gateway/plataforma.
- Redis transporta evaluaciones pequeñas, pero no datos de negocio. Para grandes volúmenes, el
  evaluador puede procesar por ventanas o particiones manteniendo la misma clave idempotente.
- Métricas Prometheus, tracing distribuido y una tabla de heartbeat complementarían los health
  checks y logs estructurados incluidos.
