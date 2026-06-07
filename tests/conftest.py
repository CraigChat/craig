"""Add tasmas/ to sys.path so tests can import its modules directly."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tasmas"))
