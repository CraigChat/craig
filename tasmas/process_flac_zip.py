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
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from logging_utils import log


REPO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INSTALL_CONFIG = REPO_DIR / "install.config"
DEFAULT_RECORDINGS_DIR = Path("/mnt/media8tb/craig-recordings")
DEFAULT_TASMAS_IMAGE = "kaddaok/tasmas:latest"
DEFAULT_OLLAMA_URL = "http://localhost:11434/api/generate"
DEFAULT_SUMMARY_PROMPT = (
    "Summarize this meeting transcript. Preserve speaker names. Include: "
    "decisions, action items with owners, open questions, and a concise timeline.\n\n"
)


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


def write_names_json(work_dir: Path) -> Path:
    names_path = work_dir / "names.json"
    names = parse_info_txt(work_dir / "info.txt")
    names_path.write_text(json.dumps(names, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return names_path


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


def summarize_with_ollama(transcript_path: Path) -> Path | None:
    model = os.environ.get("OLLAMA_MODEL")
    if not model:
        return None

    transcript = transcript_path.read_text(encoding="utf-8", errors="replace")
    ollama_url = os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA_URL)
    summary_filename_model = re.sub(r"[^A-Za-z0-9_.-]", "_", model)
    summary_path = transcript_path.parent / f"summary_ollama_{summary_filename_model}.txt"

    payload = {
        "model": model,
        "prompt": f"{DEFAULT_SUMMARY_PROMPT}{transcript}",
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        ollama_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    log(f"Summarizing with Ollama model {model}")
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama summary failed: {exc}") from exc

    summary_path.write_text(data.get("response", ""), encoding="utf-8")
    return summary_path


def acquire_lock(lock_dir: Path) -> bool:
    try:
        lock_dir.mkdir()
        return True
    except FileExistsError:
        return False


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

    if done_marker.exists():
        log(f"Already processed: {recording_id}")
        return work_dir

    work_dir.mkdir(parents=True, exist_ok=True)
    if not acquire_lock(lock_dir):
        log(f"Already processing: {recording_id}")
        return work_dir

    try:
        log(f"Staging {zip_path} -> {work_dir}")
        safe_extract_zip(zip_path, work_dir)

        write_names_json(work_dir)
        create_tasmas_audio_links(work_dir)
        run_tasmas(output_root, recording_id)

        transcript_path = work_dir / "transcript.txt"
        if transcript_path.exists():
            summarize_with_ollama(transcript_path)

        done_marker.write_text(datetime.now(timezone.utc).isoformat() + "\n", encoding="utf-8")
        log(f"Done: {work_dir}")
        return work_dir
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
