"""FastAPI app: a small JSON API over the notebook folder, plus the built web UI."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .storage import AlreadyExists, FolderNotFound, InvalidName, NotebookNotFound, NotebookStore

DEFAULT_DIR = Path.home() / "MathJournal"
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


class Notebook(BaseModel):
    """Loose validation: the frontend owns the cell schema; we only require the basics."""

    model_config = {"extra": "allow"}

    title: str = "Untitled"
    cells: list[dict[str, Any]] = []


class RenameRequest(BaseModel):
    title: str


class MoveRequest(BaseModel):
    folder: str = ""


class NewFolderRequest(BaseModel):
    parent: str = ""
    title: str


class FolderRenameRequest(BaseModel):
    path: str
    title: str


class FolderMoveRequest(BaseModel):
    path: str
    parent: str = ""


class FolderRequest(BaseModel):
    path: str


def create_app(notebook_dir: Path | None = None) -> FastAPI:
    root = notebook_dir or Path(os.environ.get("MATHJOURNAL_DIR", DEFAULT_DIR))
    store = NotebookStore(root)
    app = FastAPI(title="Math Notebook")

    def lookup(fn, *args):
        try:
            return fn(*args)
        except NotebookNotFound:
            raise HTTPException(404, "Notebook not found")
        except FolderNotFound:
            raise HTTPException(404, "Folder not found")
        except InvalidName as e:
            raise HTTPException(400, f"Invalid name: {e}")
        except AlreadyExists:
            raise HTTPException(409, "Already exists")

    @app.get("/api/health")
    def health():
        return {"ok": True, "folder": str(store.root)}

    # Notebook names may include folders ("Algebra/Quadratics"), hence the {name:path} routes.

    @app.get("/api/notebooks")
    def list_notebooks():
        return store.list()

    @app.post("/api/notebooks", status_code=201)
    def create_notebook(nb: Notebook, folder: str = ""):
        return {"name": lookup(store.create, nb.model_dump(), folder)}

    @app.post("/api/notebooks/{name:path}/rename")
    def rename_notebook(name: str, req: RenameRequest):
        return {"name": lookup(store.rename, name, req.title.strip() or "Untitled")}

    @app.post("/api/notebooks/{name:path}/move")
    def move_notebook(name: str, req: MoveRequest):
        return {"name": lookup(store.move, name, req.folder)}

    @app.get("/api/notebooks/{name:path}")
    def get_notebook(name: str):
        return lookup(store.get, name)

    @app.put("/api/notebooks/{name:path}")
    def save_notebook(name: str, nb: Notebook):
        saved = lookup(store.save, name, nb.model_dump())
        return {"modified": saved["modified"]}

    @app.delete("/api/notebooks/{name:path}", status_code=204)
    def delete_notebook(name: str):
        lookup(store.delete, name)

    @app.get("/api/folders")
    def list_folders():
        return store.folders()

    @app.post("/api/folders", status_code=201)
    def create_folder(req: NewFolderRequest):
        return {"path": lookup(store.create_folder, req.parent, req.title.strip() or "New folder")}

    @app.post("/api/folders/rename")
    def rename_folder(req: FolderRenameRequest):
        return {"path": lookup(store.rename_folder, req.path, req.title.strip() or "Untitled")}

    @app.post("/api/folders/move")
    def move_folder(req: FolderMoveRequest):
        return {"path": lookup(store.move_folder, req.path, req.parent)}

    @app.post("/api/folders/delete", status_code=204)
    def delete_folder(req: FolderRequest):
        lookup(store.delete_folder, req.path)

    @app.get("/api/scratch")
    def get_scratch():
        return store.get_scratch()

    @app.put("/api/scratch")
    def save_scratch(nb: Notebook):
        store.save_scratch(nb.model_dump())
        return {"ok": True}

    @app.delete("/api/scratch", status_code=204)
    def clear_scratch():
        store.clear_scratch()

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="ui")

    return app


app = create_app()
