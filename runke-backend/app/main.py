"""FastAPI 应用装配：生命周期、CORS、统一异常、路由、OpenAPI。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.db import engine
from app.core.logging import configure_logging, logger
from app.core.redis import redis_client
from app.schemas.common import ErrorBody, ErrorResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("app.startup", env=settings.env, app=settings.app_name)
    yield
    await engine.dispose()
    await redis_client.aclose()
    logger.info("app.shutdown")


app = FastAPI(
    title=f"{settings.app_name} API",
    version="0.1.0",
    description="Runke 智能体平台统一后端。RESTful + 统一信封。",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {"msg": "invalid request"}
    body = ErrorResponse(
        error=ErrorBody(code="VALIDATION_ERROR", message=str(first.get("msg")), details={"errors": exc.errors()})
    )
    return JSONResponse(status_code=422, content=body.model_dump())


@app.exception_handler(StarletteHTTPException)
async def http_handler(request: Request, exc: StarletteHTTPException):
    body = ErrorResponse(error=ErrorBody(code="HTTP_ERROR", message=str(exc.detail)))
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/", include_in_schema=False)
async def root():
    return {"service": settings.app_name, "docs": "/docs", "health": f"{settings.api_v1_prefix}/health"}
