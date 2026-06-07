from __future__ import annotations

import sys
from datetime import datetime
from zoneinfo import ZoneInfo

LOG_TZ = ZoneInfo("America/New_York")


def timestamp() -> str:
    return datetime.now(LOG_TZ).strftime("%Y-%m-%d %H:%M:%S %Z")


def log(message: str, *, stream=sys.stdout) -> None:
    print(f"[{timestamp()}] {message}", file=stream, flush=True)
