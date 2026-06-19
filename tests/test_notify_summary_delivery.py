"""Tests for notify_summary_delivery() — HTTP API communication to Discord bot."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

import process_flac_zip


def test_notify_summary_delivery_success_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test successful notification returns True with HTTP 200."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/notify")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "200"
        mock_result.returncode = 0
        mock_run.return_value = mock_result

        result = process_flac_zip.notify_summary_delivery("REC123")

    assert result is True
    mock_run.assert_called_once()


def test_notify_summary_delivery_no_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test when CRAIG_INTERNAL_API_URL is not set returns False."""
    monkeypatch.delenv("CRAIG_INTERNAL_API_URL", raising=False)
    result = process_flac_zip.notify_summary_delivery("REC123")
    assert result is False


def test_notify_summary_delivery_http_error_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test non-200 HTTP status returns False and logs error."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "500"
        mock_run.return_value = mock_result

        result = process_flac_zip.notify_summary_delivery("REC123")

    assert result is False


def test_notify_summary_delivery_includes_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that Authorization header is included when secret is set."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/notify")
    monkeypatch.setenv("CRAIG_INTERNAL_SECRET", "super_secret")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "200"
        mock_run.return_value = mock_result

        process_flac_zip.notify_summary_delivery("REC123")

        # Check that the curl command includes the Authorization header
        call_args = mock_run.call_args
        cmd = call_args[0][0]
        assert "-H" in cmd
        # Find the Authorization header
        auth_header_idx = None
        for i, arg in enumerate(cmd):
            if arg == "-H" and i + 1 < len(cmd) and "Authorization" in cmd[i + 1]:
                auth_header_idx = i
                break
        assert auth_header_idx is not None
        assert "Bearer super_secret" in cmd[auth_header_idx + 1]


def test_notify_summary_delivery_no_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that no Authorization header when secret is empty."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/notify")
    monkeypatch.setenv("CRAIG_INTERNAL_SECRET", "")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "200"
        mock_run.return_value = mock_result

        process_flac_zip.notify_summary_delivery("REC123")

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        # Should not have Bearer in command
        cmd_str = " ".join(cmd)
        assert "Bearer" not in cmd_str


def test_notify_summary_delivery_posts_recording_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that recording ID is sent in JSON body."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "200"
        mock_run.return_value = mock_result

        process_flac_zip.notify_summary_delivery("REC_ABC_123")

        call_args = mock_run.call_args
        cmd = call_args[0][0]
        # Find the --data-raw argument
        for i, arg in enumerate(cmd):
            if arg == "--data-raw" and i + 1 < len(cmd):
                body = json.loads(cmd[i + 1])
                assert body["recordingId"] == "REC_ABC_123"
                break


def test_notify_summary_delivery_timeout_30s(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that curl command includes 30 second timeout."""
    monkeypatch.setenv("CRAIG_INTERNAL_API_URL", "http://api.local/")
    with patch("process_flac_zip.subprocess.run") as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "200"
        mock_run.return_value = mock_result

        process_flac_zip.notify_summary_delivery("REC123")

        # Check timeout parameter
        call_kwargs = mock_run.call_args[1]
        assert call_kwargs.get("timeout") == 30
