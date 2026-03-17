import logging
import os
from datetime import datetime

import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "https://api.planet.com/data/v1"
ITEM_TYPE_PRIORITY = ["SkySat-Collect", "PSScene", "Sentinel2L1C", "Landsat8L1T"]
CLOUD_COVER_TYPES = {"PSScene", "Sentinel2L1C"}


def _auth():
    return HTTPBasicAuth(os.environ["PLANET_API_KEY"], "")


def get_available_item_types():
    """Return item types from ITEM_TYPE_PRIORITY that exist in this account."""
    resp = requests.get(f"{BASE_URL}/item-types", auth=_auth())
    resp.raise_for_status()
    available = {t["id"] for t in resp.json().get("item_types", [])}
    return [t for t in ITEM_TYPE_PRIORITY if t in available]


def build_filter(geometry, date_from, date_to, cloud_max, item_type):
    """Build a Planet AndFilter for a single item type search."""
    filters = [
        {
            "type": "GeometryFilter",
            "field_name": "geometry",
            "config": geometry,
        },
        {
            "type": "DateRangeFilter",
            "field_name": "acquired",
            "config": {"gte": date_from, "lte": date_to},
        },
    ]
    if item_type in CLOUD_COVER_TYPES:
        filters.append(
            {
                "type": "RangeFilter",
                "field_name": "cloud_cover",
                "config": {"lte": cloud_max},
            }
        )
    return {"type": "AndFilter", "config": filters}


def sort_results(results):
    """Sort by: item type priority → acquired desc → gsd asc."""
    priority = {t: i for i, t in enumerate(ITEM_TYPE_PRIORITY)}

    def sort_key(r):
        acquired = r.get("acquired") or ""
        try:
            ts = datetime.fromisoformat(acquired.replace("Z", "+00:00")).timestamp()
        except (ValueError, AttributeError):
            ts = 0.0
        return (
            priority.get(r.get("item_type"), 99),
            -ts,
            r.get("gsd") or 9999,
        )

    return sorted(results, key=sort_key)


def _search_item_type(item_type, geometry, date_from, date_to, cloud_max):
    """Search one item type. Returns list of raw feature dicts."""
    payload = {
        "item_types": [item_type],
        "filter": build_filter(geometry, date_from, date_to, cloud_max, item_type),
    }
    resp = requests.post(
        f"{BASE_URL}/quick-search",
        json=payload,
        auth=_auth(),
        params={"_page_size": 250},
    )
    resp.raise_for_status()
    return resp.json().get("features", [])


def search_all(geometry, item_types, date_from, date_to, cloud_max):
    """Search all requested item types and return merged, sorted results."""
    all_results = []
    for item_type in item_types:
        try:
            features = _search_item_type(
                item_type, geometry, date_from, date_to, cloud_max
            )
            for f in features:
                props = f.get("properties", {})
                all_results.append(
                    {
                        "id": f["id"],
                        "item_type": item_type,
                        "acquired": props.get("acquired", ""),
                        "cloud_cover": props.get("cloud_cover"),
                        "gsd": props.get("gsd"),
                        "thumbnail_url": f"/api/thumbnail/{item_type}/{f['id']}",
                        "tile_url": f"/api/tiles/{item_type}/{f['id']}/{{z}}/{{x}}/{{y}}.png",
                    }
                )
        except Exception as e:
            logging.warning("search failed for %s: %s", item_type, e)
    return sort_results(all_results)


def get_thumbnail(item_type, item_id):
    """Fetch thumbnail bytes. Returns (bytes, content_type)."""
    url = f"{BASE_URL}/item-types/{item_type}/items/{item_id}/thumb"
    resp = requests.get(url, auth=_auth())
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "image/jpeg")


def get_tile(item_type, item_id, z, x, y):
    """Fetch XYZ map tile. Returns (bytes, content_type). API key injected server-side."""
    api_key = os.environ["PLANET_API_KEY"]
    url = (
        f"https://tiles.planet.com/data/v1"
        f"/{item_type}/{item_id}/{z}/{x}/{y}.png"
    )
    resp = requests.get(url, params={"api_key": api_key})
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "image/png")
