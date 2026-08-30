# Guía de estudio y defensa técnica — Agrobot Weather Alerts

Esta guía explica el proyecto desde cero, usando palabras simples primero y el término técnico
después. La idea no es memorizar código: es entender qué ocurre desde que una persona hace clic
en el navegador hasta que PostgreSQL guarda o devuelve información.

El ejemplo que usaremos durante toda la guía es:

- Usuario: **Demo Farmer**.
- Campo: **Lote Norte**.
- Alerta: lluvia con umbral del **70 %**.
- Pronóstico: lluvia con probabilidad del **85 %** para mañana.
- Resultado: una notificación porque `85 % >= 70 %`.

---

## 1. La idea completa en una frase

El usuario configura qué riesgo climático le interesa; otro proceso revisa periódicamente los
pronósticos guardados y crea una notificación cuando encuentra una coincidencia que supera el
umbral.

Una forma de recordarlo es imaginar un restaurante:

- El **frontend** es el menú y la mesa que ve el cliente.
- La **API** es el mozo: recibe pedidos y trae respuestas.
- PostgreSQL es la **despensa y el libro de registros**.
- **Celery Beat** es el encargado que toca una campana cada diez segundos.
- **Redis** es la bandeja donde deja el pedido de revisión.
- El **Celery worker** es el empleado que toma ese pedido y revisa el libro.
- Alembic es el **plano de la despensa**: indica qué estantes y reglas deben existir.

---

## 2. Diccionario mínimo

### Frontend

Es la parte que se abre en `http://localhost:3000`. Está hecha con React y TypeScript. Dibuja
botones, formularios y tarjetas. No se conecta directamente con PostgreSQL: habla con la API por
HTTP.

### Backend y API REST

El backend está hecho con FastAPI y se abre en `http://localhost:8000`. Una **API** es una puerta
con reglas claras para pedir o modificar información. REST es la convención usada para organizar
esas puertas alrededor de recursos como usuarios, campos y alertas.

### Endpoint

Es una operación concreta de la API. Combina un método HTTP y una ruta:

- `GET /fields`: pedir campos.
- `POST /fields`: crear un campo.
- `PATCH /alerts/{id}`: modificar parte de una alerta.
- `DELETE /alerts/{id}`: solicitar la desactivación de una alerta.

### Request y response

Una **request** es el pedido que manda el navegador. Una **response** es la contestación de la API.
Normalmente transportan datos en **JSON**, un formato de texto con claves y valores:

```json
{
  "name": "Lote Norte"
}
```

### Base de datos, tabla y fila

Una base de datos es un conjunto organizado de información. Una **tabla** se parece a una planilla:
define columnas. Una **fila** es un registro concreto.

Por ejemplo, `fields` es la tabla; “Lote Norte” es una de sus filas.

### UUID, clave primaria y clave foránea

Un **UUID** es un identificador largo, por ejemplo:

```text
10000000-0000-0000-0000-000000000001
```

Cada registro tiene un UUID como **clave primaria** (`id`): su documento de identidad único. Una
**clave foránea** es una columna que apunta al `id` de otra tabla. Por ejemplo, `fields.user_id`
apunta a `users.id` y responde “¿de qué usuario es este campo?”.

Usar UUID tiene dos ventajas útiles: se puede generar sin preguntarle a una base central cuál es el
próximo número y no revela fácilmente cuántos registros existen. Cuesta más leerlo y ocupa más que
un entero; es una decisión, no una solución universal.

### Índice

Es parecido al índice de un libro. Ayuda a encontrar filas sin revisar toda la tabla. Acelera
lecturas, aunque agrega trabajo y espacio a las escrituras.

### Restricción

Es una regla que PostgreSQL aplica aunque la aplicación se equivoque. Ejemplos del proyecto:

- Una probabilidad debe estar entre `0` y `1`.
- Un usuario no puede tener dos campos con el mismo nombre.
- No pueden existir dos notificaciones para la misma alerta y el mismo pronóstico.

### Transacción y commit

Una **transacción** agrupa cambios. `commit` confirma que se vuelvan permanentes. `rollback`
descarta la operación si falló. Es como preparar una transferencia bancaria y recién al confirmar
hacer efectivo el movimiento completo.

### Migración

Una migración es una versión controlada del esquema de la base. Alembic ejecuta la migración
inicial y crea tablas, claves foráneas, índices y restricciones. Así no dependemos de crear tablas
manualmente.

### Worker

Es un programa que corre en segundo plano, sin pantalla ni endpoint público. En este proyecto
busca pronósticos que disparen alertas y crea notificaciones.

### Cola, Redis, Celery y Beat

Una **cola de tareas** desacopla quién pide un trabajo de quién lo ejecuta. Celery Beat agenda la
evaluación periódica, Redis conserva temporalmente el mensaje y un Celery worker lo consume. Redis
no guarda usuarios, campos ni notificaciones: PostgreSQL sigue siendo la fuente de verdad.

### Asincronismo

Mientras la API espera que PostgreSQL responda, puede atender otros pedidos. En Python se expresa
con `async` y `await`. No significa automáticamente “hacer todo al mismo tiempo” ni vuelve más
rápido un cálculo pesado; evita desperdiciar el proceso durante esperas de entrada/salida.

### Concurrencia

Ocurre cuando dos trabajos avanzan durante el mismo período. Por ejemplo, dos workers podrían
encontrar simultáneamente la misma alerta. Hay que evitar que ambos creen la misma notificación.

### Idempotencia

Una operación es idempotente cuando repetirla deja el mismo resultado final. Ejecutar el evaluador
diez veces debe seguir dejando una única notificación para una combinación de alerta y pronóstico.

---

## 3. Las piezas que levanta Docker Compose

