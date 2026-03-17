// map.js — Leaflet map initialisation, draw controls, tile overlay management
// Depends on: Leaflet 1.9.4, Leaflet.draw 1.0.4 (loaded via CDN before this script)
// Exposes: window.MapModule

(function () {
  "use strict";

  // ── Haversine circle → polygon ────────────────────────────────────────────
  function circleToPolygon(lat, lng, radiusMeters, numPoints) {
    numPoints = numPoints || 64;
    var coords = [];
    var d = radiusMeters / 6371000; // angular distance in radians
    var lat1 = (lat * Math.PI) / 180;
    var lng1 = (lng * Math.PI) / 180;
    for (var i = 0; i < numPoints; i++) {
      var angle = (2 * Math.PI * i) / numPoints;
      var lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
          Math.cos(lat1) * Math.sin(d) * Math.cos(angle)
      );
      var lng2 =
        lng1 +
        Math.atan2(
          Math.sin(angle) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
        );
      coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    coords.push(coords[0]); // close ring
    return { type: "Polygon", coordinates: [coords] };
  }

  // ── Module state ──────────────────────────────────────────────────────────
  var map = null;
  var drawnLayer = null;
  var tileLayer = null;
  var drawHandler = null;
  var currentMode = "polygon";

  // ── Initialise map ────────────────────────────────────────────────────────
  function init() {
    map = L.map("map", { zoomControl: false }).setView([20, 0], 3);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "topleft" }).addTo(map);

    // Wire draw-mode buttons
    document.querySelectorAll(".draw-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.dataset.mode;
        if (mode === "clear") {
          clearDraw();
        } else {
          setDrawMode(mode);
        }
      });
    });
  }

  // ── Draw mode ─────────────────────────────────────────────────────────────
  function setDrawMode(mode) {
    currentMode = mode;

    // Update active button
    document.querySelectorAll(".draw-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.mode === mode);
    });

    // Cancel existing handler
    if (drawHandler) {
      drawHandler.disable();
      drawHandler = null;
    }

    if (mode === "polygon") {
      drawHandler = new L.Draw.Polygon(map, {});
    } else if (mode === "rectangle") {
      drawHandler = new L.Draw.Rectangle(map, {});
    } else if (mode === "circle") {
      drawHandler = new L.Draw.Circle(map, {});
    } else if (mode === "marker") {
      drawHandler = new L.Draw.Marker(map, {});
    }

    if (drawHandler) drawHandler.enable();
  }

  // ── Clear AOI ─────────────────────────────────────────────────────────────
  function clearDraw() {
    if (drawnLayer) {
      map.removeLayer(drawnLayer);
      drawnLayer = null;
    }
    if (drawHandler) {
      drawHandler.disable();
      drawHandler = null;
    }
    // Re-enable the current mode
    if (currentMode !== "clear") setDrawMode(currentMode);
    if (window.MapModule.onGeometryReady) {
      window.MapModule.onGeometryReady(null);
    }
  }

  // ── Draw complete event ───────────────────────────────────────────────────
  function _attachDrawEvents() {
    map.on(L.Draw.Event.CREATED, function (e) {
      // Remove previous AOI
      if (drawnLayer) map.removeLayer(drawnLayer);
      drawnLayer = e.layer;
      map.addLayer(drawnLayer);

      var geometry = null;
      var type = e.layerType;

      if (type === "polygon" || type === "rectangle") {
        geometry = drawnLayer.toGeoJSON().geometry;
      } else if (type === "circle") {
        var center = drawnLayer.getLatLng();
        var radius = drawnLayer.getRadius();
        geometry = circleToPolygon(center.lat, center.lng, radius, 64);
      } else if (type === "marker") {
        var latlng = drawnLayer.getLatLng();
        var radiusStr = window.prompt(
          "Enter search radius in meters (e.g. 1000):", "1000"
        );
        var radiusM = parseFloat(radiusStr);
        if (!radiusM || radiusM <= 0) radiusM = 1000;
        geometry = circleToPolygon(latlng.lat, latlng.lng, radiusM, 64);
      }

      // Disable handler after draw
      if (drawHandler) {
        drawHandler.disable();
        drawHandler = null;
      }
      // Deactivate all draw buttons
      document.querySelectorAll(".draw-btn").forEach(function (b) {
        b.classList.remove("active");
      });

      if (window.MapModule.onGeometryReady) {
        window.MapModule.onGeometryReady(geometry);
      }
    });
  }

  // ── Tile overlay ──────────────────────────────────────────────────────────
  function setTileLayer(tileUrl, opacity) {
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    if (!tileUrl) return;
    tileLayer = L.tileLayer(tileUrl, {
      opacity: opacity != null ? opacity : 0.8,
      maxZoom: 22,
      tileSize: 256,
    });
    tileLayer.addTo(map);
    tileLayer.on("tileerror", function () {
      if (window.ResultsModule && window.ResultsModule.onTileError) {
        window.ResultsModule.onTileError();
      }
    });
  }

  function setOpacity(value) {
    if (tileLayer) tileLayer.setOpacity(value);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  window.MapModule = {
    init: init,
    setDrawMode: setDrawMode,
    clearDraw: clearDraw,
    setTileLayer: setTileLayer,
    setOpacity: setOpacity,
    onGeometryReady: null, // set by search.js
    _attachDrawEvents: _attachDrawEvents,
  };

  // Initialise on DOMContentLoaded
  document.addEventListener("DOMContentLoaded", function () {
    init();
    _attachDrawEvents();
    // Default draw mode
    setDrawMode("polygon");
  });
})();
