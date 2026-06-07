"""Tests for process_flac_zip.py — pure-logic functions only."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

import process_flac_zip

# ---------------------------------------------------------------------------
# parse_info_txt
# ---------------------------------------------------------------------------

INFO_TXT_SAMPLE = """\
Recording: someRecordingId
Date: 2026-05-20T21:59:00Z
Tracks:
\tAlice (alice123#0)
\tBob Smith (bobsmith#1234)
\tCharlie (charlie.d#5678)
"""


def test_parse_info_txt_basic(tmp_path: Path) -> None:
    info = tmp_path / "info.txt"
    info.write_text(INFO_TXT_SAMPLE, encoding="utf-8")
    names = process_flac_zip.parse_info_txt(info)
    assert names == {
        "alice123": "Alice",
        "bobsmith": "Bob Smith",
        "charlie.d": "Charlie",
    }


def test_parse_info_txt_missing_file(tmp_path: Path) -> None:
    result = process_flac_zip.parse_info_txt(tmp_path / "nonexistent.txt")
    assert result == {}


def test_parse_info_txt_no_tracks_section(tmp_path: Path) -> None:
    info = tmp_path / "info.txt"
    info.write_text("Recording: abc\nDate: 2026-01-01\n", encoding="utf-8")
    assert process_flac_zip.parse_info_txt(info) == {}


def test_parse_info_txt_empty_file(tmp_path: Path) -> None:
    info = tmp_path / "info.txt"
    info.write_text("", encoding="utf-8")
    assert process_flac_zip.parse_info_txt(info) == {}


# ---------------------------------------------------------------------------
# load_state / save_state
# ---------------------------------------------------------------------------


def test_load_state_missing(tmp_path: Path) -> None:
    state = process_flac_zip.load_state(tmp_path / "nope.json")
    assert state == {"version": 1, "recordings": {}}


def test_save_and_load_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    data = {"version": 1, "recordings": {"ABC": {"status": "completed"}}}
    process_flac_zip.save_state(path, data)
    assert path.exists()
    loaded = process_flac_zip.load_state(path)
    assert loaded == data


def test_load_state_corrupt_json(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    path.write_text("{not valid json", encoding="utf-8")
    state = process_flac_zip.load_state(path)
    assert state == {"version": 1, "recordings": {}}
    # Original file should have been renamed to a .corrupt-* backup
    backups = list(tmp_path.glob("state.json.corrupt-*"))
    assert len(backups) == 1


def test_load_state_non_dict_root(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    state = process_flac_zip.load_state(path)
    assert state == {"version": 1, "recordings": {}}


# ---------------------------------------------------------------------------
# safe_extract_zip (path-traversal protection)
# ---------------------------------------------------------------------------


def _make_zip(members: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    return buf.getvalue()


def test_safe_extract_normal(tmp_path: Path) -> None:
    zip_bytes = _make_zip({"track1.flac": "audio", "info.txt": "Recording: test"})
    zip_path = tmp_path / "test.flac.zip"
    zip_path.write_bytes(zip_bytes)
    work_dir = tmp_path / "out"
    work_dir.mkdir()
    process_flac_zip.safe_extract_zip(zip_path, work_dir)
    assert (work_dir / "track1.flac").read_text() == "audio"
    assert (work_dir / "info.txt").read_text() == "Recording: test"


def test_safe_extract_rejects_path_traversal(tmp_path: Path) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # Zip slip: member escapes the extraction directory
        zf.writestr("../evil.txt", "pwned")
    zip_path = tmp_path / "bad.flac.zip"
    zip_path.write_bytes(buf.getvalue())
    work_dir = tmp_path / "out"
    work_dir.mkdir()
    with pytest.raises(ValueError, match="Unsafe zip member path"):
        process_flac_zip.safe_extract_zip(zip_path, work_dir)


# ---------------------------------------------------------------------------
# recording_completed
# ---------------------------------------------------------------------------


def test_recording_completed_true(tmp_path: Path) -> None:
    state_path = process_flac_zip.state_file_path(tmp_path)
    state = {"version": 1, "recordings": {"ABC": {"status": "completed"}}}
    process_flac_zip.save_state(state_path, state)
    assert process_flac_zip.recording_completed(tmp_path, "ABC") is True


def test_recording_completed_false_missing(tmp_path: Path) -> None:
    assert process_flac_zip.recording_completed(tmp_path, "MISSING") is False


def test_recording_completed_false_processing(tmp_path: Path) -> None:
    state_path = process_flac_zip.state_file_path(tmp_path)
    state = {"version": 1, "recordings": {"ABC": {"status": "processing"}}}
    process_flac_zip.save_state(state_path, state)
    assert process_flac_zip.recording_completed(tmp_path, "ABC") is False
