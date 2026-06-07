"""Shared filename conventions for TASMAS output files.

All output files follow the pattern: {timestamp}_{recording_id}_{kind}.{ext}
  e.g.  2026-5-20_21h59_B5h4i504C2qL_summary.md
        2026-5-20_21h59_B5h4i504C2qL_transcript.txt
        2026-5-20_21h59_B5h4i504C2qL_raw.dat
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

TIMESTAMP_FORMAT = "%Y-%-m-%-d_%Hh%M"


def recording_timestamp() -> str:
    """Current New York time formatted for use in output filenames."""
    return datetime.now(ZoneInfo("America/New_York")).strftime(TIMESTAMP_FORMAT)


def recording_output_filename(recording_id: str, kind: str, ext: str, timestamp: str) -> str:
    """Return '{timestamp}_{recording_id}_{kind}.{ext}'."""
    return f"{timestamp}_{recording_id}_{kind}.{ext}"
