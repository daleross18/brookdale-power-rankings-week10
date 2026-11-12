// ============================================================================
//  sfx.js — window.SFX: the two interface sounds of the site, made in WebAudio (no files).
//
//    SFX.hover()   a light tick — the pointer has come onto something that reacts (a button, a link, a clipping, a table
//                  row, a piece of the clutter); on touch, where there is no hover, a press on one of those
//    SFX.press()   a heavier clack — a button, link or other control is actually pressed
//
//  This file wires both to the page (delegated, passive listeners: nothing is prevented or delayed). js/fx.js and
//  js/clutter.js call SFX.hover() for their own touch presses and for the clutter pieces, which take no pointer events.
//
//  The sounds go through PLAYER's AudioContext (PLAYER.audio()), so they follow the same rules as the music: nothing
//  can sound before the first tap or click on the page (browser policy), and the music button in the nav is the one
//  switch — paused there, the interface is silent too.
// ============================================================================
(function () {
  'use strict';
  if (window.SFX) return;

  var doc = document;
  // what ticks under the pointer: every control, and everything css/fx.css gives a hover move
  var HOVER = [
    'a[href]', 'button', 'select', 'summary', '[role="button"]', 'label[for]',
    '.clipping', '.news-photo', '.btn', '.seg > *', '.nav__link', '.masthead', '.fp-banner', '.section-head', '.tm-wb__head',
    '.stat', '.odds', '.sim-tie', '.tm-nav__step', '.tm-nav__back', '.st-id', '.hist-link',
    '.data tbody tr', '.ros__btn', '.hist-roll__row', '.st-g', '.hist-grid td'
  ].join(',');
  // what clacks when pressed: the things that do something
  var PRESS = 'a[href], button, select, summary, [role="button"], label[for], input[type="checkbox"], input[type="radio"], input[type="range"]';

  var HOVER_GAP = 45, PRESS_GAP = 60;      // ms: never two of the same sound closer together than this
  var noise = null, lastHover = -1e9, lastPress = -1e9, lastEl = null, mouseDownAt = -1e9;
  var count = { hover: 0, press: 0 };      // sounds actually started (for tests)

  function audio() {
    var P = window.PLAYER, a = P && typeof P.audio === 'function' ? P.audio() : null;
    return a && a.ctx && a.out && a.ctx.state === 'running' && !a.paused ? a : null;
  }
  function noiseBuf(ctx) {
    if (noise && noise.sampleRate === ctx.sampleRate) return noise;
    var len = Math.floor(ctx.sampleRate * 0.15), d;
    noise = ctx.createBuffer(1, len, ctx.sampleRate); d = noise.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }
  /** A short burst of filtered noise: the body of both sounds. */
  function burst(a, t, freq, q, dur, peak) {
    var ctx = a.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf(ctx);
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(a.out);
    s.start(t, Math.random() * 0.08, dur + 0.02);
  }
  function vary(x, by) { return x * (1 - by + Math.random() * 2 * by); }   // no two exactly alike

  function hover() {
    var now = performance.now();
    if (now - lastHover < HOVER_GAP) return;
    var a = audio(); if (!a) return;
    lastHover = now;
    try { burst(a, a.ctx.currentTime, vary(3100, 0.09), 1.6, 0.035, 0.75); count.hover++; } catch (e) { /* no sound */ }
  }
  // The press that unlocks the sound (the play button of the cutscene, or the first click on a page opened without it)
  // comes before there is a running context: it is tried again for a moment, so that press clacks too.
  var retry = 0;
  function pressSoon(from, n) {
    clearTimeout(retry);
    retry = setTimeout(function () {
      retry = 0;
      if (audio()) press(true);
      else if (n < 5 && performance.now() - from < 700) pressSoon(from, n + 1);
    }, 90);
  }
  function press(again) {
    var now = performance.now();
    if (now - lastPress < PRESS_GAP) return;
    var a = audio();
    if (!a) { var P = window.PLAYER, pa = P && typeof P.audio === 'function' ? P.audio() : null; if (again !== true && !(pa && pa.paused)) pressSoon(now, 0); return; }
    lastPress = now;
    try {
      var ctx = a.ctx, t = ctx.currentTime;
      burst(a, t, vary(1450, 0.06), 0.9, 0.06, 0.55);            // the key going down
      burst(a, t + 0.012, vary(4200, 0.08), 2.2, 0.02, 0.2);     // its edge
      var o = ctx.createOscillator(), g = ctx.createGain();       // and the weight behind it
      o.type = 'sine'; o.frequency.setValueAtTime(vary(165, 0.05), t); o.frequency.exponentialRampToValueAtTime(62, t + 0.07);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(a.out); o.start(t); o.stop(t + 0.11);
      count.press++;
    } catch (e) { /* no sound */ }
  }

  function near(t, sel) { return t && t.nodeType === 1 && t.closest ? t.closest(sel) : null; }
  var passive = { passive: true, capture: true };

  // hover: once per element the mouse comes onto
  doc.addEventListener('pointerover', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var el = near(e.target, HOVER);
    if (el === lastEl) return;
    lastEl = el;
    if (el && !el.disabled) hover();
  }, passive);
  doc.addEventListener('pointerleave', function () { lastEl = null; }, passive);

  // press: at once for a mouse; for a finger or the keyboard on the click itself, so a scroll that starts on a link is silent
  doc.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    var el = near(e.target, PRESS);
    if (!el || el.disabled) return;
    mouseDownAt = performance.now();
    press();
  }, passive);
  doc.addEventListener('click', function (e) {
    if (performance.now() - mouseDownAt < 800) return;      // the mouse press already sounded
    var el = near(e.target, PRESS);
    if (el && !el.disabled) press();
  }, passive);

  window.SFX = { hover: hover, press: press, _count: count };
})();
