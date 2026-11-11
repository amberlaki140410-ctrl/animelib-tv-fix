// animelib-clean 1.0.0: Курсор включен сразу + диагностика плеера
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var SPOOF_UA = true;
  var MAX_LINES = 12;

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

  // 1. ПОДМЕНА USER-AGENT
  if (SPOOF_UA) {
    try {
      var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      Object.defineProperty(navigator, "userAgent", { get: function () { return UA; }, configurable: true });
      Object.defineProperty(navigator, "appVersion", { get: function () { return UA.replace("Mozilla/", ""); }, configurable: true });
      Object.defineProperty(navigator, "platform", { get: function () { return "Win32"; }, configurable: true });
    } catch (e) {
      log("ошибка UA: " + e);
    }
  }

  // 2. ПЕРЕХВАТ ОШИБОК И ЛОГОВ
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) {
      if (t.tagName === "VIDEO" || t.tagName === "AUDIO") return;
      log("ошибка ресурса: " + t.tagName + " " + short(t.src || t.href || "", 60));
      return;
    }
    log("JS ошибка: " + short(e.message || "?", 80));
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    log("promise: " + short(r && r.name ? r.name + ": " + r.message : r, 100));
  });

  // 3. СОБЫТИЯ ВИДЕО
  ["loadstart", "canplay", "playing", "waiting", "error"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var v = e.target;
      if (!v || v.tagName !== "VIDEO") return;
      log("видео: " + ev + (ev === "error" && v.error ? " код=" + v.error.code : ""));
    }, true);
  });

  // 4. КУРСОР (АКТИВЕН СРАЗУ ПРИ ЗАПУСКЕ)
  var cursorEl = null;
  var curX = 640;
  var curY = 360;
  var step = 22;

  function mountUI() {
    var root = document.documentElement || document.body;
    if (!root) return;

    // Панель логов
    if (!box) {
      box = document.createElement("pre");
      box.style.cssText =
        "position:fixed!important;left:10px!important;bottom:10px!important;z-index:2147483646!important;" +
        "max-width:65vw!important;margin:0!important;padding:8px 12px!important;background:rgba(0,0,0,.85)!important;" +
        "color:#00ff66!important;font:14px/1.2 monospace!important;white-space:pre-wrap!important;" +
        "word-break:break-all!important;pointer-events:none!important;border-radius:6px!important;";
    }
    if (!box.parentNode) root.appendChild(box);

    // Курсор (стрелка)
    if (!cursorEl) {
      curX = Math.round((window.innerWidth || 1920) / 2);
      curY = Math.round((window.innerHeight || 1080) / 2);

      cursorEl = document.createElement("div");
      cursorEl.id = "clean-tv-cursor";
      cursorEl.style.cssText =
        "position:fixed!important;top:0!important;left:0!important;width:32px!important;height:32px!important;" +
        "z-index:2147483647!important;pointer-events:none!important;" +
        "transform:translate3d(" + curX + "px," + curY + "px,0)!important;";
      cursorEl.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 32 32">' +
        '<path d="M4 2 L4 26 L11 20 L16 30 L20 28 L15 18 L24 18 Z" fill="#ffffff" stroke="#000000" stroke-width="2"/>' +
        '</svg>';
    }
    if (!cursorEl.parentNode) root.appendChild(cursorEl);
    render();
  }

  function move(dx, dy) {
    var w = window.innerWidth || 1920;
    var h = window.innerHeight || 1080;

    curX += dx * step;
    curY += dy * step;

    // Скролл у краев экрана
    if (dy < 0 && curY < 80) window.scrollBy(0, -60);
    if (dy > 0 && curY > h - 80) window.scrollBy(0, 60);

    if (curX < 0) curX = 0;
    if (curY < 0) curY = 0;
    if (curX > w - 10) curX = w - 10;
    if (curY > h - 10) curY = h - 10;

    if (cursorEl) {
      cursorEl.style.setProperty("transform", "translate3d(" + curX + "px," + curY + "px,0)", "important");
    }
  }

  function clickTarget() {
    if (cursorEl) cursorEl.style.display = "none";
    var el = document.elementFromPoint(curX, curY);
    if (cursorEl) cursorEl.style.display = "block";

    if (!el) return;
    log("клик: " + el.tagName.toLowerCase());

    try {
      var opts = { bubbles: true, cancelable: true, view: window, clientX: curX, clientY: curY };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.focus();
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));

      var link = el.closest ? el.closest("a, button") : null;
      if (link && link !== el) link.click();
    } catch (err) {}
  }

  // 5. КЛАВИШИ ПУЛЬТА
  window.addEventListener("keydown", function (e) {
    var c = e.keyCode || e.which;

    // Стрелки пульта
    if (c === 37) { e.preventDefault(); e.stopPropagation(); move(-1, 0); }
    else if (c === 38) { e.preventDefault(); e.stopPropagation(); move(0, -1); }
    else if (c === 39) { e.preventDefault(); e.stopPropagation(); move(1, 0); }
    else if (c === 40) { e.preventDefault(); e.stopPropagation(); move(0, 1); }
    // Кнопка OK
    else if (c === 13) { e.preventDefault(); e.stopPropagation(); clickTarget(); }
    // Скрыть/показать логи: Play/Pause (10252, 415) или Желтая (405)
    else if ((c === 10252 || c === 415 || c === 405) && box) {
      box.style.display = box.style.display === "none" ? "block" : "none";
    }
  }, true);

  log("animelib-clean " + VERSION + " активен (курсор включен)");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountUI);
  else mountUI();
  setInterval(mountUI, 1500);
})();
