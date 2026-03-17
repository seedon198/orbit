// timeline.js — timeline slider, dot markers, play/pause, calendar picker
// Depends on: search.js (window.AppState), results.js (window.ResultsModule)
// Exposes: window.TimelineModule

(function () {
  "use strict";

  var dates = [];       // sorted unique date strings (YYYY-MM-DD)
  var dateIndex = {};   // date string → array of result indices
  var currentDateIdx = -1;
  var isPlaying = false;
  var playTimer = null;
  var speed = 1;
  var calendarPicker = null;
  var BASE_INTERVAL_MS = 1500;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function isoToDate(isoStr) {
    return isoStr ? isoStr.slice(0, 10) : null;
  }

  function hasSkysat(date) {
    var idxs = dateIndex[date] || [];
    return idxs.some(function (i) {
      return window.AppState.results[i].item_type === "SkySat-Collect";
    });
  }

  function bestResultForDate(date) {
    // Return the index of the best result for a date (SkySat preferred, then lowest cloud)
    var idxs = dateIndex[date] || [];
    if (idxs.length === 0) return -1;
    var PRIORITY = ["SkySat-Collect", "PSScene", "Sentinel2L1C", "Landsat8L1T"];
    idxs = idxs.slice().sort(function (a, b) {
      var ra = window.AppState.results[a];
      var rb = window.AppState.results[b];
      var pa = PRIORITY.indexOf(ra.item_type);
      var pb = PRIORITY.indexOf(rb.item_type);
      if (pa !== pb) return pa - pb;
      var ca = ra.cloud_cover != null ? ra.cloud_cover : 1;
      var cb = rb.cloud_cover != null ? rb.cloud_cover : 1;
      return ca - cb;
    });
    return idxs[0];
  }

  // ── Init timeline from results ────────────────────────────────────────────
  function init(results) {
    stopPlay();
    dates = [];
    dateIndex = {};
    currentDateIdx = -1;

    results.forEach(function (r, i) {
      var d = isoToDate(r.acquired);
      if (!d) return;
      if (!dateIndex[d]) {
        dateIndex[d] = [];
        dates.push(d);
      }
      dateIndex[d].push(i);
    });

    // Sort dates ascending
    dates.sort();

    buildSlider();
    updateInfo(results.length);
    initCalendar();

    if (dates.length > 0) {
      jumpToDateIdx(dates.length - 1); // start at most recent
    }
  }

  // ── Build slider track with dot markers ───────────────────────────────────
  function buildSlider() {
    var track = document.getElementById("slider-track");

    // Remove existing dots
    track.querySelectorAll(".timeline-dot").forEach(function (d) { d.remove(); });

    document.getElementById("slider-fill").style.width = "0%";
    document.getElementById("slider-handle").style.left = "0%";

    if (dates.length === 0) {
      document.getElementById("label-start").textContent = "";
      document.getElementById("label-end").textContent = "";
      document.getElementById("label-current").textContent = "";
      return;
    }

    document.getElementById("label-start").textContent = dates[0];
    document.getElementById("label-end").textContent = dates[dates.length - 1];

    var total = dates.length - 1 || 1;

    dates.forEach(function (date, idx) {
      var dot = document.createElement("div");
      dot.className = "timeline-dot " + (hasSkysat(date) ? "skysat" : "other");
      var pct = (idx / total) * 100;
      dot.style.left = pct + "%";
      dot.title = date;
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        jumpToDateIdx(idx);
      });
      track.appendChild(dot);
    });
    // Note: track mousedown listener is registered once in DOMContentLoaded (below), not here.
  }

  function onTrackClick(e) {
    if (dates.length === 0) return;
    if (e.target.classList.contains("timeline-dot")) return;
    var track = document.getElementById("slider-track");
    var rect = track.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var idx = Math.round(pct * (dates.length - 1));
    jumpToDateIdx(idx);
  }

  // ── Jump to position ──────────────────────────────────────────────────────
  function jumpToDateIdx(idx) {
    if (dates.length === 0) return;
    idx = Math.max(0, Math.min(dates.length - 1, idx));
    currentDateIdx = idx;

    var pct = dates.length > 1 ? (idx / (dates.length - 1)) * 100 : 0;
    document.getElementById("slider-fill").style.width = pct + "%";
    document.getElementById("slider-handle").style.left = pct + "%";
    document.getElementById("label-current").textContent = "▲ " + dates[idx];
    document.getElementById("current-date-display").textContent = dates[idx];

    // Auto-select best result for this date
    var resultIdx = bestResultForDate(dates[idx]);
    if (resultIdx >= 0 && window.ResultsModule) {
      window.ResultsModule.selectResult(resultIdx);
    }
  }

  function jumpToResult(result) {
    // NOTE: This function must NOT call jumpToDateIdx — doing so would create
    // an infinite call cycle: selectResult → jumpToResult → jumpToDateIdx → selectResult.
    var d = isoToDate(result.acquired);
    if (!d) return;
    var idx = dates.indexOf(d);
    if (idx >= 0) {
      currentDateIdx = idx;
      var pct = dates.length > 1 ? (idx / (dates.length - 1)) * 100 : 0;
      document.getElementById("slider-fill").style.width = pct + "%";
      document.getElementById("slider-handle").style.left = pct + "%";
      document.getElementById("label-current").textContent = "▲ " + d;
      document.getElementById("current-date-display").textContent = d;
      if (calendarPicker) calendarPicker.setDate(d, false);
    }
  }

  // ── Update info line ──────────────────────────────────────────────────────
  function updateInfo(total) {
    document.getElementById("timeline-info").textContent =
      total + " image" + (total !== 1 ? "s" : "") +
      " across " + dates.length + " date" + (dates.length !== 1 ? "s" : "");
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  function startPlay() {
    if (dates.length === 0) return;
    isPlaying = true;
    document.getElementById("btn-play").textContent = "⏸";
    scheduleNext();
  }

  function scheduleNext() {
    var interval = BASE_INTERVAL_MS / speed;
    playTimer = setTimeout(function () {
      if (!isPlaying) return;
      var next = currentDateIdx + 1;
      if (next >= dates.length) {
        stopPlay();
        return;
      }
      jumpToDateIdx(next);
      scheduleNext();
    }, interval);
  }

  function stopPlay() {
    isPlaying = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    document.getElementById("btn-play").textContent = "▶";
  }

  function togglePlay() {
    if (isPlaying) { stopPlay(); } else { startPlay(); }
  }

  // ── Calendar picker ───────────────────────────────────────────────────────
  function initCalendar() {
    if (calendarPicker) {
      calendarPicker.destroy();
      calendarPicker = null;
    }

    if (dates.length === 0) return;

    calendarPicker = flatpickr("#calendar-input", {
      enable: dates,
      dateFormat: "Y-m-d",
      onChange: function (selectedDates, dateStr) {
        var idx = dates.indexOf(dateStr);
        if (idx >= 0) jumpToDateIdx(idx);
      },
    });
  }

  // ── Wire controls ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("btn-play").addEventListener("click", togglePlay);

    document.getElementById("btn-first").addEventListener("click", function () {
      stopPlay();
      jumpToDateIdx(0);
    });

    document.getElementById("btn-last").addEventListener("click", function () {
      stopPlay();
      jumpToDateIdx(dates.length - 1);
    });

    document.querySelectorAll(".speed-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".speed-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        speed = parseInt(btn.dataset.speed);
        window.AppState.speed = speed;
      });
    });

    document.getElementById("calendar-btn").addEventListener("click", function () {
      if (calendarPicker) calendarPicker.open();
    });

    // Register track click once (not inside buildSlider to avoid accumulating listeners)
    document.getElementById("slider-track").addEventListener("mousedown", onTrackClick);
  });

  // ── Export ────────────────────────────────────────────────────────────────
  window.TimelineModule = {
    init: init,
    jumpToResult: jumpToResult,
  };
})();
