"""Bounded review payloads shared by native and MCP transports."""
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field

class RecordChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    description: Annotated[str, Field(max_length=8000)] | None = None
    tools_required: Annotated[str, Field(max_length=4000)] | None = None

class ReviewDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    change_id: Annotated[str, Field(min_length=1, max_length=64)]
    approval_token: Annotated[str, Field(min_length=1, max_length=128)]
    approve: bool
    changes: RecordChanges | None = None
    detail: Annotated[str, Field(max_length=2000)] | None = None
