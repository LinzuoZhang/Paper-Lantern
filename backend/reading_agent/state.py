"""Run options and graph state, without optional runtime imports."""

from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict


class AgentError(RuntimeError):
    """An actionable failure, with no credential or model-prompt dump."""


class AgentCancelled(AgentError):
    pass


@dataclass(frozen=True)
class AgentOptions:
    task: str
    library_dir: Path
    category_ids: tuple[str, ...] = ()
    hashes: tuple[str, ...] = ()
    max_catalog: int = 80
    max_rounds: int = 8
    max_tool_calls: int = 24
    max_context_chars: int = 160_000
    tool_timeout: int = 60
    model_timeout: int = 90
    total_timeout: int = 600
    strict_evidence: bool = True
    conversation: tuple[dict, ...] = ()

    def __post_init__(self):
        if not isinstance(self.task, str) or not self.task.strip() or len(self.task) > 8000:
            raise ValueError("研究任务须为 1–8000 字符的非空文本。")
        for name, minimum, maximum in (
            ("max_catalog", 1, 200), ("max_rounds", 1, 20), ("max_tool_calls", 1, 100),
            ("max_context_chars", 20_000, 500_000), ("tool_timeout", 1, 300),
            ("model_timeout", 1, 300), ("total_timeout", 1, 3600),
        ):
            value = getattr(self, name)
            if type(value) is not int or not minimum <= value <= maximum:
                raise ValueError(f"{name} must be between {minimum} and {maximum}.")
        if any(not isinstance(value, str) or not value.strip() for value in (*self.hashes, *self.category_ids)):
            raise ValueError("文献 ID 和分类 ID 不能为空。")


class ResearchState(TypedDict, total=False):
    messages: list[dict]
    model_calls: int
    tool_calls: int
    repairs: int
    evidence: dict[str, dict]
    report: str
    retry: bool
    claims: dict[str, dict]
    verification: dict
    catalog: list[dict]
    catalog_errors: list[dict]
    scope_count: int
    allowed_ids: list[str]
    finalizing: bool
    finalization_calls: int
    finalization_tool_calls: int
    finalization_version: int
    validation_error: str
    progress_summary: str
    focus_passage_ids: list[str]
