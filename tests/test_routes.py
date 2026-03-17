import json
import os
import pytest
from unittest.mock import patch

os.environ.setdefault("PLANET_API_KEY", "test-key")

with patch("planet_client.get_available_item_types", return_value=["SkySat-Collect", "PSScene", "Sentinel2L1C", "Landsat8L1T"]):
    import app as flask_app


@pytest.fixture
def client():
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c


def test_index_returns_200(client):
    resp = client.get("/")
    assert resp.status_code == 200


def test_search_calls_planet_client_and_returns_results(client):
    fake_results = [
        {
            "id": "abc",
            "item_type": "SkySat-Collect",
            "acquired": "2024-11-03T09:00:00Z",
            "cloud_cover": 0.01,
            "gsd": 0.5,
            "thumbnail_url": "/api/thumbnail/SkySat-Collect/abc",
            "tile_url": "/api/tiles/SkySat-Collect/abc/{z}/{x}/{y}.png",
        }
    ]
    payload = {
        "geometry": {"type": "Point", "coordinates": [0, 0]},
        "item_types": ["SkySat-Collect"],
        "date_from": "2024-01-01T00:00:00Z",
        "date_to": "2024-12-31T23:59:59Z",
        "cloud_max": 0.20,
    }
    with patch("planet_client.search_all", return_value=fake_results):
        with patch("app.get_available_item_types", return_value=["SkySat-Collect"]):
            resp = client.post(
                "/api/search",
                data=json.dumps(payload),
                content_type="application/json",
            )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["count"] == 1
    assert data["results"][0]["id"] == "abc"


def test_search_returns_500_on_planet_error(client):
    payload = {
        "geometry": {"type": "Point", "coordinates": [0, 0]},
        "item_types": ["SkySat-Collect"],
        "date_from": "2024-01-01T00:00:00Z",
        "date_to": "2024-12-31T23:59:59Z",
        "cloud_max": 0.20,
    }
    with patch("planet_client.search_all", side_effect=Exception("API down")):
        with patch("app.get_available_item_types", return_value=["SkySat-Collect"]):
            resp = client.post(
                "/api/search",
                data=json.dumps(payload),
                content_type="application/json",
            )
    assert resp.status_code == 500
    assert "error" in resp.get_json()


def test_thumbnail_proxies_bytes(client):
    fake_bytes = b"\x89PNG\r\n"
    with patch(
        "planet_client.get_thumbnail", return_value=(fake_bytes, "image/png")
    ):
        resp = client.get("/api/thumbnail/SkySat-Collect/abc123")
    assert resp.status_code == 200
    assert resp.data == fake_bytes
    assert resp.content_type == "image/png"


def test_thumbnail_returns_500_on_error(client):
    with patch("planet_client.get_thumbnail", side_effect=Exception("not found")):
        resp = client.get("/api/thumbnail/SkySat-Collect/bad_id")
    assert resp.status_code == 500


def test_tile_proxies_bytes(client):
    fake_bytes = b"PNG_TILE_DATA"
    with patch(
        "planet_client.get_tile", return_value=(fake_bytes, "image/png")
    ):
        resp = client.get("/api/tiles/SkySat-Collect/abc123/10/512/512.png")
    assert resp.status_code == 200
    assert resp.data == fake_bytes


def test_tile_returns_404_on_error(client):
    with patch("planet_client.get_tile", side_effect=Exception("tile not found")):
        resp = client.get("/api/tiles/SkySat-Collect/bad/10/0/0.png")
    assert resp.status_code == 404


def test_search_returns_400_with_aoi_too_large_message(client):
    import requests as req_lib
    payload = {
        "geometry": {"type": "Point", "coordinates": [0, 0]},
        "item_types": ["SkySat-Collect"],
        "date_from": "2024-01-01T00:00:00Z",
        "date_to": "2024-12-31T23:59:59Z",
        "cloud_max": 0.20,
    }
    http_err = req_lib.HTTPError(response=type("R", (), {"status_code": 400})())
    with patch("planet_client.search_all", side_effect=http_err):
        with patch("app.get_available_item_types", return_value=["SkySat-Collect"]):
            resp = client.post(
                "/api/search",
                data=json.dumps(payload),
                content_type="application/json",
            )
    assert resp.status_code == 400
    assert "too large" in resp.get_json()["error"]
