"""Notebook storage: one pretty-printed JSON file per notebook in a folder on disk."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

EXTENSION = ".mathnb.json"
SCRATCH_FILE = ".scratch" + EXTENSION
TRASH_DIR = ".trash"

# Names are file stems; keep them to characters that are safe on every OS.
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _\-.()]{0,99}$")


class NotebookNotFound(Exception):
    pass


class InvalidName(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(title: str) -> str:
    """Turn a notebook title into a safe file stem."""
    stem = re.sub(r"[^A-Za-z0-9 _\-.()]", "", title).strip(" .")
    stem = re.sub(r"\s+", " ", stem)[:80]
    return stem or "Untitled"


class NotebookStore:
    def __init__(self, root: Path):
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)

    # -- paths ---------------------------------------------------------------

    def _path(self, name: str) -> Path:
        if not _NAME_RE.match(name) or name.endswith("."):
            raise InvalidName(name)
        path = (self.root / f"{name}{EXTENSION}").resolve()
        if path.parent != self.root.resolve():
            raise InvalidName(name)
        return path

    def _unique_name(self, title: str) -> str:
        base = slugify(title)
        name, n = base, 2
        while (self.root / f"{name}{EXTENSION}").exists():
            name = f"{base} ({n})"
            n += 1
        return name

    # -- io ------------------------------------------------------------------

    @staticmethod
    def _write_atomic(path: Path, data: dict) -> None:
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    @staticmethod
    def _read(path: Path) -> dict:
        with path.open(encoding="utf-8") as f:
            return json.load(f)

    # -- notebooks -------------------------------------------------------------

    def list(self) -> list[dict]:
        items = []
        for path in self.root.glob(f"*{EXTENSION}"):
            if path.name.startswith("."):
                continue
            name = path.name[: -len(EXTENSION)]
            try:
                data = self._read(path)
            except (OSError, json.JSONDecodeError):
                data = {}
            stat = path.stat()
            items.append(
                {
                    "name": name,
                    "title": data.get("title") or name,
                    "modified": data.get("modified")
                    or datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                    "cellCount": len(data.get("cells", [])),
                    "id": data.get("id"),
                }
            )
        items.sort(key=lambda i: i["modified"], reverse=True)
        return items

    def get(self, name: str) -> dict:
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        return self._read(path)

    def create(self, notebook: dict) -> str:
        name = self._unique_name(notebook.get("title") or "Untitled")
        notebook.setdefault("created", now_iso())
        notebook["modified"] = now_iso()
        self._write_atomic(self._path(name), notebook)
        return name

    def save(self, name: str, notebook: dict) -> dict:
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        notebook["modified"] = now_iso()
        self._write_atomic(path, notebook)
        return notebook

    def rename(self, name: str, title: str) -> str:
        """Change a notebook's title and move its file to match. Returns the new name."""
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        data = self._read(path)
        data["title"] = title
        data["modified"] = now_iso()
        new_name = name if slugify(title) == name else self._unique_name(title)
        new_path = self._path(new_name)
        self._write_atomic(new_path, data)
        if new_path != path:
            path.unlink()
        return new_name

    def delete(self, name: str) -> None:
        """Move a notebook to the trash folder so it can be recovered by hand."""
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        trash = self.root / TRASH_DIR
        trash.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.move(str(path), trash / f"{name} {stamp}{EXTENSION}")

    # -- scratch -------------------------------------------------------------

    def get_scratch(self) -> dict | None:
        path = self.root / SCRATCH_FILE
        return self._read(path) if path.exists() else None

    def save_scratch(self, notebook: dict) -> None:
        notebook["modified"] = now_iso()
        self._write_atomic(self.root / SCRATCH_FILE, notebook)

    def clear_scratch(self) -> None:
        (self.root / SCRATCH_FILE).unlink(missing_ok=True)
