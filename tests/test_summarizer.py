"""Tests for summarizer.py — pure-logic functions only."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import summarizer

# ---------------------------------------------------------------------------
# _env_float / _env_int
# ---------------------------------------------------------------------------


def test_env_float_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_TEST_F1", raising=False)
    monkeypatch.delenv("TASMAS_TEST_F2", raising=False)
    assert summarizer._env_float("TASMAS_TEST_F1", "TASMAS_TEST_F2", 3.14) == 3.14


def test_env_float_primary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASMAS_TEST_F1", "2.5")
    monkeypatch.delenv("TASMAS_TEST_F2", raising=False)
    assert summarizer._env_float("TASMAS_TEST_F1", "TASMAS_TEST_F2", 0.0) == 2.5


def test_env_float_alt_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_TEST_F1", raising=False)
    monkeypatch.setenv("TASMAS_TEST_F2", "1.1")
    assert summarizer._env_float("TASMAS_TEST_F1", "TASMAS_TEST_F2", 0.0) == pytest.approx(1.1)


def test_env_int_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_TEST_I1", raising=False)
    monkeypatch.delenv("TASMAS_TEST_I2", raising=False)
    assert summarizer._env_int("TASMAS_TEST_I1", "TASMAS_TEST_I2", 42) == 42


def test_env_int_primary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASMAS_TEST_I1", "100")
    monkeypatch.delenv("TASMAS_TEST_I2", raising=False)
    assert summarizer._env_int("TASMAS_TEST_I1", "TASMAS_TEST_I2", 0) == 100


def test_env_int_alt_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_TEST_I1", raising=False)
    monkeypatch.setenv("TASMAS_TEST_I2", "7")
    assert summarizer._env_int("TASMAS_TEST_I1", "TASMAS_TEST_I2", 0) == 7


# ---------------------------------------------------------------------------
# _parse_sse_payload
# ---------------------------------------------------------------------------


def test_parse_sse_non_data_line() -> None:
    assert summarizer._parse_sse_payload("event: ping") is None


def test_parse_sse_empty_data() -> None:
    assert summarizer._parse_sse_payload("data:") is None
    assert summarizer._parse_sse_payload("data:   ") is None


def test_parse_sse_done() -> None:
    assert summarizer._parse_sse_payload("data: [DONE]") is None


def test_parse_sse_valid_json() -> None:
    payload: dict = {"choices": [{"delta": {"content": "hello"}}]}
    result = summarizer._parse_sse_payload(f"data: {json.dumps(payload)}")
    assert result == payload


def test_parse_sse_with_usage() -> None:
    payload = {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
    result = summarizer._parse_sse_payload(f"data: {json.dumps(payload)}")
    assert result is not None
    assert result["usage"]["total_tokens"] == 15


def test_parse_sse_invalid_json_raises() -> None:
    with pytest.raises(json.JSONDecodeError):
        summarizer._parse_sse_payload("data: {not valid json}")


# ---------------------------------------------------------------------------
# ChatCompletionsProvider
# ---------------------------------------------------------------------------


def test_provider_label() -> None:
    p = summarizer.ChatCompletionsProvider("https://api.example.com/v1/chat/completions", "key", "gpt-4")
    assert p.label() == "api.example.com/gpt-4"


def test_provider_is_available_with_key() -> None:
    p = summarizer.ChatCompletionsProvider("https://api.example.com/", "mykey", "model")
    assert p.is_available() is True


def test_provider_is_available_empty_key() -> None:
    p = summarizer.ChatCompletionsProvider("https://api.example.com/", "", "model")
    assert p.is_available() is False


# ---------------------------------------------------------------------------
# SummaryChain — construction
# ---------------------------------------------------------------------------


def test_summary_chain_filters_unavailable_providers() -> None:
    available = summarizer.ChatCompletionsProvider("https://a.com/", "key", "m")
    unavailable = summarizer.ChatCompletionsProvider("https://b.com/", "", "m")
    chain = summarizer.SummaryChain([available, unavailable], 0)
    assert len(chain._providers) == 1
    assert chain._providers[0] is available


def test_summary_chain_empty_when_all_unavailable() -> None:
    p = summarizer.ChatCompletionsProvider("https://a.com/", "", "m")
    chain = summarizer.SummaryChain([p], 0)
    assert chain._providers == []


# ---------------------------------------------------------------------------
# SummaryChain.run
# ---------------------------------------------------------------------------


def test_summary_chain_run_no_providers_returns_none(tmp_path: Path) -> None:
    transcript = tmp_path / "craig_REC1" / "transcript.txt"
    transcript.parent.mkdir()
    transcript.write_text("hello", encoding="utf-8")
    chain = summarizer.SummaryChain([], 0)
    assert chain.run(transcript, "2026-1-1_00h00") is None


def test_summary_chain_run_success(tmp_path: Path) -> None:
    provider = MagicMock()
    provider.is_available.return_value = True
    provider.label.return_value = "test/model"
    work_dir = tmp_path / "craig_REC42"
    work_dir.mkdir()
    transcript = work_dir / "transcript.txt"
    transcript.write_text("some transcript", encoding="utf-8")
    chain = summarizer.SummaryChain([provider], 0)
    result = chain.run(transcript, "2026-1-1_00h00")
    assert result is not None
    provider.summarize.assert_called_once()
    args = provider.summarize.call_args
    assert args[0][0] == "some transcript"


def test_summary_chain_run_falls_back_on_failure(tmp_path: Path) -> None:
    failing = MagicMock()
    failing.is_available.return_value = True
    failing.label.return_value = "failing/model"
    failing.summarize.side_effect = RuntimeError("timeout")

    succeeding = MagicMock()
    succeeding.is_available.return_value = True
    succeeding.label.return_value = "good/model"

    work_dir = tmp_path / "REC1"
    work_dir.mkdir()
    transcript = work_dir / "transcript.txt"
    transcript.write_text("text", encoding="utf-8")

    with patch("summarizer.time.sleep"):
        chain = summarizer.SummaryChain([failing, succeeding], 1)
        result = chain.run(transcript, "2026-1-1_00h00")

    assert result is not None
    failing.summarize.assert_called_once()
    succeeding.summarize.assert_called_once()


def test_summary_chain_run_raises_when_all_fail(tmp_path: Path) -> None:
    p1 = MagicMock()
    p1.is_available.return_value = True
    p1.label.return_value = "p1/model"
    p1.summarize.side_effect = RuntimeError("fail1")

    p2 = MagicMock()
    p2.is_available.return_value = True
    p2.label.return_value = "p2/model"
    p2.summarize.side_effect = RuntimeError("fail2")

    work_dir = tmp_path / "REC2"
    work_dir.mkdir()
    transcript = work_dir / "transcript.txt"
    transcript.write_text("text", encoding="utf-8")

    with patch("summarizer.time.sleep"):
        chain = summarizer.SummaryChain([p1, p2], 1)
        with pytest.raises(RuntimeError, match="All summary providers failed"):
            chain.run(transcript, "2026-1-1_00h00")


def test_summary_chain_run_sleeps_between_providers(tmp_path: Path) -> None:
    p1 = MagicMock()
    p1.is_available.return_value = True
    p1.label.return_value = "p1/model"
    p1.summarize.side_effect = RuntimeError("fail")

    p2 = MagicMock()
    p2.is_available.return_value = True
    p2.label.return_value = "p2/model"

    work_dir = tmp_path / "REC3"
    work_dir.mkdir()
    (work_dir / "transcript.txt").write_text("text", encoding="utf-8")

    with patch("summarizer.time.sleep") as mock_sleep:
        chain = summarizer.SummaryChain([p1, p2], 60)
        chain.run(work_dir / "transcript.txt", "2026-1-1_00h00")

    mock_sleep.assert_called_once_with(60)


# ---------------------------------------------------------------------------
# build_summary_chain
# ---------------------------------------------------------------------------


def test_build_summary_chain_with_primary_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NVIDIA_API_KEY", "primary_key")
    monkeypatch.delenv("SUMMARY_FALLBACK_CHAIN", raising=False)
    chain = summarizer.build_summary_chain()
    assert len(chain._providers) == 1
    assert chain._providers[0].api_key == "primary_key"  # type: ignore[attr-defined]


def test_build_summary_chain_no_key_yields_no_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("SUMMARY_FALLBACK_CHAIN", raising=False)
    chain = summarizer.build_summary_chain()
    assert chain._providers == []


def test_build_summary_chain_fallback_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NVIDIA_API_KEY", "primary_key")
    monkeypatch.setenv("TASMAS_TEST_FALLBACK_KEY", "fallback_key")
    monkeypatch.setenv("SUMMARY_FALLBACK_CHAIN", "https://fallback.com/v1|TASMAS_TEST_FALLBACK_KEY|gpt-4o")
    chain = summarizer.build_summary_chain()
    assert len(chain._providers) == 2
    p = chain._providers[1]
    assert p.model == "gpt-4o"  # type: ignore[attr-defined]
    assert p.api_key == "fallback_key"  # type: ignore[attr-defined]


def test_build_summary_chain_malformed_fallback_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NVIDIA_API_KEY", "key")
    monkeypatch.setenv("SUMMARY_FALLBACK_CHAIN", "bad_entry_without_pipes")
    chain = summarizer.build_summary_chain()
    assert len(chain._providers) == 1


def test_build_summary_chain_empty_fallback_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NVIDIA_API_KEY", "key")
    monkeypatch.setenv("SUMMARY_FALLBACK_CHAIN", "")
    chain = summarizer.build_summary_chain()
    assert len(chain._providers) == 1


def test_build_summary_chain_custom_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NVIDIA_API_KEY", "key")
    monkeypatch.setenv("AI_SUMMARY_MODEL", "my-custom-model")
    monkeypatch.delenv("SUMMARY_FALLBACK_CHAIN", raising=False)
    chain = summarizer.build_summary_chain()
    assert chain._providers[0].model == "my-custom-model"  # type: ignore[attr-defined]
