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
