"""统一响应信封（见 ARCHITECTURE.md §4.1）。"""
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Meta(BaseModel):
    page: int | None = None
    page_size: int | None = None
    total: int | None = None


class Envelope(BaseModel, Generic[T]):
    data: T
    meta: Meta | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    error: ErrorBody
