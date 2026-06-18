from __future__ import annotations

import base64
import json

import pytest


@pytest.fixture
def dashboard_client(monkeypatch, tmp_path):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client


@pytest.fixture
def unauthenticated_client(monkeypatch, tmp_path):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from hermes_cli.web_server import app

    return TestClient(app)


def test_mobile_pairing_admin_routes_require_dashboard_auth(unauthenticated_client):
    response = unauthenticated_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )

    assert response.status_code == 401


def test_mobile_pairing_issues_lists_and_revokes_token(dashboard_client, unauthenticated_client):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )
    assert issued.status_code == 200
    body = issued.json()
    token = body["token"]
    device_id = body["device"]["device_id"]
    assert body["token_header"] == _MOBILE_TOKEN_HEADER_NAME
    assert body["device"]["scopes"] == ["sessions:read"]

    listed = dashboard_client.get("/api/mobile/pairing/devices")
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 1
    assert listed_body["devices"][0]["device_id"] == device_id
    assert token not in json.dumps(listed_body)

    auth_check = unauthenticated_client.get(
        "/api/mobile/auth/check",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )
    assert auth_check.status_code == 200
    assert auth_check.json()["device"]["device_id"] == device_id

    revoked = dashboard_client.post(
        "/api/mobile/pairing/revoke",
        json={"device_id": device_id},
    )
    assert revoked.status_code == 200
    assert revoked.json()["revoked"] is True

    after_revoke = unauthenticated_client.get(
        "/api/mobile/auth/check",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )
    assert after_revoke.status_code == 401

    active = dashboard_client.get("/api/mobile/pairing/devices")
    assert active.json() == {"devices": [], "total": 0}

    all_devices = dashboard_client.get("/api/mobile/pairing/devices?include_revoked=true")
    assert all_devices.status_code == 200
    assert all_devices.json()["devices"][0]["revoked_at"] is not None


def test_mobile_pairing_rejects_unsupported_scopes(dashboard_client):
    response = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "sessions:delete"],
        },
    )

    assert response.status_code == 400
    assert "Unsupported mobile scope" in response.json()["detail"]


def test_mobile_token_bypasses_dashboard_cookie_gate_for_read_only_path(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME, app

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPad", "platform": "ipados"},
    )
    token = issued.json()["token"]

    previous = getattr(app.state, "auth_required", False)
    app.state.auth_required = True
    try:
        response = unauthenticated_client.get(
            "/api/mobile/auth/check",
            headers={_MOBILE_TOKEN_HEADER_NAME: token},
        )
    finally:
        app.state.auth_required = previous

    assert response.status_code == 200
    assert response.json()["device"]["device_name"] == "Leroy iPad"