```text
Navegador
   │
   │ HTTP en localhost:3000
   ▼
Frontend (React + TypeScript)
   │
   │ HTTP/JSON + headers en localhost:8000
   ▼
API (FastAPI) ───────────────┐
   │                         │ SQL asíncrono
   │ SQL asíncrono           │
   ▼                         │
PostgreSQL ◀──────── Celery Worker
   │
Migraciones (Alembic, corre una vez y termina)

Celery Beat ── cada 10 segundos ──▶ Redis ── tarea ──▶ Celery Worker
```

`docker compose up --build -d` coordina siete servicios:

1. **db**: PostgreSQL 16. Guarda los datos en el volumen `postgres_data`, por lo que sobreviven a
   reinicios normales de los contenedores.
2. **migrate**: espera a que PostgreSQL esté saludable, ejecuta `alembic upgrade head` y termina.
3. **api**: espera a que las migraciones terminen y levanta FastAPI en el puerto 8000.
4. **redis**: broker temporal de tareas; no contiene datos de negocio.
5. **celery-beat**: publica una tarea de evaluación cada diez segundos y debe tener una sola
   réplica.
6. **celery-worker**: consume las tareas y ejecuta el evaluador; puede escalar a varias réplicas.
7. **frontend**: espera que la API esté saludable y sirve la interfaz en el puerto 3000.

Importante: `migrate` aparece como terminado exitosamente. Eso es correcto; no es un servidor que
deba permanecer activo.

La conexión usada dentro de Docker es, conceptualmente:

```text
postgresql+asyncpg://usuario:contraseña@db:5432/base
```

`db` funciona como nombre de red del contenedor de PostgreSQL. SQLAlchemy arma las consultas y
`asyncpg` es el driver que efectivamente habla el protocolo de PostgreSQL de manera asíncrona.

---

## 4. Modelo de datos

### Diagrama relacional

```text
users
  1
  │ un usuario posee muchos campos
  N
fields
  1 ├──────── N alerts
  │              1
  │              │ una alerta puede producir muchas notificaciones
  │              N
  │         notifications
  │              N
  │              │ un pronóstico puede participar en varias notificaciones
  1              1
  └──────── N weather_forecasts
```

Otra forma compacta:

```text
users 1 ── N fields
fields 1 ── N alerts
fields 1 ── N weather_forecasts
alerts 1 ── N notifications
weather_forecasts 1 ── N notifications
```

La última relación puede ser uno-a-muchos porque dos alertas diferentes podrían apuntar al mismo
pronóstico. Cada alerta tendría su propia notificación.

### Tabla `users`

| Columna | Qué significa |
|---|---|
| `id` | UUID único del usuario; clave primaria. |
| `name` | Nombre visible, máximo 120 caracteres. |
| `created_at` | Momento de creación con zona horaria. |
| `updated_at` | Momento de última modificación con zona horaria. |

Para la demo, seleccionar un usuario equivale a simular que inició sesión. No existe autenticación
real.

### Tabla `fields`

| Columna | Qué significa |
|---|---|
| `id` | UUID único del campo. |
| `user_id` | UUID del dueño; clave foránea hacia `users.id`. |
| `name` | Nombre del campo, por ejemplo “Lote Norte”. |
| `created_at`, `updated_at` | Fechas de creación y modificación. |

Reglas importantes:

- `UNIQUE(user_id, name)`: el mismo usuario no puede repetir el nombre de un campo. Otro usuario
  sí puede tener un campo con ese nombre.
- Hay un índice en `user_id` porque listar los campos de un usuario es una operación frecuente.
- La clave foránea usa `ON DELETE CASCADE`: si se borrara físicamente un usuario, PostgreSQL
  borraría sus campos. Actualmente la API no ofrece un endpoint para borrar usuarios.

### Tabla `alerts`

| Columna | Qué significa |
|---|---|
| `id` | UUID único de la configuración. |
| `field_id` | Campo sobre el cual se configura. |
| `event_type` | `rain`, `frost`, `hail` o `wind`. |
| `threshold` | Umbral entre 0 y 1; `0.7000` significa 70 %. |
| `is_active` | Indica si el worker debe evaluarla. |
| `created_at`, `updated_at` | Fechas de auditoría. |

El índice `(is_active, field_id, event_type)` ayuda a buscar alertas activas y unirlas con los
pronósticos correspondientes. PostgreSQL valida tanto el evento permitido como el rango del
umbral.

No hay una restricción que impida crear dos alertas iguales para el mismo campo y evento. Eso es
válido en el modelo actual: cada configuración puede generar su propia notificación.

### Tabla `weather_forecasts`

| Columna | Qué significa |
|---|---|
| `id` | UUID único del pronóstico. |
| `field_id` | Campo al que corresponde. |
| `event_type` | Tipo de evento climático. |
| `forecast_date` | Día pronosticado, sin hora. |
| `probability` | Probabilidad entre `0.0000` y `1.0000`. |
| `created_at`, `updated_at` | Creación y última actualización. |

La combinación `(field_id, event_type, forecast_date)` es única. Para un mismo campo, evento y día
existe una sola fila. Si llega una nueva probabilidad, se actualiza esa fila mediante **upsert**.

El índice `(forecast_date, field_id, event_type)` ayuda a filtrar días actuales o futuros y a
buscar la coincidencia con alertas.

### Tabla `notifications`

| Columna | Qué significa |
|---|---|
| `id` | UUID único de la notificación. |
| `alert_id` | Alerta que la originó. |
| `forecast_id` | Pronóstico que superó el umbral. |
| `event_type` | Copia del evento al momento del disparo. |
| `forecast_date` | Copia de la fecha pronosticada. |
| `probability` | Copia de la probabilidad que disparó la alerta. |
| `threshold` | Copia del umbral evaluado. |
| `created_at` | Cuándo se creó. |
| `read_at` | Cuándo se leyó; `NULL` significa “no leída”. |

Evento, fecha, probabilidad y umbral se copian como un **snapshot**. Si mañana cambia el pronóstico
o el usuario cambia el umbral, la notificación histórica sigue explicando qué valores la
originaron.

La regla crítica es:

