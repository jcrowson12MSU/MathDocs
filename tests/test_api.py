import json

import pytest
from fastapi.testclient import TestClient

from server.app import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path)), tmp_path


def make_nb(title="Quadratics"):
    return {"title": title, "cells": [{"id": "c1", "type": "math", "latex": "x^2-5x+6=0"}], "graphs": []}


def test_create_list_get_save(client):
    c, root = client
    r = c.post("/api/notebooks", json=make_nb())
    assert r.status_code == 201
    name = r.json()["name"]
    assert name == "Quadratics"

    listing = c.get("/api/notebooks").json()
    assert [n["name"] for n in listing] == ["Quadratics"]
    assert listing[0]["cellCount"] == 1

    nb = c.get(f"/api/notebooks/{name}").json()
    nb["cells"].append({"id": "c2", "type": "math", "latex": "(x-2)(x-3)=0"})
    assert c.put(f"/api/notebooks/{name}", json=nb).status_code == 200

    # File on disk is readable, pretty-printed JSON with extra fields preserved.
    text = (root / "Quadratics.mathnb.json").read_text()
    assert "\n  " in text
    data = json.loads(text)
    assert data["cells"][1]["latex"] == "(x-2)(x-3)=0"
    assert data["graphs"] == []


def test_duplicate_titles_get_unique_names(client):
    c, _ = client
    a = c.post("/api/notebooks", json=make_nb("HW")).json()["name"]
    b = c.post("/api/notebooks", json=make_nb("HW")).json()["name"]
    assert a == "HW" and b == "HW (2)"


def test_rename_moves_file(client):
    c, root = client
    name = c.post("/api/notebooks", json=make_nb("Old")).json()["name"]
    new = c.post(f"/api/notebooks/{name}/rename", json={"title": "New Title"}).json()["name"]
    assert new == "New Title"
    assert not (root / "Old.mathnb.json").exists()
    assert c.get(f"/api/notebooks/{new}").json()["title"] == "New Title"


def test_delete_moves_to_trash(client):
    c, root = client
    name = c.post("/api/notebooks", json=make_nb()).json()["name"]
    assert c.delete(f"/api/notebooks/{name}").status_code == 204
    assert c.get("/api/notebooks").json() == []
    assert len(list((root / ".trash").iterdir())) == 1


@pytest.mark.parametrize("bad", ["..%2Fetc", ".hidden", "a%2Fb", "bad.", "x" * 200])
def test_rejects_unsafe_names(client, bad):
    c, _ = client
    assert c.get(f"/api/notebooks/{bad}").status_code in (400, 404)


def test_missing_notebook_404(client):
    c, _ = client
    assert c.get("/api/notebooks/Nope").status_code == 404
    assert c.put("/api/notebooks/Nope", json=make_nb()).status_code == 404


def test_folders_and_nested_notebooks(client):
    c, root = client
    algebra = c.post("/api/folders", json={"title": "Algebra"}).json()["path"]
    unit = c.post("/api/folders", json={"parent": algebra, "title": "Unit 2"}).json()["path"]
    assert (algebra, unit) == ("Algebra", "Algebra/Unit 2")

    name = c.post("/api/notebooks", params={"folder": unit}, json=make_nb()).json()["name"]
    assert name == "Algebra/Unit 2/Quadratics"
    assert (root / "Algebra" / "Unit 2" / "Quadratics.mathnb.json").exists()

    # The full path works in every notebook route.
    assert c.get(f"/api/notebooks/{name}").json()["title"] == "Quadratics"
    nb = c.get(f"/api/notebooks/{name}").json()
    assert c.put(f"/api/notebooks/{name}", json=nb).status_code == 200
    renamed = c.post(f"/api/notebooks/{name}/rename", json={"title": "Quadratics HW"}).json()["name"]
    assert renamed == "Algebra/Unit 2/Quadratics HW"

    listing = c.get("/api/notebooks").json()
    assert [(n["name"], n["folder"]) for n in listing] == [(renamed, "Algebra/Unit 2")]
    folders = {f["path"]: f for f in c.get("/api/folders").json()}
    assert folders["Algebra"]["folders"] == 1 and folders["Algebra"]["notebooks"] == 0
    assert folders["Algebra/Unit 2"]["notebooks"] == 1


def test_move_notebooks_and_folders(client):
    c, root = client
    c.post("/api/folders", json={"title": "Algebra"})
    c.post("/api/folders", json={"title": "Geometry"})
    name = c.post("/api/notebooks", json=make_nb("Lines")).json()["name"]

    moved = c.post(f"/api/notebooks/{name}/move", json={"folder": "Algebra"}).json()["name"]
    assert moved == "Algebra/Lines"
    # Moving onto a name that's taken gets a unique name instead of overwriting.
    c.post("/api/notebooks", params={"folder": "Geometry"}, json=make_nb("Lines"))
    again = c.post(f"/api/notebooks/{moved}/move", json={"folder": "Geometry"}).json()["name"]
    assert again == "Geometry/Lines (2)"
    back = c.post(f"/api/notebooks/{again}/move", json={"folder": ""}).json()["name"]
    assert back == "Lines (2)"

    sub = c.post("/api/folders/move", json={"path": "Geometry", "parent": "Algebra"}).json()["path"]
    assert sub == "Algebra/Geometry"
    assert (root / "Algebra" / "Geometry" / "Lines.mathnb.json").exists()
    assert c.post("/api/folders/move", json={"path": "Algebra", "parent": "Algebra/Geometry"}).status_code == 400

    renamed = c.post("/api/folders/rename", json={"path": "Algebra", "title": "Algebra 1"}).json()["path"]
    assert renamed == "Algebra 1"
    assert c.get("/api/notebooks/Algebra 1/Geometry/Lines").status_code == 200


def test_delete_folder_moves_it_to_trash(client):
    c, root = client
    c.post("/api/folders", json={"title": "Old"})
    c.post("/api/notebooks", params={"folder": "Old"}, json=make_nb())
    assert c.post("/api/folders/delete", json={"path": "Old"}).status_code == 204
    assert not (root / "Old").exists()
    assert c.get("/api/notebooks").json() == []
    trashed = list((root / ".trash").iterdir())
    assert len(trashed) == 1 and (trashed[0] / "Quadratics.mathnb.json").exists()
    # The top level itself can't be deleted, and the trash never shows up as a folder.
    assert c.post("/api/folders/delete", json={"path": ""}).status_code == 404
    assert c.get("/api/folders").json() == []


@pytest.mark.parametrize("bad", ["../escape", "a/../../b", ".hidden/x", "a//b"])
def test_rejects_unsafe_folder_paths(client, bad):
    c, _ = client
    assert c.post("/api/folders", json={"parent": bad, "title": "x"}).status_code in (400, 404)
    assert c.post("/api/notebooks", params={"folder": bad}, json=make_nb()).status_code in (400, 404)


def test_scratch_roundtrip_and_hidden_from_list(client):
    c, _ = client
    assert c.get("/api/scratch").json() is None
    c.put("/api/scratch", json=make_nb("Scratch"))
    assert c.get("/api/scratch").json()["title"] == "Scratch"
    assert c.get("/api/notebooks").json() == []
    c.delete("/api/scratch")
    assert c.get("/api/scratch").json() is None
