"""集中导入所有 ORM 模型，确保 Alembic autogenerate / metadata 能发现它们。"""
from app.models.api_token import ApiToken
from app.models.base import Base
from app.models.bot import Bot, Conversation, Message
from app.models.customer import Customer
from app.models.customer_pack import CustomerPack, customer_pack_members
from app.models.knowledge import Document, KnowledgeBase
from app.models.org import Department, Member
from app.models.voice import Voice
from app.models.voice_call import CallRecord, CallTask
from app.models.skill import Connector, Skill
from app.models.user import User
from app.models.workflow import Workflow, WorkflowRun

__all__ = [
    "Base",
    "User",
    "ApiToken",
    "Bot",
    "Conversation",
    "Message",
    "Customer",
    "CustomerPack",
    "customer_pack_members",
    "KnowledgeBase",
    "Document",
    "Department",
    "Member",
    "Voice",
    "CallTask",
    "CallRecord",
    "Connector",
    "Skill",
    "Workflow",
    "WorkflowRun",
]