```text
UNIQUE(alert_id, forecast_id)
```

PostgreSQL nunca permitirá dos notificaciones para la misma alerta y el mismo pronóstico.

### Por qué se usa `NUMERIC(5,4)`

El frontend muestra enteros de 0 a 100 porque son naturales para una persona. Antes de enviar:

```text
70 % / 100 = 0.7000
85 % / 100 = 0.8500
```

PostgreSQL guarda esos valores como `NUMERIC(5,4)`, un decimal exacto. Un `float` binario puede
representar ciertos decimales de forma aproximada. Para comparar umbrales conviene que `0.7000`
sea exactamente `0.7000`.

---

## 5. Identidad, UUID, tokens y headers

Un **header** es información adicional que viaja con una request HTTP.

### `X-User-ID`

Para campos, alertas y notificaciones el frontend manda:

```text
X-User-ID: 10000000-0000-0000-0000-000000000001
```

FastAPI busca ese UUID en `users`. Si no existe o no se envió, responde `401 Unauthorized`. Después,
cada consulta filtra por el dueño. Por ejemplo, no busca solamente una alerta por su ID: también
hace un join con el campo y exige que `fields.user_id` coincida con el usuario actual.

Esto implementa **aislamiento de datos**, pero no autenticación real. Cualquiera que conozca otro
UUID podría enviarlo. En producción ese header debería ser establecido o reemplazado por un
gateway confiable después de validar JWT, sesión o identidad de WhatsApp.

### `X-Internal-Token`

El endpoint que carga pronósticos no representa una acción normal de un agricultor. Simula el job
de ingesta meteorológica que ya existiría en Agrobot. Por eso exige:

```text
X-Internal-Token: local-development-token
```

El backend compara el valor con la configuración usando `secrets.compare_digest`, que evita
filtrar información mediante diferencias de tiempo fáciles de explotar.

El token local es sólo para la demo. En el frontend permanece en memoria de React: no se guarda en
`localStorage`. Al recargar la página desaparece. De todos modos, pedir un secreto de backend en un
navegador no sería apropiado para producción; el panel existe únicamente para demostrar la ingesta.

### `X-Request-ID`

La API acepta o genera un identificador para cada request, lo agrega a los logs y lo devuelve en la
response. Sirve para encontrar el recorrido de una operación al investigar errores. No identifica
usuarios ni concede permisos.

### CORS

El frontend está en el puerto 3000 y la API en el 8000; para el navegador son orígenes diferentes.
CORS permite explícitamente que `http://localhost:3000` llame a la API y autoriza los métodos y
headers necesarios. CORS no reemplaza autenticación ni protege una API de clientes que no sean un
navegador.

---

## 6. Flujo completo al entrar al frontend

### Paso 1: se carga React

El navegador descarga la aplicación desde `localhost:3000`. React crea estados en memoria para
usuarios, campos, alertas, notificaciones, formularios, errores y pantalla seleccionada.

### Paso 2: se consultan los usuarios

El frontend ejecuta:

```http
GET /users
```

No lleva `X-User-ID` porque precisamente necesita mostrar la lista de usuarios de la demo.

FastAPI usa SQLAlchemy para expresar conceptualmente:

```sql
SELECT *
FROM users
ORDER BY created_at, name;
```

La API convierte los modelos a JSON mediante Pydantic y responde una lista.

### Paso 3: se restaura o selecciona un usuario

Cuando se elige Demo Farmer, el frontend guarda solamente su UUID:

```text
localStorage["agrobot-selected-user"] = "10000000-..."
```

Esto permite recordar la selección después de recargar. No guarda contraseña ni token interno.

### Paso 4: se cargan tres grupos en paralelo

React dispara con `Promise.all`:

```http
GET /fields
GET /alerts
GET /notifications
X-User-ID: <UUID de Demo Farmer>
```

“En paralelo” significa que el navegador no espera a terminar la primera para empezar la segunda.
La API puede atenderlas de manera concurrente y cada una crea su propia sesión asíncrona de base.

### Paso 5: el frontend arma la vista

La API devuelve JSON. React guarda los arrays en estado y vuelve a dibujar:

- Cantidad de campos.
- Alertas activas.
- Notificaciones no leídas.
- Alertas agrupadas visualmente por campo.

La notificación no trae directamente el nombre del campo. El frontend usa `alert_id` para encontrar
la alerta y luego `field_id` para encontrar el campo dentro de los datos ya cargados.

### Paso 6: polling

Cada cinco segundos el navegador vuelve a ejecutar `GET /notifications`. Así una notificación
creada por el worker aparece sin recargar manualmente. Polling es simple y confiable para una demo,
pero produce requests aunque no haya novedades.

---

## 7. Crear un usuario

Secuencia completa:

```text
clic en Crear
  → POST /users con JSON
  → Pydantic valida el nombre
  → SQLAlchemy crea User
  → PostgreSQL inserta la fila
  → commit
  → API devuelve JSON con UUID
  → React agrega y selecciona el usuario
```

Request simplificada:

```http
POST /users
Content-Type: application/json

{"name":"Ana"}
```

SQL conceptual:

```sql
INSERT INTO users (id, name)
VALUES (<uuid generado>, 'Ana')
RETURNING *;
```

Pydantic verifica que el nombre tenga entre 1 y 120 caracteres. La función hace `strip()` para
quitar espacios al principio y al final, confirma con `commit` y usa `refresh` para obtener los
valores generados por la base, como `created_at`.

---

## 8. Crear un campo

```text
clic en Crear campo
  → POST /fields + X-User-ID
  → FastAPI resuelve CurrentUser
  → Pydantic valida el nombre
  → INSERT usando user.id
  → commit
  → JSON del campo
  → React lo agrega a la pantalla
```

Request:

```http
POST /fields
X-User-ID: <UUID de Ana>
Content-Type: application/json

{"name":"Lote Norte"}
```

Primero la dependency `get_current_user` ejecuta conceptualmente:

