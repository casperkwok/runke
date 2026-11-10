"""v1 路由聚合。后续阶段在此挂载 auth / bots / conversations / agents / ... 路由。"""
from fastapi import APIRouter

from app.api.v1 import (
    auth,
    bots,
    chats,
    conversations,
    customers,
    health,
    knowledge_bases,
    openapi_chat,
    org,
    public,
    skills,
    voice_calls,
    voices,
    wf_exp,
    workflows,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(bots.router)
api_router.include_router(conversations.router)
api_router.include_router(chats.router)
api_router.include_router(customers.router)
api_router.include_router(public.router)
api_router.include_router(openapi_chat.router)
api_router.include_router(knowledge_bases.router)
api_router.include_router(knowledge_bases.docs_router)
api_router.include_router(skills.router)
api_router.include_router(skills.connectors_router)
api_router.include_router(workflows.router)
api_router.include_router(workflows.runs_router)
api_router.include_router(org.router)
api_router.include_router(voices.router)
api_router.include_router(voice_calls.router)
api_router.include_router(voice_calls.rec_router)
api_router.include_router(wf_exp.router)
