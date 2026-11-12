// ============================================================================
//  atlas.js — window.ATLAS: all eleven video clips from ONE decoder.
//
//  media/clips-atlas.mp4 is a silent 38s loop, 800x450 @ 20fps, laid out as a 4x3 grid of 200x150 tiles. One hidden
//  <video> plays it; each clip is painted into its own small <canvas> (drawImage of its tile), so eleven clips can
//  play at once on a phone while only one stream is decoded. The grid is never shown — canvases go wherever the
//  caller puts them.
//
//  ATLAS.clips                 ['hits-a','hits-b','concert','guns','bowling','nhl','skate','rupp','industry-70s','industry-war','faze']
//  ATLAS.canvas(name)          → <canvas width=200 height=150 class="atlas-clip" data-clip="name">. Style/size it with CSS
//                                (it is a normal replaced element, 4:3). It is painted only while it is in the document.
//  ATLAS.release(canvas)       stop painting a canvas (also happens automatically once it has left the document)
//  ATLAS.start()               create the video and play it. Call inside a user gesture when one is available; safe to
//                                call repeatedly. Muted + playsinline, so it may also start without a gesture.
//  ATLAS.ready()               → Promise that resolves when frames can be painted (never rejects; resolves false on error)
//  ATLAS.pause() / .resume()   stop / continue decoding and painting (e.g. nothing is on screen)
//  ATLAS.video                 the hidden <video> (null before start)
//
//  Decoding stops by itself when the tab is hidden or no canvas is registered, and resumes when one is.
// ============================================================================
(function () {
  'use strict';

  var SRC = 'media/clips-atlas.mp4';
  var TW = 200, TH = 150, COLS = 4, FPS = 20;
  var CLIPS = ['hits-a', 'hits-b', 'concert', 'guns', 'bowling', 'nhl', 'skate', 'rupp', 'industry-70s', 'industry-war', 'faze'];

  var video = null, canvases = [], raf = 0, lastPaint = 0, userPaused = false, readyP = null, readyResolve = null;

  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.setAttribute('muted', ''); video.muted = true;
    video.setAttribute('playsinline', ''); video.playsInline = true;
    video.setAttribute('loop', ''); video.loop = true;
    video.setAttribute('preload', 'auto');
    video.setAttribute('aria-hidden', 'true');
    video.disablePictureInPicture = true;
    // kept in the document (some browsers stop decoding detached or display:none videos) but out of sight
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    video.addEventListener('loadeddata', function () { if (readyResolve) { readyResolve(true); readyResolve = null; } paint(true); });
    video.addEventListener('error', function () { if (readyResolve) { readyResolve(false); readyResolve = null; } });
    video.src = SRC;
    (document.body || document.documentElement).appendChild(video);
    return video;
  }

  function ready() {
    if (!readyP) readyP = new Promise(function (res) { readyResolve = res; if (video && video.readyState >= 2) { res(true); readyResolve = null; } });
    return readyP;
  }

  function wanted() { return !userPaused && !document.hidden && canvases.length > 0; }

  function play() {
    if (!video) return;
    var p; try { p = video.play(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(function () { /* blocked until a gesture; start() will be called again */ });
  }

  function sync() {
    if (!video) return;
    if (wanted()) { if (video.paused) play(); if (!raf) raf = requestAnimationFrame(tick); }
    else { if (!video.paused) video.pause(); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  }

  function paint(force) {
    if (!video || video.readyState < 2) return;
    for (var i = canvases.length - 1; i >= 0; i--) {
      var c = canvases[i];
      if (!c.isConnected) { if (c._atlasSeen) canvases.splice(i, 1); continue; }   // left the document → forget it
      c._atlasSeen = true;
      if (!force && c.offsetParent === null && getComputedStyle(c).position !== 'fixed') continue;   // display:none
      var k = c._atlasIndex;
      try { c._atlasCtx.drawImage(video, (k % COLS) * TW, Math.floor(k / COLS) * TH, TW, TH, 0, 0, TW, TH); } catch (e) { /* frame not ready */ }
    }
  }

  function tick(now) {
    raf = 0;
    if (!wanted()) { sync(); return; }
    if (now - lastPaint >= 1000 / FPS - 4) { lastPaint = now; paint(false); }
    if (!canvases.length) { sync(); return; }
    raf = requestAnimationFrame(tick);
  }

  function canvas(name) {
    var k = CLIPS.indexOf(name);
    if (k < 0) k = 0;
    var c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    c.className = 'atlas-clip';
    c.setAttribute('data-clip', CLIPS[k]);
    c.setAttribute('aria-hidden', 'true');
    c._atlasIndex = k; c._atlasCtx = c.getContext('2d'); c._atlasSeen = false;
    canvases.push(c);
    if (video) sync();
    return c;
  }

  function release(c) {
    var i = canvases.indexOf(c);
    if (i >= 0) canvases.splice(i, 1);
    sync();
  }

  function start() { ensureVideo(); ready(); sync(); if (wanted() && video.paused) play(); return video; }

  document.addEventListener('visibilitychange', sync);

  window.ATLAS = {
    clips: CLIPS.slice(),
    canvas: canvas,
    release: release,
    start: start,
    ready: ready,
    pause: function () { userPaused = true; sync(); },
    resume: function () { userPaused = false; sync(); },
    get video() { return video; }
  };
})();
