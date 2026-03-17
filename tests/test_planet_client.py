import os
import pytest
import responses as resp_mock
import requests

os.environ.setdefault("PLANET_API_KEY", "test-key")

import planet_client


# --- build_filter ---

def test_build_filter_includes_cloud_cover_for_psscene():
    f = planet_client.build_filter(
        geometry={"type": "Point", "coordinates": [0, 0]},
        date_from="2024-01-01T00:00:00Z",
        date_to="2024-12-31T23:59:59Z",
        cloud_max=0.20,
        item_type="PSScene",
    )
    assert f["type"] == "AndFilter"
    field_names = [c["field_name"] for c in f["config"]]
    assert "cloud_cover" in field_names


def test_build_filter_excludes_cloud_cover_for_skysat():
    f = planet_client.build_filter(
        geometry={"type": "Point", "coordinates": [0, 0]},
        date_from="2024-01-01T00:00:00Z",
        date_to="2024-12-31T23:59:59Z",
        cloud_max=0.20,
        item_type="SkySat-Collect",
    )
    field_names = [c["field_name"] for c in f["config"]]
    assert "cloud_cover" not in field_names


def test_build_filter_excludes_cloud_cover_for_landsat():
    f = planet_client.build_filter(
        geometry={"type": "Point", "coordinates": [0, 0]},
        date_from="2024-01-01T00:00:00Z",
        date_to="2024-12-31T23:59:59Z",
        cloud_max=0.20,
        item_type="Landsat8L1T",
    )
    field_names = [c["field_name"] for c in f["config"]]
    assert "cloud_cover" not in field_names


def test_build_filter_always_includes_geometry_and_date():
    f = planet_client.build_filter(
        geometry={"type": "Point", "coordinates": [10, 20]},
        date_from="2024-06-01T00:00:00Z",
        date_to="2024-06-30T23:59:59Z",
        cloud_max=0.50,
        item_type="PSScene",
    )
    field_names = [c["field_name"] for c in f["config"]]
    assert "geometry" in field_names
    assert "acquired" in field_names


# --- sort_results ---

def test_sort_results_skysat_before_psscene():
    results = [
        {"item_type": "PSScene", "acquired": "2024-11-03T09:00:00Z", "gsd": 3.0},
        {"item_type": "SkySat-Collect", "acquired": "2024-11-01T09:00:00Z", "gsd": 0.5},
    ]
    sorted_r = planet_client.sort_results(results)
    assert sorted_r[0]["item_type"] == "SkySat-Collect"


def test_sort_results_most_recent_first_within_type():
    results = [
        {"item_type": "PSScene", "acquired": "2024-10-01T00:00:00Z", "gsd": 3.0},
        {"item_type": "PSScene", "acquired": "2024-11-15T00:00:00Z", "gsd": 3.0},
        {"item_type": "PSScene", "acquired": "2024-11-01T00:00:00Z", "gsd": 3.0},
    ]
    sorted_r = planet_client.sort_results(results)
    assert sorted_r[0]["acquired"] == "2024-11-15T00:00:00Z"
    assert sorted_r[1]["acquired"] == "2024-11-01T00:00:00Z"
    assert sorted_r[2]["acquired"] == "2024-10-01T00:00:00Z"


def test_sort_results_lower_gsd_first_within_same_type_and_date():
    results = [
        {"item_type": "PSScene", "acquired": "2024-11-01T00:00:00Z", "gsd": 5.0},
        {"item_type": "PSScene", "acquired": "2024-11-01T00:00:00Z", "gsd": 3.0},
    ]
    sorted_r = planet_client.sort_results(results)
    assert sorted_r[0]["gsd"] == 3.0


# --- search_all (mocked HTTP) ---

@resp_mock.activate
def test_search_all_returns_formatted_results():
    resp_mock.add(
        resp_mock.POST,
        "https://api.planet.com/data/v1/quick-search",
        json={
            "features": [
                {
                    "id": "abc123",
                    "properties": {
                        "acquired": "2024-11-03T09:42:00Z",
                        "cloud_cover": 0.02,
                        "gsd": 0.5,
                    },
                }
            ]
        },
        status=200,
    )
    results = planet_client.search_all(
        geometry={"type": "Point", "coordinates": [0, 0]},
        item_types=["SkySat-Collect"],
        date_from="2024-01-01T00:00:00Z",
        date_to="2024-12-31T23:59:59Z",
        cloud_max=0.20,
    )
    assert len(results) == 1
    r = results[0]
    assert r["id"] == "abc123"
    assert r["item_type"] == "SkySat-Collect"
    assert r["acquired"] == "2024-11-03T09:42:00Z"
    assert r["thumbnail_url"] == "/api/thumbnail/SkySat-Collect/abc123"
    assert r["tile_url"] == "/api/tiles/SkySat-Collect/abc123/{z}/{x}/{y}.png"


@resp_mock.activate
def test_search_all_skips_failed_item_type_gracefully():
    resp_mock.add(
        resp_mock.POST,
        "https://api.planet.com/data/v1/quick-search",
        json={"message": "Unauthorized"},
        status=401,
    )
    # Should not raise — returns empty list
    results = planet_client.search_all(
        geometry={"type": "Point", "coordinates": [0, 0]},
        item_types=["SkySat-Collect"],
        date_from="2024-01-01T00:00:00Z",
        date_to="2024-12-31T23:59:59Z",
        cloud_max=0.20,
    )
    assert results == []


# --- get_thumbnail ---

@resp_mock.activate
def test_get_thumbnail_returns_bytes_and_content_type():
    resp_mock.add(
        resp_mock.GET,
        "https://api.planet.com/data/v1/item-types/SkySat-Collect/items/abc123/thumb",
        body=b"\x89PNG\r\n",
        status=200,
        headers={"Content-Type": "image/png"},
    )
    data, ct = planet_client.get_thumbnail("SkySat-Collect", "abc123")
    assert data == b"\x89PNG\r\n"
    assert ct == "image/png"


# --- get_tile ---

@resp_mock.activate
def test_get_tile_returns_bytes_and_content_type():
    resp_mock.add(
        resp_mock.GET,
        "https://tiles.planet.com/data/v1/SkySat-Collect/abc123/10/512/512.png",
        body=b"TILE_DATA",
        status=200,
        headers={"Content-Type": "image/png"},
    )
    data, ct = planet_client.get_tile("SkySat-Collect", "abc123", 10, 512, 512)
    assert data == b"TILE_DATA"
    assert ct == "image/png"
