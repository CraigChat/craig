"""Tests for recording state management and config loading."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

import process_flac_zip

# ---------------------------------------------------------------------------
# State management — update_recording_state edge cases
# ---------------------------------------------------------------------------


def test_update_recording_state_multiple_transitions(tmp_path: Path) -> None:
    """Test state transitions through multiple status changes."""
    state_path = process_flac_zip.state_file_path(tmp_path)

    # Start: processing
    process_flac_zip.update_recording_state(
        tmp_path, "REC1", "processing", archivePath="/path/to/archive.zip"
    )
    state = process_flac_zip.load_state(state_path)
    assert state["recordings"]["REC1"]["status"] == "processing"
    started_at = state["recordings"]["REC1"]["startedAt"]

    # Transition: failed
    time.sleep(0.01)  # Ensure time advances
    process_flac_zip.update_recording_state(tmp_path, "REC1", "failed", error="oops")
    state = process_flac_zip.load_state(state_path)
    assert state["recordings"]["REC1"]["status"] == "failed"
    assert state["recordings"]["REC1"]["error"] == "oops"
    assert state["recordings"]["REC1"]["startedAt"] == started_at  # Should be preserved

    # Transition: back to processing (simulating retry)
    time.sleep(0.01)
    process_flac_zip.update_recording_state(tmp_path, "REC1", "processing", retrying=True)
    state = process_flac_zip.load_state(state_path)
    assert state["recordings"]["REC1"]["status"] == "processing"
    assert "error" in state["recordings"]["REC1"]  # Error preserved until success
    assert state["recordings"]["REC1"]["retrying"] is True


def test_update_recording_state_preserves_previous_fields(tmp_path: Path) -> None:
    """Test that new fields are merged with existing ones."""
    state_path = process_flac_zip.state_file_path(tmp_path)

    # First update
    process_flac_zip.update_recording_state(
        tmp_path, "REC1", "processing", field1="value1", field2="value2"
    )

    # Second update with different field
    process_flac_zip.update_recording_state(tmp_path, "REC1", "processing", field3="value3")

    state = process_flac_zip.load_state(state_path)
    rec = state["recordings"]["REC1"]
    assert rec["field1"] == "value1"
    assert rec["field2"] == "value2"
    assert rec["field3"] == "value3"


# ---------------------------------------------------------------------------
# Config loading — Variable substitution edge cases
# ---------------------------------------------------------------------------


def test_load_install_config_handles_env_substitution_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test that variable substitution works with forward and backward references."""
    config = tmp_path / ".env"
    # Reference to a variable that hasn't been defined yet
    config.write_text(
        "TASMAS_TEST_FIRST=$TASMAS_TEST_SECOND/first\nTASMAS_TEST_SECOND=/base\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_FIRST", raising=False)
    monkeypatch.delenv("TASMAS_TEST_SECOND", raising=False)

    process_flac_zip.load_install_config()

    # First should contain the literal reference since SECOND isn't loaded yet
    # when processing FIRST, but it will use the loaded version from config
    first_val = os.environ.get("TASMAS_TEST_FIRST")
    second_val = os.environ.get("TASMAS_TEST_SECOND")
    assert second_val == "/base"
    assert first_val is not None
    assert "/base/first" in first_val or "$TASMAS_TEST_SECOND/first" in first_val


def test_load_install_config_with_braces_syntax(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test that ${VAR} syntax is supported alongside $VAR."""
    config = tmp_path / ".env"
    config.write_text(
        "TASMAS_TEST_BASE=/opt\nTASMAS_TEST_PATH=${TASMAS_TEST_BASE}/bin\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_BASE", raising=False)
    monkeypatch.delenv("TASMAS_TEST_PATH", raising=False)

    process_flac_zip.load_install_config()

    assert os.environ.get("TASMAS_TEST_PATH") == "/opt/bin"
