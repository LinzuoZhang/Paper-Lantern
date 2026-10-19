"""Lightweight timing diagnostics for OpenAI-compatible requests."""

import logging
from time import perf_counter
from urllib.parse import urlsplit


logger = logging.getLogger(__name__)


class RequestTiming:
    """Record first-occurrence timings without retaining prompts or credentials."""

    def __init__(self, payload, endpoint, streaming=False):
        self._started = perf_counter()
        self._finished = False
        self.data = {
            "model": payload.get("model", ""),
            "host": urlsplit(endpoint).hostname,
            "streaming": bool(streaming),
        }

    def mark(self, name):
        if not self._finished and name not in self.data:
            self.data[name] = perf_counter() - self._started

    def finish(self, error=None):
        if self._finished:
            return
        self.mark("total_s")
        self._finished = True
        if error is not None:
            self.data["error_type"] = type(error).__name__
        logger.debug("LLM request timing: %s", self.data)
