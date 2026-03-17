// search.js — top bar controls, app state, search dispatch
// Depends on: map.js (sets window.MapModule before this script runs)
// Exposes: window.AppState, window.showToast

(function () {
  "use strict";

  // ── Shared app state ──────────────────────────────────────────────────────
  window.AppState = {
    geometry: null,
    results: [],
    currentIndex: -1,
    sortMode: "recent", // "recent" | "priority"
    playInterval: null,
    speed: 1,
    currentOpacity: 0.8,
  };

  // ── Toast ─────────────────────────────────────────────────────────────────
  var toastTimer = null;
  window.showToast = function (msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3500);
  };

  // ── Source selector ───────────────────────────────────────────────────────
  function initSourceSelector() {
    var toggle = document.getElementById("source-toggle");
    var popover = document.getElementById("source-popover");
    var label = document.getElementById("source-label");

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      popover.classList.toggle("open");
    });

    document.addEventListener("click", function () {
      popover.classList.remove("open");
    });

    popover.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    function updateLabel() {
      var checked = getSelectedSources();
      if (checked.length === 4) {
        label.textContent = "All sources";
      } else if (checked.length === 0) {
        label.textContent = "None";
      } else {
        label.textContent = checked.length + " source" + (checked.length > 1 ? "s" : "");
      }
    }

    popover.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", updateLabel);
    });
  }

  function getSelectedSources() {
    var sources = [];
    document.querySelectorAll("#source-popover input[type=checkbox]").forEach(function (cb) {
      if (cb.checked) sources.push(cb.value);
    });
    return sources;
  }

  // ── Date range defaults ───────────────────────────────────────────────────
  function initDateRange() {
    var now = new Date();
    var oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    function fmt(d) {
      return d.toISOString().slice(0, 10);
    }

    flatpickr("#date-from", {
      defaultDate: fmt(oneYearAgo),
      dateFormat: "Y-m-d",
    });

    flatpickr("#date-to", {
      defaultDate: fmt(now),
      dateFormat: "Y-m-d",
    });
  }

  // ── Cloud cover slider ────────────────────────────────────────────────────
  function initCloudSlider() {
    var slider = document.getElementById("cloud-slider");
    var label = document.getElementById("cloud-value");
    slider.addEventListener("input", function () {
      label.textContent = slider.value + "%";
    });
  }

  // ── Opacity slider ────────────────────────────────────────────────────────
  function initOpacitySlider() {
    var slider = document.getElementById("opacity-slider");
    var label = document.getElementById("opacity-value");
    slider.addEventListener("input", function () {
      var val = parseInt(slider.value) / 100;
      label.textContent = slider.value + "%";
      window.AppState.currentOpacity = val;
      window.MapModule.setOpacity(val);
    });
  }

  // ── Geometry callback from map ────────────────────────────────────────────
  window.MapModule.onGeometryReady = function (geometry) {
    window.AppState.geometry = geometry;
  };

  // ── Search ────────────────────────────────────────────────────────────────
  function doSearch() {
    if (!window.AppState.geometry) {
      window.showToast("Draw an area on the map first.");
      return;
    }

    var sources = getSelectedSources();
    if (sources.length === 0) {
      window.showToast("Select at least one image source.");
      return;
    }

    var dateFrom = document.getElementById("date-from").value;
    var dateTo = document.getElementById("date-to").value;
    if (!dateFrom || !dateTo) {
      window.showToast("Set a date range.");
      return;
    }

    var cloudMax = parseInt(document.getElementById("cloud-slider").value) / 100;

    var btn = document.getElementById("search-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Searching…";

    var payload = {
      geometry: window.AppState.geometry,
      item_types: sources,
      date_from: dateFrom + "T00:00:00Z",
      date_to: dateTo + "T23:59:59Z",
      cloud_max: cloudMax,
    };

    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) {
            throw new Error(data.error || "Server error " + resp.status);
          }
          return data;
        });
      })
      .then(function (data) {
        btn.disabled = false;
        btn.textContent = "🔍 Search";

        window.AppState.results = data.results || [];
        window.AppState.currentIndex = -1;

        if (window.ResultsModule) window.ResultsModule.render(window.AppState.results);
        if (window.TimelineModule) window.TimelineModule.init(window.AppState.results);

        if (window.AppState.results.length === 0) {
          window.showToast("No imagery found. Try widening the date range or increasing cloud cover limit.");
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "🔍 Search";
        window.showToast("Network error: " + err.message);
      });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    initSourceSelector();
    initDateRange();
    initCloudSlider();
    initOpacitySlider();
    document.getElementById("search-btn").addEventListener("click", doSearch);
  });
})();