```sql
SELECT * FROM users WHERE id = <X-User-ID>;
```

Después se inserta:

```sql
INSERT INTO fields (id, user_id, name)
VALUES (<uuid>, <user-id>, 'Lote Norte');
```

Si el mismo usuario ya tiene “Lote Norte”, la restricción única de PostgreSQL provoca un error de
integridad. La API hace `rollback` y devuelve `409 Conflict` con un mensaje entendible.

---

## 9. Crear y modificar una alerta

El usuario elige campo, evento y porcentaje. Si ingresa 70, el cliente TypeScript llama `toRatio`
y envía `0.7`.

```http
POST /alerts
X-User-ID: <UUID de Ana>
Content-Type: application/json

{
  "field_id": "<UUID de Lote Norte>",
  "event_type": "rain",
  "threshold": 0.7
}
```

Antes de crear, la API comprueba simultáneamente ID y propiedad:

```sql
SELECT *
FROM fields
WHERE id = <field-id>
  AND user_id = <current-user-id>;
```

Si el campo pertenece a otro usuario devuelve `404 Field not found`. Usar 404 evita confirmar si
un recurso ajeno realmente existe.

Luego inserta la alerta con `is_active = true`. Para modificar umbral o estado se usa:

```http
PATCH /alerts/<alert-id>
X-User-ID: <UUID del usuario>

{"threshold":0.8}
```

La búsqueda segura equivale a:

```sql
SELECT alerts.*
FROM alerts
JOIN fields ON fields.id = alerts.field_id
WHERE alerts.id = <alert-id>
  AND fields.user_id = <current-user-id>;
```

El `PATCH` sólo cambia las propiedades incluidas en el JSON.

### Qué hace DELETE realmente

`DELETE /alerts/{id}` no ejecuta `DELETE FROM alerts`. Hace:

```sql
UPDATE alerts
SET is_active = false
WHERE id = <alert-id>;
```

Es un **borrado lógico**. Se conserva la alerta y sus notificaciones para mantener el historial.

---

## 10. Cargar o actualizar un pronóstico

En “Clima demo” se elige campo, evento, fecha y probabilidad. El frontend convierte, por ejemplo,
85 % a `0.85` y manda el token interno:

```http
PUT /internal/weather-forecasts
X-Internal-Token: local-development-token
Content-Type: application/json

{
  "field_id": "<UUID de Lote Norte>",
  "event_type": "rain",
  "forecast_date": "2026-08-29",
  "probability": 0.85
}
```

Pydantic valida UUID, evento, fecha y rango `0..1`. La API verifica que el campo exista. Después
ejecuta un **upsert**: insertar si no existe o actualizar si ya existe.

SQL conceptual:

```sql
INSERT INTO weather_forecasts
    (id, field_id, event_type, forecast_date, probability)
VALUES
    (<nuevo-uuid>, <field-id>, 'rain', '2026-08-29', 0.8500)
ON CONFLICT ON CONSTRAINT uq_forecast_field_event_date
DO UPDATE SET
    probability = 0.8500,
    updated_at = now()
RETURNING *;
```

Aunque la sentencia prepara un UUID nuevo, si ocurre conflicto PostgreSQL actualiza la fila
existente y conserva su `id`. Eso permite corregir continuamente el pronóstico del mismo día sin
crear filas duplicadas.

---

## 11. Cómo Celery genera una notificación

Beat y el worker son procesos separados. El ciclo es:

```text
Beat publica cada 10 segundos
  → Redis conserva la tarea
  → un worker la toma
  → crea un event loop async aislado
  → abre una sesión de base
  → buscar coincidencias
  → insertar nuevas notificaciones
  → commit
  → ACK de la tarea
```

Una alerta y un pronóstico coinciden si se cumplen todas estas condiciones:

1. La alerta está activa.
2. Pertenecen al mismo campo.
3. Tienen el mismo tipo de evento.
4. La fecha pronosticada es hoy o futura, calculada en UTC.
5. `probability >= threshold`.

Para el ejemplo:

```text
misma parcela: Lote Norte = Lote Norte       ✓
mismo evento: rain = rain                    ✓
alerta activa: true                          ✓
fecha: mañana >= hoy                         ✓
probabilidad: 0.8500 >= 0.7000               ✓
resultado: crear notificación
```

No carga candidatos en Python uno por uno. Le pide a PostgreSQL que seleccione e inserte en una
sola sentencia, equivalente a:

```sql
INSERT INTO notifications
    (id, alert_id, forecast_id, event_type,
     forecast_date, probability, threshold)
SELECT
    gen_random_uuid(),
    alerts.id,
    weather_forecasts.id,
    weather_forecasts.event_type,
    weather_forecasts.forecast_date,
    weather_forecasts.probability,
    alerts.threshold
FROM alerts
JOIN weather_forecasts
  ON weather_forecasts.field_id = alerts.field_id
 AND weather_forecasts.event_type = alerts.event_type
WHERE alerts.is_active = true
  AND weather_forecasts.forecast_date >= <hoy UTC>
  AND weather_forecasts.probability >= alerts.threshold
ON CONFLICT ON CONSTRAINT uq_notification_alert_forecast
DO NOTHING;
```

Esto reduce viajes entre aplicación y base, y deja que PostgreSQL haga el trabajo relacional para
el que está optimizado.

Si existe un error transitorio de conexión con PostgreSQL, Celery reintenta con backoff exponencial
y jitter, hasta cinco veces. La task usa ACK tardío: si el proceso muere antes de confirmar el
mensaje, Redis puede entregarlo nuevamente. Los errores no transitorios no se reintentan
automáticamente.

---

## 12. Concurrencia e idempotencia, explicadas despacio

Imaginemos dos workers:

```text
Worker A encuentra la alerta ─┐
                              ├─ ambos intentan INSERT
Worker B encuentra la alerta ─┘
```

Una comprobación hecha sólo en Python sería insegura:

