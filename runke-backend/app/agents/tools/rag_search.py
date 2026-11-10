"""rag_search 工具：把某知识库的检索能力暴露给 agent（Agentic RAG）。

agent 的 harness 可多轮调用它（换角度追问），而非依赖检索器内部多跳。
"""
from langchain_core.tools import StructuredTool

from app.rag.llamaindex_pgvector import get_provider


def retrieve_text(kb_id: str, query: str) -> str:
    """直接返回知识库检索到的文本（供 workflow kb 节点拼接）。"""
    chunks = get_provider().retrieve(kb_id, query)
    if not chunks:
        return ""
    return "\n\n".join(f"[片段{i + 1}] {c.text}" for i, c in enumerate(chunks))


def make_rag_search_tool(kb_id: str) -> StructuredTool:
    def rag_search(query: str) -> str:
        """在绑定的知识库中检索与问题相关的资料片段。"""
        chunks = get_provider().retrieve(kb_id, query)
        if not chunks:
            return "（知识库中未检索到相关内容）"
        return "\n\n".join(
            f"[片段{i + 1}] {c.text}" for i, c in enumerate(chunks)
        )

    return StructuredTool.from_function(
        func=rag_search,
        name="rag_search",
        description="当需要依据知识库回答专业问题时，用此工具检索资料。输入一个检索问题字符串。",
    )
