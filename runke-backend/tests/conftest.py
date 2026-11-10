"""测试夹具：强制 ENV=test（NullPool），提供异步 HTTP 客户端。"""
import os

os.environ.setdefault("ENV", "test")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
