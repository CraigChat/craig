"""Tests for watch_flac_zips.py — pure-logic functions only."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import watch_flac_zips

# ---------------------------------------------------------------------------
# try_process
# ---------------------------------------------------------------------------


def test_try_process_returns_true_on_success(tmp_path: Path) -> None:
    zip_path = tmp_path / "rec1.flac.zip"
    zip_path.write_bytes(b"")
    with patch("watch_flac_zips.process_zip", return_value=tmp_path):
        assert watch_flac_zips.try_process(zip_path) is True


def test_try_process_returns_false_on_exception(tmp_path: Path) -> None:
    zip_path = tmp_path / "rec1.flac.zip"
    with patch("watch_flac_zips.process_zip", side_effect=RuntimeError("boom")):
        assert watch_flac_zips.try_process(zip_path) is False


def test_try_process_returns_false_on_file_not_found(tmp_path: Path) -> None:
    zip_path = tmp_path / "ghost.flac.zip"
    with patch("watch_flac_zips.process_zip", side_effect=FileNotFoundError("gone")):
        assert watch_flac_zips.try_process(zip_path) is False


# ---------------------------------------------------------------------------
# is_stable
# ---------------------------------------------------------------------------


def test_is_stable_returns_true_for_unchanged_file(tmp_path: Path) -> None:
    f = tmp_path / "rec.flac.zip"
    f.write_bytes(b"data")
    with patch("watch_flac_zips.time.sleep"):
        assert watch_flac_zips.is_stable(f, 5) is True


def test_is_stable_returns_false_for_missing_file(tmp_path: Path) -> None:
    assert watch_flac_zips.is_stable(tmp_path / "ghost.flac.zip", 0) is False


def test_is_stable_returns_false_when_size_changes(tmp_path: Path) -> None:
    f = tmp_path / "rec.flac.zip"
    f.write_bytes(b"data")

    stat1 = MagicMock()
    stat1.st_size = 100
    stat1.st_mtime_ns = 1000

    stat2 = MagicMock()
    stat2.st_size = 200
    stat2.st_mtime_ns = 1000

    with (
        patch.object(Path, "stat", side_effect=[stat1, stat2]),
        patch("watch_flac_zips.time.sleep"),
    ):
        assert watch_flac_zips.is_stable(f, 1) is False


def test_is_stable_returns_false_when_mtime_changes(tmp_path: Path) -> None:
    f = tmp_path / "rec.flac.zip"
    f.write_bytes(b"data")

    stat1 = MagicMock()
    stat1.st_size = 100
    stat1.st_mtime_ns = 1000

    stat2 = MagicMock()
    stat2.st_size = 100
    stat2.st_mtime_ns = 2000

    with (
        patch.object(Path, "stat", side_effect=[stat1, stat2]),
        patch("watch_flac_zips.time.sleep"),
    ):
        assert watch_flac_zips.is_stable(f, 1) is False


def test_is_stable_returns_false_when_file_disappears_between_stats(tmp_path: Path) -> None:
    f = tmp_path / "rec.flac.zip"
    f.write_bytes(b"data")

    stat1 = MagicMock()
    stat1.st_size = 100
    stat1.st_mtime_ns = 1000

    with (
        patch.object(Path, "stat", side_effect=[stat1, FileNotFoundError("gone")]),
        patch("watch_flac_zips.time.sleep"),
    ):
        assert watch_flac_zips.is_stable(f, 1) is False


# ---------------------------------------------------------------------------
# process_existing
# ---------------------------------------------------------------------------


def test_process_existing_processes_stable_zips(tmp_path: Path) -> None:
    (tmp_path / "rec1.flac.zip").write_bytes(b"")
    (tmp_path / "rec2.flac.zip").write_bytes(b"")
    (tmp_path / "other.txt").write_text("ignored")

    processed: list[Path] = []
    with (
        patch("watch_flac_zips.is_stable", return_value=True),
        patch("watch_flac_zips.try_process", side_effect=lambda p: processed.append(p) or True),
    ):
        watch_flac_zips.process_existing(tmp_path, 0)

    assert len(processed) == 2
    assert all(p.name.endswith(".flac.zip") for p in processed)


def test_process_existing_skips_unstable_files(tmp_path: Path) -> None:
    (tmp_path / "rec1.flac.zip").write_bytes(b"")

    with (
        patch("watch_flac_zips.is_stable", return_value=False),
        patch("watch_flac_zips.try_process") as mock_process,
    ):
        watch_flac_zips.process_existing(tmp_path, 0)

    mock_process.assert_not_called()


def test_process_existing_empty_directory(tmp_path: Path) -> None:
    with patch("watch_flac_zips.try_process") as mock_process:
        watch_flac_zips.process_existing(tmp_path, 0)
    mock_process.assert_not_called()


def test_process_existing_processes_in_sorted_order(tmp_path: Path) -> None:
    (tmp_path / "c.flac.zip").write_bytes(b"")
    (tmp_path / "a.flac.zip").write_bytes(b"")
    (tmp_path / "b.flac.zip").write_bytes(b"")

    processed: list[str] = []
    with (
        patch("watch_flac_zips.is_stable", return_value=True),
        patch(
            "watch_flac_zips.try_process",
            side_effect=lambda p: processed.append(p.name) or True,
        ),
    ):
        watch_flac_zips.process_existing(tmp_path, 0)

    assert processed == ["a.flac.zip", "b.flac.zip", "c.flac.zip"]