```text
A pregunta “¿existe?” → no
B pregunta “¿existe?” → no
A inserta
B inserta
```

Eso es una **race condition** o condición de carrera. La solución está en PostgreSQL:

1. `UNIQUE(alert_id, forecast_id)` define la verdad: sólo una combinación puede existir.
2. `ON CONFLICT DO NOTHING` convierte al intento perdedor en una operación válida que no inserta.
3. Una ejecución devolverá “creé 1”; la otra, “creé 0”.

La misma protección funciona si el worker se reinicia, Beat publica dos veces o Redis redespacha
una task. La cola ofrece procesamiento “al menos una vez”; PostgreSQL vuelve idempotente el efecto.

Consecuencia deliberada: si un pronóstico llega a 85 %, baja a 60 % y vuelve a 85 %, sigue teniendo
el mismo `forecast_id`. La notificación original ya existe, así que no se crea otra. El sistema
notifica una vez por alerta y pronóstico diario, no una vez por cada cruce del umbral.

---

## 13. Consultar notificaciones y marcarlas como leídas

El frontend manda:

```http
GET /notifications
X-User-ID: <UUID del usuario>
```

La API no confía sólo en `notification.id`. Comprueba propiedad recorriendo relaciones:

```sql
SELECT notifications.*
FROM notifications
JOIN alerts ON alerts.id = notifications.alert_id
JOIN fields ON fields.id = alerts.field_id
WHERE fields.user_id = <current-user-id>
ORDER BY notifications.created_at DESC;
```

El filtro `?unread_only=true` agrega:

```sql
AND notifications.read_at IS NULL
```

Al marcar como leída:

```http
PATCH /notifications/<notification-id>/read
X-User-ID: <UUID del usuario>
```

se verifica la misma cadena de propiedad y se guarda:

```sql
UPDATE notifications
SET read_at = <fecha y hora UTC>
WHERE id = <notification-id>;
```

Si ya estaba leída, no cambia la fecha. La operación también es idempotente desde el punto de vista
del usuario. React reemplaza esa notificación por la respuesta actualizada y desaparece del filtro
de no leídas.

---

## 14. Qué significa realmente “async” en este proyecto

### API

Los endpoints son `async def`. Una operación como `await session.execute(...)` cede el control
mientras espera a PostgreSQL. El servidor puede avanzar con otras requests en vez de quedarse
bloqueado.

Cada request obtiene una sesión independiente mediante una dependency de FastAPI:

```text
llega request
  → get_session abre AsyncSession
  → endpoint la usa
  → termina request
  → el context manager cierra la sesión
```

Una sesión no es “la base de datos”; es una unidad de trabajo y conexión lógica para esa operación.
El engine mantiene un pool de conexiones reutilizables y usa `pool_pre_ping` para detectar
conexiones muertas antes de usarlas.

### Frontend

`Promise.all` inicia juntas las consultas de campos, alertas y notificaciones. `await` espera el
resultado sin congelar la interfaz completa.

### Worker

Celery recibe una función síncrona porque sus workers prefork no ejecutan directamente tasks
`async def`. Esa función crea un event loop con `asyncio.run` y ejecuta el evaluador con SQLAlchemy
async. Cada task crea un engine con `NullPool` y lo cierra al terminar, evitando compartir
conexiones entre procesos prefork o entre event loops diferentes.

### Lo que async no resuelve

- No impide duplicados: eso lo resuelve la restricción única.
- No crea automáticamente múltiples procesos.
- No acelera trabajo intensivo de CPU.
- No reemplaza transacciones ni manejo de errores.

---

## 15. Validación por capas

El proyecto valida en más de un lugar:

1. **Frontend**: inputs con límites y selects. Ayuda a la experiencia, pero un atacante puede
   saltárselo.
2. **Pydantic/FastAPI**: valida JSON, UUID, eventos y rangos. Un valor inválido suele producir
   `422 Unprocessable Entity`.
3. **Lógica de aplicación**: comprueba propiedad, existencia y token.
4. **PostgreSQL**: aplica claves foráneas, unicidad y checks. Es la última autoridad para la
   integridad de los datos.

La base debe tener reglas porque no todas las escrituras necesariamente vendrán siempre del mismo
frontend o de la misma versión del backend.

---

## 16. Códigos HTTP que conviene poder explicar

| Código | Significado en este proyecto |
|---|---|
| `200 OK` | Lectura o actualización correcta. |
| `201 Created` | Se creó usuario, campo o alerta. |
| `204 No Content` | La alerta se desactivó y no hay JSON de respuesta. |
| `401 Unauthorized` | Falta o es inválido el usuario/token. |
| `404 Not Found` | El recurso no existe o no pertenece al usuario. |
| `409 Conflict` | El usuario intentó repetir el nombre de un campo. |
| `422 Unprocessable Entity` | El JSON tiene forma o valores inválidos. |
| `503 Service Unavailable` | El health check no pudo consultar PostgreSQL. |

---

## 17. Health checks, logs y configuración

- `GET /health/live` responde si el proceso de API está vivo.
- `GET /health/ready` además ejecuta `SELECT 1` en PostgreSQL. Indica si está listo para trabajar.
- API y Celery generan logs JSON con duración, request/task ID, intento y cantidad de
  notificaciones creadas.
- Pydantic Settings lee variables de entorno: URL de base, token interno, intervalo, nivel de logs
  y orígenes CORS.

Los secretos y valores dependientes del ambiente no están escritos dentro de la lógica de negocio.
En local existen defaults cómodos; en producción deberían inyectarse valores seguros.

---

## 18. Laboratorio guiado

Los siguientes pasos afectan solamente la base local de esta aplicación.

### Paso 1: levantar todo

Desde el directorio del proyecto:

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Si `.env` ya existe, no hace falta copiarlo nuevamente. Abrí `http://localhost:3000`.

### Paso 2: crear usuario y campo desde el frontend

