"""AgentRuntime —— agent = model + harness。

harness 用 LangGraph 预置 ReAct 图（model + tools 的循环）。P2 暂无工具，
图退化为单轮 model 调用；P3 注入 rag_search 工具后循环才真正发挥作用。
两机制（单 agent / workflow）共享此运行时。
"""
from collections.abc import AsyncIterator, Sequence
from typing import Any

from langchain_core.messages import (
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from langchain.agents import create_agent

from app.agents.models import default_chat_model

# 会话历史的轻量表示：(role, content)
Turn = tuple[str, str]


def _to_lc_messages(history: Sequence[Turn]) -> list[BaseMessage]:
    out: list[BaseMessage] = []
    for role, content in history:
        if role == "assistant":
            from langchain_core.messages import AIMessage

            out.append(AIMessage(content=content))
        elif role == "system":
            out.append(SystemMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    return out


class AgentRuntime:
    def __init__(
        self,
        system_prompt: str,
        *,
        model: Any | None = None,
        tools: list | None = None,
    ):
        self.system_prompt = system_prompt
        self.model = model or default_chat_model()
        self.tools = tools or []
        self.graph = create_agent(self.model, tools=self.tools, system_prompt=system_prompt)

    async def astream_tokens(
        self,
        history: Sequence[Turn],
        steps_out: list | None = None,
        *,
        silent_tools: set[str] | None = None,
        recursion_limit: int = 8,
    ) -> AsyncIterator[str]:
        """流式产出 assistant 文本增量；若传入 steps_out 则同时收集工具调用/结果。

        silent_tools：静默副作用工具名集合（如 register_customer）。当本轮「工具调用前已经
        产出过文本」且「只调用了静默工具」时，抑制工具调用后的补说文本——避免 ReAct 循环在
        静默工具返回后再生成一段多余旁白（例如「（等待客户回复中…）」）追加到同一条回复里。
        """
        messages = _to_lc_messages(history)
        config = {"recursion_limit": recursion_limit}
        if steps_out is None:
            async for chunk, _meta in self.graph.astream(
                {"messages": messages}, stream_mode="messages", config=config
            ):
                if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
                    yield chunk.content
            return
        silent = silent_tools or set()
        spoke_before_tool = False     # 工具调用前是否已产出文本
        tool_called = False           # 本轮是否已发生工具调用
        informational_tool = False    # 是否调用过「非静默(信息型)」工具
        async for mode, data in self.graph.astream(
            {"messages": messages}, stream_mode=["messages", "updates"], config=config
        ):
            if mode == "messages":
                chunk, _meta = data
                if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
                    if not tool_called:
                        spoke_before_tool = True
                        yield chunk.content
                    elif informational_tool or not spoke_before_tool:
                        # 信息型工具的工具后回答要说；或工具前没说过话(纯静默触发)也得有回复
                        yield chunk.content
                    # 否则：工具前已说过 + 仅静默工具 → 抑制工具后补说
            elif mode == "updates":
                for _node, upd in (data or {}).items():
                    for m in (upd or {}).get("messages", []) or []:
                        for tc in getattr(m, "tool_calls", None) or []:
                            tool_called = True
                            if (tc.get("name") or "") not in silent:
                                informational_tool = True
                            steps_out.append({"kind": "tool_call", "name": tc.get("name"), "args": tc.get("args")})
                        if m.__class__.__name__ == "ToolMessage":
                            steps_out.append({"kind": "tool_result", "name": getattr(m, "name", ""), "output": str(m.content)[:2000]})
