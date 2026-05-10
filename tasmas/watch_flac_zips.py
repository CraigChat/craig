#!/usr/bin/env python3
"""Watch Craig's recording folder and process finished .flac.zip archives."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from logging_utils import log
from process_flac_zip import DEFAULT_RECORDINGS_DIR, load_install_config, process_zip


def try_process(zip_path: Path) -> bool:
    try:
        process_zip(zip_path)
        return True
    except Exception as exc:
        log(f"error processing {zip_path}: {exc}", stream=sys.stderr)
        return False


def is_stable(path: Path, wait_seconds: float) -> bool:
    try:
        first = path.stat()
        time.sleep(wait_seconds)
        second = path.stat()
    except FileNotFoundError:
        return False
    return first.st_size == second.st_size and first.st_mtime_ns == second.st_mtime_ns


def process_existing(watch_dir: Path, settle_seconds: float) -> None:
    for zip_path in sorted(watch_dir.glob("*.flac.zip")):
        if is_stable(zip_path, settle_seconds):
            try_process(zip_path)


def watch_with_inotifywait(watch_dir: Path, settle_seconds: float) -> None:
    command = [
        "inotifywait",
        "-m",
        "-e",
        "close_write,moved_to",
        "--format",
        "%w%f",
        str(watch_dir),
    ]
    with subprocess.Popen(command, stdout=subprocess.PIPE, text=True) as proc:
        assert proc.stdout is not None
        for line in proc.stdout:
            path = Path(line.strip())
            if path.name.endswith(".flac.zip") and is_stable(path, settle_seconds):
                try_process(path)


def watch_with_polling(watch_dir: Path, interval_seconds: float, settle_seconds: float) -> None:
    seen: set[Path] = set()
    while True:
        for zip_path in sorted(watch_dir.glob("*.flac.zip")):
            if zip_path in seen:
                continue
            if is_stable(zip_path, settle_seconds):
                if try_process(zip_path):
                    seen.add(zip_path)
        time.sleep(interval_seconds)


def main() -> int:
    load_install_config()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--watch-dir",
        type=Path,
        default=Path(os.environ.get("CRAIG_RECORDINGS_DIR", str(DEFAULT_RECORDINGS_DIR))),
        help="Folder containing Craig .flac.zip archives.",
    )
    parser.add_argument(
        "--poll",
        action="store_true",
        help="Use portable polling instead of inotifywait.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.environ.get("TASMAS_WATCH_INTERVAL", "10")),
        help="Polling interval in seconds.",
    )
    parser.add_argument(
        "--settle",
        type=float,
        default=float(os.environ.get("TASMAS_SETTLE_SECONDS", "5")),
        help="Seconds a file must remain unchanged before processing.",
    )
    args = parser.parse_args()

    watch_dir = args.watch_dir.expanduser().resolve()
    if not watch_dir.is_dir():
        log(f"error: watch directory does not exist: {watch_dir}", stream=sys.stderr)
        return 1

    log(f"Watching for Craig FLAC archives in {watch_dir}")
    process_existing(watch_dir, args.settle)

    if args.poll:
        watch_with_polling(watch_dir, args.interval, args.settle)
    else:
        try:
            watch_with_inotifywait(watch_dir, args.settle)
        except FileNotFoundError:
            log("inotifywait not found; falling back to polling", stream=sys.stderr)
            watch_with_polling(watch_dir, args.interval, args.settle)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
