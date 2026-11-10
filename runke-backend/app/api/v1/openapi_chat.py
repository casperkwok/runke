"""OpenAPI：外部应用用 API 令牌（Bearer）调用某个 Bot 的对话。

    curl -N -X POST {base}/api/v1/openapi/chat \
      -H "Authorization: Bearer rk-xxxx" -H "Content-Type: application/json" \
      -d '{"content":"你好"}'

返回 SSE 流（与站内 completion 一致）。令牌绑定到具体 Bot。
"""
import uuid

from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.db import SessionLocal
from app.models.bot import Conversation
from app.schemas.public import PublicChatRequest
from app.services import completion_service, token_service

router = APIRouter(prefix="/openapi", tags=["openapi"])


@router.post("/chat", summary="用 API 令牌调用 Bot 对话（SSE 流式）")
async def openapi_chat(
    body: PublicChatRequest, authorization: str = Header(default="")
) -> StreamingResponse:
    completion_service.ensure_llm_ready()
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 Bearer 令牌")
    key = authorization.split(" ", 1)[1].strip()

    async with SessionLocal() as session:
        token = await token_service.verify_token(session, key)
        bot_id = token.bot_id
        owner_id = token.owner_id
        conv_id = body.conversation_id
        if conv_id is not None:
            conv = await session.get(Conversation, conv_id)
            if conv is None or conv.bot_id != bot_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
        else:
            conv = Conversation(bot_id=bot_id, title="API 会话", channel="api")
            session.add(conv)
            await session.commit()
            await session.refresh(conv)
            conv_id = conv.id

    async def gen():
        yield f'data: {{"type":"conversation","id":"{conv_id}"}}\n\n'
        async for chunk in completion_service.sse_stream(conv_id, owner_id, body.content):
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")
