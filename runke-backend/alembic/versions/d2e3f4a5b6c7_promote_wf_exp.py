"""实验工作流转正：workflow_definition 为空而 workflow_exp.graph 有图的 bot，提升实验图为正式图。

新版编辑器（AI 编排画布）直接读写 workflow_definition；workflow_exp 此后仅存 AI 对话
历史（graph 键保留作备份，不再读取）。正式图非空时一律以正式为准，不覆盖。

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-12

"""
import json

import sqlalchemy as sa
from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, workflow_definition, workflow_exp FROM bots WHERE orchestration_type = 'workflow'"
    )).fetchall()
    for bot_id, definition, exp in rows:
        def_nodes = (definition or {}).get("nodes") or []
        exp_graph = (exp or {}).get("graph") or {}
        if not def_nodes and exp_graph.get("nodes"):
            conn.execute(
                sa.text("UPDATE bots SET workflow_definition = :d WHERE id = :i"),
                {"d": json.dumps({"nodes": exp_graph["nodes"], "edges": exp_graph.get("edges") or []}), "i": bot_id},
            )


def downgrade() -> None:
    pass  # 提升不可自动逆转（workflow_exp.graph 原样保留，可手工恢复）
