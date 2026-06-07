#!/usr/bin/env python3
"""Stage a Craig .flac.zip archive and run TASMAS on the extracted stems."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from logging_utils import log
from recording_names import recording_output_filename, recording_timestamp


REPO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INSTALL_CONFIG = REPO_DIR / "install.config"
DEFAULT_RECORDINGS_DIR = Path("/mnt/media8tb/craig-recordings")
DEFAULT_TASMAS_IMAGE = "kaddaok/tasmas:latest"


def load_install_config() -> None:
    """Load Craig's install.config as default environment for the sidecar."""
    config_path = Path(os.environ.get("INSTALL_CONFIG", str(DEFAULT_INSTALL_CONFIG))).expanduser()
    if not config_path.exists():
        return

    loaded: dict[str, str] = {}
    pattern = re.compile(r"\$(\w+)|\$\{(\w+)\}")

    for raw_line in config_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]

        def replace_var(match: re.Match[str]) -> str:
            name = match.group(1) or match.group(2)
            return os.environ.get(name, loaded.get(name, match.group(0)))

        loaded[key] = pattern.sub(replace_var, value)

    for key, value in loaded.items():
        os.environ.setdefault(key, value)


def env_path(name: str, default: Path) -> Path:
    return Path(os.environ.get(name, str(default))).expanduser().resolve()


def parse_info_txt(info_path: Path) -> dict[str, str]:
    """Return TASMAS filename-speaker mappings from Craig's info.txt."""
    if not info_path.exists():
        return {}

    names: dict[str, str] = {}
    in_tracks = False
    track_pattern = re.compile(r"^\t(?P<display>.*?) \((?P<username>[A-Za-z0-9_.-]+)#")

    for line in info_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip() == "Tracks:":
            in_tracks = True
            continue
        if not in_tracks:
            continue
        match = track_pattern.match(line)
        if match:
            names[match.group("username")] = match.group("display").strip()

    return names


