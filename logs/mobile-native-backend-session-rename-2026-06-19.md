# Mobile backend session title endpoint

Date: 2026-06-19

## Summary

Added the backend side of editable Mobile Native V1 session names.

The mobile backend now has a narrow session-title endpoint for mobile clients:

- POST /api/mobile/sessions/{session_id}/title

The endpoint uses the existing mobile token write boundary and requires messages:send.

It updates the normal SessionDB title so desktop/history title behavior stays consistent with existing Hermes session title rules.

## Safety boundary

No broad dashboard PATCH route was exposed to mobile tokens.

No delete/archive/tool execution routes were added.

No polling, push, background, pairing, Keychain, revocation, or upload-scope changes were added.

Upload routes remain separate and still require files:upload plus messages:send.

## Verification

Passed:

- python3 -m py_compile hermes_cli/web_server.py hermes_cli/dashboard_auth/middleware.py
- pytest -q tests/hermes_cli/test_mobile_sessions_endpoints.py -q

Result: all targeted mobile session endpoint tests passed.
