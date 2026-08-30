from datetime import date, timedelta


async def create_user_and_field(client, user_name="Ana", field_name="Lote 1"):
    user_response = await client.post("/users", json={"name": user_name})
    assert user_response.status_code == 201
    user = user_response.json()
    headers = {"X-User-ID": user["id"]}
    field_response = await client.post("/fields", headers=headers, json={"name": field_name})
    assert field_response.status_code == 201
    return user, field_response.json(), headers


async def test_alert_crud_validation_and_ownership(client):
    _, field, headers = await create_user_and_field(client)
    _, _, other_headers = await create_user_and_field(client, "Bruno", "Lote 2")

    invalid = await client.post(
        "/alerts",
        headers=headers,
        json={"field_id": field["id"], "event_type": "rain", "threshold": 1.1},
    )
    assert invalid.status_code == 422

    created = await client.post(
        "/alerts",
        headers=headers,
        json={"field_id": field["id"], "event_type": "rain", "threshold": 0.7},
    )
    assert created.status_code == 201
    alert = created.json()

    assert (await client.get("/alerts", headers=headers)).json()[0]["id"] == alert["id"]
    assert (await client.get("/alerts", headers=other_headers)).json() == []
    assert (
        await client.patch(f"/alerts/{alert['id']}", headers=other_headers, json={"threshold": 0.5})
    ).status_code == 404

    updated = await client.patch(f"/alerts/{alert['id']}", headers=headers, json={"threshold": 0.8})
    assert updated.status_code == 200
    assert updated.json()["threshold"] == "0.8000"

    deleted = await client.delete(f"/alerts/{alert['id']}", headers=headers)
    assert deleted.status_code == 204
    assert (await client.get("/alerts?active_only=true", headers=headers)).json() == []


async def test_user_listing_and_cors(client):
    first = (await client.post("/users", json={"name": "Ana"})).json()
    second = (await client.post("/users", json={"name": "Bruno"})).json()
    response = await client.get("/users")
    assert response.status_code == 200
    assert [user["id"] for user in response.json()] == [first["id"], second["id"]]

    preflight = await client.options(
        "/users",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"


async def test_forecast_upsert_and_internal_auth(client):
    _, field, _ = await create_user_and_field(client)
    payload = {
        "field_id": field["id"],
        "event_type": "frost",
        "forecast_date": str(date.today() + timedelta(days=1)),
        "probability": 0.4,
    }
    unauthorized = await client.put("/internal/weather-forecasts", json=payload)
    assert unauthorized.status_code == 401

    headers = {"X-Internal-Token": "test-internal-token-123"}
    created = await client.put("/internal/weather-forecasts", headers=headers, json=payload)
    assert created.status_code == 200
    forecast_id = created.json()["id"]

    payload["probability"] = 0.9
    updated = await client.put("/internal/weather-forecasts", headers=headers, json=payload)
    assert updated.status_code == 200
    assert updated.json()["id"] == forecast_id
    assert updated.json()["probability"] == "0.9000"


async def test_health_checks(client):
    assert (await client.get("/health/live")).json() == {"status": "ok", "database": None}
    assert (await client.get("/health/ready")).json() == {"status": "ok", "database": "ok"}