1. Creá un usuario con un nombre fácil de reconocer, por ejemplo “Entrevista Ana”.
2. Entrá con ese usuario.
3. Abrí “Campos y alertas”.
4. Creá “Campo Laboratorio”.

### Paso 3: mirar las filas en PostgreSQL

Abrí otra terminal en el proyecto:

```bash
docker compose exec db psql -U agrobot -d agrobot
```

Dentro de `psql` ejecutá:

```sql
SELECT id, name, created_at FROM users ORDER BY created_at;

SELECT f.id, f.name, u.name AS owner
FROM fields AS f
JOIN users AS u ON u.id = f.user_id
ORDER BY f.created_at;
```

Para salir escribí:

```text
\q
```

### Paso 4: crear una alerta

Desde el frontend, en “Campos y alertas”:

1. Elegí “Campo Laboratorio”.
2. Elegí lluvia.
3. Usá umbral 70 %.
4. Activá la alerta.

Observá la conversión:

```sql
SELECT f.name, a.event_type, a.threshold, a.is_active
FROM alerts AS a
JOIN fields AS f ON f.id = a.field_id
WHERE f.name = 'Campo Laboratorio';
```

Deberías ver `0.7000`, no `70`.

### Paso 5: cargar un pronóstico por debajo

En “Clima demo”:

1. Ingresá `local-development-token`.
2. Elegí el campo del laboratorio y lluvia.
3. Elegí hoy o una fecha futura.
4. Cargá 60 %.
5. Esperá al menos diez segundos.

No debería aparecer una notificación porque `0.6000 < 0.7000`.

Podés verificar el pronóstico:

```sql
SELECT f.name, wf.event_type, wf.forecast_date, wf.probability, wf.id
FROM weather_forecasts AS wf
JOIN fields AS f ON f.id = wf.field_id
WHERE f.name = 'Campo Laboratorio';
```

### Paso 6: superar el umbral con un upsert

Sin cambiar campo, evento ni fecha, cargá nuevamente el pronóstico al 85 %. La fila conserva el
mismo UUID y cambia a `0.8500`. En un máximo aproximado de diez segundos el worker crea la
notificación; el frontend la descubre en su polling de cinco segundos.

```sql
SELECT f.name, n.event_type, n.forecast_date,
       n.probability, n.threshold, n.read_at
FROM notifications AS n
JOIN alerts AS a ON a.id = n.alert_id
JOIN fields AS f ON f.id = a.field_id
WHERE f.name = 'Campo Laboratorio';
```

### Paso 7: comprobar idempotencia

Contá las notificaciones:

```sql
SELECT count(*)
FROM notifications AS n
JOIN alerts AS a ON a.id = n.alert_id
JOIN fields AS f ON f.id = a.field_id
WHERE f.name = 'Campo Laboratorio';
```

Reiniciá el Celery worker:

```bash
docker compose restart celery-worker
```

Esperá y repetí el `count(*)`. Debe seguir siendo `1`.

### Paso 8: marcar como leída

Desde “Notificaciones”, marcala como leída. Volvé a consultar `read_at`: ahora debe contener una
fecha UTC. El registro no se borra.

### Paso 9: comprobar aislamiento

Creá o elegí otro usuario. No debería ver el campo, la alerta ni la notificación del usuario del
laboratorio. La API filtra propiedad; React además limpia sus arrays al cambiar de usuario para no
mostrar por un instante los datos anteriores.

### Consultas útiles de sólo lectura

Contar todas las tablas:

```sql
SELECT 'users' AS tabla, count(*) FROM users
UNION ALL SELECT 'fields', count(*) FROM fields
UNION ALL SELECT 'alerts', count(*) FROM alerts
UNION ALL SELECT 'weather_forecasts', count(*) FROM weather_forecasts
UNION ALL SELECT 'notifications', count(*) FROM notifications;
```

Ver el recorrido completo:

```sql
SELECT
    u.name AS usuario,
    f.name AS campo,
    a.event_type,
    a.threshold,
    wf.forecast_date,
    wf.probability,
    n.created_at AS notificada,
    n.read_at
FROM users AS u
JOIN fields AS f ON f.user_id = u.id
LEFT JOIN alerts AS a ON a.field_id = f.id
LEFT JOIN weather_forecasts AS wf
       ON wf.field_id = f.id
      AND wf.event_type = a.event_type
LEFT JOIN notifications AS n
       ON n.alert_id = a.id
      AND n.forecast_id = wf.id
ORDER BY u.name, f.name;
```

---

## 19. Tests: qué demuestran

La suite usa PostgreSQL real, no SQLite, porque necesita comprobar comportamiento específico como
`ON CONFLICT`, UUID, `NUMERIC` y concurrencia.

Los tests verifican, entre otras cosas:

- Rechazo de umbrales fuera de rango.
- CRUD y borrado lógico de alertas.
- Aislamiento entre usuarios.
- CORS para el frontend.
- Autorización del endpoint interno.
- Upsert que conserva el UUID del pronóstico.
- Health checks.
- Umbral inclusivo: 70 % dispara una alerta de 70 %.
- Rechazo de alertas inactivas, eventos diferentes y fechas pasadas.
- Idempotencia al ejecutar varias veces.
- Dos evaluaciones concurrentes producen exactamente una notificación.
- Filtro de no leídas y marcado de lectura.

Para correrlos de forma reproducible:

```bash
make test
make test-clean
```

La base de tests es separada y el código se niega a limpiar una base cuyo nombre no termine en
`_test`, una protección contra borrar datos útiles por error.

---

## 20. Limitaciones reales y cómo reconocerlas

Una buena defensa técnica no dice “todo es perfecto”. Explica qué se priorizó y cuál sería el
siguiente paso.

### Identidad de demo

`X-User-ID` se puede falsificar y `GET /users` expone los usuarios. Se aceptó para mostrar el flujo
sin convertir el challenge en un proyecto de autenticación. En producción usaríamos JWT o un
gateway de identidad y obtendríamos el usuario de credenciales verificadas.

