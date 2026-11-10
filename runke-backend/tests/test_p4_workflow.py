"""P4：Workflow CRUD（无 LLM）+ 条件路由运行（RUN_LLM_TESTS=1 才打真实 LLM）。"""
import os
import uuid

import pytest


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


_WF = {
    "name": "情绪分流",
    "definition": {
        "entry": "classify",
        "nodes": {
            "classify": {
                "type": "llm",
                "system": "你是情绪分类器。只输出一个词：正面 或 负面。",
                "prompt": "判断情绪：{input}",
                "branches": {"rules": [{"contains": "正面", "goto": "happy"}], "default": "comfort"},
            },
            "happy": {"type": "llm", "prompt": "热情回应：{input}", "next": None},
            "comfort": {"type": "llm", "prompt": "温暖安慰：{input}", "next": None},
        },
    },
}


async def test_workflow_crud(client):
    h = await _login(client)
    wf = (await client.post("/api/v1/workflows", json=_WF, headers=h)).json()["data"]
    assert wf["definition"]["entry"] == "classify"
    wf_id = wf["id"]

    got = (await client.get(f"/api/v1/workflows/{wf_id}", headers=h)).json()["data"]
    assert got["id"] == wf_id

    lst = (await client.get("/api/v1/workflows", headers=h)).json()
    assert lst["meta"]["total"] >= 1


async def test_workflow_isolation(client):
    h = await _login(client)
    other = await _login(client)
    wf_id = (await client.post("/api/v1/workflows", json=_WF, headers=h)).json()["data"]["id"]
    assert (await client.get(f"/api/v1/workflows/{wf_id}", headers=other)).status_code == 404


@pytest.mark.skipif(os.getenv("RUN_LLM_TESTS") != "1", reason="需 RUN_LLM_TESTS=1")
async def test_workflow_run(client):
    h = await _login(client)
    wf_id = (await client.post("/api/v1/workflows", json=_WF, headers=h)).json()["data"]["id"]
    run = (
        await client.post(
            f"/api/v1/workflows/{wf_id}/runs",
            json={"input": "我今天搞砸了项目，好沮丧"},
            headers=h,
        )
    ).json()["data"]
    assert run["status"] == "done"
    # 负面输入应经 classify → comfort
    nodes = [t["node"] for t in run["trace"]]
    assert "classify" in nodes and "comfort" in nodes
