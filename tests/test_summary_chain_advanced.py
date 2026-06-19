"""Tests for SummaryChain.run() — Provider fallback chain edge cases."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import summarizer


def test_summary_chain_run_extracts_recording_id_from_path(tmp_path: Path) -> None:
    """Test that recording ID is correctly extracted from transcript path."""
    provider = MagicMock()
    provider.is_available.return_value = True
    provider.label.return_value = "test/model"

    # Test both craig_ prefixed and non-prefixed paths
    work_dir = tmp_path / "craig_RECORDING_ABC_123"
    work_dir.mkdir()
    transcript = work_dir / "transcript.txt"
    transcript.write_text("content", encoding="utf-8")

    chain = summarizer.SummaryChain([provider], 0)
    chain.run(transcript, "2026-1-1_00h00")

    # Verify the output path uses correct recording ID
    call_args = provider.summarize.call_args
    output_path = call_args[0][1]
    assert "RECORDING_ABC_123" in str(output_path)


def test_summary_chain_run_reads_transcript_content(tmp_path: Path) -> None:
    """Test that transcript content is correctly read and passed to provider."""
    provider = MagicMock()
    provider.is_available.return_value = True
    provider.label.return_value = "test/model"

    work_dir = tmp_path / "rec1"
    work_dir.mkdir()
    transcript = work_dir / "transcript.txt"
    transcript_content = "Alice said hello\nBob replied goodbye"
    transcript.write_text(transcript_content, encoding="utf-8")

    chain = summarizer.SummaryChain([provider], 0)
    chain.run(transcript, "2026-1-1_00h00")

    # Verify exact transcript content was passed
    call_args = provider.summarize.call_args
    assert call_args[0][0] == transcript_content


def test_summary_chain_run_collects_all_errors(tmp_path: Path) -> None:
    """Test that all provider errors are collected and reported."""
    p1 = MagicMock()
    p1.is_available.return_value = True
    p1.label.return_value = "provider1/model"
    p1.summarize.side_effect = RuntimeError("Connection timeout")

    p2 = MagicMock()
    p2.is_available.return_value = True
    p2.label.return_value = "provider2/model"
    p2.summarize.side_effect = RuntimeError("Rate limited")

    work_dir = tmp_path / "rec"
    work_dir.mkdir()
    (work_dir / "transcript.txt").write_text("text", encoding="utf-8")

    with patch("summarizer.time.sleep"):
        chain = summarizer.SummaryChain([p1, p2], 1)
        with pytest.raises(RuntimeError) as exc_info:
            chain.run(work_dir / "transcript.txt", "2026-1-1_00h00")

    error_msg = str(exc_info.value)
    assert "Connection timeout" in error_msg
    assert "Rate limited" in error_msg