### Token interno

El valor local es conocido y el panel lo manda desde el navegador. Sólo simula la integración con
el job meteorológico. En producción el job llamaría por una red privada con un secreto rotado,
identidad de servicio o mTLS; el usuario nunca vería esa credencial.

### No hay WhatsApp

“Notificar” significa persistir una notificación consultable. Falta un adaptador de entrega con
estados como `pending`, `sent`, `failed`, reintentos y referencia del proveedor.

### Polling

El navegador consulta cada cinco segundos aunque no cambie nada. Es suficiente para la demo. A
mayor escala se podría usar WebSocket, Server-Sent Events o notificaciones push.

### Volumen y paginación

Los listados devuelven todas las filas del usuario. Con miles de registros hacen falta paginación,
límites y posiblemente filtros por fecha.

### Semántica de una sola notificación

La clave idempotente impide avisar de nuevo para el mismo pronóstico diario. Si producto requiere
avisar cada vez que cruza el umbral, se necesitaría modelar evaluaciones o episodios y definir
histéresis para no generar ruido.

### Operación y observabilidad

Hay health checks de PostgreSQL, Redis, API, Beat y worker, además de logs estructurados. Todavía
faltan métricas, tracing, alertas operativas y un heartbeat histórico persistido.

### Escalabilidad del worker

La sentencia única es excelente para un volumen moderado y Celery permite escalar consumidores.
Con millones de pronósticos también se debería procesar por ventanas o lotes y particionar datos
antiguos. La restricción única seguiría siendo la última defensa contra duplicados.

---

## 21. Speech de dos minutos

> Construí un sistema de alertas climáticas separado en frontend, API, PostgreSQL y procesamiento
> de background con Celery y Redis. El
> usuario administra campos y configura alertas por tipo de evento y umbral. La ingesta
> meteorológica existente está representada por un endpoint interno que hace upsert de un
> pronóstico único por campo, evento y fecha.
>
> La API está hecha con FastAPI y SQLAlchemy asíncrono. Todos los recursos del usuario se filtran
> atravesando la propiedad del campo. Para la demo simulo identidad con X-User-ID; lo considero una
> limitación explícita y en producción lo reemplazaría por identidad verificada.
>
> Celery Beat publica una evaluación cada diez segundos, Redis la transporta y los workers la
> ejecutan fuera de FastAPI. La task conserva SQLAlchemy async mediante un event loop y un engine
> aislados. En una sola sentencia PostgreSQL une alertas activas con pronósticos compatibles.
>
> La parte crítica es la idempotencia: notifications tiene una restricción única por alerta y
> pronóstico, y el insert usa ON CONFLICT DO NOTHING. Celery trabaja con semántica de al menos una
> vez: dos workers, un reinicio o una redelivery pueden repetir la task, pero producen como máximo
> una notificación. PostgreSQL es la autoridad de integridad.
>
> El frontend convierte porcentajes humanos de 0 a 100 a decimales de 0 a 1, consulta
> notificaciones cada cinco segundos y permite marcarlas como leídas. Docker Compose hace
> reproducible la demo, Alembic crea el esquema y los tests usan PostgreSQL real para validar
> restricciones, upsert y concurrencia.

---

## 22. Preguntas de entrevista y respuestas sugeridas

### ¿Por qué PostgreSQL?

Porque el problema es relacional y necesita integridad fuerte, joins, transacciones, restricciones
únicas y un upsert seguro ante concurrencia. Además, era parte del stack preferido del challenge.

### ¿Por qué UUID y no enteros?

Permiten generar identificadores sin una secuencia central y son cómodos si en el futuro hay
servicios distribuidos. También evitan exponer IDs consecutivos. Reconozco que ocupan más espacio y
son menos legibles; para este dominio el costo es aceptable.

### ¿Por qué SQLAlchemy asíncrono?

Las operaciones de API y evaluación esperan red/base. `async` evita bloquear durante ese I/O.
FastAPI mantiene un pool async; cada task Celery crea un engine async aislado para no compartirlo
entre procesos prefork o event loops. No diría que async acelera cualquier cosa: beneficia I/O.

### ¿Por qué el worker está separado de FastAPI?

Si el scheduler estuviera dentro de la API, cada réplica podría arrancar el suyo. Beat agenda,
Redis desacopla y los workers se despliegan y escalan independientemente. Beat debe ser singleton;
la base protege la concurrencia y posibles redeliveries.

### ¿Cómo evitás notificaciones duplicadas?

Con una garantía en PostgreSQL: `UNIQUE(alert_id, forecast_id)` más `ON CONFLICT DO NOTHING`. No
hago “SELECT y después INSERT” en Python porque dos procesos podrían pasar el SELECT antes de que
alguno inserte.

### ¿Por qué una sola sentencia `INSERT ... SELECT`?

Reduce viajes a la base, evita cargar grandes listas en Python y permite que PostgreSQL optimice
joins y filtros. La inserción y la decisión de conflicto ocurren atómicamente en la autoridad de
datos.

### ¿Qué es un upsert y por qué lo usaste?

Es “insertar o actualizar”. Para el mismo campo, evento y día sólo debe existir un pronóstico. Si
el proveedor manda una corrección, se actualiza la probabilidad sin crear otra fila y se conserva
el UUID.

### ¿Por qué guardar datos repetidos en `notifications`?

Es un snapshot deliberado. La alerta o el pronóstico pueden cambiar después. Guardar los valores
evaluados permite explicar históricamente por qué se emitió el aviso.

### ¿Cómo aislás usuarios?

Todos los endpoints privados resuelven el usuario y filtran recursos a través de `fields.user_id`.
Para actualizaciones se busca al mismo tiempo el ID del recurso y su dueño. Los tests demuestran
que otro usuario obtiene lista vacía o 404.

### ¿Por qué devolver 404 para un recurso ajeno?

No confirma la existencia de IDs pertenecientes a terceros. Es una pequeña mejora de privacidad,
aunque la autenticación de esta demo siga siendo simulada.

