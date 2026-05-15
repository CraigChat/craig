#!/usr/bin/env python3
"""Provider chain for AI-powered transcript summarization."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from logging_utils import log


DEFAULT_NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
DEFAULT_AI_MODEL = "mistralai/mistral-large-3-675b-instruct-2512"
DEFAULT_RETRY_DELAY = 120

SUMMARY_PROMPT = (
    "Summarize the meeting transcript below in French. Preserve speaker names exactly as shown.\n\n"
    "Output rules:\n"
    "- Write in French. Common tech/industry anglicisms are acceptable.\n"
    "- Start directly with the summary. No intro sentence.\n"
    "- Use ## for section headers.\n"
    "- NEVER output the character sequence --- anywhere. It breaks rendering.\n"
    "- Use bullet points. Be concise.\n"
    "- Omit any section that has no relevant content.\n\n"
    "## Résumé\n"
    "## Décisions\n"
    "## Actions\n"
    "## Questions ouvertes\n\n"
    "Transcript:\n\n"
)


def _env_float(name: str, alt_name: str, default: float) -> float:
    raw = os.environ.get(name) or os.environ.get(alt_name)
    return float(raw) if raw else default


def _env_int(name: str, alt_name: str, default: int) -> int:
    raw = os.environ.get(name) or os.environ.get(alt_name)
    return int(raw) if raw else default


def _parse_sse_payload(line: str) -> dict[str, Any] | None:
    if not line.startswith("data:"):
        return None
    data = line.removeprefix("data:").strip()
    if not data or data == "[DONE]":
        return None
    return json.loads(data)


class SummaryProvider(ABC):
    @abstractmethod
    def label(self) -> str: ...

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def summarize(self, transcript: str, output_path: Path) -> None: ...


class ChatCompletionsProvider(SummaryProvider):
    def __init__(self, url: str, api_key: str, model: str) -> None:
        self.url = url
        self.api_key = api_key
        self.model = model

    def label(self) -> str:
        return f"{urlparse(self.url).netloc}/{self.model}"

    def is_available(self) -> bool:
        return bool(self.api_key)

    def summarize(self, transcript: str, output_path: Path) -> None:
        partial_path = output_path.with_suffix(output_path.suffix + ".partial")
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": f"{SUMMARY_PROMPT}{transcript}"}],
            "max_tokens": _env_int("AI_SUMMARY_MAX_TOKENS", "NVIDIA_SUMMARY_MAX_TOKENS", 2048),
            "temperature": _env_float("AI_SUMMARY_TEMPERATURE", "NVIDIA_SUMMARY_TEMPERATURE", 0.15),
            "top_p": _env_float("AI_SUMMARY_TOP_P", "NVIDIA_SUMMARY_TOP_P", 1.0),
            "frequency_penalty": _env_float("AI_SUMMARY_FREQUENCY_PENALTY", "NVIDIA_SUMMARY_FREQUENCY_PENALTY", 0.0),
            "presence_penalty": _env_float("AI_SUMMARY_PRESENCE_PENALTY", "NVIDIA_SUMMARY_PRESENCE_PENALTY", 0.0),
            "stream": True,
        }
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "text/event-stream",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        log(f"Summarizing with {self.label()}")
        try:
            with urllib.request.urlopen(request, timeout=900) as response, partial_path.open("w", encoding="utf-8") as f:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    chunk = _parse_sse_payload(line)
                    if chunk is None:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    content = choice.get("delta", {}).get("content", "") or choice.get("message", {}).get("content", "")
                    if content:
                        f.write(content)
                        f.flush()
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{self.label()} failed with HTTP {exc.code}: {details}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"{self.label()} failed: {exc}") from exc

        partial_path.replace(output_path)
        log(f"Wrote summary to {output_path}")


class SummaryChain:
    def __init__(self, providers: list[SummaryProvider], retry_delay_s: int) -> None:
        self._providers = [p for p in providers if p.is_available()]
        self._retry_delay_s = retry_delay_s

    def run(self, transcript_path: Path) -> Path | None:
        if not self._providers:
            log("No summary providers configured — skipping summarization")
            return None

        transcript = transcript_path.read_text(encoding="utf-8", errors="replace")
        errors: list[str] = []
        total = len(self._providers)

        ny_now = datetime.now(ZoneInfo("America/New_York"))
        timestamp = ny_now.strftime("%Y-%-m-%-d_%Hh%M")
        recording_id = transcript_path.parent.name.removeprefix("craig_")

        for i, provider in enumerate(self._providers):
            if i > 0:
                log(f"Waiting {self._retry_delay_s}s before next provider...")
                time.sleep(self._retry_delay_s)
            log(f"[{i + 1}/{total}] Trying {provider.label()}")

            output_path = transcript_path.parent / f"{timestamp}_{recording_id}_summary.md"

            try:
                provider.summarize(transcript, output_path)
                return output_path
            except Exception as exc:
                msg = f"{provider.label()}: {exc}"
                log(f"Provider failed: {msg}")
                errors.append(msg)

        raise RuntimeError("All summary providers failed:\n" + "\n".join(f"  - {e}" for e in errors))


def build_summary_chain() -> SummaryChain:
    retry_delay = int(os.environ.get("SUMMARY_RETRY_DELAY_SECONDS", DEFAULT_RETRY_DELAY))
    providers: list[SummaryProvider] = []

    # Primary provider from NVIDIA_* vars
    nvidia_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    nvidia_url = os.environ.get("NVIDIA_API_URL", DEFAULT_NVIDIA_API_URL)
    primary_model = (
        os.environ.get("AI_SUMMARY_MODEL")
        or os.environ.get("NVIDIA_SUMMARY_MODEL")
        or DEFAULT_AI_MODEL
    )
    providers.append(ChatCompletionsProvider(nvidia_url, nvidia_key, primary_model))

    # Fallbacks from SUMMARY_FALLBACK_CHAIN (semicolon-separated url|KEY_VAR|model)
    for entry in os.environ.get("SUMMARY_FALLBACK_CHAIN", "").split(";"):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split("|")
        if len(parts) != 3:
            log(f"Skipping malformed fallback entry (expected url|KEY_VAR|model): {entry}")
            continue
        url, key_var, model = parts
        api_key = os.environ.get(key_var.strip(), "").strip()
        providers.append(ChatCompletionsProvider(url.strip(), api_key, model.strip()))

    return SummaryChain(providers, retry_delay)