def test_mobile_token_can_read_sessions_without_dashboard_session(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME, app
    import hermes_state
    import importlib

    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                mobile_live_session_status=lambda session_id: {
                    "is_mobile_sendable": session_id == "mobile-readable-session",
                    "live_session_id": "live-abc" if session_id == "mobile-readable-session" else "",
                    "mobile_send_unavailable_reason": "" if session_id == "mobile-readable-session" else "session is not live in the current Hermes desktop gateway",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    class FakeSessionDB:
        def list_sessions_rich(self, **kwargs):
            return [
                {
                    "id": "mobile-readable-session",
                    "title": "Mobile Read Session",
                    "preview": "Read-only mobile session preview",
                    "source": "telegram",
                    "message_count": 3,
                    "last_active": 1234.0,
                    "started_at": 1200.0,
                    "ended_at": None,
                    "archived": 0,
                }
            ]

        def session_count(self, **kwargs):
            return 1

        def close(self):
            pass

    monkeypatch.setattr(hermes_state, "SessionDB", FakeSessionDB)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )
    token = issued.json()["token"]

    previous = getattr(app.state, "auth_required", False)
    app.state.auth_required = True
    try:
        response = unauthenticated_client.get(
            "/api/sessions?limit=25&offset=0",
            headers={_MOBILE_TOKEN_HEADER_NAME: token},
        )
    finally:
        app.state.auth_required = previous

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["sessions"][0]["id"] == "mobile-readable-session"
    assert body["sessions"][0]["archived"] is False
    assert body["sessions"][0]["is_active"] is False
    assert body["sessions"][0]["is_mobile_sendable"] is True
    assert body["sessions"][0]["live_session_id"] == "live-abc"
    assert body["sessions"][0]["mobile_send_unavailable_reason"] == ""


def test_mobile_token_can_read_session_detail_and_messages_but_not_delete(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME, app
    import hermes_state

    class FakeSessionDB:
        def resolve_session_id(self, session_id):
            return session_id if session_id == "mobile-detail-session" else None

        def get_session(self, session_id):
            return {
                "id": session_id,
                "title": "Mobile Detail Session",
                "source": "telegram",
                "message_count": 2,
            }

        def resolve_resume_session_id(self, session_id):
            return session_id

        def get_messages(self, session_id):
            return [
                {"role": "user", "content": "Read this only."},
                {
                    "role": "assistant",
                    "content": "Showing read-only detail.\nMEDIA:/tmp/hermes/chart.png\n![voice](https://example.com/voice.m4a)",
                },
            ]

        def delete_session(self, session_id):
            raise AssertionError("mobile token must not reach delete handler")

        def close(self):
            pass

    monkeypatch.setattr(hermes_state, "SessionDB", FakeSessionDB)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )
    token = issued.json()["token"]
    headers = {_MOBILE_TOKEN_HEADER_NAME: token}

    previous = getattr(app.state, "auth_required", False)
    app.state.auth_required = True
    try:
        detail = unauthenticated_client.get("/api/sessions/mobile-detail-session", headers=headers)
        messages = unauthenticated_client.get("/api/sessions/mobile-detail-session/messages", headers=headers)
        delete = unauthenticated_client.delete("/api/sessions/mobile-detail-session", headers=headers)
    finally:
        app.state.auth_required = previous

    assert detail.status_code == 200
    assert detail.json()["id"] == "mobile-detail-session"
    assert messages.status_code == 200
    message_rows = messages.json()["messages"]
    assert [m["content"] for m in message_rows] == [
        "Read this only.",
        "Showing read-only detail.\nMEDIA:/tmp/hermes/chart.png\n![voice](https://example.com/voice.m4a)",
    ]
    assert message_rows[1]["media_items"] == [
        {
            "kind": "image",
            "filename": "chart.png",
            "content_type": "image/png",
            "source": "local",
            "path": "/tmp/hermes/chart.png",
        },
        {
            "kind": "audio",
            "filename": "voice.m4a",
            "content_type": "audio/mp4a-latm",
            "label": "voice",
            "source": "remote",
            "url": "https://example.com/voice.m4a",
        },
    ]
    assert delete.status_code == 401


def test_mobile_readonly_token_cannot_send_session_message(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/messages",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json={"text": "This must not send."},
    )

    assert response.status_code == 401


def test_mobile_readonly_token_cannot_prepare_live_session(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={"device_name": "Leroy iPhone", "platform": "ios"},
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/stored-session/resume",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )

    assert response.status_code == 401


def test_mobile_send_scope_prepares_live_session(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    calls = []
    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                prepare_mobile_live_session=lambda session_id: calls.append(session_id) or {
                    "ok": True,
                    "status": "idle",
                    "session_id": session_id,
                    "live_session_id": "live-prepare-123",
                    "is_mobile_sendable": True,
                    "mobile_send_unavailable_reason": "",
                    "message_count": 8,
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/stored-session/resume",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == "idle"
    assert body["session_id"] == "stored-session"
    assert body["live_session_id"] == "live-prepare-123"
    assert body["is_mobile_sendable"] is True
    assert body["mobile_send_unavailable_reason"] == ""
    assert body["message_count"] == 8
    assert calls == ["stored-session"]


def test_mobile_prepare_scope_returns_gateway_bridge_errors(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                prepare_mobile_live_session=lambda session_id: {
                    "ok": False,
                    "status_code": 409,
                    "detail": "active session limit reached",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPad",
            "platform": "ipados",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/stored-session/resume",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "active session limit reached"


def test_mobile_prepare_scope_maps_missing_session_to_404(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                prepare_mobile_live_session=lambda session_id: {
                    "ok": False,
                    "status_code": 404,
                    "detail": "session not found",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPad",
            "platform": "ipados",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/missing-session/resume",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "session not found"


def test_mobile_send_scope_submits_to_live_gateway_bridge(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    calls = []

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                submit_mobile_prompt_to_live_session=lambda session_id, text: calls.append(
                    {"session_id": session_id, "text": text}
                ) or {
                    "ok": True,
                    "status": "streaming",
                    "session_id": session_id,
                    "live_session_id": "live-123",
                }
            )
        return original_import_module(name)

    original_import_module = importlib.import_module
    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    assert issued.status_code == 200
    body = issued.json()
    assert body["device"]["scopes"] == ["messages:send", "sessions:read"]
    token = body["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/messages",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json={"text": "Hello from native mobile."},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "streaming"
    assert response.json()["live_session_id"] == "live-123"
    assert calls == [{"session_id": "live-session", "text": "Hello from native mobile."}]


def test_mobile_send_scope_returns_gateway_bridge_errors(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                submit_mobile_prompt_to_live_session=lambda session_id, text: {
                    "ok": False,
                    "status_code": 404,
                    "detail": "session is not live in the current Hermes desktop gateway",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPad",
            "platform": "ipados",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/offline-session/messages",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json={"text": "Hello."},
    )

    assert response.status_code == 404
    assert "not live" in response.json()["detail"]


def _upload_payload(**overrides):
    payload = {
        "filename": "note.txt",
        "content_type": "text/plain",
        "kind": "file",
        "data_base64": base64.b64encode(b"mobile upload smoke").decode("ascii"),
        "caption": "Attach this to the live session.",
    }
    payload.update(overrides)
    return payload


def test_mobile_upload_route_requires_token(unauthenticated_client):
    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        json=_upload_payload(),
    )

    assert response.status_code == 401


def test_mobile_upload_route_requires_files_upload_scope(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json=_upload_payload(),
    )

    assert response.status_code == 401


def test_mobile_upload_route_requires_messages_send_scope(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "files:upload"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json=_upload_payload(),
    )

    assert response.status_code == 403
    assert "messages:send" in response.json()["detail"]


def test_mobile_upload_route_stores_file_and_submits_attachment_prompt(
    monkeypatch,
    tmp_path,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME
    import importlib

    calls = []
    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                submit_mobile_prompt_to_live_session=lambda session_id, text: calls.append(
                    {"session_id": session_id, "text": text}
                ) or {
                    "ok": True,
                    "status": "streaming",
                    "session_id": session_id,
                    "live_session_id": "live-upload-123",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send", "files:upload"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json=_upload_payload(filename="../../voice note.m4a", content_type="audio/mp4", kind="voice"),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == "streaming"
    assert body["live_session_id"] == "live-upload-123"
    assert body["upload"]["kind"] == "voice"
    assert body["upload"]["filename"] == "_.._voice note.m4a"
    stored_path = tmp_path / "mobile_uploads" / "live-session"
    stored_files = list(stored_path.glob("*-_.._voice note.m4a"))
    assert len(stored_files) == 1
    assert stored_files[0].read_bytes() == b"mobile upload smoke"
    assert calls[0]["session_id"] == "live-session"
    assert "Voice note upload from mobile is confirmed." in calls[0]["text"]
    assert str(stored_files[0]) in calls[0]["text"]
    assert "Attach this to the live session." in calls[0]["text"]


def test_mobile_upload_token_bypasses_oauth_gate_and_route_requires_send_scope(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME, app

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "files:upload"],
        },
    )
    token = issued.json()["token"]

    previous = getattr(app.state, "auth_required", False)
    app.state.auth_required = True
    try:
        response = unauthenticated_client.post(
            "/api/mobile/sessions/live-session/uploads",
            headers={_MOBILE_TOKEN_HEADER_NAME: token},
            json=_upload_payload(),
        )
    finally:
        app.state.auth_required = previous

    assert response.status_code == 403
    assert "messages:send" in response.json()["detail"]


def test_mobile_upload_token_bypasses_oauth_gate_with_full_scope(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from types import SimpleNamespace
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME, app
    import importlib

    original_import_module = importlib.import_module

    def fake_import_module(name):
        if name == "tui_gateway.server":
            return SimpleNamespace(
                submit_mobile_prompt_to_live_session=lambda session_id, text: {
                    "ok": True,
                    "status": "streaming",
                    "session_id": session_id,
                    "live_session_id": "live-upload-oauth-123",
                }
            )
        return original_import_module(name)

    monkeypatch.setattr(importlib, "import_module", fake_import_module)
    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send", "files:upload"],
        },
    )
    token = issued.json()["token"]

    previous = getattr(app.state, "auth_required", False)
    app.state.auth_required = True
    try:
        response = unauthenticated_client.post(
            "/api/mobile/sessions/live-session/uploads",
            headers={_MOBILE_TOKEN_HEADER_NAME: token},
            json=_upload_payload(),
        )
    finally:
        app.state.auth_required = previous

    assert response.status_code == 200
    assert response.json()["live_session_id"] == "live-upload-oauth-123"


def test_mobile_upload_route_rejects_invalid_base64(
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send", "files:upload"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json=_upload_payload(data_base64="not base64!!"),
    )

    assert response.status_code == 400
    assert "invalid base64" in response.json()["detail"]


def test_mobile_upload_route_rejects_oversize_payload(
    monkeypatch,
    dashboard_client,
    unauthenticated_client,
):
    from hermes_cli import web_server
    from hermes_cli.web_server import _MOBILE_TOKEN_HEADER_NAME

    monkeypatch.setattr(web_server, "_MOBILE_UPLOAD_MAX_BYTES", 4)
    issued = dashboard_client.post(
        "/api/mobile/pairing/approve",
        json={
            "device_name": "Leroy iPhone",
            "platform": "ios",
            "scopes": ["sessions:read", "messages:send", "files:upload"],
        },
    )
    token = issued.json()["token"]

    response = unauthenticated_client.post(
        "/api/mobile/sessions/live-session/uploads",
        headers={_MOBILE_TOKEN_HEADER_NAME: token},
        json=_upload_payload(data_base64=base64.b64encode(b"too large").decode("ascii")),
    )

    assert response.status_code == 413
