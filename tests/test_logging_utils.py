"""Tests for logging_utils.py."""

from __future__ import annotations

import io
import re

import logging_utils


def test_timestamp_format() -> None:
    ts = logging_utils.timestamp()
    # e.g. "2026-05-20 21:59:00 EDT"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \w+", ts), f"bad format: {ts!r}"


def test_log_writes_to_stdout() -> None:
    buf = io.StringIO()
    logging_utils.log("hello world", stream=buf)
    assert "hello world" in buf.getvalue()


def test_log_writes_to_stderr() -> None:
    buf = io.StringIO()
    logging_utils.log("an error", stream=buf)
    assert "an error" in buf.getvalue()


def test_log_includes_timestamp() -> None:
    buf = io.StringIO()
    logging_utils.log("msg", stream=buf)
    line = buf.getvalue()
    assert re.search(r"\[\d{4}-\d{2}-\d{2}", line)
