import os

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

import planet_client

load_dotenv()

app = Flask(__name__)

# Verify available item types at startup and log them
_available_item_types = None

def get_available_item_types():
    global _available_item_types
    if _available_item_types is None:
        try:
            _available_item_types = planet_client.get_available_item_types()
            print(f"Available item types: {_available_item_types}")
        except Exception as e:
            print(f"Warning: could not fetch item types at startup: {e}")
            _available_item_types = planet_client.ITEM_TYPE_PRIORITY
    return _available_item_types


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search", methods=["POST"])
def search():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400
    # Filter requested types to only those available in this account
    available = get_available_item_types()
    requested = data.get("item_types", [])
    item_types = [t for t in requested if t in available]
    if not item_types:
        return jsonify({"error": "None of the requested item types are available for this account."}), 400
    try:
        results = planet_client.search_all(
            geometry=data["geometry"],
            item_types=item_types,
            date_from=data["date_from"],
            date_to=data["date_to"],
            cloud_max=data["cloud_max"],
        )
        return jsonify({"results": results, "count": len(results)})
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 400:
            return jsonify({"error": "Area of interest is too large. Please draw a smaller region."}), 400
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/thumbnail/<item_type>/<item_id>")
def thumbnail(item_type, item_id):
    try:
        data, content_type = planet_client.get_thumbnail(item_type, item_id)
        return Response(data, content_type=content_type)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/tiles/<item_type>/<item_id>/<int:z>/<int:x>/<int:y>.png")
def tile(item_type, item_id, z, x, y):
    try:
        data, content_type = planet_client.get_tile(item_type, item_id, z, x, y)
        return Response(data, content_type=content_type)
    except Exception:
        return Response(status=404)


# Warm the item-type cache at startup and log available types
with app.app_context():
    get_available_item_types()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
