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


def test_scratch_roundtrip_and_hidden_from_list(client):
    c, _ = client
    assert c.get("/api/scratch").json() is None
    c.put("/api/scratch", json=make_nb("Scratch"))
    assert c.get("/api/scratch").json()["title"] == "Scratch"
    assert c.get("/api/notebooks").json() == []
    c.delete("/api/scratch")
    assert c.get("/api/scratch").json() is None
