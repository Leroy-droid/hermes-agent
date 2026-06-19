"""Mobile Sessions command-center endpoint tests."""

import pytest


class _FakeSessionDB:
    def __init__(self, rows):
        self._rows = rows
        self.closed = False

    def _get_session_rich_row(self, session_id):
        return self._rows.get(session_id)

    def close(self):
        self.closed = True


@pytest.fixture
def dashboard_client():
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client


def _patch_session_db(monkeypatch, rows):
    import hermes_state

    monkeypatch.setattr(hermes_state, "SessionDB", lambda: _FakeSessionDB(rows))


def test_waiting_input_endpoint_shapes_live_blockers(monkeypatch, dashboard_client):
    import tui_gateway.server as gateway_server

    _patch_session_db(
        monkeypatch,
        {
            "stored-session": {
                "id": "stored-session",
                "source": "telegram",
                "model": "openai/gpt-5.5",
                "title": "Stored Approval Session",
                "started_at": 1000.0,
                "last_active": 2000.0,
                "message_count": 7,
                "tool_call_count": 3,
                "input_tokens": 111,
                "output_tokens": 222,
                "parent_session_id": "parent-1",
            }
        },
    )

    captured = {}

    def fake_waiting(limit):
        captured["limit"] = limit
        return [
            {
                "kind": "approval",
                "payload": {
                    "request_id": "approval-1",
                    "command": "sudo make install",
                    "description": "Install build prerequisites",
                    "allow_permanent": False,
                },
                "session": {
                    "id": "live-approval",
                    "session_key": "stored-session",
                    "last_active": 1500.0,
                    "started_at": 900.0,
                    "model": "live/model",
                    "title": "Live title",
                    "message_count": 2,
                },
            },
            {
                "kind": "clarify",
                "payload": {
                    "request_id": "clarify-1",
                    "question": "Which path should I use?",
                    "choices": ["A", "B"],
                },
                "session": {
                    "id": "live-clarify",
                    "session_key": "clarify-session",
                    "last_active": 1700.0,
                    "started_at": 1600.0,
                    "model": "live/clarify",
                    "title": "Clarify Session",
                    "message_count": 4,
                },
            },
            {
                "kind": "progress",
                "payload": {"request_id": "ignored"},
                "session": {"id": "ignored", "session_key": "ignored"},
            },
        ]

    monkeypatch.setattr(gateway_server, "list_waiting_input_sessions", fake_waiting)

    resp = dashboard_client.get("/api/sessions/waiting-input?limit=99")

    assert resp.status_code == 200
    assert captured["limit"] == 50
    data = resp.json()
    assert data["total"] == 2
    assert data["limit"] == 99
    assert data["offset"] == 0

    approval, clarify = data["sessions"]
    assert approval["id"] == "stored-session"
    assert approval["live_session_id"] == "live-approval"
    assert approval["source"] == "telegram"
    assert approval["model"] == "openai/gpt-5.5"
    assert approval["title"] == "Stored Approval Session"
    assert approval["message_count"] == 7
    assert approval["tool_call_count"] == 3
    assert approval["last_active"] == 2000.0
    assert approval["parent_session_id"] == "parent-1"
    assert approval["pending_kind"] == "approval"
    assert approval["pending_summary"] == "Approval needed: sudo make install"
    assert approval["pending_request_id"] == "approval-1"
    assert approval["pending_command"] == "sudo make install"
    assert approval["pending_description"] == "Install build prerequisites"
    assert approval["pending_allow_permanent"] is False

    assert clarify["id"] == "clarify-session"
    assert clarify["source"] == "tui"
    assert clarify["model"] == "live/clarify"
    assert clarify["title"] == "Clarify Session"
    assert clarify["pending_kind"] == "clarify"
    assert clarify["pending_summary"] == "Which path should I use?"
    assert clarify["pending_question"] == "Which path should I use?"
    assert clarify["pending_choices"] == ["A", "B"]


