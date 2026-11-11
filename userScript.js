// animelib-tv-fix 0.0.2: виртуальный курсор (всегда активен) + диагностика плеера AnimeLib + подмена UA.
// Кнопка Play/Pause (или Жёлтая кнопка) скрывает и показывает панель со статусом.
(function () {
  "use strict";

  var VERSION = "0.0.2";
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
    if (!document.body) return;
    if (!box) {
      box = document.createElement("pre");
      box.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483646;max-width:72vw;margin:0;" +
        "padding:8px 12px;background:rgba(0,0,0,.8);color:#9f9;font:15px/1.25 monospace;" +
        "white-space:pre-wrap;word-break:break-all;pointer-events:none;border-radius:6px";
    }
    if (!box.isConnected) {
      document.body.appendChild(box);
    }
    render();
    mountCursor();
  }

  // =========================================================================
  // ВИРТУАЛЬНЫЙ КУРСОР (ВСЕГДА АКТИВЕН)
  // =========================================================================
  var cursorEl = null;
  var cursorX = Math.floor((window.innerWidth || 1920) / 2);
  var cursorY = Math.floor((window.innerHeight || 1080) / 2);
  var speed = 8;
  var maxSpeed = 30;
  var accel = 0.65;
  var currentSpeed = speed;
  var scrollMargin = 70; // зона у края экрана для автоскролла (в пикселях)
  var scrollStep = 22;
  var activeKeys = { up: false, down: false, left: false, right: false };
  var lastHoverEl = null;

  function mountCursor() {
    if (!document.body) return;
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.id = "tb-virtual-cursor";
      cursorEl.style.cssText =
        "position:fixed;top:0;left:0;width:28px;height:28px;z-index:2147483647;" +
        "pointer-events:none;transform:translate3d(" + cursorX + "px," + cursorY + "px,0);" +
        "transition:transform 0.02s linear;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.85));";
      cursorEl.innerHTML =
        '<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 2 L4 20 L9.5 15 L13.5 22 L16.5 20.5 L12.5 13.5 L19.5 13.5 Z" ' +
        'fill="#ffffff" stroke="#000000" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<circle cx="4" cy="2" r="1.5" fill="#ff3b30"/>' +
        "</svg>";
    }
    if (!cursorEl.isConnected) {
      document.body.appendChild(cursorEl);
    }
  }

  function findScrollableParent(el, dy) {
    while (el && el !== document.body && el !== document.documentElement) {
      var style = window.getComputedStyle(el);
      var overflowY = style.overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function scrollPage(dx, dy) {
    var target = document.elementFromPoint(cursorX, cursorY);
    var scrollable = dy !== 0 ? findScrollableParent(target, dy) : null;
    if (scrollable) {
      scrollable.scrollBy(dx, dy);
    } else {
      window.scrollBy(dx, dy);
    }
  }

  function dispatchHover() {
    var el = document.elementFromPoint(cursorX, cursorY);
    if (el !== lastHoverEl) {
      if (lastHoverEl) {
        try {
          lastHoverEl.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, clientX: cursorX, clientY: cursorY }));
          lastHoverEl.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, clientX: cursorX, clientY: cursorY }));
        } catch (e) {}
      }
      if (el) {
        try {
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cursorX, clientY: cursorY }));
          el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: cursorX, clientY: cursorY }));
        } catch (e) {}
      }
      lastHoverEl = el;
    }
    if (el) {
      try {
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: cursorX, clientY: cursorY }));
      } catch (e) {}
    }
  }

  function triggerClick() {
    if (!cursorEl) return;
    // Визуальный отклик клика
    cursorEl.style.transform = "translate3d(" + cursorX + "px," + cursorY + "px,0) scale(0.8)";
    setTimeout(function () {
      if (cursorEl) cursorEl.style.transform = "translate3d(" + cursorX + "px," + cursorY + "px,0) scale(1)";
    }, 110);

    var el = document.elementFromPoint(cursorX, cursorY);
    if (!el) return;

    try {
      var opts = { bubbles: true, cancelable: true, view: window, clientX: cursorX, clientY: cursorY };
      if (typeof PointerEvent !== "undefined") {
        el.dispatchEvent(new PointerEvent("pointerdown", opts));
      }
      el.dispatchEvent(new MouseEvent("mousedown", opts));

      // Фокус для полей ввода, чтобы открывалась экранная клавиатура Tizen
      var tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) {
        el.focus();
      } else if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
        document.activeElement.blur();
      }

      if (typeof PointerEvent !== "undefined") {
        el.dispatchEvent(new PointerEvent("pointerup", opts));
      }
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    } catch (e) {
      log("ошибка клика: " + e);
    }
  }

  function updateCursorLoop() {
    var moving = activeKeys.up || activeKeys.down || activeKeys.left || activeKeys.right;
    if (moving) {
      currentSpeed = Math.min(maxSpeed, currentSpeed + accel);
      var vw = window.innerWidth || 1920;
      var vh = window.innerHeight || 1080;

      if (activeKeys.left) cursorX -= currentSpeed;
      if (activeKeys.right) cursorX += currentSpeed;
      if (activeKeys.up) {
        if (cursorY <= scrollMargin) scrollPage(0, -scrollStep);
        cursorY -= currentSpeed;
      }
      if (activeKeys.down) {
        if (cursorY >= vh - scrollMargin) scrollPage(0, scrollStep);
        cursorY += currentSpeed;
      }

      if (cursorX < 0) cursorX = 0;
      if (cursorY < 0) cursorY = 0;
      if (cursorX > vw - 4) cursorX = vw - 4;
      if (cursorY > vh - 4) cursorY = vh - 4;

      if (cursorEl) {
        cursorEl.style.transform = "translate3d(" + Math.round(cursorX) + "px," + Math.round(cursorY) + "px,0)";
      }
      dispatchHover();