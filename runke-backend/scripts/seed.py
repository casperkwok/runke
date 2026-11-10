"""开发种子数据：创建一个 demo 用户（幂等）。

用法：uv run python scripts/seed.py
"""
import asyncio

from app.core.db import SessionLocal
from app.services.auth_service import create_user

DEMO_EMAIL = "demo@runke.dev"
DEMO_PASSWORD = "demo1234"


async def main() -> None:
    async with SessionLocal() as session:
        try:
            user = await create_user(session, DEMO_EMAIL, DEMO_PASSWORD, name="Demo")
            print(f"created demo user: {user.email} / {DEMO_PASSWORD}")
        except Exception as exc:  # noqa: BLE001
            print(f"skip (likely exists): {exc}")


if __name__ == "__main__":
    asyncio.run(main())
