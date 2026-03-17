// results.js — floating results panel rendering and interaction
// Depends on: map.js (window.MapModule), search.js (window.AppState, window.showToast)
// Exposes: window.ResultsModule

(function () {
  "use strict";

  function cloudClass(cloud) {
    if (cloud == null) return "unknown";
    if (cloud < 0.1) return "low";
    if (cloud < 0.3) return "mid";
    return "high";
  }

  function cloudLabel(cloud) {
    if (cloud == null) return "☁ —";
    return "☁ " + Math.round(cloud * 100) + "%";
  }

  function gsdLabel(gsd) {
    if (gsd == null) return "—";
    return gsd + "m GSD";
  }

  function formatDate(isoStr) {
    if (!isoStr) return "—";
    return isoStr.slice(0, 16).replace("T", " ") + "Z";
  }

  // ── Render result cards ───────────────────────────────────────────────────
  function render(results) {
    var list = document.getElementById("results-list");
    var countEl = document.getElementById("results-count");

    // Clear previous
    list.innerHTML = "";

    if (!results || results.length === 0) {
      countEl.textContent = "0 results";
      list.innerHTML = '<div id="results-empty">No imagery found for this area and date range.</div>';
      return;
    }

    var sorted = sortResults(results, window.AppState.sortMode);
    countEl.textContent = sorted.length + " result" + (sorted.length !== 1 ? "s" : "");

    sorted.forEach(function (r, idx) {
      var card = document.createElement("div");
      var isSkysat = r.item_type === "SkySat-Collect";
      card.className = "result-card" + (isSkysat ? " skysat" : "");
      card.dataset.index = idx;

      var thumbEl;
      if (r.thumbnail_url) {
        thumbEl = '<img class="result-thumb" src="' + r.thumbnail_url + '" alt="thumbnail" onerror="this.style.display=\'none\'" />';
      } else {
        thumbEl = '<div class="result-thumb-placeholder">🛰</div>';
      }

      var cc = r.cloud_cover;
      card.innerHTML =
        thumbEl +
        '<div class="result-type">' + r.item_type + "</div>" +
        '<div class="result-date">' + formatDate(r.acquired) + "</div>" +
        '<div class="result-meta">' +
        '<span class="result-cloud ' + cloudClass(cc) + '">' + cloudLabel(cc) + "</span>" +
        '<span class="result-gsd">' + gsdLabel(r.gsd) + "</span>" +
        "</div>";

      card.addEventListener("click", function () {
        selectResult(idx, sorted);
      });

      list.appendChild(card);
    });
  }

  // ── Sort results client-side ──────────────────────────────────────────────
  var PRIORITY = ["SkySat-Collect", "PSScene", "Sentinel2L1C", "Landsat8L1T"];

  function sortResults(results, mode) {
    var copy = results.slice();
    if (mode === "priority") {
      copy.sort(function (a, b) {
        var pa = PRIORITY.indexOf(a.item_type);
        var pb = PRIORITY.indexOf(b.item_type);
        if (pa !== pb) return pa - pb;
        return (b.acquired || "") < (a.acquired || "") ? -1 : 1;
      });
    }
    // "recent" is already the default sort from server
    return copy;
  }

  // ── Select a result ───────────────────────────────────────────────────────
  function selectResult(idx, resultsOverride) {
    var results = resultsOverride || window.AppState.results;
    if (idx < 0 || idx >= results.length) return;

    window.AppState.currentIndex = idx;
    var r = results[idx];

    // Highlight selected card
    document.querySelectorAll(".result-card").forEach(function (c) {
      c.classList.toggle("selected", parseInt(c.dataset.index) === idx);
    });

    // tile_url is already in Leaflet {z}/{x}/{y} format — pass directly
    window.MapModule.setTileLayer(r.tile_url, window.AppState.currentOpacity);

    // Sync timeline
    if (window.TimelineModule) {
      window.TimelineModule.jumpToResult(r);
    }
  }

  // ── Tile error callback ───────────────────────────────────────────────────
  function onTileError() {
    var selected = document.querySelector(".result-card.selected");
    if (selected) {
      var existing = selected.querySelector(".result-tile-error");
      if (!existing) {
        var err = document.createElement("div");
        err.className = "result-tile-error";
        err.textContent = "⚠ Tiles unavailable";
        selected.appendChild(err);
      }
    }
  }

  // ── Sort toggle ───────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("sort-toggle");
    btn.addEventListener("click", function () {
      if (window.AppState.sortMode === "recent") {
        window.AppState.sortMode = "priority";
        btn.textContent = "priority ▾";
      } else {
        window.AppState.sortMode = "recent";
        btn.textContent = "recent ▾";
      }
      render(window.AppState.results);
    });
  });

  // ── Export ────────────────────────────────────────────────────────────────
  window.ResultsModule = {
    render: render,
    selectResult: selectResult,
    onTileError: onTileError,
  };
})();