def write_names_json(work_dir: Path) -> tuple[Path, dict]:
    names_path = work_dir / "names.json"
    names = parse_info_txt(work_dir / "info.txt")
    names_path.write_text(json.dumps(names, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return names_path, names


def create_tasmas_audio_links(work_dir: Path) -> None:
    """TASMAS scans for .ogg files, so expose Craig FLAC stems with .ogg names."""
    for flac_path in work_dir.glob("*.flac"):
        ogg_path = flac_path.with_suffix(".ogg")
        if ogg_path.exists():
            continue
        try:
            os.link(flac_path, ogg_path)
        except OSError:
            ogg_path.symlink_to(flac_path.name)


def docker_gpu_args() -> list[str]:
    raw = os.environ.get("TASMAS_GPU_ARGS", "--gpus all").strip()
    return shlex.split(raw) if raw else []


def tasmas_extra_args() -> list[str]:
    raw = os.environ.get("TASMAS_EXTRA_ARGS", "").strip()
    return shlex.split(raw) if raw else []


def tasmas_model_cache_args() -> list[str]:
    cache_dir = os.environ.get("TASMAS_MODEL_CACHE_DIR", "").strip()
    if not cache_dir:
        return []
    cache_path = Path(cache_dir).expanduser().resolve()
    cache_path.mkdir(parents=True, exist_ok=True)
    return ["-v", f"{cache_path}:/root/.cache"]


def run_tasmas(output_root: Path, recording_id: str) -> None:
    image = os.environ.get("TASMAS_IMAGE", DEFAULT_TASMAS_IMAGE)
    container_dir = f"/recordings/{recording_id}"
    command = [
        "docker",
        "run",
        "--rm",
        *docker_gpu_args(),
        "--entrypoint",
        "python",
        "-v",
        f"{output_root}:/recordings",
        *tasmas_model_cache_args(),
        image,
        "/usr/local/bin/tasmas",
        *tasmas_extra_args(),
        "--names",
        f"{container_dir}/names.json",
        "semiauto",
        container_dir,
    ]

    log(f"Running TASMAS semiauto for {recording_id}")
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1) as child:
        assert child.stdout is not None
        for line in child.stdout:
            log(f"[tasmas:{recording_id}] {line.rstrip()}")
        exit_code = child.wait()
    if exit_code:
        raise subprocess.CalledProcessError(exit_code, command)


def notify_summary_delivery(recording_id: str) -> bool:
    """Notify the craig bot to deliver the summary. Returns True if the bot handled it."""
    internal_url = os.environ.get("CRAIG_INTERNAL_API_URL", "").strip()
    if not internal_url:
        return False
    secret = os.environ.get("CRAIG_INTERNAL_SECRET", "").strip()
    body = json.dumps({"recordingId": recording_id})
    result = subprocess.run(
        [
            "curl", "-s", "-o", "/dev/stderr", "-w", "%{http_code}",
            "-X", "POST",
            "-H", "Content-Type: application/json",
            *(["-H", f"Authorization: Bearer {secret}"] if secret else []),
            "--data-raw", body,
            internal_url,
        ],
        capture_output=True, text=True, timeout=30,
    )
    status = result.stdout.strip()
    if status == "200":
        log(f"Summary delivered for {recording_id}")
        return True
    log(f"Internal API returned {status} for {recording_id}, summary not delivered", stream=sys.stderr)
    return False


def summarize_transcript(transcript_path: Path, timestamp: str) -> None:
    from summarizer import build_summary_chain
    summary = build_summary_chain().run(transcript_path, timestamp)
    if summary:
        notify_summary_delivery(transcript_path.parent.name)


def acquire_lock(lock_dir: Path) -> bool:
    try:
        lock_dir.mkdir()
        return True
    except FileExistsError:
        return False


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def state_file_path(output_root: Path) -> Path:
    return output_root / os.environ.get("TASMAS_RECORDINGS_LOCK_FILE", "recordings.lock.json")


def load_state(state_path: Path) -> dict[str, Any]:
    if not state_path.exists():
        return {"version": 1, "recordings": {}}
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        backup_path = state_path.with_suffix(state_path.suffix + f".corrupt-{int(datetime.now(timezone.utc).timestamp())}")
        state_path.replace(backup_path)
        log(f"Moved corrupt recording state file to {backup_path}", stream=sys.stderr)
        return {"version": 1, "recordings": {}}

    if not isinstance(state, dict):
        return {"version": 1, "recordings": {}}
    if not isinstance(state.get("recordings"), dict):
        state["recordings"] = {}
    state.setdefault("version", 1)
    return state


def save_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = state_path.with_suffix(state_path.suffix + ".tmp")
    temp_path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp_path.replace(state_path)


def update_recording_state(output_root: Path, recording_id: str, status: str, **fields: Any) -> None:
    state_path = state_file_path(output_root)
    state = load_state(state_path)
    recordings = state["recordings"]
    current = recordings.get(recording_id, {})
    if not isinstance(current, dict):
        current = {}
    current.update(fields)
    current["status"] = status
    current["updatedAt"] = utc_now()
    if status == "processing":
        current.setdefault("startedAt", current["updatedAt"])
    if status == "completed":
        current["completedAt"] = current["updatedAt"]
        current.pop("error", None)
    if status == "failed":
        current["failedAt"] = current["updatedAt"]
    recordings[recording_id] = current
    save_state(state_path, state)


def recording_completed(output_root: Path, recording_id: str) -> bool:
    state = load_state(state_file_path(output_root))
    current = state["recordings"].get(recording_id)
    return isinstance(current, dict) and current.get("status") == "completed"


def safe_extract_zip(zip_path: Path, work_dir: Path) -> None:
    work_dir = work_dir.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            destination = (work_dir / member.filename).resolve()
            if not str(destination).startswith(f"{work_dir}{os.sep}") and destination != work_dir:
                raise ValueError(f"Unsafe zip member path: {member.filename}")
        archive.extractall(work_dir)


def process_zip(zip_path: Path) -> Path:
    zip_path = zip_path.expanduser().resolve()
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)
    if not zip_path.name.endswith(".flac.zip"):
        raise ValueError(f"Expected a .flac.zip file: {zip_path}")

    recordings_dir = env_path("CRAIG_RECORDINGS_DIR", DEFAULT_RECORDINGS_DIR)
    output_root = env_path("TASMAS_OUTPUT_DIR", recordings_dir / "tasmas")
    recording_id = zip_path.name.removesuffix(".flac.zip")
    work_dir = output_root / recording_id
    done_marker = work_dir / ".done"
    lock_dir = work_dir / ".lock"

    if recording_completed(output_root, recording_id) or done_marker.exists():
        log(f"Already processed: {recording_id}")
        if done_marker.exists() and not recording_completed(output_root, recording_id):
            update_recording_state(output_root, recording_id, "completed", archivePath=str(zip_path), workDir=str(work_dir))
        return work_dir

    work_dir.mkdir(parents=True, exist_ok=True)
    if not acquire_lock(lock_dir):
        log(f"Already processing: {recording_id}")
        return work_dir

    try:
        update_recording_state(output_root, recording_id, "processing", archivePath=str(zip_path), workDir=str(work_dir))
        log(f"Staging {zip_path} -> {work_dir}")
        safe_extract_zip(zip_path, work_dir)

        _, names = write_names_json(work_dir)
        if not names:
            log(f"No tracks in recording {recording_id}, skipping transcription")
            return work_dir
        create_tasmas_audio_links(work_dir)
        run_tasmas(output_root, recording_id)

        ts = recording_timestamp()
        for plain, kind, ext in [("transcript.txt", "transcript", "txt"), ("raw.dat", "raw", "dat")]:
            src = work_dir / plain
            if src.exists():
                src.rename(work_dir / recording_output_filename(recording_id, kind, ext, ts))

        transcript_path = work_dir / recording_output_filename(recording_id, "transcript", "txt", ts)
        if transcript_path.exists():
            summarize_transcript(transcript_path, ts)

        done_marker.write_text(utc_now() + "\n", encoding="utf-8")
        update_recording_state(
            output_root,
            recording_id,
            "completed",
            archivePath=str(zip_path),
            workDir=str(work_dir),
            transcriptPath=str(transcript_path) if transcript_path.exists() else None,
        )
        log(f"Done: {work_dir}")
        return work_dir
    except Exception as exc:
        update_recording_state(output_root, recording_id, "failed", archivePath=str(zip_path), workDir=str(work_dir), error=str(exc))
        raise
    finally:
        try:
            lock_dir.rmdir()
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path", type=Path, help="Path to Craig RECORDING_ID.flac.zip")
    args = parser.parse_args()

    try:
        process_zip(args.zip_path)
    except Exception as exc:
        log(f"error: {exc}", stream=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    load_install_config()
    raise SystemExit(main())
