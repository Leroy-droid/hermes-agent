"""Native mobile device pairing token store for Hermes dashboard clients.

This module intentionally has no FastAPI route registration. It is the small,
testable security core for future iPhone/iPad/Mac native clients:

- issue a high-entropy scoped device token
- store only a salted hash on disk
- validate token + scope without leaking raw values
- revoke individual devices

HTTP endpoints should be added only after this layer is covered by tests.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from hermes_constants import get_hermes_home
from utils import atomic_replace

MOBILE_PAIRING_DIR = "mobile_pairing"
DEVICES_FILENAME = "devices.json"
TOKEN_BYTES = 32
SALT_BYTES = 16
DEFAULT_SCOPES = frozenset({"sessions:read"})


@dataclass(frozen=True)
class MobileDeviceRecord:
    """Stored metadata for one paired native device.

    ``token_hash`` and ``salt`` are base64 strings. The raw token is never
    persisted and is returned only once from ``issue_device_token``.
    """

    device_id: str
    device_name: str
    platform: str
    scopes: tuple[str, ...]
    token_hash: str
    salt: str
    created_at: float
    last_seen_at: float | None = None
    revoked_at: float | None = None

    @property
    def active(self) -> bool:
        return self.revoked_at is None


@dataclass(frozen=True)
class IssuedMobileToken:
    device_id: str
    token: str
    record: MobileDeviceRecord


@dataclass(frozen=True)
class MobileTokenValidation:
    ok: bool
    reason: str
    record: MobileDeviceRecord | None = None


@dataclass
class MobilePairingStore:
    """File-backed mobile device token store.

    The default path is ``$HERMES_HOME/mobile_pairing/devices.json``.
    Tests can pass an explicit ``root``.
    """

    root: Path | None = None
    now: Callable[[], float] = time.time

    def __post_init__(self) -> None:
        if self.root is None:
            self.root = get_hermes_home() / MOBILE_PAIRING_DIR
        root = self.root
        assert root is not None
        root.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path:
        assert self.root is not None
        return self.root / DEVICES_FILENAME

    def issue_device_token(
        self,
        *,
        device_name: str,
        platform: str,
        scopes: Iterable[str] = DEFAULT_SCOPES,
    ) -> IssuedMobileToken:
        device_name = _clean_label(device_name, fallback="Unnamed device")
        platform = _clean_label(platform, fallback="unknown")
        normalized_scopes = _normalize_scopes(scopes)
        token = _new_token()
        salt = secrets.token_bytes(SALT_BYTES)
        device_id = secrets.token_urlsafe(18)
        record = MobileDeviceRecord(
            device_id=device_id,
            device_name=device_name,
            platform=platform,
            scopes=tuple(normalized_scopes),
            token_hash=_b64(_hash_token(token, salt)),
            salt=_b64(salt),
            created_at=float(self.now()),
        )
        records = self._load()
        records[device_id] = record
        self._save(records)
        return IssuedMobileToken(device_id=device_id, token=token, record=record)

    def validate_token(self, token: str, *, required_scope: str = "sessions:read") -> MobileTokenValidation:
        token = str(token or "").strip()
        required_scope = str(required_scope or "").strip()
        if not token:
            return MobileTokenValidation(False, "missing_token")
        if not required_scope:
            return MobileTokenValidation(False, "missing_required_scope")

        records = self._load()
        for device_id, record in records.items():
            if not record.active:
                continue
            try:
                salt = base64.urlsafe_b64decode(record.salt.encode("ascii"))
                expected = base64.urlsafe_b64decode(record.token_hash.encode("ascii"))
            except Exception:
                continue
            actual = _hash_token(token, salt)
            if hmac.compare_digest(actual, expected):
                if required_scope not in record.scopes:
                    return MobileTokenValidation(False, "insufficient_scope", record)
                updated = MobileDeviceRecord(
                    **{**record.__dict__, "last_seen_at": float(self.now())}
                )
                records[device_id] = updated
                self._save(records)
                return MobileTokenValidation(True, "ok", updated)
        return MobileTokenValidation(False, "invalid_token")

    def list_devices(self, *, include_revoked: bool = False) -> list[MobileDeviceRecord]:
        records = self._load().values()
        result = [record for record in records if include_revoked or record.active]
        return sorted(result, key=lambda record: record.created_at, reverse=True)

    def revoke_device(self, device_id: str) -> bool:
        device_id = str(device_id or "").strip()
        if not device_id:
            return False
        records = self._load()
        record = records.get(device_id)
        if record is None or not record.active:
            return False
        records[device_id] = MobileDeviceRecord(
            **{**record.__dict__, "revoked_at": float(self.now())}
        )
        self._save(records)
        return True

    def _load(self) -> dict[str, MobileDeviceRecord]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        records: dict[str, MobileDeviceRecord] = {}
        for device_id, payload in raw.get("devices", {}).items():
            try:
                record = MobileDeviceRecord(
                    device_id=str(payload["device_id"]),
                    device_name=str(payload["device_name"]),
                    platform=str(payload["platform"]),
                    scopes=tuple(str(scope) for scope in payload.get("scopes", [])),
                    token_hash=str(payload["token_hash"]),
                    salt=str(payload["salt"]),
                    created_at=float(payload["created_at"]),
                    last_seen_at=(
                        float(payload["last_seen_at"])
                        if payload.get("last_seen_at") is not None
                        else None
                    ),
                    revoked_at=(
                        float(payload["revoked_at"])
                        if payload.get("revoked_at") is not None
                        else None
                    ),
                )
            except (KeyError, TypeError, ValueError):
                continue
            records[device_id] = record
        return records

    def _save(self, records: dict[str, MobileDeviceRecord]) -> None:
        payload = {
            "version": 1,
            "devices": {
                device_id: {
                    "device_id": record.device_id,
                    "device_name": record.device_name,
                    "platform": record.platform,
                    "scopes": list(record.scopes),
                    "token_hash": record.token_hash,
                    "salt": record.salt,
                    "created_at": record.created_at,
                    "last_seen_at": record.last_seen_at,
                    "revoked_at": record.revoked_at,
                }
                for device_id, record in records.items()
            },
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            atomic_replace(tmp_path, self.path)
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise


def _new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def _hash_token(token: str, salt: bytes) -> bytes:
    return hashlib.sha256(salt + token.encode("utf-8")).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii")


def _clean_label(value: str, *, fallback: str) -> str:
    cleaned = " ".join(str(value or "").strip().split())
    return cleaned[:120] if cleaned else fallback


def _normalize_scopes(scopes: Iterable[str]) -> list[str]:
    normalized = sorted({str(scope).strip() for scope in scopes if str(scope).strip()})
    return normalized or sorted(DEFAULT_SCOPES)
