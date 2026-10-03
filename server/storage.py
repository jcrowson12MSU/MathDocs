"""Notebook storage: one pretty-printed JSON file per notebook, in folders on disk.

A notebook's name is its path inside the journal without the extension, e.g. "Quadratics" or
"Algebra/Unit 2/Quadratics". Folders are ordinary directories, so the journal stays easy to
browse outside the app. Hidden entries (names starting with ".", like .trash) are ignored.
"""

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
MAX_DEPTH = 8

# Each part of a name (file stem or folder) is kept to characters that are safe on every OS.
_SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _\-.()]{0,99}$")


class NotebookNotFound(Exception):
    pass


class FolderNotFound(Exception):
    pass


class InvalidName(Exception):
    pass


class AlreadyExists(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(title: str) -> str:
    """Turn a notebook or folder title into a safe file or folder name."""
    stem = re.sub(r"[^A-Za-z0-9 _\-.()]", "", title).strip(" .")
    stem = re.sub(r"\s+", " ", stem)[:80]
    return stem or "Untitled"


def _split(path: str) -> list[str]:
    """Validate a relative path like "Algebra/Unit 2" and return its parts ("" is the top level)."""
    if path in ("", "/"):
        return []
    parts = path.strip("/").split("/")
    if len(parts) > MAX_DEPTH or any(not _SEGMENT_RE.match(p) or p.endswith(".") for p in parts):
        raise InvalidName(path)
    return parts


def _join(folder: str, name: str) -> str:
    return f"{folder}/{name}" if folder else name


def parent_of(name: str) -> str:
    return name.rsplit("/", 1)[0] if "/" in name else ""


class NotebookStore:
    def __init__(self, root: Path):
        self.root = Path(root).expanduser()
        self.root.mkdir(parents=True, exist_ok=True)
        self._resolved_root = self.root.resolve()

    # -- paths ---------------------------------------------------------------

    def _inside(self, path: Path) -> Path:
        resolved = path.resolve()
        if resolved != self._resolved_root and self._resolved_root not in resolved.parents:
            raise InvalidName(str(path))
        return resolved

    def _path(self, name: str) -> Path:
        parts = _split(name)
        if not parts:
            raise InvalidName(name)
        return self._inside(self.root.joinpath(*parts[:-1], f"{parts[-1]}{EXTENSION}"))

    def _dir(self, folder: str) -> Path:
        return self._inside(self.root.joinpath(*_split(folder)))

    def _unique(self, folder: str, title: str, suffix: str = EXTENSION) -> str:
        """A name for `title` in `folder` that isn't taken (adds " (2)", " (3)" …)."""
        base = slugify(title)
        directory = self._dir(folder)
        stem, n = base, 2
        while (directory / f"{stem}{suffix}").exists():
            stem = f"{base} ({n})"
            n += 1
        return stem

    def _trash(self, path: Path, label: str) -> None:
        trash = self.root / TRASH_DIR
        trash.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.move(str(path), trash / f"{label.replace('/', ' - ')} {stamp}{EXTENSION if path.is_file() else ''}")

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

    def _visible(self, path: Path) -> bool:
        return not any(p.startswith(".") for p in path.relative_to(self.root).parts)

    # -- notebooks -------------------------------------------------------------

    def list(self) -> list[dict]:
        """Every notebook in every folder; `folder` says where each one lives ("" = top level)."""
        items = []
        for path in self.root.rglob(f"*{EXTENSION}"):
            if not self._visible(path):
                continue
            rel = path.relative_to(self.root).as_posix()
            name = rel[: -len(EXTENSION)]
            try:
                data = self._read(path)
            except (OSError, json.JSONDecodeError):
                data = {}
            items.append(
                {
                    "name": name,
                    "folder": parent_of(name),
                    "title": data.get("title") or name.rsplit("/", 1)[-1],
                    "modified": data.get("modified")
                    or datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
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

    def create(self, notebook: dict, folder: str = "") -> str:
        directory = self._dir(folder)
        if not directory.is_dir():
            raise FolderNotFound(folder)
        name = _join(folder.strip("/"), self._unique(folder, notebook.get("title") or "Untitled"))
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
        """Change a notebook's title and its file name to match (same folder). Returns the new name."""
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        folder = parent_of(name)
        data = self._read(path)
        data["title"] = title
        data["modified"] = now_iso()
        stem = name.rsplit("/", 1)[-1]
        new_name = name if slugify(title) == stem else _join(folder, self._unique(folder, title))
        new_path = self._path(new_name)
        self._write_atomic(new_path, data)
        if new_path != path:
            path.unlink()
        return new_name

    def move(self, name: str, folder: str) -> str:
        """Move a notebook into another folder. Returns its new name."""
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        if not self._dir(folder).is_dir():
            raise FolderNotFound(folder)
        folder = folder.strip("/")
        if parent_of(name) == folder:
            return name
        stem = name.rsplit("/", 1)[-1]
        target = stem if not (self._dir(folder) / f"{stem}{EXTENSION}").exists() else self._unique(folder, stem)
        new_name = _join(folder, target)
        shutil.move(str(path), self._path(new_name))
        return new_name

    def delete(self, name: str) -> None:
        """Move a notebook to the trash folder so it can be recovered by hand."""
        path = self._path(name)
        if not path.exists():
            raise NotebookNotFound(name)
        self._trash(path, name)

    # -- folders -------------------------------------------------------------

    def folders(self) -> list[dict]:
        """Every folder (including empty ones), with how many notebooks and folders are directly inside."""
        result = []
        for path in sorted(self.root.rglob("*")):
            if not path.is_dir() or not self._visible(path):
                continue
            rel = path.relative_to(self.root).as_posix()
            try:
                _split(rel)
            except InvalidName:
                continue  # made outside the app with characters we don't use; leave it alone
            children = [c for c in path.iterdir() if not c.name.startswith(".")]
            result.append(
                {
                    "path": rel,
                    "name": path.name,
                    "parent": parent_of(rel),
                    "notebooks": sum(1 for c in children if c.is_file() and c.name.endswith(EXTENSION)),
                    "folders": sum(1 for c in children if c.is_dir()),
                }
            )
        return result

    def create_folder(self, parent: str, title: str) -> str:
        directory = self._dir(parent)
        if not directory.is_dir():
            raise FolderNotFound(parent)
        name = self._unique(parent, title, suffix="")
        path = _join(parent.strip("/"), name)
        self._dir(path).mkdir()
        return path

    def rename_folder(self, path: str, title: str) -> str:
        directory = self._dir(path)
        if not path.strip("/") or not directory.is_dir():
            raise FolderNotFound(path)
        parent = parent_of(path.strip("/"))
        if slugify(title) == directory.name:
            return path.strip("/")
        new_path = _join(parent, self._unique(parent, title, suffix=""))
        directory.rename(self._dir(new_path))
        return new_path

    def move_folder(self, path: str, parent: str) -> str:
        """Move a folder (and everything in it) into another folder. Returns its new path."""
        path = path.strip("/")
        parent = parent.strip("/")
        directory = self._dir(path)
        if not path or not directory.is_dir():
            raise FolderNotFound(path)
        if not self._dir(parent).is_dir():
            raise FolderNotFound(parent)
        if parent == path or parent.startswith(path + "/"):
            raise InvalidName("A folder can't go inside itself")
        if parent_of(path) == parent:
            return path
        new_path = _join(parent, self._unique(parent, directory.name, suffix=""))
        shutil.move(str(directory), self._dir(new_path))
        return new_path

    def delete_folder(self, path: str) -> None:
        """Move a folder and everything in it to the trash."""
        directory = self._dir(path)
        if not path.strip("/") or not directory.is_dir():
            raise FolderNotFound(path)
        self._trash(directory, path.strip("/"))

    # -- scratch -------------------------------------------------------------

    def get_scratch(self) -> dict | None:
        path = self.root / SCRATCH_FILE
        return self._read(path) if path.exists() else None

    def save_scratch(self, notebook: dict) -> None:
        notebook["modified"] = now_iso()
        self._write_atomic(self.root / SCRATCH_FILE, notebook)

    def clear_scratch(self) -> None:
        (self.root / SCRATCH_FILE).unlink(missing_ok=True)
