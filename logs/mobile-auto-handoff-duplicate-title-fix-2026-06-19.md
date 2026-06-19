# Mobile Auto Handoff HTTP 500 fix — 2026-06-19

## What failed

Auto Handoff reached the backend, but the backend returned HTTP 500.

## Cause

Repeated handoffs from the same chat tried to reuse the same session title.

The session database requires titles to be unique, so the second handoff could fail before the new handoff chat was made usable.

## Fix

The backend now gives repeated handoffs a safe numbered title instead of failing.

Example:

- `Original Chat — mobile handoff`
- `Original Chat — mobile handoff #2`

## Safety boundary

This only changes title handling for handoff sessions.

No send behavior changed.

No upload behavior changed.

No token or pairing behavior changed.

No tool execution route was added.

## Verification

Backend compile passed.

Mobile session endpoint tests passed.

Whitespace diff check passed.

The live local mobile handoff route returned 200 with a temporary scoped mobile token, then the temporary token was revoked.
