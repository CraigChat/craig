"""Tests for ChatCompletionsProvider.summarize() — Streaming response handling."""

from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import summarizer


def test_provider_summarize_streams_response(tmp_path: Path) -> None:
    """Test that summarize correctly processes streaming SSE response."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "test_model"
    )
    output_path = tmp_path / "summary.md"

    # Mock streaming response with SSE format
    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        b'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        b"data: [DONE]\n",
    ]

    mock_response = MagicMock()
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=None)
    mock_response.__iter__ = MagicMock(return_value=iter(sse_lines))

    with patch("urllib.request.urlopen", return_value=mock_response):
        provider.summarize("test transcript", output_path)

    # Verify summary was written
    assert output_path.exists()
    assert output_path.read_text(encoding="utf-8") == "Hello world"


def test_provider_summarize_handles_partial_on_error(tmp_path: Path) -> None:
    """Test that partial file is cleaned up on HTTP error."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "test_model"
    )
    output_path = tmp_path / "summary.md"

    http_error = urllib.error.HTTPError(
        "https://api.example.com/v1",
        401,
        "Unauthorized",
        {},  # type: ignore[arg-type]
        io.BytesIO(b"Invalid key"),
    )

    with (
        patch("urllib.request.urlopen", side_effect=http_error),
        pytest.raises(RuntimeError, match="HTTP 401"),
    ):
        provider.summarize("test transcript", output_path)

    # Final output should not exist
    assert not output_path.exists()
    # Partial file should also be cleaned up
    partial_path = output_path.with_suffix(output_path.suffix + ".partial")
    assert not partial_path.exists()


def test_provider_summarize_builds_correct_payload(tmp_path: Path) -> None:
    """Test that request payload includes correct model and parameters."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "mistral-large"
    )
    output_path = tmp_path / "summary.md"

    captured_request = None

    def mock_urlopen(request, timeout=None):
        nonlocal captured_request
        captured_request = request
        mock_response = MagicMock()
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)
        mock_response.__iter__ = MagicMock(return_value=iter([b"data: [DONE]\n"]))
        return mock_response

    with patch("urllib.request.urlopen", side_effect=mock_urlopen):
        provider.summarize("test content", output_path)

    # Verify request details
    assert captured_request is not None
    assert captured_request.get_full_url() == "https://api.example.com/v1"
    payload = json.loads(captured_request.data.decode("utf-8"))
    assert payload["model"] == "mistral-large"
    assert payload["stream"] is True
    assert payload["messages"][0]["role"] == "user"
    assert "test content" in payload["messages"][0]["content"]


def test_provider_summarize_warning_on_non_stop_finish(tmp_path: Path) -> None:
    """Test that warning is logged when finish_reason is not 'stop'."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "test_model"
    )
    output_path = tmp_path / "summary.md"

    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"summary"},"finish_reason":"length"}]}\n',
        b"data: [DONE]\n",
    ]

    mock_response = MagicMock()
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=None)
    mock_response.__iter__ = MagicMock(return_value=iter(sse_lines))

    with (
        patch("urllib.request.urlopen", return_value=mock_response),
        patch("summarizer.log") as mock_log,
    ):
        provider.summarize("test", output_path)

    # Check that a warning was logged about truncation
    warning_calls = [call for call in mock_log.call_args_list if "WARNING" in str(call)]
    assert len(warning_calls) > 0


def test_provider_summarize_handles_url_error(tmp_path: Path) -> None:
    """Test that URLError is properly converted to RuntimeError."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "test_model"
    )
    output_path = tmp_path / "summary.md"

    url_error = urllib.error.URLError("Network is unreachable")

    with (
        patch("urllib.request.urlopen", side_effect=url_error),
        pytest.raises(RuntimeError, match="failed"),
    ):
        provider.summarize("test", output_path)


def test_provider_summarize_accumulates_tokens(tmp_path: Path) -> None:
    """Test that token usage is logged from SSE stream."""
    provider = summarizer.ChatCompletionsProvider(
        "https://api.example.com/v1", "test_key", "test_model"
    )
    output_path = tmp_path / "summary.md"

    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"test"}}]}\n',
        b'data: {"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n',
        b"data: [DONE]\n",
    ]

    mock_response = MagicMock()
    mock_response.__enter__ = MagicMock(return_value=mock_response)
    mock_response.__exit__ = MagicMock(return_value=None)
    mock_response.__iter__ = MagicMock(return_value=iter(sse_lines))

    with (
        patch("urllib.request.urlopen", return_value=mock_response),
        patch("summarizer.log") as mock_log,
    ):
        provider.summarize("test", output_path)

    # Check that token counts were logged
    token_calls = [call for call in mock_log.call_args_list if "Tokens" in str(call)]
    assert len(token_calls) > 0