### ¿Por qué Alembic?

Versiona el esquema, permite crear la base desde cero de forma reproducible y deja un camino para
evolucionarla sin ejecutar SQL manual diferente en cada ambiente.

### ¿Qué escalarías primero?

Depende de la métrica real. Para muchas notificaciones: paginación y filtros. Para muchos
pronósticos: evaluación por ventanas/lotes e índices medidos con `EXPLAIN ANALYZE`. Para entrega
externa: una segunda cola, estados de entrega y reintentos. Mediría antes de cambiar índices o
particionar.

---

## 23. Preguntas tramposas y respuestas honestas

### “¿Esto es seguro para producción?”

No en autenticación. El núcleo de integridad y concurrencia es sólido, pero `X-User-ID`, listado de
usuarios y token local existen sólo para la demo. Explicaría claramente cómo los reemplazaría.

### “¿CORS protege la API?”

No. CORS es una política del navegador. Un script de servidor puede llamar a la API igualmente.
La seguridad real requiere autenticación y autorización.

### “¿Qué pasa si dos workers evalúan al mismo tiempo?”

Los dos pueden detectar el candidato, pero PostgreSQL admite un solo insert por la restricción
única. El otro hace `DO NOTHING`. Existe un test que ejecuta ambas evaluaciones concurrentemente.

### “¿Qué pasa si el worker cae después del commit?”

La notificación quedó persistida. Al reiniciar vuelve a encontrar el candidato, pero la clave única
evita duplicarlo. Si además existiera entrega a WhatsApp, esa entrega necesitaría su propia
idempotencia y estados persistidos.

### “¿Y si cae antes del commit?”

La transacción no se confirma. La siguiente evaluación vuelve a encontrar el candidato y lo
intenta de nuevo.

### “¿Podrían existir dos alertas iguales?”

Sí. El esquema actual no las prohíbe y producirían una notificación por alerta. Si producto define
que debe haber sólo una por campo y evento, agregaría una restricción única y decidiría cómo migrar
duplicados existentes.

### “¿Por qué Celery y Redis si PostgreSQL ya resolvía el problema?”

No eran obligatorios para la corrección. Los agregué para separar agendamiento y ejecución,
permitir escalar consumidores y demostrar redelivery/retries. El costo es más infraestructura, por
eso Redis no se convirtió en fuente de verdad y mantuve la garantía idempotente en PostgreSQL.

### “¿El worker garantiza exactamente una entrega?”

Celery procesa al menos una vez y puede repetir una task. PostgreSQL garantiza como máximo un
registro por alerta y pronóstico. No existe todavía entrega externa, por lo que no prometo
“exactamente una vez” de punta a punta.

### “¿Qué problema tiene el polling?”

Consume requests y consultas aunque no haya cambios y puede demorar hasta el próximo intervalo.
Para la escala y claridad de la demo es razonable; para tiempo real usaría eventos o conexiones
push.

### “¿Por qué no SQLite en tests?”

Porque podría ocultar diferencias importantes: sintaxis de upsert, comportamiento concurrente,
tipos UUID/NUMERIC y restricciones de PostgreSQL. Probar contra el motor real da más confianza.

---

## 24. Chuleta de una página

### Mapa mental

```text
Usuario → posee Campos
Campo → tiene Alertas y Pronósticos
Alerta + Pronóstico compatible + supera umbral
       → Beat → Redis → Celery Worker → Notification
Frontend consulta Notification y permite leerla
```

### Tablas

| Tabla | Responsabilidad | Relación clave |
|---|---|---|
| `users` | Usuario de demo | Tiene muchos fields. |
| `fields` | Campo agrícola | Pertenece a un user. |
| `alerts` | Evento + umbral + activo | Pertenece a un field. |
| `weather_forecasts` | Probabilidad por día | Único por field/event/date. |
| `notifications` | Resultado histórico | Une alert y forecast. |

### Headers

- `X-User-ID`: identidad simulada; no es autenticación real.
- `X-Internal-Token`: protege la ingesta meteorológica de demo.
- `X-Request-ID`: trazabilidad en logs.

### Endpoints

| Método y ruta | Acción |
|---|---|
| `GET/POST /users` | Listar o crear usuarios de demo. |
| `GET/POST /fields` | Listar o crear campos propios. |
| `GET/POST /alerts` | Listar o crear alertas propias. |
| `PATCH /alerts/{id}` | Cambiar umbral o actividad. |
| `DELETE /alerts/{id}` | Desactivar sin borrar historial. |
| `GET /notifications` | Listar propias; acepta `unread_only`. |
| `PATCH /notifications/{id}/read` | Marcar como leída. |
| `PUT /internal/weather-forecasts` | Upsert protegido del pronóstico. |
| `GET /health/live` | Proceso vivo. |
| `GET /health/ready` | API y PostgreSQL listos. |

### Cinco decisiones para recordar

1. **Beat + Redis + workers**: agendamiento, transporte y ejecución desacoplados.
2. **PostgreSQL como autoridad**: restricciones y transacciones protegen los datos.
3. **Idempotencia en base**: unique + on conflict evita carreras y duplicados.
4. **Async para I/O**: API y tasks usan acceso PostgreSQL asíncrono y aislado.
5. **Snapshots históricos**: la notificación conserva los valores que la dispararon.

### Flujo que tenés que poder contar sin mirar

```text
El usuario crea una alerta
→ la API valida identidad, propiedad y datos
→ PostgreSQL la guarda
→ ingresa o se actualiza un pronóstico
→ Beat publica una task en Redis
→ un Celery worker une alertas con pronósticos
→ si probability >= threshold intenta insertar
→ PostgreSQL evita duplicados
→ el frontend consulta cada cinco segundos
→ el usuario ve y marca la notificación como leída
```

Si podés explicar ese flujo, la restricción única y la limitación de `X-User-ID`, ya entendés el
corazón técnico de la solución.
