// ============================================================================
//  fx.js — the small part of the print treatment that css/fx.css cannot do by itself.
//
//  1. Press = hover on touch.  Hover does not exist on a phone, so a press puts the class `fx-hit` on the pressed
//     element(s) for HIT_MS; css/fx.css plays the same move for `.fx-hit` as for `:hover` / `:focus-visible`.
//     Listeners are delegated from document and passive: nothing is prevented or delayed, and no element is ever
//     added to or removed from a view — a press is a class on existing elements and nothing else (no layout).
//     The class goes on 40ms after the finger lands, or at once when it lifts sooner — except a quick tap on a
//     link, where the click is about to change the page. A finger that moves first is scrolling: nothing plays
//     (pointercancel also clears whatever is on).
//  2. One <svg> with the dot pattern that css/fx.css uses for the playoff band of the charts (`#fx-pat-band`).
//  3. The jump plate.  Each piece of display type (headlines, numerals, records, section heads, stat values) gets its
//     visible text copied into the attribute `data-fxt`; css/fx.css sets that copy behind the ink as the two colour
//     plates, shown only for the two held frames of fx-sep. Refreshed (throttled) when the app's DOM changes.
//  4. Nothing runs with ?reduce (html.reduce) or while the tab is hidden; a hidden tab clears whatever was playing.
//
//  Views are re-rendered on every route change: no view DOM is kept — pressed elements are found from the event
//  target and only held until their timer fires (~0.5s). No element is ever added to or removed from a view.
//
//  window.FX = { hit(el) }   play the press move on an element (and its pressable ancestors) by hand; no-op under ?reduce
// ============================================================================
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var HIT_MS = 460;              // how long the class stays (the longest move is 360ms)
  var PRESS_MS = 40;             // a finger must rest this long (or lift) before the press plays
  var SLOP = 8;                  // px of movement that makes a touch a scroll
  var MAX_HITS = 4;              // pressable elements animated per press, nearest first
  var HAS_POINTER = !!window.PointerEvent;
  var MOVE = HAS_POINTER ? 'pointermove' : 'touchmove';
  var passive = { passive: true, capture: true };

  // what a press animates — the same elements css/fx.css gives a :hover move
  var HIT = [
    '.clipping', '.news-photo', '.btn', '.seg > *', '.nav__link', '.masthead', '.fp-banner', '.section-head', '.tm-wb__head',
    '.stat', '.odds', '.sim-tie', '.seg', '.tm-nav__step', '.tm-nav__back', '.st-id', '.hist-link',
    '.data td.team a', '.data th.team a', '.tm-read__opp a', '.data tbody tr', '.ros__btn', '.hist-roll__row',
    '.st-g', '.hist-grid td'
  ].join(',');

  function still() { return root.classList.contains('reduce') || doc.hidden; }

  // ---------- press ----------
  var live = [];                 // [{ el, timer }] — only while a press is playing
  var pend = null;               // { target, x, y, timer } — a touch that has not yet shown whether it is a press or a scroll

  function drop(entry) {
    clearTimeout(entry.timer);
    entry.el.classList.remove('fx-hit');
    var i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
  }
  function dropAll() { while (live.length) drop(live[live.length - 1]); }

  function hit(el) {
    for (var i = 0; i < live.length; i++) {
      if (live[i].el === el) {                       // pressed again while still playing: start over
        drop(live[i]);
        void getComputedStyle(el).animationName;     // style only (no layout): lets the class restart its animations
        break;
      }
    }
    var entry = { el: el, timer: 0 };
    el.classList.add('fx-hit');
    entry.timer = setTimeout(function () { drop(entry); }, HIT_MS);
    live.push(entry);
  }

  // play the press on everything pressable from `t` upwards
  function press(t) {
    if (still() || !t || t.nodeType !== 1 || !t.isConnected) return;
    var n = 0;
    for (var el = t.closest(HIT); el && n < MAX_HITS; el = el.parentElement && el.parentElement.closest(HIT)) { hit(el); n++; }
  }

  function unpend() {
    if (!pend) return null;
    var p = pend; pend = null;
    clearTimeout(p.timer);
    doc.removeEventListener(MOVE, onMove, passive);
    return p;
  }
  function firePending() { var p = unpend(); if (p) press(p.target); }
  function point(e) { return (e.touches && e.touches[0]) || e; }

  function onDown(e) {
    if (e.pointerType === 'mouse') return;           // a mouse hovers: css does it
    unpend();
    if (still()) return;
    var t = e.target;
    if (!t || t.nodeType !== 1 || !t.closest || !t.closest(HIT)) return;
    var p = point(e);
    pend = { target: t, x: p.clientX, y: p.clientY, timer: setTimeout(firePending, PRESS_MS) };
    doc.addEventListener(MOVE, onMove, passive);     // only while a touch is undecided
  }
  function onMove(e) {
    if (!pend) return;
    var p = point(e);
    if (Math.abs(p.clientX - pend.x) > SLOP || Math.abs(p.clientY - pend.y) > SLOP) unpend();
  }
  function onUp(e) {
    if (e.pointerType === 'mouse') return;
    var p = unpend();
    if (p && !p.target.closest('a[href]')) press(p.target);
  }
  function onCancel() { unpend(); dropAll(); }

  // ---------- the jump plate: a copy of each piece of display type, for css/fx.css to set behind its ink ----------
  // An attribute on the existing element, nothing else: `[data-fxt]::before { content: attr(data-fxt) }` is the copy.
  // Views are re-rendered on every route change (and some rewrite their own text), so the attribute is refreshed,
  // debounced, whenever the app's DOM changes. Only text and attributes are read — no layout.
  var TYPE = '.masthead__name,.headline,.fp-clip__rec,.tm-card__rec,.st-mark__big,.hist-roll__year,' +
    '.section-head > span:first-child,.stat__value,.fp-clip__num,.tm-card__num,.tm-wb__rec,.tm-foot__num,.tm-nav__no';
  var TAG_MS = 250;              // at most one pass per TAG_MS: at once after a quiet spell, else trailing
  var tagTimer = 0, tagAt = -1e9, app = null;

  // What is printed: the text nodes, minus .sr-only children. Type that holds other elements (a movement marker
  // inside a stat value) cannot be set again as plain text, so it gets no copy — null — and simply has no jump;
  // a headline's plain inline spans (the banner's red kicker) are the exception.
  function visibleText(el) {
    var s = '', spans = el.classList.contains('headline');
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1 && !n.classList.contains('sr-only')) {
        if (!spans || n.firstElementChild) return null;
        s += n.textContent;
      }
    }
    return s;
  }
  function tagType() {
    clearTimeout(tagTimer); tagTimer = 0; tagAt = Date.now();
    if (!app || root.classList.contains('reduce')) return;
    var els = app.querySelectorAll(TYPE);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('.cl-layer')) continue;         // clutter's pieces are not ours
      var t = visibleText(el);
      if (t === null) { if (el.hasAttribute('data-fxt')) el.removeAttribute('data-fxt'); }
      else if (el.getAttribute('data-fxt') !== t) el.setAttribute('data-fxt', t);
    }
  }
  // straight after a render the copy is in place before the new view is first laid out (no second layout for it);
  // a view that keeps rewriting itself (a chart readout, a running simulation) gets one pass per TAG_MS
  function tagSoon() {
    if (tagTimer) return;
    if (Date.now() - tagAt >= TAG_MS) tagType(); else tagTimer = setTimeout(tagType, TAG_MS);
  }
  function watchType() {
    app = doc.getElementById('app');
    if (!app || root.classList.contains('reduce')) return;
    if (window.MutationObserver) {
      new MutationObserver(function (recs) {
        if (tagTimer) return;
        for (var i = 0; i < recs.length; i++) {
          var t = recs[i].target;
          if (t.nodeType !== 1) t = t.parentNode;
          if (t && t.closest && !t.closest('.cl-layer')) { tagSoon(); return; }
        }
      }).observe(app, { childList: true, subtree: true, characterData: true });
    }
    tagSoon();
  }

  // ---------- the chart band's dot pattern ----------
  function addDefs() {
    if (doc.getElementById('fx-defs') || !doc.body) return;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.id = 'fx-defs';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    var pat = doc.createElementNS(NS, 'pattern');
    pat.id = 'fx-pat-band';
    pat.setAttribute('width', '6'); pat.setAttribute('height', '6');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('patternTransform', 'rotate(45)');
    var dot = doc.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '3'); dot.setAttribute('cy', '3'); dot.setAttribute('r', '1.25');
    dot.setAttribute('fill', 'rgba(21,18,15,0.3)');
    pat.appendChild(dot);
    var defs = doc.createElementNS(NS, 'defs');
    defs.appendChild(pat);
    svg.appendChild(defs);
    doc.body.appendChild(svg);
  }

  // ---------- wiring ----------
  if (HAS_POINTER) {
    doc.addEventListener('pointerdown', onDown, passive);
    doc.addEventListener('pointerup', onUp, passive);
    doc.addEventListener('pointercancel', onCancel, passive);
  } else {
    doc.addEventListener('touchstart', onDown, passive);
    doc.addEventListener('touchend', onUp, passive);
    doc.addEventListener('touchcancel', onCancel, passive);
  }
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) onCancel(); });
  window.addEventListener('pagehide', onCancel);

  if (doc.body) addDefs(); else doc.addEventListener('DOMContentLoaded', addDefs);     // static, so with ?reduce too
  if (doc.getElementById('app')) watchType(); else doc.addEventListener('DOMContentLoaded', watchType);

  window.FX = { hit: press };
})();
