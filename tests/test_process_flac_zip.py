"""Tests for process_flac_zip.py — pure-logic functions only."""

from __future__ import annotations

import io
import json
import os
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


# ---------------------------------------------------------------------------
# load_install_config
# ---------------------------------------------------------------------------


def test_load_install_config_sets_var(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "install.config"
    config.write_text("TASMAS_TEST_BASIC=hello\n", encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_BASIC", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_BASIC") == "hello"


def test_load_install_config_export_prefix(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "install.config"
    config.write_text("export TASMAS_TEST_EXPORTED=world\n", encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_EXPORTED", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_EXPORTED") == "world"


def test_load_install_config_double_quoted_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "install.config"
    config.write_text('TASMAS_TEST_QUOTED="some value"\n', encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_QUOTED", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_QUOTED") == "some value"


def test_load_install_config_single_quoted_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "install.config"
    config.write_text("TASMAS_TEST_SQ='single quoted'\n", encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_SQ", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_SQ") == "single quoted"


def test_load_install_config_variable_substitution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "install.config"
    config.write_text(
        "TASMAS_TEST_BASE=/opt/foo\nTASMAS_TEST_DERIVED=$TASMAS_TEST_BASE/bar\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_BASE", raising=False)
    monkeypatch.delenv("TASMAS_TEST_DERIVED", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_DERIVED") == "/opt/foo/bar"


def test_load_install_config_does_not_overwrite_existing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "install.config"
    config.write_text("TASMAS_TEST_EXISTING=new_value\n", encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.setenv("TASMAS_TEST_EXISTING", "original")
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_EXISTING") == "original"


def test_load_install_config_missing_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INSTALL_CONFIG", "/nonexistent/path/install.config")
    process_flac_zip.load_install_config()  # must not raise


def test_load_install_config_comments_and_blank_lines_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "install.config"
    config.write_text("# comment\n\nTASMAS_TEST_VALID=yes\n", encoding="utf-8")
    monkeypatch.setenv("INSTALL_CONFIG", str(config))
    monkeypatch.delenv("TASMAS_TEST_VALID", raising=False)
    process_flac_zip.load_install_config()
    assert os.environ.get("TASMAS_TEST_VALID") == "yes"


# ---------------------------------------------------------------------------
# write_names_json
# ---------------------------------------------------------------------------


def test_write_names_json_creates_file(tmp_path: Path) -> None:
    (tmp_path / "info.txt").write_text(INFO_TXT_SAMPLE, encoding="utf-8")
    path, names = process_flac_zip.write_names_json(tmp_path)
    assert path.exists()
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "alice123": "Alice",
        "bobsmith": "Bob Smith",
        "charlie.d": "Charlie",
    }
    assert names == {"alice123": "Alice", "bobsmith": "Bob Smith", "charlie.d": "Charlie"}


def test_write_names_json_empty_when_no_info(tmp_path: Path) -> None:
    path, names = process_flac_zip.write_names_json(tmp_path)
    assert names == {}
    assert json.loads(path.read_text(encoding="utf-8")) == {}


# ---------------------------------------------------------------------------
# create_tasmas_audio_links
# ---------------------------------------------------------------------------


def test_create_tasmas_audio_links_creates_ogg(tmp_path: Path) -> None:
    (tmp_path / "track1.flac").write_bytes(b"audio1")
    (tmp_path / "track2.flac").write_bytes(b"audio2")
    process_flac_zip.create_tasmas_audio_links(tmp_path)
    assert (tmp_path / "track1.ogg").exists()
    assert (tmp_path / "track2.ogg").exists()


def test_create_tasmas_audio_links_skips_existing_ogg(tmp_path: Path) -> None:
    (tmp_path / "track1.flac").write_bytes(b"audio")
    (tmp_path / "track1.ogg").write_bytes(b"original")
    process_flac_zip.create_tasmas_audio_links(tmp_path)
    assert (tmp_path / "track1.ogg").read_bytes() == b"original"


# ---------------------------------------------------------------------------
# docker_gpu_args / tasmas_extra_args / tasmas_model_cache_args
# ---------------------------------------------------------------------------


def test_docker_gpu_args_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_GPU_ARGS", raising=False)
    assert process_flac_zip.docker_gpu_args() == ["--gpus", "all"]


def test_docker_gpu_args_custom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASMAS_GPU_ARGS", "--device /dev/dri")
    assert process_flac_zip.docker_gpu_args() == ["--device", "/dev/dri"]


def test_docker_gpu_args_empty_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASMAS_GPU_ARGS", "")
    assert process_flac_zip.docker_gpu_args() == []


def test_tasmas_extra_args_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_EXTRA_ARGS", raising=False)
    assert process_flac_zip.tasmas_extra_args() == []


def test_tasmas_extra_args_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASMAS_EXTRA_ARGS", "--model large --lang en")
    assert process_flac_zip.tasmas_extra_args() == ["--model", "large", "--lang", "en"]


def test_tasmas_model_cache_args_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASMAS_MODEL_CACHE_DIR", raising=False)
    assert process_flac_zip.tasmas_model_cache_args() == []


def test_tasmas_model_cache_args_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cache = tmp_path / "cache"
    monkeypatch.setenv("TASMAS_MODEL_CACHE_DIR", str(cache))
    args = process_flac_zip.tasmas_model_cache_args()
    assert args == ["-v", f"{cache.resolve()}:/root/.cache"]
    assert cache.is_dir()


# ---------------------------------------------------------------------------
# acquire_lock
# ---------------------------------------------------------------------------


def test_acquire_lock_creates_dir(tmp_path: Path) -> None:
    lock_dir = tmp_path / ".lock"
    assert process_flac_zip.acquire_lock(lock_dir) is True
    assert lock_dir.is_dir()


def test_acquire_lock_returns_false_when_exists(tmp_path: Path) -> None:
    lock_dir = tmp_path / ".lock"
    lock_dir.mkdir()
    assert process_flac_zip.acquire_lock(lock_dir) is False


# ---------------------------------------------------------------------------
# update_recording_state
# ---------------------------------------------------------------------------


def test_update_recording_state_processing(tmp_path: Path) -> None:
    process_flac_zip.update_recording_state(tmp_path, "REC1", "processing")
    state = process_flac_zip.load_state(process_flac_zip.state_file_path(tmp_path))
    rec = state["recordings"]["REC1"]
    assert rec["status"] == "processing"
    assert "startedAt" in rec
    assert "updatedAt" in rec


def test_update_recording_state_completed(tmp_path: Path) -> None:
    process_flac_zip.update_recording_state(tmp_path, "REC1", "completed")
    state = process_flac_zip.load_state(process_flac_zip.state_file_path(tmp_path))
    rec = state["recordings"]["REC1"]
    assert rec["status"] == "completed"
    assert "completedAt" in rec


def test_update_recording_state_failed(tmp_path: Path) -> None:
    process_flac_zip.update_recording_state(tmp_path, "REC1", "failed", error="oops")
    state = process_flac_zip.load_state(process_flac_zip.state_file_path(tmp_path))
    rec = state["recordings"]["REC1"]
    assert rec["status"] == "failed"
    assert "failedAt" in rec
    assert rec["error"] == "oops"


def test_update_recording_state_completed_clears_error(tmp_path: Path) -> None:
    process_flac_zip.update_recording_state(tmp_path, "REC1", "failed", error="oops")
    process_flac_zip.update_recording_state(tmp_path, "REC1", "completed")
    state = process_flac_zip.load_state(process_flac_zip.state_file_path(tmp_path))
    rec = state["recordings"]["REC1"]
    assert rec["status"] == "completed"
    assert "error" not in rec


def test_update_recording_state_preserves_extra_fields(tmp_path: Path) -> None:
    process_flac_zip.update_recording_state(
        tmp_path, "REC1", "processing", archivePath="/some/path"
    )
    state = process_flac_zip.load_state(process_flac_zip.state_file_path(tmp_path))
    assert state["recordings"]["REC1"]["archivePath"] == "/some/path"


# ---------------------------------------------------------------------------
# process_zip — input validation
# ---------------------------------------------------------------------------


def test_process_zip_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        process_flac_zip.process_zip(tmp_path / "ghost.flac.zip")


def test_process_zip_rejects_wrong_extension(tmp_path: Path) -> None:
    bad = tmp_path / "recording.zip"
    bad.write_bytes(b"")
    with pytest.raises(ValueError, match=r"\.flac\.zip"):
        process_flac_zip.process_zip(bad)
