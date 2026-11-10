"""导出 OpenAPI schema 到 openapi.json，供前端 codegen 生成 typed client。

用法：python scripts/export_openapi.py [输出路径]
"""
import json
import sys
from pathlib import Path

# 允许从仓库根直接运行
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.json")
    schema = app.openapi()
    out.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OpenAPI exported -> {out} ({len(schema.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
