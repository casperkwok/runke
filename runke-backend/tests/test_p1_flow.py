"""P1 端到端：注册→登录→建bot→建会话→发消息→读消息。

需要本地 Postgres 可用且已 alembic upgrade head。
"""
import uuid


async def _register_and_login(client) -> str:
    email = f"t_{uuid.uuid4().hex[:8]}@runke.dev"
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw12345678", "name": "T"},
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "pw12345678"}
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def test_full_flow(client):
    token = await _register_and_login(client)
    h = {"Authorization": f"Bearer {token}"}

    assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 200

    r = await client.post(
        "/api/v1/bots", json={"name": "测试bot", "welcome": "你好"}, headers=h
    )
    assert r.status_code == 201, r.text
    bot_id = r.json()["data"]["id"]

    r = await client.get("/api/v1/bots", headers=h)
    assert r.status_code == 200 and r.json()["meta"]["total"] >= 1

    r = await client.patch(f"/api/v1/bots/{bot_id}", json={"welcome": "改了"}, headers=h)
    assert r.json()["data"]["welcome"] == "改了"

    r = await client.post(
        f"/api/v1/bots/{bot_id}/conversations", json={"title": "会话1"}, headers=h
    )
    assert r.status_code == 201
    conv_id = r.json()["data"]["id"]

    r = await client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        json={"role": "user", "content": "在吗"},
        headers=h,
    )
    assert r.status_code == 201

    r = await client.get(f"/api/v1/conversations/{conv_id}/messages", headers=h)
    assert r.status_code == 200 and len(r.json()["data"]) == 1


async def test_unauthorized(client):
    r = await client.get("/api/v1/bots")
    assert r.status_code in (401, 403)


async def test_cannot_access_others_bot(client):
    token_a = await _register_and_login(client)
    ha = {"Authorization": f"Bearer {token_a}"}
    bot_id = (
        await client.post("/api/v1/bots", json={"name": "A的bot"}, headers=ha)
    ).json()["data"]["id"]

    token_b = await _register_and_login(client)
    hb = {"Authorization": f"Bearer {token_b}"}
    r = await client.get(f"/api/v1/bots/{bot_id}", headers=hb)
    assert r.status_code == 404
