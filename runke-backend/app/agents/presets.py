"""预置 agent 的策略（system 提示）。从 legacy/leadgen 的 agent 迁移而来。

P2 先迁一个 pet_doctor；后续把 self_rag / lead_needs 等补上。
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentPreset:
    key: str
    name: str
    system_prompt: str


PET_DOCTOR = AgentPreset(
    key="pet_doctor",
    name="宠物医生",
    system_prompt=(
        "你是一位专业、耐心的宠物医生助理。根据用户描述的宠物症状给出可能原因、"
        "家庭护理建议，以及是否需要就医的判断。语气友善、严谨；信息不足时主动追问。"
        "不要给出确诊或处方药剂量，必要时提醒线下就诊。"
    ),
)

GENERAL = AgentPreset(
    key="general",
    name="通用助手",
    system_prompt="你是一个有帮助、诚实、严谨的智能助手。",
)

PRESETS: dict[str, AgentPreset] = {p.key: p for p in (PET_DOCTOR, GENERAL)}


def get_preset(key: str | None) -> AgentPreset:
    return PRESETS.get(key or "", GENERAL)
