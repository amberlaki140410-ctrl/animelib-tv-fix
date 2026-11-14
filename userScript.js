// animelib-tv-fix 0.3.1: диагностика плеера AnimeLib на ТВ + подмена user-agent + курсор.
// Курсор активен сразу. Play/Pause включает и выключает курсор; Назад в поле ввода закрывает поле.
// Скрыть/показать логи: клик курсором по кнопке [Скрыть логи] в левом нижнем углу или Жёлтая кнопка (405).
(function () {
  "use strict";

  // Только в главном окне. Во вложенных iframe (капча, плееры) второй экземпляр рисовал
  // свой курсор и панель логов и перехватывал стрелки, когда фокус уходил внутрь iframe.
  var IN_IFRAME = true;
  try { IN_IFRAME = window.self !== window.top; } catch (e) {}
  if (IN_IFRAME) {
    // Внутри iframe (плеер Kodik и т.п.): только команды видео от главного окна
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (d && typeof d === "object" && ["toggle", "play", "pause", "ff", "rw", "skip", "back"].indexOf(d.tbCmd) !== -1) videoCommand(d.tbCmd);
    });
    return;
  }

  // Перенос входа с ПК: страница на ПК открывает https://animelib.org/#tbauth=<base64 от localStorage.auth>
  try {
    var mAuth = /^#tbauth=(.+)$/.exec(location.hash);
    if (mAuth && location.hostname.indexOf("animelib.org") !== -1) {
      localStorage.setItem("auth", decodeURIComponent(escape(atob(mAuth[1]))));
      sessionStorage.setItem("tbAuthDone", "1");
      history.replaceState(null, "", location.pathname + location.search);
      location.replace(location.pathname + location.search); // перезагрузка уже со входом
      return;
    }
  } catch (e) {}

  var VERSION = "0.6.0";
  var TRANSFER_URL = "http://192.168.8.162:8000/give.html";
  var SPOOF_UA = true; // поставь false, чтобы проверить без подмены user-agent
  var MAX_LINES = 18;

  var lines = [];
  var lastMsg = "";
  var box = null;
  var toggleLogBtn = null;
  var logsVisible = false;
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

  function uiHost() {
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    // внутри <video>, <iframe> и т.п. дочерние элементы в полном экране не рисуются
    if (fs && !/^(VIDEO|IFRAME|IMG|CANVAS)$/.test(fs.tagName)) return fs;
    return document.body || document.documentElement;
  }

  function showToast(text) {
    var root = uiHost();
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
    if (toastEl.parentNode !== root) root.appendChild(toastEl);
    toastEl.textContent = text;
    toastEl.style.setProperty("opacity", "1", "important");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.style.setProperty("opacity", "0", "important");
    }, 1800);
  }

  function toggleLogs() {
    logsVisible = !logsVisible;
    if (box) box.style.display = logsVisible ? "block" : "none";
    showToast("Логи: " + (logsVisible ? "ВКЛ" : "ВЫКЛ") + " (Зелёная)");
  }

  // =========================================================================
  // ВИРТУАЛЬНЫЙ КУРСОР 0.3: движение по времени (dt), плавный разгон при удержании,
  // клик попадает точно в кончик, поля ввода не перехватывают управление
  // =========================================================================
  var cursorEnabled = true;
  var cursorEl = null;
  var x = 960, y = 540;      // позиция кончика курсора
  var vx = 0, vy = 0;        // скорость, px/с
  var held = { l: false, r: false, u: false, d: false };
  var heldSince = 0, lastDirEvent = 0, keyupSeen = false;
  var isPointer = false, lastUnder = null, lastHoverT = 0, lastFrameT = 0;
  var hoverDirty = false, edgeAcc = 0, hotX = 7, hotY = 4, lastToggleTime = 0;
  var HIDE_AFTER_MS = 5000;   // через сколько без движения курсор скрывается
  var lastActivity = Date.now(), cursorHidden = false;

  // Показать курсор после скрытия; возвращает true, если он был скрыт
  function wake() {
    lastActivity = Date.now();
    var was = cursorHidden;
    if (cursorHidden) {
      cursorHidden = false;
      if (cursorEl) cursorEl.style.setProperty("opacity", "1", "important");
    }
    return was;
  }

  var SPEED_MIN = 240;   // px/с при коротком нажатии (точное наведение)
  var SPEED_MAX = 1500;  // px/с при долгом удержании
  var RAMP_MS = 900;     // за сколько разгоняется до максимума

  var SVG_ARROW =
    '<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M7 4 L7 29 L14 22 L19 32 L23 30 L18 20 L27 20 Z" fill="#FFFFFF" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>' +
    '</svg>';
  var SVG_HAND =
    '<svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="18" cy="18" r="11" fill="rgba(0,168,255,0.35)" stroke="#FFFFFF" stroke-width="2"/>' +
    '<circle cx="18" cy="18" r="4" fill="#FFFFFF" stroke="#000000" stroke-width="1.5"/>' +
    '</svg>';

  function placeCursor(extra) {
    if (!cursorEl) return;
    cursorEl.style.setProperty("transform",
      "translate3d(" + Math.round(x - hotX) + "px," + Math.round(y - hotY) + "px,0)" + (extra || ""), "important");
  }

  function setIcon() {
    if (!cursorEl) return;
    cursorEl.innerHTML = isPointer ? SVG_HAND : SVG_ARROW;
    hotX = isPointer ? 18 : 7;
    hotY = isPointer ? 18 : 4;
    placeCursor();
  }

  function mount() {
    var root = uiHost();
    if (!root) return;

    if (!box) {
      box = document.createElement("pre");
      box.style.cssText =
        "position:fixed;left:8px;bottom:42px;z-index:2147483645;max-width:72vw;margin:0;" +
        "padding:8px 12px;background:rgba(0,0,0,.82);color:#9f9;font:15px/1.25 monospace;" +
        "white-space:pre-wrap;word-break:break-all;pointer-events:none;border-radius:6px;display:none;";
    }
    if (box.parentNode !== root) {
      root.appendChild(box);
      render();
    }


    if (!cursorEl) {
      x = Math.round((window.innerWidth || 1920) / 2);
      y = Math.round((window.innerHeight || 1080) / 2);
      cursorEl = document.createElement("div");
      cursorEl.id = "tb-cursor-v3";
      cursorEl.style.cssText =
        "position:fixed!important;top:0!important;left:0!important;width:36px!important;height:36px!important;" +
        "z-index:2147483647!important;pointer-events:none!important;user-select:none!important;" +
        "will-change:transform!important;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.75))!important;transition:opacity 0.25s ease!important;" +
        "display:" + (cursorEnabled ? "block" : "none") + "!important;";
      cursorEl.innerHTML = SVG_ARROW;
      placeCursor();
    }
    if (cursorEl.parentNode !== root) root.appendChild(cursorEl);
  }

  function releaseAll() {
    held.l = held.r = held.u = held.d = false;
    heldSince = 0;
  }

  function toggleCursorMode() {
    mount();
    cursorEnabled = !cursorEnabled;
    vx = 0; vy = 0;
    releaseAll();
    if (cursorEnabled) {
      cursorEl.style.setProperty("display", "block", "important");
      wake();
      placeCursor();
      showToast("Курсор: ВКЛЮЧЕН (Красная — выкл)");
      log("курсор: ВКЛ");
    } else {
      cursorEl.style.setProperty("display", "none", "important");
      changeHover(null);
      showToast("Курсор: ВЫКЛЮЧЕН (Красная — вкл)");
      log("курсор: ВЫКЛ");
    }
  }

  function isEditable(el) {
    if (!el) return false;
    var t = el.tagName;
    if (t === "TEXTAREA" || el.isContentEditable) return true;
    if (t === "INPUT") {
      var ty = (el.type || "text").toLowerCase();
      return ["button", "submit", "checkbox", "radio", "range", "color", "file", "image", "reset"].indexOf(ty) === -1;
    }
    return false;
  }

  function isInteractive(el) {
    var cur = el, depth = 0;
    while (cur && cur !== document.body && depth < 8) {
      var tag = cur.tagName;
      if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "LABEL" || tag === "VIDEO") return true;
      if (cur.getAttribute && cur.getAttribute("role") === "button") return true;
      var st = window.getComputedStyle(cur);
      if (st && st.cursor === "pointer") return true;
      cur = cur.parentElement;
      depth++;
    }
    return false;
  }

  function fire(el, type) {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    } catch (e) {}
  }

  function ancestors(el) {
    var a = [];
    while (el) { a.push(el); el = el.parentElement; }
    return a;
  }

  function fireMouse(el, type, rel, bubbles) {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: bubbles, cancelable: true, view: window, clientX: x, clientY: y, relatedTarget: rel || null }));
    } catch (e) {}
  }

  function firePointer(el, type, rel, bubbles) {
    if (!window.PointerEvent) return;
    try {
      el.dispatchEvent(new PointerEvent(type, { bubbles: bubbles, cancelable: true, view: window, clientX: x, clientY: y, relatedTarget: rel || null, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch (e) {}
  }

  // Как настоящая мышь: при смене элемента под курсором старому уходят out/leave, новому over/enter
  function changeHover(next) {
    var prev = lastUnder;
    if (prev === next) return;
    var pa = prev ? ancestors(prev) : [];
    var na = next ? ancestors(next) : [];
    var i;
    if (prev) {
      firePointer(prev, "pointerout", next, true);
      fireMouse(prev, "mouseout", next, true);
      for (i = 0; i < pa.length; i++) {
        if (na.indexOf(pa[i]) === -1) {
          firePointer(pa[i], "pointerleave", next, false);
          fireMouse(pa[i], "mouseleave", next, false);
        }
      }
    }
    if (next) {
      firePointer(next, "pointerover", prev, true);
      fireMouse(next, "mouseover", prev, true);
      for (i = na.length - 1; i >= 0; i--) {
        if (pa.indexOf(na[i]) === -1) {
          firePointer(na[i], "pointerenter", prev, false);
          fireMouse(na[i], "mouseenter", prev, false);
        }
      }
    }
    lastUnder = next;
  }

  function hover(now) {
    if (now - lastHoverT < 80) return;
    lastHoverT = now;
    var el = document.elementFromPoint(x, y); // курсор с pointer-events:none, его скрывать не нужно
    if (!el) return;
    if (el !== lastUnder) {
      var c = isInteractive(el);
      if (c !== isPointer) { isPointer = c; setIcon(); }
      changeHover(el);
    }
    firePointer(el, "pointermove", null, true);
    fireMouse(el, "mousemove", null, true);
  }

  function scrollUnderCursor(dy) {
    var el = lastUnder;
    while (el && el !== document.body && el !== document.documentElement) {
      var oy = window.getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) { el.scrollTop += dy; return; }
      el = el.parentElement;
    }
    window.scrollBy(0, dy);
  }

  function step(dt, now) {
    var any = held.l || held.r || held.u || held.d;
    // страховка, если пульт не присылает keyup
    if (any && now - lastDirEvent > (keyupSeen ? 2500 : 260)) { releaseAll(); any = false; }

    if (any || vx || vy) lastActivity = now;
    if (!cursorHidden && cursorEl && now - lastActivity > HIDE_AFTER_MS) {
      cursorHidden = true;
      cursorEl.style.setProperty("opacity", "0", "important");
    }

    var tx = 0, ty = 0;
    if (any) {
      var dx = (held.r ? 1 : 0) - (held.l ? 1 : 0);
      var dy = (held.d ? 1 : 0) - (held.u ? 1 : 0);
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len) {
        var k = Math.min(1, (now - heldSince) / RAMP_MS);
        var sp = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * k * k;
        tx = dx / len * sp;
        ty = dy / len * sp;
      }
    }
    var a = 1 - Math.exp(-dt * ((tx || ty) ? 16 : 26));
    vx += (tx - vx) * a;
    vy += (ty - vy) * a;
    if (!tx && !ty && Math.abs(vx) < 8 && Math.abs(vy) < 8) { vx = 0; vy = 0; }

    var w = window.innerWidth || 1920, h = window.innerHeight || 1080;
    if (vx || vy) {
      x = Math.min(Math.max(x + vx * dt, 0), w - 1);
      y = Math.min(Math.max(y + vy * dt, 0), h - 1);
      placeCursor();
      hoverDirty = true;
      hover(now);
    } else if (hoverDirty) {
      hoverDirty = false;
      lastHoverT = 0;
      hover(now);
    }

    // прокрутка у верхнего/нижнего края, только пока зажата стрелка в эту сторону
    var dirS = 0;
    if (held.u && y < 90) dirS = -1;
    else if (held.d && y > h - 90) dirS = 1;
    if (dirS) {
      edgeAcc += dirS * 950 * dt;
      var px = edgeAcc > 0 ? Math.floor(edgeAcc) : Math.ceil(edgeAcc);
      if (px) { edgeAcc -= px; scrollUnderCursor(px); }
    } else {
      edgeAcc = 0;
    }
  }

  function loop(ts) {
    var dt = lastFrameT ? Math.min((ts - lastFrameT) / 1000, 0.05) : 0.016;
    lastFrameT = ts;
    if (cursorEnabled) step(dt, Date.now());
    requestAnimationFrame(loop);
  }

  function performClick() {
    var el = document.elementFromPoint(x, y);
    if (!el) return;
    setTimeout(function () { hoverDirty = true; }, 250);
    var act = document.activeElement;
    // клик мимо поля ввода снимает с него фокус
    if (isEditable(act) && act !== el && !act.contains(el)) act.blur();

    placeCursor(" scale(0.82)");
    setTimeout(function () { placeCursor(""); }, 110);

    try {
      var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      el.dispatchEvent(new MouseEvent("mousedown", o));
      if (isEditable(el)) el.focus();
      el.dispatchEvent(new MouseEvent("mouseup", o));
      el.dispatchEvent(new MouseEvent("click", o)); // один клик; всплытие само дойдёт до ссылки/кнопки
    } catch (e) {
      log("ошибка клика: " + e);
    }
  }


  // =========================================================================
  // ВИДЕО, ПРОКРУТКА КАК КОЛЕСОМ МЫШИ, АДБЛОК
  // =========================================================================
  function findVideo() {
    var best = null, bestScore = -1;
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect();
      var score = Math.max(0, r.width) * Math.max(0, r.height) + (vids[i].paused ? 0 : 1e9);
      if (score > bestScore) { best = vids[i]; bestScore = score; }
    }
    return best;
  }

  function videoCommand(cmd) {
    var v = findVideo();
    if (!v) return false;
    var p;
    if (cmd === "toggle") { if (v.paused) p = v.play(); else v.pause(); }
    else if (cmd === "play") p = v.play();
    else if (cmd === "pause") v.pause();
    else if (cmd === "ff") v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);
    else if (cmd === "rw") v.currentTime = Math.max(0, v.currentTime - 10);
    else if (cmd === "skip") v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 85); // пропуск опенинга, секунды можно поменять
    else if (cmd === "back") v.currentTime = Math.max(0, v.currentTime - 85);
    if (p && p.catch) p.catch(function () {});
    return v;
  }

  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    var m = Math.floor(t / 60), sec = t % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function mediaKey(cmd) {
    var v = videoCommand(cmd);
    if (v) {
      var label = { toggle: v.paused ? "Пауза" : "Воспроизведение", play: "Воспроизведение", pause: "Пауза",
        ff: "+10 с", rw: "−10 с", skip: "Пропуск опенинга +85 с", back: "Назад −85 с" }[cmd];
      showToast(label + "   " + fmtTime(v.currentTime) + (isFinite(v.duration) ? " / " + fmtTime(v.duration) : ""));
      return;
    }
    // в этом окне видео нет: передаём команду во вложенные iframe (плеер Kodik и т.п.)
    var fr = document.querySelectorAll("iframe");
    for (var i = 0; i < fr.length; i++) {
      try { fr[i].contentWindow.postMessage({ tbCmd: cmd }, "*"); } catch (e) {}
    }
    showToast(fr.length ? "Команда отправлена в плеер" : "Видео на странице не найдено");
  }

  // CH вверх/вниз: прокрутка того, что под курсором, как колесо мыши.
  // Упёрлись в край этой области: останавливаемся, соседние области и страницу не трогаем.
  var scrollAnim = { el: null, target: 0, raf: 0, last: 0 };

  function getPos(el) { return el === window ? (window.pageYOffset || 0) : el.scrollTop; }
  function getMax(el) {
    return el === window
      ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      : Math.max(0, el.scrollHeight - el.clientHeight);
  }
  function setPos(el, v) {
    try {
      if (el === window) window.scrollTo({ top: v, behavior: "instant" });
      else el.scrollTo({ top: v, behavior: "instant" });
    } catch (e) {
      if (el === window) window.scrollTo(0, v); else el.scrollTop = v;
    }
  }

  function scrollTick(ts) {
    var a = scrollAnim;
    var dt = a.last ? Math.min((ts - a.last) / 1000, 0.05) : 0.016;
    a.last = ts;
    var pos = getPos(a.el);
    var diff = a.target - pos;
    if (Math.abs(diff) < 1) { setPos(a.el, a.target); a.raf = 0; a.last = 0; return; }
    var step = diff * (1 - Math.exp(-dt * 14));      // быстрый старт, мягкое торможение
    if (Math.abs(step) < 1) step = diff > 0 ? 1 : -1;
    setPos(a.el, pos + step);
    a.raf = requestAnimationFrame(scrollTick);
  }

  // Быстрые нажатия складываются в одну цель, поэтому прокрутка не сбивается и не отстаёт
  function scrollSmooth(el, delta) {
    var a = scrollAnim;
    if (a.el !== el || !a.raf) { a.el = el; a.target = getPos(el); }
    a.target = Math.min(getMax(el), Math.max(0, a.target + delta));
    if (!a.raf) { a.last = 0; a.raf = requestAnimationFrame(scrollTick); }
  }

  // Курсор над видео (или над iframe-плеером)?
  function cursorOverVideo() {
    var px = cursorEnabled ? x : (window.innerWidth || 1920) / 2;
    var py = cursorEnabled ? y : (window.innerHeight || 1080) / 2;
    var el = document.elementFromPoint(px, py);
    if (el && el.tagName === "IFRAME") return true;
    var v = findVideo();
    if (!v) return false;
    var r = v.getBoundingClientRect();
    return r.width > 100 && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  }

  function wheelAt(dir) {
    setTimeout(function () { hoverDirty = true; }, 150);
    setTimeout(function () { hoverDirty = true; }, 500);
    var px = cursorEnabled ? x : (window.innerWidth || 1920) / 2;
    var py = cursorEnabled ? y : (window.innerHeight || 1080) / 2;
    var el = document.elementFromPoint(px, py);
    if (!el) return;
    var dy = dir * 360;
    try {
      var ev = new WheelEvent("wheel", { bubbles: true, cancelable: true, view: window, clientX: px, clientY: py, deltaY: dy, deltaMode: 0 });
      if (!el.dispatchEvent(ev)) return; // сайт сам обработал прокрутку
    } catch (e) {}

    var scroller = null, cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var oy = window.getComputedStyle(cur).overflowY;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && cur.scrollHeight > cur.clientHeight + 1) { scroller = cur; break; }
      cur = cur.parentElement;
    }
    var target = scroller || window;
    var pos = getPos(target), max = getMax(target);
    if ((dir > 0 && pos >= max - 1) || (dir < 0 && pos <= 0)) return; // дальше некуда: стоим
    var h = target === window ? (window.innerHeight || 1080) : target.clientHeight;
    var step = target === window ? h * 0.4 : Math.max(100, Math.min(360, h * 0.5));
    scrollSmooth(target, dir * step);
  }

  // Адблок: блок запросов и вставки элементов с рекламных доменов + скрытие типовых рекламных блоков
  var AD_HOSTS = ["googlesyndication.com", "googleadservices.com", "doubleclick.net", "adservice.google.",
    "an.yandex.ru", "yandexadexchange.net", "adfox.ru", "adriver.ru", "ad.mail.ru", "exoclick.com",
    "propellerads.com", "popads.net", "adsterra.com", "hilltopads.net", "juicyads.com", "trafficjunky.com",
    "mgid.com", "taboola.com", "outbrain.com", "adnxs.com", "criteo.com"];
  var AD_CSS = ".adsbygoogle,[id^='yandex_rtb'],[id^='adfox'],[class*='adfox'],[id^='div-gpt-ad']," +
    "iframe[src*='googlesyndication'],iframe[src*='doubleclick'],iframe[src*='adfox'],iframe[src*='yandexadexchange']{display:none!important}";
  var adblockOn = true, adBlocked = 0, adStyleEl = null;
  try { adblockOn = localStorage.getItem("tb_adblock") !== "off"; } catch (e) {}

  function isAdUrl(u) {
    if (!adblockOn || !u) return false;
    try {
      var h = new URL(String(u), location.href).hostname;
      for (var i = 0; i < AD_HOSTS.length; i++) {
        var a = AD_HOSTS[i];
        if (a.charAt(a.length - 1) === ".") { if (h.indexOf(a) !== -1) return true; }
        else if (h === a || h.slice(-(a.length + 1)) === "." + a) return true;
      }
    } catch (e) {}
    return false;
  }

  function adHit(kind, u) {
    adBlocked++;
    log("адблок " + kind + ": " + short(u, 70) + " (всего " + adBlocked + ")");
  }

  function applyAdStyle() {
    var parent = document.head || document.documentElement;
    if (!parent) return;
    if (adblockOn) {
      if (!adStyleEl) { adStyleEl = document.createElement("style"); adStyleEl.textContent = AD_CSS; }
      if (!adStyleEl.isConnected) parent.appendChild(adStyleEl);
    } else if (adStyleEl && adStyleEl.isConnected) {
      adStyleEl.remove();
    }
  }

  function sweepAds() {
    if (!adblockOn) return;
    var nodes = document.querySelectorAll("iframe[src],script[src]");
    for (var i = 0; i < nodes.length; i++) {
      if (isAdUrl(nodes[i].src)) { adHit(nodes[i].tagName.toLowerCase(), nodes[i].src); nodes[i].remove(); }
    }
  }

  function toggleAdblock() {
    adblockOn = !adblockOn;
    try { localStorage.setItem("tb_adblock", adblockOn ? "on" : "off"); } catch (e) {}
    applyAdStyle();
    showToast("Адблок: " + (adblockOn ? "ВКЛ" : "ВЫКЛ") + " (Жёлтая)");
  }

  try {
    var adFetch = window.fetch;
    window.fetch = function (input) {
      var u = typeof input === "string" ? input : (input && input.url) || "";
      if (isAdUrl(u)) { adHit("fetch", u); return Promise.reject(new TypeError("blocked")); }
      return adFetch.apply(this, arguments);
    };
    var xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__tbAd = isAdUrl(u);
      if (this.__tbAd) adHit("xhr", u);
      return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__tbAd) {
        var self = this;
        setTimeout(function () { try { self.dispatchEvent(new Event("error")); } catch (e) {} }, 0);
        return;
      }
      return xhrSend.apply(this, arguments);
    };
    [["HTMLScriptElement", "script"], ["HTMLIFrameElement", "iframe"], ["HTMLImageElement", "img"]].forEach(function (pair) {
      var proto = window[pair[0]] && window[pair[0]].prototype;
      var dsc = proto && Object.getOwnPropertyDescriptor(proto, "src");
      if (!dsc || !dsc.set) return;
      Object.defineProperty(proto, "src", {
        get: dsc.get, configurable: true, enumerable: dsc.enumerable,
        set: function (v) { if (isAdUrl(v)) { adHit(pair[1], v); return; } dsc.set.call(this, v); }
      });
    });
    var adSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) {
      if (n === "src" && /^(SCRIPT|IFRAME|IMG)$/.test(this.tagName) && isAdUrl(v)) { adHit(this.tagName.toLowerCase(), v); return; }
      return adSetAttr.apply(this, arguments);
    };
  } catch (e) {
    log("адблок: хуки не поставились: " + e);
  }
  applyAdStyle();

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

  // 6. Кнопки пульта (по образцу родного браузера Samsung)
  // Красная: курсор. Зелёная: логи. Жёлтая: адблок. Синяя: перенос входа с ПК.
  // CH вверх/вниз: прокрутка под курсором. Назад: как Alt+Влево. Play/Pause/Stop/перемотка: видео.
  var DIR = { 37: "l", 39: "r", 38: "u", 40: "d" };
  var lastCh = { dir: 0, t: 0 }, chHinted = false;
  var KNOWN = { 10252: 1, 415: 1, 19: 1, 413: 1, 412: 1, 417: 1, 427: 1, 428: 1, 403: 1, 404: 1, 405: 1, 406: 1, 10009: 1, 65376: 1, 65385: 1 };

  window.addEventListener("keydown", function (e) {
    var c = e.keyCode || e.which;
    var now = Date.now();
    var act = document.activeElement;
    var typing = isEditable(act);
    function eat() { e.preventDefault(); e.stopPropagation(); }

    if (c > 255 && !KNOWN[c]) log("кнопка " + c + (typing ? " (в поле)" : ""));

    if (c === 403) { eat(); if (!e.repeat && now - lastToggleTime > 400) { lastToggleTime = now; toggleCursorMode(); } return; }
    if (c === 404) { eat(); if (!e.repeat) toggleLogs(); return; }
    if (c === 405) { eat(); if (!e.repeat) toggleAdblock(); return; }
    if (c === 406) {
      eat();
      if (!e.repeat) {
        log("перенос входа: открываю " + TRANSFER_URL);
        showToast("Перенос входа с ПК…");
        setTimeout(function () { location.href = TRANSFER_URL; }, 400);
      }
      return;
    }

    // Видео: Play/Pause, Play, Pause, Stop (пауза), перемотка вперёд и назад на 10 с
    if (c === 10252 || c === 415 || c === 19 || c === 413 || c === 417 || c === 412) {
      eat();
      var cmd = c === 10252 ? "toggle" : c === 415 ? "play" : (c === 19 || c === 413) ? "pause" : c === 417 ? "ff" : "rw";
      if (!e.repeat || cmd === "ff" || cmd === "rw") mediaKey(cmd);
      return;
    }

    // CH вверх/вниз: колесо мыши под курсором
    if (c === 427 || c === 428) {
      eat();
      var dir = c === 428 ? 1 : -1;
      // Над видео: двойное нажатие. CH вверх дважды: +85 с, CH вниз дважды: -85 с
      if (cursorOverVideo()) {
        if (!e.repeat) {
          if (lastCh.dir === dir && now - lastCh.t < 350) {
            lastCh.t = 0;
            mediaKey(dir < 0 ? "skip" : "back");
          } else {
            lastCh.dir = dir;
            lastCh.t = now;
            if (!chHinted) { chHinted = true; showToast("Дважды быстро: ±85 с"); }
          }
        }
        return;
      }
      lastCh.t = 0;
      wheelAt(dir);
      return;
    }

    // «Готово»/«Отмена» экранной клавиатуры: снять фокус с поля
    if (c === 65376 || c === 65385) { if (typing) act.blur(); return; }

    // Назад: закрыть поле, выйти из полного экрана, иначе как Alt+Влево
    if (c === 10009 || c === 27) {
      if (typing) { act.blur(); eat(); return; }
      if (document.fullscreenElement) { eat(); try { document.exitFullscreen(); } catch (err) {} return; }
      if (c === 10009 && history.length > 1) { eat(); history.back(); }
      return;
    }

    if (!cursorEnabled) return;

    if (DIR[c]) {
      eat();
      if (!held[DIR[c]] && !(held.l || held.r || held.u || held.d)) heldSince = now;
      held[DIR[c]] = true;
      wake();
      lastDirEvent = now;
      return;
    }

    if (c === 13) {
      if (!typing && cursorHidden) { wake(); eat(); return; }
      wake();
      // Enter в поле, когда курсор стоит над этим же полем: обычное поведение, без повторного клика
      if (typing) {
        var under = document.elementFromPoint(x, y);
        if (under === act || (under && act.contains(under))) return;
      }
      eat();
      if (!e.repeat) performClick();
    }
  }, true);

  window.addEventListener("keyup", function (e) {
    var c = e.keyCode || e.which;
    if (!DIR[c]) return;
    keyupSeen = true;
    if (!cursorEnabled) return;
    held[DIR[c]] = false;
    if (!(held.l || held.r || held.u || held.d)) heldSince = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener("blur", releaseAll);

  requestAnimationFrame(loop);

  // Если клавиатурный фокус ушёл в iframe (капча и т.п.), стрелки перестают доходить до курсора.
  setInterval(function () {
    var a = document.activeElement;
    if (cursorEnabled && a && a.tagName === "IFRAME") {
      try { a.blur(); } catch (e) {}
      try { window.focus(); } catch (e) {}
      log("фокус возвращён из iframe в страницу");
    }
  }, 300);

  log("animelib-tv-fix " + VERSION + " активен (Курсор ВКЛ), UA: " + short(navigator.userAgent, 60));
  log("экран " + screen.width + "x" + screen.height + ", MediaSource: " + !!window.MediaSource);

  try {
    if (sessionStorage.getItem("tbAuthDone")) {
      sessionStorage.removeItem("tbAuthDone");
      log("вход перенесён с ПК");
      setTimeout(function () { showToast("Вход перенесён с ПК"); }, 1500);
    }
  } catch (e) {}

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      log("полный экран: " + (fs ? fs.tagName : "выкл"));
      mount();
    });
  });

  setInterval(function () {
    applyAdStyle();
    sweepAds();
    if (!document.body) return;
    mount();
  }, 2000);
})();
