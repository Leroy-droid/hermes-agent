from __future__ import annotations

import json
import os

from hermes_cli.mobile_pairing import MobilePairingStore


def test_issue_token_stores_hash_not_raw_token(tmp_path):
    store = MobilePairingStore(root=tmp_path, now=lambda: 1000.0)

    issued = store.issue_device_token(device_name="Leroy iPhone", platform="ios")

    assert issued.token
    assert issued.token not in store.path.read_text(encoding="utf-8")
    payload = json.loads(store.path.read_text(encoding="utf-8"))
    saved = payload["devices"][issued.device_id]
    assert saved["device_name"] == "Leroy iPhone"
    assert saved["platform"] == "ios"
    assert saved["scopes"] == ["sessions:read"]
    assert saved["token_hash"]
    assert saved["salt"]

    if os.name != "nt":
        assert oct(store.path.stat().st_mode & 0o777) == "0o600"


def test_validate_token_updates_last_seen(tmp_path):
    times = iter([1000.0, 1010.0])
    store = MobilePairingStore(root=tmp_path, now=lambda: next(times))
    issued = store.issue_device_token(device_name="iPad", platform="ipados")

    result = store.validate_token(issued.token, required_scope="sessions:read")

    assert result.ok is True
    assert result.reason == "ok"
    assert result.record is not None
    assert result.record.device_id == issued.device_id
    assert result.record.last_seen_at == 1010.0


def test_validate_rejects_wrong_token_and_missing_scope(tmp_path):
    store = MobilePairingStore(root=tmp_path, now=lambda: 1000.0)
    issued = store.issue_device_token(
        device_name="MacBook",
        platform="macos",
        scopes=["sessions:read"],
    )

    wrong = store.validate_token("not-the-token", required_scope="sessions:read")
    assert wrong.ok is False
    assert wrong.reason == "invalid_token"

    missing_scope = store.validate_token(issued.token, required_scope="sessions:delete")
    assert missing_scope.ok is False
    assert missing_scope.reason == "insufficient_scope"
    assert missing_scope.record is not None


def test_revoke_device_invalidates_token(tmp_path):
    store = MobilePairingStore(root=tmp_path, now=lambda: 1000.0)
    issued = store.issue_device_token(device_name="Leroy iPhone", platform="ios")

    assert store.validate_token(issued.token).ok is True
    assert store.revoke_device(issued.device_id) is True

    revoked = store.validate_token(issued.token)
    assert revoked.ok is False
    assert revoked.reason == "invalid_token"

    active_devices = store.list_devices()
    all_devices = store.list_devices(include_revoked=True)
    assert active_devices == []
    assert len(all_devices) == 1
    assert all_devices[0].revoked_at is not None


def test_files_upload_scope_is_supported(tmp_path):
    store = MobilePairingStore(root=tmp_path, now=lambda: 1000.0)
    issued = store.issue_device_token(
        device_name="Leroy iPhone",
        platform="ios",
        scopes=["sessions:read", "messages:send", "files:upload"],
    )

    assert store.validate_token(issued.token, required_scope="files:upload").ok is True
    assert store.validate_token(issued.token, required_scope="messages:send").ok is True


def test_labels_are_trimmed_and_empty_scopes_fallback(tmp_path):
    store = MobilePairingStore(root=tmp_path, now=lambda: 1000.0)

    issued = store.issue_device_token(device_name="  ", platform="  ", scopes=[])

    assert issued.record.device_name == "Unnamed device"
    assert issued.record.platform == "unknown"
    assert issued.record.scopes == ("sessions:read",)
