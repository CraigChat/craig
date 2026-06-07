"""Tests for recording_names.py."""

from __future__ import annotations

import re

import recording_names


def test_recording_output_filename_format() -> None:
    result = recording_names.recording_output_filename(
        "ABC123", "transcript", "txt", "2026-5-20_21h59"
    )
    assert result == "2026-5-20_21h59_ABC123_transcript.txt"


def test_recording_output_filename_summary() -> None:
    result = recording_names.recording_output_filename("XYZ", "summary", "md", "2026-1-1_00h00")
    assert result == "2026-1-1_00h00_XYZ_summary.md"


def test_recording_timestamp_format() -> None:
    ts = recording_names.recording_timestamp()
    # e.g. "2026-5-20_21h59"
    assert re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}_\d{2}h\d{2}", ts), f"unexpected format: {ts!r}"


def test_recording_output_filename_raw() -> None:
    result = recording_names.recording_output_filename(
        "B5h4i504C2qL", "raw", "dat", "2026-5-20_21h59"
    )
    assert result == "2026-5-20_21h59_B5h4i504C2qL_raw.dat"
