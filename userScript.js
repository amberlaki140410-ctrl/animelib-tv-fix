// animelib-tv-fix 0.0.3: бронебойный курсор + диагностика плеера AnimeLib + подмена UA.
(function () {
  "use strict";

  var VERSION = "0.0.3";
  var SPOOF_UA = true;
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

  // =========================================================================
  // ВИРТУАЛЬНЫЙ КУРСОР (НЕУБИВАЕМЫЙ ЧЕРЕЗ HTML ROOT + KEYDOWN)
  // =========================================================================
  var cursorEl = null;
  var cursorX = 640;
  var cursorY = 360;
  var lastKeyTime = 0;
  var stepSize = 18;
  var scrollMargin = 80;
  var scrollStep = 60;
  var loggedFirstMove = false;

  function initCoords() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1920;
    var h = window.innerHeight || document.documentElement.clientHeight || 1080;
    cursorX = Math.floor(w / 2);
    cursorY = Math.floor(h / 2);
  }
  initCoords();

  function mountUI() {
    var root = document.documentElement || document.body;
    if (!root) return;

    // 1. Панель логов
    if (!box) {
      box = document.createElement("pre");
      box.style.cssText =
        "position:fixed !important;left:12px !important;bottom:12px !important;" +
        "z-index:2147483646 !important;max-width:75vw !important;margin:0 !important;" +
        "padding:8px 12px !important;background:rgba(0,0,0,0.85) !important;" +
        "color:#00ff66 !important;font:15px/1.25 monospace !important;" +
        "white-space:pre-wrap !important;word-break:break-all !important;" +
        "pointer-events:none !important;border-radius:6px !important;border:1px solid #00ff66 !important;";
    }
    if (!box.parentNode) {
      root.appendChild(box);
      render();
    }

    // 2. Сам курсор (чистый CSS + внутренний указатель, не блокируется CSP)
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.id = "tb-cursor-root";
      cursorEl.style.cssText =
        "position:fixed !important;left:" + cursorX + "px !important;top:" + cursorY + "px !important;" +
        "width:26px !important;height:26px !important;z-index:2147483647 !important;" +
        "pointer-events:none !important;display:block !important;visibility:visible !important;" +
        "opacity:1 !important;margin:0 !important;padding:0 !important;";

      // Рисуем заметный курсор: красная точка на острие + белая стрелка с черной обводкой
      cursorEl.innerHTML =
        '<div style="' +
        "width:0;height:0;" +
        "border-left:14px solid #ffffff;" +
        "border-right:10px solid transparent;" +
        "border-bottom:14px solid transparent;" +
        "border-top:22px solid #ffffff;" +
        "filter:drop-shadow(0 0 2px #000) drop-shadow(1px 2px 4px rgba(0,0,0,0.9));" +
        'transform:rotate(-15deg);transform-origin:0 0;"></div>' +
        '<div style="' +
        "position:absolute;left:-4px;top:-4px;width:10px;height:10px;" +
        "background:#ff1e00;border:2px solid #ffffff;border-radius:50%;" +
        'box-shadow:0 0 6px #ff1e00;"></div>';
    }
    if (!cursorEl.parentNode) {
      root.appendChild(cursorEl);
    }
  }

  function updateCursorPos() {
    if (!cursorEl) mountUI();
    if (cursorEl) {
      cursorEl.style.setProperty("left", Math.round(cursorX) + "px", "important");
      cursorEl.style.setProperty("top", Math.round(cursorY) + "px", "important");
    }
  }

  function getElementUnderCursor() {
    if (cursorEl) cursorEl.style.setProperty("display", "none", "important");
    var el = document.elementFromPoint(cursorX, cursorY);
    if (cursorEl) cursorEl.style.setProperty("display", "block", "important");
    return el;
  }

  function scrollPage(dx, dy) {
    var el = getElementUnderCursor();
    while (el && el !== document.body && el !== document.documentElement) {
      var st = window.getComputedStyle(el);
      if ((st.overflowY === "auto" || st.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollBy(dx, dy);
        return;
      }
      el = el.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  function moveCursor(dx, dy) {
    var now = Date.now();
    // Если кнопки нажимаются подряд быстрее чем раз в 180 мс — ускоряем шаг
    if (now - lastKeyTime < 180) {
      stepSize = Math.min(55, stepSize + 5);
    } else {
      stepSize = 20;
    }
    lastKeyTime = now;

    var w = window.innerWidth || document.documentElement.clientWidth || 1920;
    var h = window.innerHeight || document.documentElement.clientHeight || 1080;

    cursorX += dx * stepSize;
    cursorY += dy * stepSize;

    // Автоскролл у верхнего и нижнего края
    if (dy < 0 && cursorY < scrollMargin) scrollPage(0, -scrollStep);
    if (dy > 0 && cursorY > h - scrollMargin) scrollPage(0, scrollStep);

    if (cursorX < 2) cursorX = 2;
    if (cursorY < 2) cursorY = 2;
    if (cursorX > w - 10) cursorX = w - 10;
    if (cursorY > h - 10) cursorY = h - 10;

    updateCursorPos();

    if (!loggedFirstMove) {
      loggedFirstMove = true;
      log("Курсор сдвинут: X=" + cursorX + " Y=" + cursorY);
    }

    var target = getElementUnderCursor();
    if (target) {
      try {
        target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cursorX, clientY: cursorY }));
        target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cursorX, clientY: cursorY }));
      } catch (e) {}
    }
  }

  function clickUnderCursor() {
    var target = getElementUnderCursor();
    if (!target) {
      log("Клик: под курсором пусто");
      return;
    }

    log("Клик по: <" + target.tagName.toLowerCase() + (target.className ? "." + short(target.className, 25) : "") + ">");

    // Анимация нажатия
    if (cursorEl) {
      cursorEl.style.transform = "scale(0.75)";
      setTimeout(function () {
        if (cursorEl) cursorEl.style.transform = "scale(1)";
      }, 120);
    }

    try {
      var evOpts = { bubbles: true, cancelable: true, view: window, clientX: cursorX, clientY: cursorY };
      if (typeof PointerEvent !== "undefined") {
        target.dispatchEvent(new PointerEvent("pointerdown", evOpts));
      }
      target.dispatchEvent(new MouseEvent("mousedown", evOpts));

      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        target.focus();
      }

      if (typeof PointerEvent !== "undefined") {
        target.dispatchEvent(new PointerEvent("pointerup", evOpts));
      }
      target.dispatchEvent(new MouseEvent("mouseup", evOpts));
      target.dispatchEvent(new MouseEvent("click", evOpts));

      // Если кликнули внутри ссылки <a> или <button>, дополнительно вызываем нативный .click()
      var clickable = target.closest ? target.closest("a, button, [role='button']") : null;
      if (clickable && clickable !== target) {
        clickable.click();
      }
    } catch (e) {
      log("Ошибка клика: " + e);
    }
  }

  function handleKeyDown(e) {
    var code = e.keyCode || e.which;

    // 37 = Left, 38 = Up, 39 = Right, 40 = Down
    if (code === 37) {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(-1, 0);
    } else if (code === 38) {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(0, -1);
    } else if (code === 39) {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(1, 0);
    } else if (code === 40) {
      e.preventDefault();
      e.stopPropagation();
      moveCursor(0, 1);
    } else if (code === 13) {
      // 13 = OK / Enter
      e.preventDefault();
      e.stopPropagation();
      clickUnderCursor();
    } else if (code === 405 || code === 10252 || code === 415 || code === 19) {
      // Play/Pause или Жёлтая кнопка — скрыть/показать зелёное окно логов
      if (box) {
        box.style.setProperty("display", box.style.display === "none" ? "block" : "none", "important");
      }
    }
  }

  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);

  // =========================================================================
  // КОД ДИАГНОСТИКИ И ПОДМЕНЫ UA
  // =========================================================================
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

  log("animelib-tv-fix " + VERSION + " ЗАПУЩЕН (Курсор по центру)");

  mountUI();
  document.addEventListener("DOMContentLoaded", mountUI);
  setInterval(mountUI, 1000);
})();