"""Backup files: writing, listing, pruning and validation."""
import json

import pytest

from custom_components.haushaltsbuch import backups
from custom_components.haushaltsbuch.ledger import Ledger
from custom_components.haushaltsbuch.store import Book, ValidationError

from .test_store import ITEM


def test_backup_roundtrip_and_pruning(tmp_path, monkeypatch):
    book = Book()
    book.save_item("anna", ITEM)
    ledger = Ledger()
    ledger.add("anna", [{"date": "2026-11-04", "amount": -74, "name": "Strom"}])
    document = backups.make_document(book, ledger, "csv_import")
    name = backups.write(tmp_path, document)
    assert name.endswith("-csv_import.json")
    # same second: a second file gets its own name
    assert backups.write(tmp_path, document) != name
    found = backups.listing(tmp_path)
    assert found[0]["items"] == 1 and found[0]["rows"] == 1 and found[0]["reason"] == "csv_import"
    restored = backups.read(tmp_path, name)
    assert restored["book"]["items"] == book.data["items"]
    # the backup is a copy, later changes do not leak into it
    book.save_item("anna", {**ITEM, "name": "Neu"})
    assert len(json.loads((tmp_path / name).read_text())["book"]["items"]) == 1

    monkeypatch.setattr(backups, "KEEP", 3)
    for second in range(5):
        backups.write(tmp_path, {**document, "created": f"2026-11-07T10:00:0{second}+01:00"})
    assert len(backups.listing(tmp_path)) == 3


def test_backup_validation(tmp_path):
    with pytest.raises(ValidationError):
        backups.check_document({"format": "haushaltsbuch", "items": []})
    with pytest.raises(ValidationError):
        backups.check_document({"format": backups.BACKUP_FORMAT, "book": {"items": "x"}})
    with pytest.raises(ValidationError):
        backups.read(tmp_path, "../secrets.yaml")
    with pytest.raises(ValidationError):
        backups.read(tmp_path, "20261107-100000-manual.json")
