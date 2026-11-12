// ============================================================================
//  player.js — window.PLAYER — every sound on the site.
//
//  One AudioContext, created/resumed inside a user gesture (PLAYER.unlock()).
//    <audio> thx / jungle / money-for-nothing / gimme-shelter / sirius  → MediaElementAudioSourceNode → GainNode → master
//      (fades are done on the GainNodes: HTMLMediaElement.volume is read-only on iOS)
//    camera.mp3 decoded to an AudioBuffer, looped at low gain
//    static buzz + CRT blip synthesized (noise buffer, saw hum, filters)
//
//  Playlist (after the intro, or on a deep link after the first interaction anywhere):
//    jungle → money-for-nothing → gimme-shelter → sirius → loop, CFG.crossfade seconds of equal-power crossfade.
//    A track that cannot be loaded is skipped; pressing play again retries everything.
//  One small fixed play/pause button (.pdeck), the M key, pause when the tab is hidden / resume when visible.
//  Headset / media-key / lock-screen play and pause go through the same play() and pause().
//  The button and the M key are inert while <html> has class 'intro-active' (the cutscene owns the sound then).
//
//  API used by intro.js (the app never calls this module):
//    PLAYER.unlock()                 call inside a tap/click/key handler; idempotent
//    PLAYER.prepare()                start loading the cutscene's media (thx, jungle, camera)
//    PLAYER.progress()               0..1, how much of what the gate needs is ready
//    PLAYER.thx, PLAYER.jungle       the <audio> elements (their currentTime drives the cutscene)
//    PLAYER.playThx(at) / stopThx(fadeSec)
//    PLAYER.playJungle(at, fadeSec)  → Promise<boolean> (false when the browser refused to play)
//    PLAYER.cueJungle(at)            seek the song without starting it
//    PLAYER.staticOn(level) / staticLevel(level) / staticOff() / blip()
//    PLAYER.cameraOn(fadeSec) / cameraOff(fadeSec)
//    PLAYER.latency()                seconds between an element's currentTime and what is heard through WebAudio (capped)
//    PLAYER.handoff()                cutscene is over: the playlist, the button and the M key take over
//    PLAYER.play() / pause() / toggle() / isPlaying()
// ============================================================================
(function () {
  'use strict';

  var CFG = {
    dir: 'media/',
    tracks: ['jungle.m4a', 'money-for-nothing.m4a', 'gimme-shelter.m4a', 'sirius.m4a'],   // playlist order; jungle is also the cutscene song
    thx: 'thx.m4a',
    camera: 'camera.mp3',
    crossfade: 1.5,          // seconds
    preloadNextAt: 25,       // seconds before the end of a track at which the next one starts buffering
    forceLoadAt: 12,         // ...and at which a browser that ignored that (iOS) is made to load it by a silent play/pause
    cameraRise: 20,          // seconds over which the camera loop comes up from cameraFrom × its level to its level, as the song gets louder
    cameraFrom: 0.6,
    maxLatency: 0.03,        // cap on the output-latency compensation reported to the cutscene (seconds)
    gain: { music: 0.9, thx: 0.75, camera: 0.42, static: 0.2, blip: 0.22 }
  };

  var root = document.documentElement;
  var AC = window.AudioContext || window.webkitAudioContext;
  // file:// media is cross-origin to WebAudio (it would play silence), so there the elements play directly.
  var USE_GRAPH = !!AC && location.protocol !== 'file:';

  var ctx = null, master = null;
  var unlocked = false;
  var started = false;        // the playlist has been started (by the cutscene or by a first interaction)
  var owned = false;          // the cutscene has handed the playlist over (or there was no cutscene)
  var userPaused = false;
  var heldByHide = null;      // decks paused because the tab went hidden
  var cur = -1;               // playlist index of the track that is playing
  var xfade = null;           // { from: deck, to: deck, toIndex }

  /* ---------- decks: one <audio> + one GainNode each ---------- */
  function Deck(file, level) {
    var el = new Audio();
    el.preload = 'none';
    el.src = CFG.dir + file;
    el.setAttribute('playsinline', '');
    this.el = el; this.level = level; this.gain = null; this.wanted = false; this.vol = 0; this.stopTimer = 0; this.local = false; this.fetching = false; this.gen = 0;
    this.primed = false;     // play() has been allowed on this element at least once (so later programmatic play() calls are too)
    this.bad = false;        // the file failed to load from the network
    this.seekTo = null;      // a seek asked for before the element could seek; applied when its metadata arrives
    var self = this;
    el.addEventListener('loadedmetadata', function () { self.bad = false; if (self.seekTo != null) self.seek(self.seekTo); });
    el.addEventListener('playing', function () { self.primed = true; });
    el.addEventListener('error', function () { if (!self.local) self.bad = true; });   // (a deck playing from memory falls back to the network first: fetchInto)
  }
  Deck.prototype.wire = function () {
    if (this.gain || !ctx || !USE_GRAPH) return;
    try {
      var src = ctx.createMediaElementSource(this.el);
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      src.connect(this.gain); this.gain.connect(master);
    } catch (e) { this.gain = null; }
  };
  /** volume 0..1 of this deck's own level; fade in seconds (0 = now). */
  Deck.prototype.setVol = function (v, fade) {
    this.vol = v;
    var target = v * this.level;
    if (this.gain) {
      var g = this.gain.gain, now = ctx.currentTime;
      try {
        g.cancelScheduledValues(now);
        if (fade > 0) { g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(target, now + fade); }
        else g.setValueAtTime(target, now);
      } catch (e) { g.value = target; }
    } else {
      try { this.el.volume = Math.max(0, Math.min(1, target)); } catch (e) { /* read-only on iOS */ }
      this.el.muted = target <= 0.0001;
    }
  };
  /** Inside the gesture: start the element silently so later programmatic play() calls are allowed (iOS). */
  Deck.prototype.prime = function () {
    var self = this, el = this.el;
    if (this.wanted || !el.paused) return;
    this.setVol(0, 0);
    var p, gen = ++this.gen;
    try { p = el.play(); } catch (e) { p = null; }
    // put it back to rest once it has started, unless something has used the deck in the meantime
    if (p && p.then) p.then(function () { self.primed = true; if (self.gen !== gen || self.wanted) return; el.pause(); if (el.currentTime !== 0) { try { el.currentTime = 0; } catch (e) { /* not seekable yet */ } } }, function () { /* refused, or its source was swapped */ });
  };
  /** Seek; if the element cannot seek yet (no metadata), the seek is applied as soon as it can. */
  Deck.prototype.seek = function (at) {
    var el = this.el;
    this.seekTo = null;
    try { el.currentTime = at; } catch (e) { /* not seekable yet */ }
    if (el.readyState < 1 && at > 0) this.seekTo = at;
  };
  /** Move a deck without starting it (the cutscene cues the song at the drop before a skip). */
  Deck.prototype.cue = function (at) {
    this.gen++;
    if (this.el.preload !== 'auto') this.el.preload = 'auto';
    if (this.el.readyState === 0 && this.el.networkState !== 2) { try { this.el.load(); } catch (e) { /* ignore */ } }   // nothing has asked for the file yet
    this.seek(at);
  };
  Deck.prototype.start = function (at, vol, fade) {
    var el = this.el;
    clearTimeout(this.stopTimer);
    this.gen++;
    this.wanted = true;
    if (el.preload !== 'auto') el.preload = 'auto';
    if (el.error && !this.local) { try { el.load(); } catch (e) { /* ignore */ } }   // a file that failed earlier gets another try
    if (at != null && (Math.abs(el.currentTime - at) > 0.02 || this.seekTo != null)) this.seek(at);
    if (fade > 0) { this.setVol(0, 0); this.setVol(vol, fade); } else this.setVol(vol, 0);
    return this.resume();
  };
  /** play() that reports whether the browser let it through. */
  Deck.prototype.resume = function () {
    var p;
    try { p = this.el.play(); } catch (e) { return Promise.resolve(false); }
    if (!p || !p.then) return Promise.resolve(true);
    return p.then(function () { return true; }, function () { return false; });
  };
  Deck.prototype.stop = function (fade, rewind) {
    var self = this, el = this.el;
    this.gen++;
    this.wanted = false;
    this.seekTo = null;
    clearTimeout(this.stopTimer);
    var end = function () { if (self.wanted) return; if (!el.paused) el.pause(); if (rewind && el.currentTime !== 0) { try { el.currentTime = 0; } catch (e) { /* ignore */ } } };
    if (fade > 0 && !el.paused) { this.setVol(0, fade); this.stopTimer = setTimeout(end, fade * 1000 + 40); }
    else { this.setVol(0, 0); end(); }
  };

  var tracks = CFG.tracks.map(function (f) { return new Deck(f, CFG.gain.music); });
  var thx = new Deck(CFG.thx, CFG.gain.thx);
  var allDecks = tracks.concat([thx]);

  /* ---------- context ---------- */
  function ensureCtx() {
    if (ctx || !AC) return ctx;
    try {
      ctx = new AC();
      master = ctx.createGain();
      // Automated browsers (site checks) never make noise on the machine running them.
      master.gain.value = navigator.webdriver ? 0 : 1;
      master.connect(ctx.destination);
      // iOS: without this, WebAudio output is silenced by the ring/silent switch while plain <audio> is not.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      allDecks.forEach(function (d) { d.wire(); });
      decodeCamera();
    } catch (e) { ctx = null; master = null; }
    return ctx;
  }
  function resumeCtx() { if (ctx && ctx.state !== 'running' && !document.hidden) { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } } }

  function unlock() {
    ensureCtx();
    resumeCtx();
    // Every call primes the decks that have not been allowed to play yet: the first call may not have been a gesture
    // the browser accepts (a scroll's touchend, a modifier key), and then nothing was unlocked by it.
    allDecks.forEach(function (d) { if (!d.primed) d.prime(); });
    if (unlocked && ctx && ctx.state === 'running') return;
    unlocked = true;
    if (ctx) {   // a one-sample buffer played in the gesture fully unlocks WebAudio on older iOS
      try { var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- cutscene media: loading ---------- */
  var cameraBytes = null, cameraBuf = null, cameraSrc = null, cameraGain = null, cameraFetch = null, cameraWanted = 0;
  /** Download a deck's file whole and play it from memory: it is then loaded before the tap even on iOS (which ignores
   *  preload), seeking to the drop is instant, and it cannot stall mid-song. Falls back to plain streaming. */
  function fetchInto(d) {
    var stream = function () { if (d.el.preload !== 'auto') { d.el.preload = 'auto'; if (d.el.readyState === 0 && d.el.paused) { try { d.el.load(); } catch (e) { /* ignore */ } } } };
    if (d.local || d.fetching) return;
    if (!window.fetch || !window.Blob || !window.URL || !URL.createObjectURL || location.protocol === 'file:') { stream(); return; }
    d.fetching = true;
    fetch(d.el.src).then(function (r) { if (!r.ok) throw new Error('media ' + r.status); return r.arrayBuffer(); }).then(function (buf) {
      d.fetching = false;
      if (d.wanted || d.el.currentTime > 0.5) return;                      // already in use from the network: leave it alone
      var url = d.el.src;
      d.el.addEventListener('error', function back() {                     // a browser that will not play from memory: back to the network
        d.el.removeEventListener('error', back);
        if (!d.local) return;
        d.local = false; d.el.src = url;
        try { d.el.load(); } catch (e) { /* ignore */ }
        if (d.wanted) d.resume();
      });
      d.el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/mp4' }));
      d.el.preload = 'auto';
      try { d.el.load(); } catch (e) { /* ignore */ }
      d.local = true;
    }).catch(function () { d.fetching = false; stream(); });
  }
  function prepare() {
    fetchInto(thx); fetchInto(tracks[0]);
    if (!cameraFetch && window.fetch && USE_GRAPH) {
      cameraFetch = fetch(CFG.dir + CFG.camera).then(function (r) { if (!r.ok) throw new Error('camera ' + r.status); return r.arrayBuffer(); })
        .then(function (b) { cameraBytes = b; decodeCamera(); }).catch(function () { cameraBytes = null; });
    }
  }
  function decodeCamera() {
    if (!ctx || !cameraBytes || cameraBuf) return;
    var bytes = cameraBytes; cameraBytes = null;
    var done = function (buf) { cameraBuf = buf; if (cameraWanted) cameraOn(cameraWanted); };
    try { var p = ctx.decodeAudioData(bytes, done, function () {}); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
  }
  function progress() {
    // (a file that cannot be loaded is not waited for)
    var a = thx.local || thx.bad ? 1 : Math.min(1, thx.el.readyState / 3), b = tracks[0].local || tracks[0].bad ? 1 : Math.min(1, tracks[0].el.readyState / 1);
    return (a * 2 + b) / 3;
  }

  /* ---------- camera loop ---------- */
  function cameraOn(fade) {
    cameraWanted = fade || 0.01;
    if (!ctx || !cameraBuf || cameraSrc) return;
    try {
      cameraSrc = ctx.createBufferSource(); cameraSrc.buffer = cameraBuf; cameraSrc.loop = true;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;   // takes the edge off the shutter clicks so they sit under the guitar
      cameraGain = ctx.createGain(); cameraGain.gain.value = 0;
      cameraSrc.connect(lp); lp.connect(cameraGain); cameraGain.connect(master);
      var now = ctx.currentTime;
      cameraGain.gain.setValueAtTime(0, now);
      cameraGain.gain.linearRampToValueAtTime(CFG.gain.camera * CFG.cameraFrom, now + cameraWanted);
      cameraGain.gain.linearRampToValueAtTime(CFG.gain.camera, now + cameraWanted + CFG.cameraRise);
      cameraSrc.start(0);
    } catch (e) { cameraSrc = null; }
  }
  function cameraOff(fade) {
    cameraWanted = 0;
    if (!cameraSrc) return;
    var src = cameraSrc, g = cameraGain; cameraSrc = null; cameraGain = null;
    try {
      var now = ctx.currentTime;
      g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + (fade || 0.01));
      src.stop(now + (fade || 0.01) + 0.05);
    } catch (e) { try { src.stop(); } catch (e2) { /* ignore */ } }
  }

  /* ---------- static buzz + blip (synthesized) ---------- */
  var stat = null;
  function staticOn(level) {
    if (!ctx) return;
    if (stat) { staticLevel(level); return; }
    try {
      var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.45;
      var ng = ctx.createGain(); ng.gain.value = 1;
      var hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 59;
      var hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 520;
      var hg = ctx.createGain(); hg.gain.value = 0.55;
      var out = ctx.createGain(); out.gain.value = 0;
      noise.connect(bp); bp.connect(ng); ng.connect(out);
      hum.connect(hlp); hlp.connect(hg); hg.connect(out);
      out.connect(master);
      noise.start(0); hum.start(0);
      stat = { noise: noise, hum: hum, out: out };
      staticLevel(level);
    } catch (e) { stat = null; }
  }
  function staticLevel(level) {
    if (!stat) return;
    try { stat.out.gain.setTargetAtTime(Math.max(0, level) * CFG.gain.static, ctx.currentTime, 0.012); } catch (e) { /* ignore */ }
  }
  function staticOff() {
    if (!stat) return;
    var s = stat; stat = null;
    try {
      var now = ctx.currentTime;
      s.out.gain.cancelScheduledValues(now); s.out.gain.setTargetAtTime(0, now, 0.008);
      s.noise.stop(now + 0.08); s.hum.stop(now + 0.08);
    } catch (e) { /* ignore */ }
  }
  /** The CRT collapsing: a short falling tone. */
  function blip() {
    if (!ctx) return;
    try {
      var now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1500, now); o.frequency.exponentialRampToValueAtTime(45, now + 0.26);
      g.gain.setValueAtTime(CFG.gain.blip, now); g.gain.exponentialRampToValueAtTime(0.0008, now + 0.3);
      o.connect(g); g.connect(master); o.start(now); o.stop(now + 0.32);
    } catch (e) { /* ignore */ }
  }

  /* ---------- cutscene songs ---------- */
  function playThx(at) { return thx.start(at || 0, 1, 0); }
  function stopThx(fade) { thx.stop(fade || 0, true); }
  function cueJungle(at) { tracks[0].cue(at); }
  function playJungle(at, fade) {
    tracks.forEach(function (d, i) { if (i !== 0) d.stop(0, true); });
    xfade = null; cur = 0; userPaused = false;
    return tracks[0].start(at || 0, 1, fade || 0).then(function (ok) { if (ok) started = true; render(); return ok; });
  }

  function latency() {
    if (!ctx || !USE_GRAPH || !tracks[0].gain) return 0;
    var l = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    return isFinite(l) && l > 0 ? Math.min(l, CFG.maxLatency) : 0;
  }

  /* ---------- playlist ---------- */
  function startPlaylist(i, at) {
    tracks.forEach(function (d, k) { if (k !== i) d.stop(0, true); });
    xfade = null; cur = i; userPaused = false;
    return tracks[i].start(at || 0, 1, 0).then(function (ok) { if (ok) started = true; render(); return ok; });
  }
  /** The next track in order that has not failed to load; the current one again if every other one has. */
  function nextIndex() {
    for (var k = 1; k <= tracks.length; k++) { var i = (cur + k) % tracks.length; if (!tracks[i].bad) return i; }
    return cur;
  }
  function advance() {   // hard cut to the next track (a track ended without a crossfade, or failed to load)
    if (cur < 0) return;
    var from = tracks[cur];
    xfade = null;
    cur = nextIndex();
    if (tracks[cur].bad) { from.stop(0, false); render(); return; }   // nothing on the playlist can be loaded
    if (tracks[cur] !== from) from.stop(0, true);
    var p = tracks[cur].start(0, 1, 0);
    if (userPaused || heldByHide) tracks[cur].el.pause();
    p.then(render);
  }
  function poll() {
    if (!owned || cur < 0) return;
    var d = tracks[cur], el = d.el;
    if (xfade) {
      var t = xfade.to.el.currentTime, p = Math.max(0, Math.min(1, t / CFG.crossfade));
      xfade.from.setVol(Math.cos(p * Math.PI / 2), 0.06);
      xfade.to.setVol(Math.sin(p * Math.PI / 2), 0.06);
      if (p >= 1 || xfade.from.el.ended) {
        var to = xfade.to;
        xfade.from.stop(0, true); to.setVol(1, 0.05);
        cur = xfade.toIndex; xfade = null;
        if (to.el.paused && !userPaused && !heldByHide) to.resume().then(render);   // its play() had not gone through yet
        render();
      }
      return;
    }
    if (el.paused || !isFinite(el.duration) || !el.duration) return;
    var left = el.duration - el.currentTime, ni = nextIndex(), nx = tracks[ni];
    if (nx === d) return;
    if (left <= CFG.preloadNextAt && nx.el.preload !== 'auto') { nx.el.preload = 'auto'; if (nx.el.readyState === 0) { try { nx.el.load(); } catch (e) { /* ignore */ } } }
    if (left <= CFG.forceLoadAt && left > CFG.crossfade + 1 && nx.el.readyState < 3 && forced !== nx) { forced = nx; nx.prime(); }   // iOS ignores preload: start it silently, prime() pauses it again
    if (left <= CFG.crossfade + 0.05) {
      xfade = { from: d, to: nx, toIndex: ni };
      nx.start(0, 0, 0);
    }
  }
  var forced = null;          // the deck last made to load by a silent play (CFG.forceLoadAt)
  tracks.forEach(function (d, i) {
    d.el.addEventListener('ended', function () {
      if (!owned) return;
      if (xfade && xfade.from === d) return;   // the crossfade poll finishes it
      if (i === cur) advance();
    });
    d.el.addEventListener('error', function () {
      if (d.local) return;                     // a deck playing from memory falls back to the network first (fetchInto)
      if (xfade && xfade.to === d) {           // the track being faded in is missing: poll() picks the one after it
        var from = xfade.from;
        from.setVol(1, 0.05); xfade = null; d.stop(0, false);
        if (from.el.ended) advance();
        return;
      }
      if (owned && i === cur && d.wanted) setTimeout(function () { if (i === cur && d.bad) advance(); }, 800);
    });
    d.el.addEventListener('play', render); d.el.addEventListener('pause', render);
  });
  setInterval(poll, 100);

  function activeDecks() { return allDecks.filter(function (d) { return d.wanted; }); }
  function isPlaying() { return cur >= 0 && tracks[cur].wanted && !tracks[cur].el.paused && !tracks[cur].el.ended; }
  function play() {
    unlock();
    userPaused = false;
    if (cur >= 0 && tracks[cur].bad) {         // asked to play after files failed to load: try them all again
      tracks.forEach(function (d) { d.bad = false; });
      return startPlaylist(cur, 0);
    }
    if (cur < 0 || !tracks[cur].wanted) return startPlaylist(cur < 0 ? 0 : cur, cur < 0 ? 0 : null);
    resumeCtx();
    var ps = activeDecks().map(function (d) { return d.resume(); });
    return Promise.all(ps).then(function (r) { if (r[0]) started = true; render(); return !!r[0]; });
  }
  function pause() {
    userPaused = true;
    activeDecks().forEach(function (d) { d.el.pause(); });
    render();
  }
  function toggle() { if (isPlaying()) pause(); else play(); }
  // Headset buttons, media keys and lock-screen controls: without handlers the system pauses one <audio> element behind
  // this module's back (during a crossfade two are playing). During the cutscene "play" only resumes what was playing.
  try {
    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      navigator.mediaSession.setActionHandler('pause', function () { pause(); });
      navigator.mediaSession.setActionHandler('play', function () {
        if (!introActive()) { owned = true; play(); return; }
        userPaused = false; resumeCtx();
        activeDecks().forEach(function (d) { d.resume(); });
      });
    }
  } catch (e) { /* ignore */ }

  /* ---------- tab hidden / visible ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      var held = allDecks.filter(function (d) { return !d.el.paused; });
      held.forEach(function (d) { d.el.pause(); });
      heldByHide = (heldByHide || []).concat(held);
      if (ctx && ctx.state === 'running') { try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }
    } else {
      resumeCtx();
      var back = heldByHide || []; heldByHide = null;
      if (!userPaused) back.forEach(function (d) { if (d.wanted) d.resume(); });
    }
  });
  window.addEventListener('pagehide', function () { allDecks.forEach(function (d) { try { d.el.pause(); } catch (e) { /* ignore */ } }); });

  /* ---------- the button ---------- */
  var css = '' +
    '.pdeck{position:fixed;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:900;' +
      'display:flex;align-items:center;justify-content:center;gap:7px;min-width:44px;height:44px;padding:0 11px;margin:0;' +
      'font:500 15px/1 var(--f-data,"IBM Plex Mono",ui-monospace,Menlo,monospace);color:var(--ink,#15120f);background:var(--paper-2,#ebe5d5);' +
      'border:1.5px solid var(--ink,#15120f);border-radius:0;box-shadow:2px 2px 0 var(--ink,#15120f);cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-user-select:none;user-select:none}' +
    '.pdeck:hover{background:var(--paper-3,#cbc2a9)}' +
    '.pdeck:active{transform:translate(2px,2px);box-shadow:none}' +
    '.pdeck:focus-visible{outline:2px solid var(--red,#c3261c);outline-offset:2px}' +
    '.pdeck-ico{position:relative;display:block;width:11px;height:12px}' +
    '.pdeck-ico::before,.pdeck-ico::after{content:"";position:absolute;top:0;bottom:0;width:3.5px;background:currentColor}' +
    '.pdeck-ico::before{left:0}.pdeck-ico::after{right:0}' +
    '.pdeck[aria-pressed="false"] .pdeck-ico::before{width:auto;right:0;background:none;border-left:11px solid currentColor;border-top:6px solid transparent;border-bottom:6px solid transparent}' +
    '.pdeck[aria-pressed="false"] .pdeck-ico::after{display:none}' +
    'html.intro-active .pdeck{display:none}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'pdeck';
  btn.setAttribute('aria-label', 'Play or pause music'); btn.title = 'Play / pause  [M]';
  var note = document.createElement('span'); note.setAttribute('aria-hidden', 'true'); note.textContent = '♫';
  var ico = document.createElement('span'); ico.className = 'pdeck-ico'; ico.setAttribute('aria-hidden', 'true');
  btn.appendChild(note); btn.appendChild(ico);
  function mount() { if (!btn.parentNode) document.body.appendChild(btn); render(); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  function render() { btn.setAttribute('aria-pressed', isPlaying() ? 'true' : 'false'); }

  function introActive() { return root.classList.contains('intro-active'); }
  btn.addEventListener('click', function (e) { e.stopPropagation(); if (introActive()) return; owned = true; toggle(); });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key !== 'm' && e.key !== 'M') return;
    if (/input|textarea|select/i.test((e.target && e.target.tagName) || '') || introActive()) return;
    owned = true; toggle();
  });

  /* ---------- no cutscene (deep link): the first interaction anywhere starts the playlist from the top ---------- */
  var GESTURES = ['pointerup', 'click', 'keydown', 'touchend'];
  function removeGesture() { GESTURES.forEach(function (t) { document.removeEventListener(t, firstGesture, true); }); }
  function firstGesture(e) {
    if (introActive()) return;                    // the cutscene's gate owns the first tap
    if (started || userPaused) { removeGesture(); return; }
    if (cur >= 0 && tracks[cur].bad) tracks.forEach(function (d) { d.bad = false; });
    if (e.type === 'keydown' && (e.key === 'm' || e.key === 'M' || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (e.target && btn.contains(e.target)) return;   // the button's own handler does it
    owned = true;
    unlock();
    // A track the cutscene already asked for (still loading, or refused until now) is carried on from where it is cued,
    // not restarted; otherwise the playlist starts from the top.
    var d = cur >= 0 ? tracks[cur] : null;
    var p = d && d.wanted && !d.bad ? d.resume().then(function (ok) { if (ok) started = true; render(); return ok; }) : startPlaylist(0, 0);
    p.then(function (ok) { if (ok) removeGesture(); });
  }
  GESTURES.forEach(function (t) { document.addEventListener(t, firstGesture, true); });

  function handoff() {
    owned = true;
    if (cur >= 0 && tracks[cur].bad && tracks[cur].wanted) advance();   // the cutscene's song could not be loaded: go on with the next one
    render();
  }

  window.PLAYER = {
    unlock: unlock, prepare: prepare, progress: progress,
    thx: thx.el, jungle: tracks[0].el,
    playThx: playThx, stopThx: stopThx, playJungle: playJungle, cueJungle: cueJungle,
    staticOn: staticOn, staticLevel: staticLevel, staticOff: staticOff, blip: blip,
    cameraOn: cameraOn, cameraOff: cameraOff,
    latency: latency, handoff: handoff,
    play: play, pause: pause, toggle: toggle, isPlaying: isPlaying,
    _debug: function () {
      return { ctx: ctx ? ctx.state : null, cur: cur, started: started, owned: owned, userPaused: userPaused, xfade: !!xfade,
        camera: !!cameraSrc, cameraBuf: !!cameraBuf, graph: USE_GRAPH,
        decks: allDecks.map(function (d) { return { src: d.el.src.split('/').pop(), local: d.local, paused: d.el.paused, t: +d.el.currentTime.toFixed(2), wanted: d.wanted, vol: +d.vol.toFixed(2), gain: d.gain ? +d.gain.gain.value.toFixed(3) : null, rs: d.el.readyState }; }) };
    }
  };
})();
