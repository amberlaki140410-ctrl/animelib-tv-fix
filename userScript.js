// animelib-tv-fix 0.0.1: диагностика плеера AnimeLib на ТВ + подмена user-agent.
// Жёлтая кнопка на пульте скрывает и показывает панель со статусом.
(function () {
  "use strict";

  var VERSION = "0.0.1";
  var SPOOF_UA = true; // поставь false, чтобы проверить без подмены user-agent
  var MAX_LINES = 18;

  var lines = [];
  var lastMsg = "";
  var box = null;

  function short(s, n) {
    s = String(s);
    n = n || 90;
    if (s.length <= n) return s;
    var h = Math.floor(n / 2);
    return s.slice(0, h) + "…" + s.slice(-(h - 1));
  }

  function render() {
    if (box) box.textContent = lines.join("\n");
  }

  function log(msg) {
    if (msg === lastMsg) return;
    lastMsg = msg;
    var t = new Date();
    var stamp = ("0" + t.getMinutes()).slice(-2) + ":" + ("0" + t.getSeconds()).slice(-2);
    lines.push(stamp + " " + msg);
    if (lines.length > MAX_LINES) lines.shift();
    render();
  }

  function mount() {
    if (box || !document.body) return;
    box = document.createElement("pre");
    box.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:72vw;margin:0;" +
      "padding:8px 12px;background:rgba(0,0,0,.8);color:#9f9;font:15px/1.25 monospace;" +
      "white-space:pre-wrap;word-break:break-all;pointer-events:none;border-radius:6px";
    document.body.appendChild(box);
    render();
  }

  // 1. Подмена user-agent (до скриптов сайта, если TizenBrew внедряет код достаточно рано)
  if (SPOOF_UA) {
    try {
      var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      Object.defineProperty(navigator, "userAgent", { get: function () { return UA; }, configurable: true });
      Object.defineProperty(navigator, "appVersion", { get: function () { return UA.replace("Mozilla/", ""); }, configurable: true });
      Object.defineProperty(navigator, "platform", { get: function () { return "Win32"; }, configurable: true });
    } catch (e) {
      log("не удалось подменить UA: " + e);
    }
  }

  // 2. Ошибки скриптов и ресурсов
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === "VIDEO" || t.tagName === "AUDIO") return;
      log("ресурс не загрузился: " + t.tagName + " " + short(t.src || t.href || "", 80));
      return;
    }
    log("JS ошибка: " + short(e.message || "?", 100) + " @" + short((e.filename || "") + ":" + (e.lineno || ""), 60));
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    log("promise: " + short(r && r.name ? r.name + ": " + r.message : r, 120));
  });

  ["error", "warn"].forEach(function (k) {
    var orig = console[k];
    console[k] = function () {
      try {
        log("console." + k + ": " + short(Array.prototype.slice.call(arguments).map(String).join(" "), 120));
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  });

  // 3. События видео
  ["loadstart", "loadedmetadata", "canplay", "playing", "waiting", "stalled", "error", "abort", "emptied", "ended"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var v = e.target;
      if (!v || v.tagName !== "VIDEO") return;
      var info = ev + " " + v.videoWidth + "x" + v.videoHeight + " rs=" + v.readyState + " ns=" + v.networkState;
      if (ev === "error" && v.error) info += " code=" + v.error.code + " " + (v.error.message || "");
      if (ev === "loadstart" || ev === "error") info += " src=" + short(v.currentSrc || v.src || "", 80);
      log("video: " + info);
    }, true);
  });

  // 4. Хуки: play(), video.src, canPlayType, MediaSource.isTypeSupported
  try {
    var P = HTMLMediaElement.prototype;
    var seen = {};

    var origPlay = P.play;
    P.play = function () {
      var p = origPlay.apply(this, arguments);
      if (p && p.catch) {
        p.catch(function (e) { log("play() отклонён: " + (e && e.name) + " " + (e && e.message)); });
      }
      return p;
    };

    var d = Object.getOwnPropertyDescriptor(P, "src");
    if (d && d.set) {
      Object.defineProperty(P, "src", {
        get: d.get,
        set: function (v) { log("video.src = " + short(v, 100)); return d.set.call(this, v); },
        configurable: true,
        enumerable: d.enumerable
      });
    }

    var origCPT = P.canPlayType;
    P.canPlayType = function (t) {
      var r = origCPT.apply(this, arguments);
      var k = "cpt:" + t;
      if (!seen[k]) { seen[k] = 1; log("canPlayType(" + short(t, 60) + ") = " + (r || "нет")); }
      return r;
    };

    if (window.MediaSource && MediaSource.isTypeSupported) {
      var origITS = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (t) {
        var r = origITS(t);
        var k = "its:" + t;
        if (!seen[k]) { seen[k] = 1; log("isTypeSupported(" + short(t, 60) + ") = " + r); }
        return r;
      };
    }
  } catch (e) {
    log("хуки не поставились: " + e);
  }

  // 5. Неудачные запросы fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      return origFetch.apply(this, arguments).then(function (r) {
        if (!r.ok) log("fetch " + r.status + " " + short(url, 80));
        return r;
      }, function (e) {
        log("fetch ошибка " + short(url, 80) + " " + e);
        throw e;
      });
    };
  } catch (e) {}

  // 6. Жёлтая кнопка: показать или скрыть панель
  document.addEventListener("keydown", function (e) {
    if (e.keyCode === 405 && box) {
      box.style.display = box.style.display === "none" ? "block" : "none";
    }
  });

  log("animelib-tv-fix " + VERSION + " активен, UA: " + short(navigator.userAgent, 70));
  log("экран " + screen.width + "x" + screen.height + ", MediaSource: " + !!window.MediaSource);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  setInterval(function () {
    if (!document.body) return;
    if (!box) mount();
    else if (!box.isConnected) document.body.appendChild(box);
  }, 2000);
})();
