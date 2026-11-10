"""代码节点的受限执行沙箱。

约定：用户代码可读取 `inputs`(dict)，把结果赋给 `output`（dict/list/标量，需可 JSON 序列化）。
受限：仅暴露白名单 builtins + json/re/math/datetime；禁止 import 与 dunder 访问；独立线程 + 超时。
注意：这是面向自托管编排者的基础沙箱，非强隔离。
"""
from __future__ import annotations

import datetime
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor

_SAFE_BUILTIN_NAMES = [
    "abs", "min", "max", "sum", "len", "range", "enumerate", "sorted", "map", "filter",
    "zip", "round", "int", "float", "str", "bool", "list", "dict", "tuple", "set",
    "any", "all", "reversed", "bool", "isinstance", "type", "repr", "format",
]


def _safe_builtins() -> dict:
    import builtins
    return {n: getattr(builtins, n) for n in _SAFE_BUILTIN_NAMES if hasattr(builtins, n)}


def run_user_code(code: str, inputs: dict, timeout: float = 3.0):
    """执行用户代码，返回 output。出错抛异常（由引擎记录为节点错误）。"""
    src = code or ""
    if "__" in src:
        raise ValueError("代码中不允许使用双下划线（__）")
    if re.search(r"(^|\n)\s*import\s", src) or "__import__" in src:
        raise ValueError("代码节点禁止 import")
    ns: dict = {
        "inputs": inputs, "output": None,
        "json": json, "re": re, "math": math, "datetime": datetime,
        "__builtins__": _safe_builtins(),
    }

    def _run():
        exec(compile(src, "<code-node>", "exec"), ns)  # noqa: S102
        return ns.get("output")

    with ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(_run).result(timeout=timeout)
