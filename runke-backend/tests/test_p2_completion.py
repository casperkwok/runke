"""P2：单 Agent completion。

- 默认只测「无 key 时返回明确 400」与鉴权，不打真实 LLM。
- 置环境变量 RUN_LLM_TESTS=1 时，才做一次真实 SSE 流式调用（消耗额度）。
"""
import os
import uuid

import pytest

from app.core.config import settings


async def _login_make_conv(client) -> tuple[dict, str]:
    email = f"t_{uuid.uuid4().hex[:8]}@runke.dev"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pw12345678"},
    )
    tok = (
        await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "pw12345678"}
        )
    ).json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    bid = (
        await client.post("/api/v1/bots", json={"name": "b", "bot_role": "pet_doctor"}, headers=h)
    ).json()["data"]["id"]
    cid = (
        await client.post(f"/api/v1/bots/{bid}/conversations", json={}, headers=h)
    ).json()["data"]["id"]
    return h, cid


async def test_completion_requires_key_or_works(client):
    h, cid = await _login_make_conv(client)
    resp = await client.post(
        f"/api/v1/conversations/{cid}/completions",
        json={"content": "你好"},
        headers=h,
    )
    if not settings.deepseek_api_key:
        assert resp.status_code == 400  # 明确提示缺 key
    else:
        # 有 key：端点应进入流式（200, event-stream）
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]


@pytest.mark.skipif(
    os.getenv("RUN_LLM_TESTS") != "1", reason="需 RUN_LLM_TESTS=1 才打真实 LLM"
)
async def test_real_streaming(client):
    h, cid = await _login_make_conv(client)
    async with client.stream(
        "POST",
        f"/api/v1/conversations/{cid}/completions",
        json={"content": "用一个字回答：在吗"},
        headers=h,
    ) as resp:
        assert resp.status_code == 200
        body = ""
        async for chunk in resp.aiter_text():
            body += chunk
    assert '"type": "done"' in body
