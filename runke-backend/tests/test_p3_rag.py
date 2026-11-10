"""P3：知识库 CRUD + 文档 ingest + 检索（用真实 fastembed + pgvector，无需 LLM key）。"""
import uuid


async def _login(client) -> dict:
    email = f"t_{uuid.uuid4().hex[:8]}@runke.dev"
    await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "pw12345678"}
    )
    tok = (
        await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "pw12345678"}
        )
    ).json()["data"]["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def test_kb_ingest_and_retrieve(client):
    h = await _login(client)

    kb = (
        await client.post("/api/v1/knowledge-bases", json={"name": "测试库"}, headers=h)
    ).json()["data"]
    kb_id = kb["id"]

    r = await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={"title": "规则", "content": "本系统的魔法口令是 RUNKE-7788，仅授权用户可见。"},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["data"]["chunk_count"] >= 1

    r = await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/queries",
        json={"query": "魔法口令是什么"},
        headers=h,
    )
    assert r.status_code == 200
    chunks = r.json()["data"]["chunks"]
    assert chunks and "RUNKE-7788" in chunks[0]["text"]


async def test_kb_isolation(client):
    h = await _login(client)
    other = await _login(client)
    kb_id = (
        await client.post("/api/v1/knowledge-bases", json={"name": "A库"}, headers=h)
    ).json()["data"]["id"]
    # 他人不可访问
    assert (await client.get(f"/api/v1/knowledge-bases/{kb_id}", headers=other)).status_code == 404


async def test_bot_binds_kb(client):
    h = await _login(client)
    kb_id = (
        await client.post("/api/v1/knowledge-bases", json={"name": "B库"}, headers=h)
    ).json()["data"]["id"]
    bot = (
        await client.post(
            "/api/v1/bots",
            json={"name": "b", "knowledge_base_id": kb_id},
            headers=h,
        )
    ).json()["data"]
    assert bot["knowledge_base_id"] == kb_id
