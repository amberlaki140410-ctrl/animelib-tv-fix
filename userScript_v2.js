// animelib-tv-fix 0.1.0: диагностика плеера AnimeLib на ТВ + подмена user-agent + переключаемый курсор.
// Кнопка Play/Pause на пульте включает и выключает курсор (по умолчанию выключен).
// Двойное нажатие Play/Pause или Жёлтая кнопка скрывает и показывает панель со статусом.
(function () {
  "use strict";

  var VERSION = "0.1.0";
  var SPOOF_UA = true; // поставь false, чтобы проверить без подмены user-agent
  var MAX_LINES = 18;

  var lines = [];
  var lastMsg = "";
  var box = null;
  var toastEl = null;
  var toastTimer = null;

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

  function showToast(text) {
    var root = document.body || document.documentElement;
    if (!root) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed!important;top:24px!important;left:50%!important;transform:translateX(-50%)!important;" +
        "z-index:2147483647!important;background:rgba(20,20,20,0.92)!important;color:#fff!important;" +
        "padding:10px 22px!important;border-radius:30px!important;font:bold 18px sans-serif!important;" +
        "box-shadow:0 4px 15px rgba(0,0,0,0.6)!important;border:1px solid rgba(255,255,255,0.2)!important;" +
        "pointer-events:none!important;transition:opacity 0.25s ease!important;opacity:0!important;";
      root.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.setProperty("opacity", "1", "important");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.style.setProperty("opacity", "0", "important");
    }, 1800);
  }

  // =========================================================================
  // ВИРТУАЛЬНЫЙ КУРСОР В СТИЛЕ TIZEN BROWSER (ВКЛ/ВЫКЛ ПО PLAY/PAUSE)
  // =========================================================================
  var cursorEnabled = false;
  var cursorEl = null;
  var x = 960, y = 540;
  var vx = 0, vy = 0;
  var isPointer = false;
  var lastMoveInput = 0;
  var lastToggleTap = 0;
  var toggleTapTimeout = null;

  var SVG_ARROW =
    '<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M7 4 L7 29 L14 22 L19 32 L23 30 L18 20 L27 20 Z" fill="#FFFFFF" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>' +
    '</svg>';

  var SVG_HAND =
    '<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="14" cy="14" r="10" fill="rgba(0, 168, 255, 0.35)" stroke="#FFFFFF" stroke-width="2"/>' +
    '<circle cx="14" cy="14" r="4" fill="#FFFFFF" stroke="#000000" stroke-width="1.5"/>' +
    '</svg>';

  function mount() {
    var root = document.body || document.documentElement;
    if (!root) return;

    if (!box) {
      box = document.createElement("pre");
      box.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483645;max-width:72vw;margin:0;" +
        "padding:8px 12px;background:rgba(0,0,0,.8);color:#9f9;font:15px/1.25 monospace;" +
        "white-space:pre-wrap;word-break:break-all;pointer-events:none;border-radius:6px";
    }
    if (!box.isConnected) {
      root.appendChild(box);
      render();
    }

    if (!cursorEl) {
      x = Math.round((window.innerWidth || 1920) / 2);
      y = Math.round((window.innerHeight || 1080) / 2);
      cursorEl = document.createElement("div");
      cursorEl.style.cssText =
        "position:fixed!important;top:0!important;left:0!important;width:36px!important;height:36px!important;" +
        "z-index:2147483647!important;pointer-events:none!important;user-select:none!important;" +
        "filter:drop-shadow(0 3px 6px rgba(0,0,0,0.75))!important;display:none!important;" +
        "transform:translate3d(" + x + "px," + y + "px,0)!important;";
      cursorEl.innerHTML = SVG_ARROW;
    }
    if (!cursorEl.isConnected) {
      root.appendChild(cursorEl);
    }
  }

  function toggleCursorMode() {
    mount();
    cursorEnabled = !cursorEnabled;
    vx = 0;
    vy = 0;

    if (cursorEnabled) {
      x = Math.round((window.innerWidth || 1920) / 2);
      y = Math.round((window.innerHeight || 1080) / 2);
      if (cursorEl) {
        cursorEl.style.setProperty("transform", "translate3d(" + x + "px," + y + "px,0)", "important");
        cursorEl.style.setProperty("display", "block", "important");
      }
      showToast("Курсор: ВКЛЮЧЕН (Play/Pause — выкл)");
      log("курсор: ВКЛ");
    } else {
      if (cursorEl) {
        cursorEl.style.setProperty("display", "none", "important");
      }
      showToast("Курсор: ВЫКЛЮЧЕН (Стандартный пульт)");
      log("курсор: ВЫКЛ");
    }
  }

  function getTargetAt(cx, cy) {
    if (cursorEl) cursorEl.style.setProperty("display", "none", "important");
    var el = document.elementFromPoint(cx, cy);
    if (cursorEl && cursorEnabled) cursorEl.style.setProperty("display", "block", "important");
    return el;
  }

  function isInteractive(el) {
    var curr = el;
    while (curr && curr !== document.body) {
      var tag = curr.tagName;
      if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "VIDEO") {
        return true;
      }
      if (curr.getAttribute && (curr.getAttribute("role") === "button" || curr.onclick)) {
        return true;
      }
      var st = window.getComputedStyle(curr);
      if (st && st.cursor === "pointer") return true;
      curr = curr.parentElement;
    }
    return false;
  }

  function smartScroll(dx, dy) {
    var el = getTargetAt(x, y);
    while (el && el !== document.body && el !== document.documentElement) {
      var st = window.getComputedStyle(el);
      if ((st.overflowY === "auto" || st.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollTop += dy;
        return;
      }
      el = el.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  function physicsLoop() {
    if (cursorEnabled && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1)) {
      var w = window.innerWidth || 1920;
      var h = window.innerHeight || 1080;

      x += vx;
      y += vy;
      vx *= 0.82;
      vy *= 0.82;

      if (y < 75 && vy < -0.5) smartScroll(0, -18);
      if (y > h - 75 && vy > 0.5) smartScroll(0, 18);

      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x > w - 8) x = w - 8;
      if (y > h - 8) y = h - 8;

      if (cursorEl) {
        cursorEl.style.setProperty("transform", "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)", "important");
      }

      var under = getTargetAt(x, y);
      if (under) {
        var clickable = isInteractive(under);
        if (clickable !== isPointer) {
          isPointer = clickable;
          if (cursorEl) cursorEl.innerHTML = isPointer ? SVG_HAND : SVG_ARROW;
        }
        try {
          under.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
        } catch (e) {}
      }
    }
    requestAnimationFrame(physicsLoop);
  }

  function performClick() {
    var el = getTargetAt(x, y);
    if (!el) return;

    if (cursorEl) {
      cursorEl.style.setProperty("transform", "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0) scale(0.82)", "important");
      setTimeout(function () {
        if (cursorEl) cursorEl.style.setProperty("transform", "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0) scale(1)", "important");
      }, 110);
    }

    try {
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
        el.focus();
      }
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));

      var linkOrBtn = el.closest ? el.closest("a, button, [role='button']") : null;
      if (linkOrBtn && linkOrBtn !== el) linkOrBtn.click();
    } catch (e) {
      log("ошибка клика: " + e);
    }
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

 // 6. Обработка кнопок пульта
  var okPressTimer = null;

  window.addEventListener("keydown", function (e) {
    var c = e.keyCode || e.which;
    var now = Date.now();

    // Записываем код нажатой клавиши в лог для проверки
    log("Нажата кнопка: " + c);

    // Включение/выключение курсора по кнопке Play/Pause (коды 10252, 415, 19)
    if (c === 10252 || c === 415 || c === 19) {
      e.preventDefault();
      e.stopPropagation();
      toggleCursorMode();
      return;
    }

    // Дополнительный способ: удержание центральной кнопки OK (Enter, код 13) на 1.2 секунды
    if (c === 13 && !okPressTimer && !cursorEnabled) {
      okPressTimer = setTimeout(function () {
        toggleCursorMode();
      }, 1200);
    }

    // Скрытие/показ панели логов только по жёлтой кнопке (405) или Stop (413)
    if ((c === 405 || c === 413) && box) {
      box.style.display = box.style.display === "none" ? "block" : "none";
      return;
    }

    // Если курсор выключен — работают стандартные стрелки Tizen
    if (!cursorEnabled) return;

    // Если курсор включен — перехватываем стрелки и клик
    var boost = (now - lastMoveInput < 160) ? 1.45 : 1;
    if (c === 37 || c === 38 || c === 39 || c === 40) {
      e.preventDefault();
      e.stopPropagation();
      lastMoveInput = now;

      if (c === 37) vx = Math.max(vx * boost - 9, -36);
      if (c === 39) vx = Math.min(vx * boost + 9, 36);
      if (c === 38) vy = Math.max(vy * boost - 9, -36);
      if (c === 40) vy = Math.min(vy * boost + 9, 36);
    } else if (c === 13) {
      e.preventDefault();
      e.stopPropagation();
      performClick();
    }
  }, true);

  window.addEventListener("keyup", function (e) {
    if (e.keyCode === 13 && okPressTimer) {
      clearTimeout(okPressTimer);
      okPressTimer = null;
    }
  }, true);