def test_active_work_endpoint_shapes_live_sessions(monkeypatch, dashboard_client):
    import tui_gateway.server as gateway_server

    _patch_session_db(
        monkeypatch,
        {
            "stored-active": {
                "id": "stored-active",
                "source": "cli",
                "model": "openai/gpt-5.5",
                "title": "Stored Active Session",
                "started_at": 100.0,
                "last_active": 300.0,
                "message_count": 12,
                "tool_call_count": 5,
                "input_tokens": 400,
                "output_tokens": 800,
                "parent_session_id": None,
            }
        },
    )

    captured = {}

    def fake_active(limit):
        captured["limit"] = limit
        return [
            {
                "id": "live-active",
                "session_key": "stored-active",
                "status": "working",
                "running": True,
                "last_active": 250.0,
                "started_at": 80.0,
                "model": "live/model",
                "title": "Live title",
                "message_count": 2,
                "preview": "fallback preview",
                "inflight": {
                    "user": "Please draft the guide",
                    "assistant": "Creating the outline now",
                },
            },
            {
                "id": "live-only",
                "session_key": "live-only",
                "status": "starting",
                "running": False,
                "last_active": 200.0,
                "started_at": 190.0,
                "model": "live/only",
                "title": "Live Only",
                "message_count": 1,
                "inflight": {"user": "Start this task"},
            },
        ]

    monkeypatch.setattr(gateway_server, "list_active_work_sessions", fake_active)

    resp = dashboard_client.get("/api/sessions/active-work?limit=2")

    assert resp.status_code == 200
    assert captured["limit"] == 2
    data = resp.json()
    assert data["total"] == 2
    assert data["limit"] == 2
    assert data["offset"] == 0

    stored, live_only = data["sessions"]
    assert stored["id"] == "stored-active"
    assert stored["live_session_id"] == "live-active"
    assert stored["source"] == "cli"
    assert stored["model"] == "openai/gpt-5.5"
    assert stored["title"] == "Stored Active Session"
    assert stored["preview"] == "Creating the outline now"
    assert stored["message_count"] == 12
    assert stored["tool_call_count"] == 5
    assert stored["last_active"] == 300.0
    assert stored["live_status"] == "working"
    assert stored["live_running"] is True
    assert stored["live_inflight_user"] == "Please draft the guide"
    assert stored["live_inflight_assistant"] == "Creating the outline now"

    assert live_only["id"] == "live-only"
    assert live_only["live_session_id"] == "live-only"
    assert live_only["source"] == "tui"
    assert live_only["model"] == "live/only"
    assert live_only["title"] == "Live Only"
    assert live_only["preview"] == "Working on: Start this task"
    assert live_only["live_status"] == "starting"
    assert live_only["live_running"] is False
    assert live_only["live_inflight_user"] == "Start this task"
    assert live_only["live_inflight_assistant"] == ""


def test_prepare_mobile_live_session_uses_lazy_resume(monkeypatch):
    import tui_gateway.server as gateway_server

    calls = []

    def fake_resume(rid, params):
        calls.append(params)
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "session_id": "live-prepared",
                "resumed": "stored-session",
                "message_count": 4,
                "status": "idle",
            },
        }

    monkeypatch.setitem(gateway_server._methods, "session.resume", fake_resume)
    monkeypatch.setattr(
        gateway_server,
        "mobile_live_session_status",
        lambda session_id: {
            "is_mobile_sendable": True,
            "live_session_id": "live-prepared",
            "mobile_send_unavailable_reason": "",
        },
    )

    result = gateway_server.prepare_mobile_live_session("stored-session")

    assert result == {
        "ok": True,
        "status": "idle",
        "session_id": "stored-session",
        "live_session_id": "live-prepared",
        "is_mobile_sendable": True,
        "mobile_send_unavailable_reason": "",
        "message_count": 4,
    }
    assert calls == [{"session_id": "stored-session", "lazy": True}]


