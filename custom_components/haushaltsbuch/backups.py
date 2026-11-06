"""Versioned backups of all Haushaltsbuch data in /config/haushaltsbuch_backups.

A backup holds the book (items, households, users) and the saved bank
transactions. Backups are made by hand, before every CSV import and before a
restore, and the newest ones are kept. Restoring replaces the data of all
users, so only administrators may list, download or restore them.
"""
from __future__ import annotations

import copy
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .ledger import Ledger
from .store import Book, ValidationError

BACKUP_FORMAT = "haushaltsbuch-backup"
BACKUP_VERSION = 1
KEEP = 30
REASONS = ("manual", "csv_import", "before_restore", "upload")
_NAME = re.compile(r"^\d{8}-\d{6}(-\d+)?-[a-z_]+\.json$")


def backup_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.path("haushaltsbuch_backups"))


def make_document(book: Book, ledger: Ledger, reason: str) -> dict[str, Any]:
    return {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "created": dt_util.now().isoformat(timespec="seconds"),
        "reason": reason,
        "book": copy.deepcopy(book.data),
        "ledger": copy.deepcopy(ledger.data),
    }


def summary(document: dict[str, Any]) -> dict[str, Any]:
    book = document.get("book") or {}
    ledger = document.get("ledger") or {}
    return {
        "created": document.get("created"),
        "reason": document.get("reason"),
        "items": len(book.get("items") or {}),
        "households": len(book.get("households") or {}),
        "rows": sum(len(u.get("rows") or []) for u in (ledger.get("users") or {}).values()),
    }


def check_document(document: Any) -> dict[str, Any]:
    """Accept only a complete backup; the book must load without errors."""
    if not isinstance(document, dict) or document.get("format") != BACKUP_FORMAT:
        raise ValidationError("backup_format")
    if not isinstance(document.get("book"), dict) or not isinstance(document["book"].get("items"), dict):
        raise ValidationError("backup_book")
    try:
        Book(copy.deepcopy(document["book"]))
        Ledger(copy.deepcopy(document.get("ledger") or {"users": {}}))
    except Exception as err:  # noqa: BLE001 - any broken file is a format error
        raise ValidationError("backup_content") from err
    return document


def write(folder: Path, document: dict[str, Any]) -> str:
    """Write a backup file and prune old ones. Runs in the executor."""
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.fromisoformat(document["created"]).strftime("%Y%m%d-%H%M%S")
    reason = document["reason"] if document["reason"] in REASONS else "manual"
    name = f"{stamp}-{reason}.json"
    counter = 1
    while (folder / name).exists():
        counter += 1
        name = f"{stamp}-{counter}-{reason}.json"
    (folder / name).write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    for old in sorted(_files(folder), reverse=True)[KEEP:]:
        old.unlink()
    return name


def listing(folder: Path) -> list[dict[str, Any]]:
    result = []
    for path in sorted(_files(folder), reverse=True):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        result.append({"id": path.name, "size": path.stat().st_size, **summary(document)})
    return result


def read(folder: Path, backup_id: str) -> dict[str, Any]:
    if not _NAME.match(backup_id or ""):
        raise ValidationError("backup_id")
    path = folder / backup_id
    if not path.is_file():
        raise ValidationError("backup_id")
    return check_document(json.loads(path.read_text(encoding="utf-8")))


def _files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return [p for p in folder.iterdir() if p.is_file() and _NAME.match(p.name)]
