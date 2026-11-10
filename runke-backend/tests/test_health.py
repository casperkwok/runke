from app.main import app


async def test_health(client):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "ok"


async def test_readiness(client):
    resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    assert resp.json()["data"]["checks"]["postgres"] == "ok"


def test_openapi_paths():
    schema = app.openapi()
    assert "/api/v1/health" in schema["paths"]
    assert "/api/v1/bots" in schema["paths"]