def test_prepare_mobile_live_session_maps_not_found(monkeypatch):
    import tui_gateway.server as gateway_server

    def fake_resume(rid, params):
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "error": {"code": 4007, "message": "session not found"},
        }

    monkeypatch.setitem(gateway_server._methods, "session.resume", fake_resume)

    result = gateway_server.prepare_mobile_live_session("missing-session")

    assert result == {
        "ok": False,
        "status_code": 404,
        "detail": "session not found",
    }


def test_prepare_mobile_live_session_reuses_existing_live_session(monkeypatch):
    import threading
    import tui_gateway.server as gateway_server

    live_session = {
        "agent": None,
        "history_lock": threading.Lock(),
        "lazy": True,
        "running": False,
        "session_key": "stored-session",
    }
    with gateway_server._sessions_lock:
        gateway_server._sessions["live-existing"] = live_session
    try:
        def fake_resume(rid, params):
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "session_id": "live-existing",
                    "resumed": "stored-session",
                    "message_count": 5,
                    "status": "idle",
                },
            }

        monkeypatch.setitem(gateway_server._methods, "session.resume", fake_resume)

        result = gateway_server.prepare_mobile_live_session("stored-session")
    finally:
        with gateway_server._sessions_lock:
            gateway_server._sessions.pop("live-existing", None)

    assert result["ok"] is True
    assert result["session_id"] == "stored-session"
    assert result["live_session_id"] == "live-existing"
    assert result["is_mobile_sendable"] is True
    assert result["mobile_send_unavailable_reason"] == ""
    assert result["message_count"] == 5


def test_prepare_mobile_live_session_is_idempotent_for_existing_live_session(monkeypatch):
    import threading
    import tui_gateway.server as gateway_server

    calls = []
    live_session = {
        "agent": None,
        "history_lock": threading.Lock(),
        "lazy": True,
        "running": False,
        "session_key": "stored-session",
    }

    def fake_resume(rid, params):
        calls.append(params)
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "session_id": "live-existing",
                "resumed": "stored-session",
                "message_count": 5,
                "status": "idle",
            },
        }

    monkeypatch.setitem(gateway_server._methods, "session.resume", fake_resume)
    with gateway_server._sessions_lock:
        gateway_server._sessions["live-existing"] = live_session
    try:
        first = gateway_server.prepare_mobile_live_session("stored-session")
        second = gateway_server.prepare_mobile_live_session("stored-session")
    finally:
        with gateway_server._sessions_lock:
            gateway_server._sessions.pop("live-existing", None)

    assert first["ok"] is True
    assert second["ok"] is True
    assert first["live_session_id"] == second["live_session_id"] == "live-existing"
    assert calls == [
        {"session_id": "stored-session", "lazy": True},
        {"session_id": "stored-session", "lazy": True},
    ]


def test_mobile_send_path_allows_new_session_and_handoff_routes():
    from hermes_cli.web_server import _is_mobile_token_send_path

    assert _is_mobile_token_send_path("/api/mobile/sessions", "POST") is True
    assert _is_mobile_token_send_path("/api/mobile/sessions/abc/handoff", "POST") is True
    assert _is_mobile_token_send_path("/api/mobile/sessions/abc/uploads", "POST") is False
    assert _is_mobile_token_send_path("/api/mobile/sessions", "GET") is False


def test_dashboard_auth_mobile_send_path_allows_new_session_and_handoff_routes():
    from hermes_cli.dashboard_auth.middleware import _is_mobile_token_send_path

    assert _is_mobile_token_send_path("/api/mobile/sessions", "POST") is True
    assert _is_mobile_token_send_path("/api/mobile/sessions/abc/handoff", "POST") is True
    assert _is_mobile_token_send_path("/api/mobile/sessions/abc/uploads", "POST") is False
    assert _is_mobile_token_send_path("/api/mobile/sessions", "GET") is False


def test_create_mobile_session_endpoint_uses_gateway(monkeypatch, dashboard_client):
    import hermes_cli.web_server as web_server
    import tui_gateway.server as gateway_server
    from types import SimpleNamespace

    fake_record = SimpleNamespace(
        device_id="device-1",
        device_name="Leroy iPhone",
        platform="ios",
        scopes=["sessions:read", "messages:send"],
        created_at=1.0,
        last_seen_at=2.0,
        revoked_at=None,
        active=True,
    )

    def fake_has_mobile_token(request, required_scope="sessions:read"):
        request.state.mobile_device = fake_record
        return required_scope == "messages:send"

    monkeypatch.setattr(web_server, "_has_valid_mobile_token", fake_has_mobile_token)
    monkeypatch.setattr(
        gateway_server,
        "create_mobile_live_session",
        lambda title: {
            "ok": True,
            "status": "idle",
            "session_id": "stored-new",
            "live_session_id": "live-new",
            "title": title,
            "message_count": 0,
            "is_mobile_sendable": True,
            "mobile_send_unavailable_reason": "",
        },
    )

    resp = dashboard_client.post("/api/mobile/sessions", json={"title": "Mobile Test"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["session_id"] == "stored-new"
    assert data["live_session_id"] == "live-new"
    assert data["title"] == "Mobile Test"
    assert data["is_mobile_sendable"] is True
    assert data["device"]["device_id"] == "device-1"


def test_unique_mobile_handoff_title_adds_suffix_for_duplicate_title():
    import tui_gateway.server as gateway_server

    class FakeDB:
        def __init__(self):
            self.titles = {
                "Existing Chat — mobile handoff": {"id": "old-1"},
            }

        def get_session_by_title(self, title):
            return self.titles.get(title)

    title = gateway_server._unique_mobile_handoff_title(
        FakeDB(),
        "Existing Chat — mobile handoff",
        "new-session",
    )

    assert title == "Existing Chat — mobile handoff #2"


def test_unique_mobile_handoff_title_keeps_titles_under_session_limit():
    import tui_gateway.server as gateway_server

    class FakeDB:
        def get_session_by_title(self, title):
            if title.endswith(" #2"):
                return None
            return {"id": "old-1"}

    title = gateway_server._unique_mobile_handoff_title(
        FakeDB(),
        "A" * 140,
        "new-session",
    )

    assert title.endswith(" #2")
    assert len(title) <= 100


def test_unique_mobile_handoff_title_does_not_stack_handoff_suffix():
    import tui_gateway.server as gateway_server

    class FakeDB:
        def get_session_by_title(self, _title):
            return None

    title = gateway_server._unique_mobile_handoff_title(
        FakeDB(),
        "Existing Chat — mobile handoff — mobile handoff",
        "new-session",
    )

    assert title == "Existing Chat — mobile handoff"


def test_set_unique_mobile_handoff_title_retries_title_race():
    import tui_gateway.server as gateway_server

    class FakeDB:
        def __init__(self):
            self.saved = []

        def get_session_by_title(self, title):
            if title == "Existing Chat — mobile handoff":
                return None
            return None

        def set_session_title(self, _session_id, title):
            self.saved.append(title)
            if title == "Existing Chat — mobile handoff":
                raise ValueError("Title 'Existing Chat — mobile handoff' is already in use by session old-1")
            return True

    db = FakeDB()
    title = gateway_server._set_unique_mobile_handoff_title(
        db,
        "new-session",
        "Existing Chat — mobile handoff",
    )

    assert title == "Existing Chat — mobile handoff #2"
    assert db.saved == ["Existing Chat — mobile handoff", "Existing Chat — mobile handoff #2"]


def test_handoff_mobile_session_endpoint_uses_gateway(monkeypatch, dashboard_client):
    import hermes_cli.web_server as web_server
    import tui_gateway.server as gateway_server
    from types import SimpleNamespace

    fake_record = SimpleNamespace(
        device_id="device-1",
        device_name="Leroy iPhone",
        platform="ios",
        scopes=["sessions:read", "messages:send"],
        created_at=1.0,
        last_seen_at=2.0,
        revoked_at=None,
        active=True,
    )

    def fake_has_mobile_token(request, required_scope="sessions:read"):
        request.state.mobile_device = fake_record
        return required_scope == "messages:send"

    monkeypatch.setattr(web_server, "_has_valid_mobile_token", fake_has_mobile_token)
    monkeypatch.setattr(
        gateway_server,
        "create_mobile_handoff_session",
        lambda session_id, title: {
            "ok": True,
            "status": "idle",
            "session_id": "stored-handoff",
            "live_session_id": "live-handoff",
            "title": title or "Old — mobile handoff",
            "parent_session_id": session_id,
            "message_count": 8,
            "is_mobile_sendable": True,
            "mobile_send_unavailable_reason": "",
        },
    )

    resp = dashboard_client.post("/api/mobile/sessions/old-session/handoff", json={})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["session_id"] == "stored-handoff"
    assert data["live_session_id"] == "live-handoff"
    assert data["parent_session_id"] == "old-session"
    assert data["message_count"] == 8


def test_create_mobile_handoff_session_uses_compact_seed(monkeypatch):
    import tui_gateway.server as gateway_server

    class FakeDB:
        def __init__(self):
            self.created = []
            self.appended = []
            self.titles = {"source": "Long Chat"}

        def get_session(self, session_id):
            return {"id": session_id, "title": "Long Chat"} if session_id == "source" else None

        def get_session_title(self, session_id):
            return self.titles.get(session_id)

        def get_session_by_title(self, _title):
            return None

        def get_messages_as_conversation(self, _session_id):
            return [
                {"role": "user", "content": "Original request"},
                {"role": "assistant", "content": "Detailed answer"},
                {"role": "tool", "content": "noisy tool output that should not be cloned"},
                {"role": "user", "content": "Continue from here"},
            ]

        def create_session(self, *args, **kwargs):
            self.created.append((args, kwargs))

        def append_message(self, **kwargs):
            self.appended.append(kwargs)

        def set_session_title(self, session_id, title):
            self.titles[session_id] = title
            return True

    fake_db = FakeDB()
    captured = {}

    def fake_create(_rid, params):
        captured.update(params)
        with gateway_server._sessions_lock:
            gateway_server._sessions["live-new"] = {"session_key": "stored-new"}
        return {
            "jsonrpc": "2.0",
            "id": "unused",
            "result": {"session_id": "live-new", "stored_session_id": "stored-new"},
        }

    monkeypatch.setattr(gateway_server, "_get_db", lambda: fake_db)
    monkeypatch.setitem(gateway_server._methods, "session.create", fake_create)
    try:
        result = gateway_server.create_mobile_handoff_session("source")
    finally:
        with gateway_server._sessions_lock:
            gateway_server._sessions.pop("live-new", None)

    assert result["ok"] is True
    assert result["session_id"] == "stored-new"
    assert result["live_session_id"] == "live-new"
    assert result["parent_session_id"] == "source"
    assert result["message_count"] == 1
    assert result["source_message_count"] == 3

    seed_messages = captured["messages"]
    assert len(seed_messages) == 2
    assert seed_messages[0]["role"] == "system"
    assert seed_messages[0]["_mobile_hidden"] is True
    assert "Original request" in seed_messages[0]["content"]
    assert "noisy tool output" not in seed_messages[0]["content"]
    assert seed_messages[1] == {
        "role": "assistant",
        "content": "Handoff complete. Ready to continue in this chat.",
    }

    assert len(fake_db.appended) == 2
    assert [message["role"] for message in fake_db.appended] == ["system", "assistant"]
    assert fake_db.created[0][1]["parent_session_id"] == "source"
