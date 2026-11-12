// ============================================================================
//  intro.js — window.INTRO — the gate and the cutscene (styles: css/intro.css, sound: js/player.js).
//
//    INTRO.shouldPlay()            hash is '', '#', '#/' or '#/intro' and the query string has no 'nointro'
//    INTRO.start({ onBam, onDone }) builds a full-screen overlay above the app and runs:
//        gate → terminal → static → CRT off → pre-intro (thx) → intro (jungle, 0:00 → the drop) → BAM
//      onBam() is called in the animation frame at the drop; <html>.intro-active is removed just before it (the app must
//      be visible for its slam-in). The impact itself (flash, shock front, clippings flying) is a set of compositor
//      animations armed a quarter of a second earlier to start on the drop, so it stays on time whatever onBam costs.
//      The clippings finish flying over the app, then the overlay removes itself and onDone() is called.
//
//  The intro step follows the jungle <audio> element's currentTime (read every animation frame). If the audio cannot
//  play or stalls, the same timeline runs on a wall clock instead, so the sequence always completes; the song is then
//  cued at the drop, so whatever starts it later carries on from there. Nothing advances while the tab is hidden.
//  While the overlay is up the page's own elements are inert; an exception anywhere in the frame loop tears the
//  overlay down and calls onBam / onDone (bail()), so the site is never left locked behind it.
//
//  Query-string hooks (development / review):
//    ?t=<seconds>   after the gate tap, start the intro step at that song time      &freeze=1 holds that frame
//    ?phase=gate|terminal|static|pre|intro|bam    after the gate tap, jump to that phase
//    ?fast=1        pre-intro shortened to its last CFG.PRE_FAST seconds
//  INTRO.log  — [{ e, i, perf, song, t }] one entry per reel card ('card'), the impact ('bam', written immediately before
//               onBam is called) and any frame longer than 150 ms ('hitch', i = its length in ms).
//               perf = performance.now(), song = jungle currentTime, t = timeline time (song time minus output latency).
//  INTRO.state() — { phase, t, card, clock }.
// ============================================================================
(function () {
  'use strict';

  /* ======================================================================
     CONFIG — every path, time and duration of the sequence
     ====================================================================== */
  var CFG = {
    media: 'media/',
    videos: [                       // placement of each clipping: css/intro.css (.ix-clip--<id>)
      { id: 'hits-a', file: 'hits-a.mp4' },
      { id: 'hits-b', file: 'hits-b.mp4' },
      { id: 'concert', file: 'concert.mp4' },
      { id: 'guns', file: 'guns.mp4' },
      { id: 'bowling', file: 'bowling.mp4' }
    ],

    // --- jungle.m4a (seconds of song time) ---
    DROP_AT: 31.87,
    SNARE_HITS: [28.24, 28.52, 28.79, 29.05, 29.84, 30.10, 30.35, 30.61, 30.86, 31.12, 31.37, 31.63],
    BARS: [2.26, 4.64, 7.02, 9.40, 11.79, 14.13, 16.48, 18.87, 21.24, 23.62, 26.04],   // riff accents; the last bar ends on the first snare hit
    CARDS_PER_BAR: 4,               // one matchup per beat of the riff (~0.6 s)
    BUILD_CARDS: 5,                 // the last matchups are cut on snare hits, spread evenly over the build
    REEL_MIN_START: 2.2,            // no matchup before the stage has faded in
    FADE_IN: 2.2,                   // the stage fades in over the first seconds of the song
    BUILD_ZOOM: 0.05,               // how far the stage pushes in over the snare build (0 = off)
    BUILD_JOLT: 1,                  // how hard each snare hit knocks the clippings (degrees, grows through the build; 0 = off)

    // --- thx.m4a ---
    THX_END: 14.0,                  // the recording is digitally silent from here to the end of the 21.1 s file
    THX_ENV: [0, .01, .03, .03, .04, .05, .05, .05, .06, .07, .08, .1, .11, .14, .17, .2, .24, .28, .31, .35, .41, .46, .52, .62, .8, .82, .79, .89, .87, .89,
      .87, .86, 1, .99, .88, .85, .8, .74, .83, .68, .64, .73, .67, .64, .6, .58, .47, .37, .25, .16, .14, .1, .07, .04, .02, 0, 0],   // loudness every 0.25 s
    PRE_FAST: 2.2,                  // ?fast=1
    WARM_UP: 1.6,                   // seconds before the end of the pre-intro at which the videos start, still under black

    // --- phase durations (ms) ---
    TERMINAL_MS: 1000,
    STATIC_MS: 1500,
    POWEROFF_MS: 520,
    BAM_MS: 900,                    // overlay is gone this long after the impact
    BAM_ARM: 0.25,                  // this long before the drop the BAM animations are handed to the compositor with the remaining time as their delay
    BAM_LEAD: 0.016,                // the impact is aimed this much ahead of the drop: a frame takes about that long to reach the screen
    GATE_WAIT_MS: 4000,             // longest the play control shows "loading" after the tap before going on anyway
    STALL_MS: 900,                  // audio not advancing for this long → wall clock

    // --- skip ---
    SKIP_HOLD_MS: 2000,
    SKIP_DRAIN_MS: 450,
    SKIP_SEEK_WAIT_MS: 500,         // longest the charged skip waits for the song to seek to the drop

    // --- camera flashes (pops per second of song time) ---
    FLASH_RATE: [[0, 2.2], [9.4, 4.5], [21.2, 6], [28.24, 9]],

    // --- the old site's main screen (ls -la of the ten .rank files), verbatim ---
    OLD: {
      host: 'brookdale@league', path: '~/power-rankings/2026', cmd: 'ls -la --sort=rank', meta: '12 files · bash',
      rows: [
        ['hoes-mad', 'HOES_MAD.rank', 'ANK', '10-4', 'ALL GAS NO BRAKES', '1.4K'],
        ['hammertime', 'HAMMERTIME.rank', 'Caleb', '9-5', 'I\'M GOING TO ASSUME BLIND LUCK', '1.4K'],
        ['mr-glass-reborn', 'MR._GLASS_REBORN.rank', 'Gabe', '9-5', 'HE\'S CHEATING BUT I CAN\'T PROVE IT', '1.4K'],
        ['saxwillruintheleague', 'SAXWILLRUINTHELEAGUE.rank', 'Dale', '8-6', 'I AM INEVITABLE', '1.5K'],
        ['killer-whales', 'KILLER_WHALES.rank', 'Chris', '8-6', 'HE\'S CHEATING AND I CAN PROVE IT', '1.5K'],
        ['schkattebooboo', 'SCHKATTEBOOBOO.rank', 'Ben', '7-7', 'THE OSAMA BIN LADEN OF FANTASY', '1.4K'],
        ['eyes-wide-shut', 'EYES_WIDE_SHUT.rank', 'Van', '7-7', 'NO GAS NO BRAKES', '1.4K'],
        ['dhhate', 'DHHATE.rank', 'Oliver', '5-9', 'GET READY TO GET GOBBLED', '1.4K'],
        ['mac-and-movies', 'MAC_AND_MOVIES.rank', 'Ethan', '5-9', 'HAS HE LOST HIS TOUCH?', '1.4K'],
        ['hogwash', 'HOGWASH.rank', 'Belsky', '2-11-1', 'ALL BRAKES NO GAS', '1.5K']
      ],
      extra: [
        { cls: 'exe', perms: '-rwxr-xr-x', size: '24.0K', rank: 'exe', glyph: '▶︎', file: 'SEASON_SIM.exe', exec: true, owner: 'league', tag: 'roll a 2026 season · 10,000-season monte carlo · toilet bowl' },
        { cls: 'log', perms: '-r-xr-xr-x', size: '38.3K', rank: 'log', glyph: '≡', file: 'LEAGUE_INTEL.log', owner: 'league', tag: 'champions · all-time table · insights · standings grid' }
      ]
    }
  };

  var root = document.documentElement;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var QS = (function () { var o = {}; try { new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); } catch (e) { /* ignore */ } return o; })();

  /* ---------- tiny helpers ---------- */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(p) { return p * p * (3 - 2 * p); }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ======================================================================
     Reel schedule — computed from CFG so every matchup is on screen before the drop
     ====================================================================== */
  function buildSchedule(n) {
    var hits = CFG.SNARE_HITS, drop = CFG.DROP_AT, h0 = hits[0], i, k;
    var nb = Math.min(CFG.BUILD_CARDS, n, hits.length);
    // the build: nb cards spread evenly over [first hit, drop), each snapped to a snare hit
    var build = [], used = -1;
    for (k = 0; k < nb; k++) {
      var ideal = h0 + k * (drop - h0) / nb, best = -1, bd = Infinity;
      for (i = used + 1; i <= hits.length - (nb - k); i++) { var d = Math.abs(hits[i] - ideal); if (d < bd) { bd = d; best = i; } }
      used = best; build.push(hits[best]);
    }
    // before the build: one card per beat of the bar grid, counted back from the first snare hit
    var edges = CFG.BARS.concat([h0]), beats = [];
    for (i = 0; i < edges.length - 1; i++) for (k = 0; k < CFG.CARDS_PER_BAR; k++) beats.push(edges[i] + (edges[i + 1] - edges[i]) * k / CFG.CARDS_PER_BAR);
    beats = beats.filter(function (t) { return t >= CFG.REEL_MIN_START; });
    var m = n - nb, pre = [];
    if (m <= beats.length) pre = beats.slice(beats.length - m);
    else for (i = 0; i < m; i++) pre.push(CFG.REEL_MIN_START + (h0 - CFG.REEL_MIN_START) * i / m);   // more matchups than beats: even spacing
    return pre.concat(build).map(function (t) { return Math.round(t * 1000) / 1000; });
  }

  function matchups() {
    var B = window.BROOKDALE || {}, names = {}, out = [];
    (B.teams || []).forEach(function (t) { names[t.slug] = t.name; });
    ((B.season && B.season.weeks) || []).forEach(function (w) {
      (w.games || []).forEach(function (g) {
        out.push({ week: w.week, a: { name: names[g[0]] || g[0], pts: g[1] }, b: { name: names[g[3]] || g[3], pts: g[4] } });
      });
    });
    return out;
  }

  /* ======================================================================
     Clock — a media element's currentTime, smoothed per frame; wall clock when the element cannot keep time
     ====================================================================== */
  function Clock(el, at) {
    this.el = el; this.t = at || 0; this.mode = el ? 'media' : 'wall';
    this.lastCt = el ? el.currentTime : 0; this.lastWall = performance.now(); this.stall = 0; this.off = 0; this.resync = 0; this.frozen = false;
  }
  Clock.prototype.toWall = function () { this.mode = 'wall'; this.resync = 0; };
  Clock.prototype.tick = function (now, dt) {
    if (this.frozen || document.hidden) return this.t;
    var el = this.el;
    if (this.mode === 'media') {
      var ct = el.currentTime, est;
      if (ct !== this.lastCt) { this.lastCt = ct; this.lastWall = now; this.stall = 0; est = ct; }
      else { this.stall += dt; est = el.paused ? ct : ct + Math.min(now - this.lastWall, 120) / 1000; }
      if (est > this.t) { this.t = est; this.off = 0; }
      else if (est < this.t - 0.4 && !el.seeking) this.off += dt;         // playing, but not where the timeline is (a seek that did not take)
      if ((this.stall + this.off) * 1000 > CFG.STALL_MS && !document.hidden) this.toWall();
    } else {
      this.t += dt;
      if (el) {   // the element came back: bring it to the timeline, then follow it again
        var c = el.currentTime;
        if (!el.paused && c !== this.lastCt) {
          if (Math.abs(c - this.t) < 0.12) { this.mode = 'media'; this.lastWall = now; this.stall = 0; this.off = 0; }
          else if (now - this.resync > 1500) { this.resync = now; try { el.currentTime = this.t + 0.05; } catch (e) { /* ignore */ } }
        }
        this.lastCt = c;
      }
    }
    return this.t;
  };

  /* ======================================================================
     State
     ====================================================================== */
  var started = false, opts = {}, P = null;
  var el = {};                       // DOM handles
  var phase = 'idle', phaseT = 0;    // phaseT: seconds spent in the phase (frames only, so a hidden tab does not count)
  var raf = 0, lastNow = 0;
  var clock = null;                  // drives 'pre' and 'intro'
  var games = [], sched = [], cards = [];
  var reelIdx = -1, barIdx = 0, hitIdx = 0, lastHitT = -10, nextFlash = 0;
  var videos = [];
  var hold = { pointer: false, key: false, charge: 0 };
  var skipDeadline = 0, skipGo = null, skipOff = null;
  var gate = { tapped: false, t0: 0, byKey: false };
  var log = [];
  var rand = rng(20261111);
  var noise = null;                  // { ctx, img, buf32, w, h }
  var dotBorn = 0;                   // seconds into 'pre' — the dot the tube left behind fades from here
  var frameDt = 1 / 60;              // smoothed frame interval (seconds)
  var bammed = false;                // onBam has been called
  var inerted = [];                  // the page's own elements made inert while the overlay is up

  function songNow() { return P && P.jungle ? P.jungle.currentTime : 0; }
  function mark(e, i, t) { log.push({ e: e, i: i, perf: Math.round(performance.now() * 10) / 10, song: Math.round(songNow() * 1000) / 1000, t: Math.round((t == null ? -1 : t) * 1000) / 1000 }); }

  /* ======================================================================
     DOM
     ====================================================================== */
  function grainUrl() {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 128;
      var g = c.getContext('2d'), im = g.createImageData(128, 128), d = im.data, r = rng(7);
      for (var i = 0; i < d.length; i += 4) { var v = r() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.floor(r() * r() * 150); }
      g.putImageData(im, 0, 0);
      return 'url(' + c.toDataURL('image/png') + ')';
    } catch (e) { return 'none'; }
  }

  function buildTerminal() {
    var O = CFG.OLD, B = window.BROOKDALE || {}, img = {};
    (B.teams || []).forEach(function (t) { img[t.slug] = t.profile; });
    function sp(cls, text) { return h('span', cls, text); }
    var screen = h('div', 'ix-screen'), inner = h('div', 'ix-screen-in');
    var pane = h('section', 'ix-pane'), bar = h('div', 'ix-pane-title'), dots = h('span', 'ix-dots'), ttl = h('span', 'ix-ttl');
    add(dots, h('i'), h('i'), h('i'));
    add(ttl, h('b', '', O.host), document.createTextNode(': ' + O.path));
    add(bar, dots, ttl, h('span', 'ix-meta', O.meta));
    var body = h('div', 'ix-pane-body');
    var prompt = h('div', 'ix-prompt');
    add(prompt, sp('host', O.host), document.createTextNode(':'), sp('path', O.path), document.createTextNode('$ '), sp('cmd cur', O.cmd));
    var head = h('div', 'ix-lshead');
    add(head, sp('chk', ''), sp('perms', 'mode'), sp('size', 'size'), sp('rank', 'rank'), sp('thumb', ''), sp('file', 'file'), sp('mgr', 'owner'), sp('rec', 'proj'), sp('tag', 'tagline'));
    var ls = h('div', 'ix-ls');
    function row(d) {
      var r = h('div', 'ix-row' + (d.cls ? ' ' + d.cls : '')), th = h('span', 'thumb');
      if (d.img) { var im = h('img', 'pthumb'); im.alt = ''; im.decoding = 'async'; im.src = d.img; th.appendChild(im); }
      else th.appendChild(sp('noimg', d.glyph || ''));
      var file = h('span', 'file', d.file); if (d.exec) file.appendChild(sp('xtag', '[EXEC]'));
      add(r, sp('chk', '[ ]'), sp('perms', d.perms), sp('size', d.size), sp('rank', d.rank), th, file, sp('br', ''), sp('mgr', d.owner), sp('rec', d.rec || ''), sp('tag', d.tag || ''));
      return r;
    }
    O.rows.forEach(function (r, i) {
      ls.appendChild(row({ perms: '-rw-r--r--', size: r[5], rank: '#' + (i < 9 ? '0' : '') + (i + 1), img: img[r[0]] || '', file: r[1], owner: r[2], rec: r[3], tag: r[4] }));
    });
    O.extra.forEach(function (x) { ls.appendChild(row(x)); });
    add(body, prompt, head, ls); add(pane, bar, body); add(inner, pane);
    var status = h('footer', 'ix-status'), left = h('span', 'sb-left');
    add(left, sp('sb-host', O.host), sp('sb-path', O.path)); status.appendChild(left);
    add(screen, inner, status, h('div', 'ix-scan'));
    return screen;
  }

  function buildCard(m, i, r) {
    var c = h('article', 'ix-card'), inn = h('div', 'ix-card-in'), wk = h('div', 'ix-wk');
    add(wk, document.createTextNode('Week'), h('b', '', String(m.week)));
    var tie = m.a.pts === m.b.pts, first = m.a.pts >= m.b.pts ? m.a : m.b, second = first === m.a ? m.b : m.a;
    function line(side, win) {
      var row = h('div', 'ix-mrow ' + (win ? 'ix-mrow--w' : 'ix-mrow--l')), name = h('div', 'ix-name');
      name.appendChild(h('span', '', side.name)); name._name = side.name; name._win = win;
      add(row, name, h('div', 'ix-pts', Number(side.pts).toFixed(2)));
      return row;
    }
    add(inn, wk, line(first, true), line(second, tie)); c.appendChild(inn);
    c.style.setProperty('--r', ((r() * 2 - 1) * 2.5).toFixed(2) + 'deg');
    c.style.setProperty('--dx', ((r() * 2 - 1) * 2.2).toFixed(2) + '%');
    c.style.setProperty('--dy', Math.round((r() * 2 - 1) * 9) + 'px');
    c.style.zIndex = String(10 + i);
    setSpin(c, r);
    return c;
  }

  function build() {
    var B = window.BROOKDALE || {};
    var o = el.root = h('div', 'intro');
    o.setAttribute('data-phase', 'gate');
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Intro');
    o.style.setProperty('--ix-grain', grainUrl());
    o.style.setProperty('--off-ms', CFG.POWEROFF_MS + 'ms');

    /* terminal world: gate, old list, static, CRT */
    var term = el.term = h('div', 'ix-layer ix-term');
    var tube = el.tube = h('div', 'ix-tube');
    var screen = el.screen = buildTerminal();
    var gA = h('div', 'ix-ghost a'), gB = h('div', 'ix-ghost b');
    gA.appendChild(screen.cloneNode(true)); gB.appendChild(screen.cloneNode(true));
    gA.setAttribute('aria-hidden', 'true'); gB.setAttribute('aria-hidden', 'true');
    el.noise = h('canvas', 'ix-noise');
    add(tube, screen, gA, gB, el.noise);
    var gateEl = h('div', 'ix-gate');
    var play = el.play = h('button', 'ix-play'); play.type = 'button'; play.setAttribute('aria-label', 'Play with sound');
    var pbar = h('span', 'ix-play-bar'); pbar.appendChild(h('i'));
    add(play, h('span', 'ix-c tl', '┌'), h('span', 'ix-c tr', '┐'), h('span', 'ix-c bl', '└'), h('span', 'ix-c br', '┘'), h('span', 'ix-play-tri'), pbar);
    var snd = h('div', 'ix-sound'); add(snd, h('span', 'ix-spk'), h('span', '', 'sound on'));
    add(gateEl, play, snd);
    add(term, tube, h('div', 'ix-line'), gateEl);

    /* pre-intro */
    var pre = h('div', 'ix-layer ix-pre');
    el.glow = h('div', 'ix-glow'); el.beamG = h('div', 'ix-beam g'); el.beamW = h('div', 'ix-beam w');
    add(pre, el.glow, el.beamG, el.beamW);

    /* newspaper stage */
    var stage = el.stage = h('div', 'ix-layer ix-stage');
    var desk = h('div', 'ix-layer ix-desk');
    el.heat = h('div', 'ix-heat');
    el.flashes = h('div', 'ix-flashes');
    el.flashesF = h('div', 'ix-flashes ix-flashes--front');   // light spilling over the clippings
    el.pops = []; el.popsF = [];
    for (var i = 0; i < 10; i++) { var p = h('div', 'ix-pop'); el.flashes.appendChild(p); el.pops.push(p); }
    for (i = 0; i < 6; i++) { p = h('div', 'ix-pop'); el.flashesF.appendChild(p); el.popsF.push(p); }
    var clips = el.clips = h('div', 'ix-clips');
    el.clipEls = [];
    CFG.videos.forEach(function (v) {
      var fig = h('figure', 'ix-clip ix-clip--' + v.id), ph = h('div', 'ix-clip-photo'), vid = document.createElement('video');
      vid.muted = true; vid.defaultMuted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', ''); vid.setAttribute('webkit-playsinline', ''); vid.setAttribute('loop', ''); vid.setAttribute('preload', 'auto');
      vid.setAttribute('disablepictureinpicture', ''); vid.setAttribute('aria-hidden', 'true'); vid.tabIndex = -1;
      vid.addEventListener('error', function () { fig.classList.add('ix-clip--dead'); });   // no file: no empty frame on the desk
      vid.src = CFG.media + v.file;
      ph.appendChild(vid); fig.appendChild(ph); clips.appendChild(fig);
      videos.push(vid); el.clipEls.push(fig); setSpin(fig, rand);
    });
    var reel = el.reel = h('div', 'ix-reel');
    var title = el.title = h('article', 'ix-card ix-title'), tin = h('div', 'ix-card-in');
    add(tin, h('div', 'ix-mast', B.league || ''), h('div', 'ix-ed', (B.edition && B.edition.title) || ''));
    title.appendChild(tin); title.style.setProperty('--r', '-1.2deg'); title.style.zIndex = '9'; setSpin(title, rand);
    reel.appendChild(title);
    var r = rng(4510);
    games.forEach(function (m, k) { var c = buildCard(m, k, r); cards.push(c); reel.appendChild(c); });
    el.measure = h('span', 'ix-measure'); reel.appendChild(el.measure);
    clips.appendChild(reel);
    add(stage, desk, el.heat, el.flashes, clips, el.flashesF);

    /* BAM */
    var bamEl = el.bam = h('div', 'ix-layer ix-bam');
    var burst = h('div', 'ix-burst'), burstR = h('div', 'ix-burst r');
    burst.style.clipPath = burst.style.webkitClipPath = starPath(31, 14, 0.66, 0.8);
    burstR.style.clipPath = burstR.style.webkitClipPath = starPath(31, 14, 0.66, 0.9);
    el.scraps = buildScraps();
    el.scraps.forEach(function (sc) { bamEl.appendChild(sc); });
    add(bamEl, burstR, burst, h('div', 'ix-white'));

    /* skip */
    var skip = el.skip = h('button', 'ix-skip'); skip.type = 'button'; skip.setAttribute('aria-label', 'Hold to skip the intro');
    var fill = h('span', 'ix-skip-fill', 'hold to skip'); fill.setAttribute('aria-hidden', 'true');
    add(skip, h('span', 'ix-skip-label', 'hold to skip'), fill);

    [tube, pre, stage, bamEl].forEach(function (x) { x.setAttribute('aria-hidden', 'true'); });   // picture only; the two controls stay reachable
    add(o, term, pre, stage, bamEl, skip);
    document.body.appendChild(o);
  }

  /* ---------- layout: units + headline fitting ---------- */
  var nameEm = {};
  function layout() {
    var o = el.root;
    if (!o || phase === 'done') return;
    var w = o.clientWidth, hh = o.clientHeight;
    if (!w || !hh) return;
    el.W = w; el.H = hh;
    o.style.setProperty('--vw', (w / 100) + 'px');
    o.style.setProperty('--vh', (hh / 100) + 'px');
    o.style.setProperty('--vmax', Math.max(w, hh) + 'px');
    el.clipEls.forEach(function (c) { c._cx = c.offsetLeft + c.offsetWidth / 2; c._cy = c.offsetTop + c.offsetHeight / 2; });   // where each clipping lies
    aimFlight();
    var rw = el.reel.offsetWidth;
    if (!rw) return;
    var cu = rw / 100;
    o.style.setProperty('--cu', cu + 'px');
    // headline fit: each team name as large as its column allows, capped
    nameEm = {};
    var names = el.reel.querySelectorAll('.ix-name'), i, n;
    for (i = 0; i < names.length; i++) { n = names[i]; n.style.fontSize = ''; }
    var widths = [];
    for (i = 0; i < names.length; i++) widths.push(names[i].clientWidth);
    for (i = 0; i < names.length; i++) {
      n = names[i];
      if (!(n._name in nameEm)) { el.measure.textContent = n._name; nameEm[n._name] = el.measure.offsetWidth / 100; }
      var max = cu * (n._win ? 13 : 8.4), fit = nameEm[n._name] > 0 ? (widths[i] - 1) / nameEm[n._name] : max;
      n.style.fontSize = Math.max(8, Math.min(max, fit)).toFixed(2) + 'px';
    }
    // the title card's two lines never overflow it
    var lines = el.title.querySelectorAll('.ix-mast, .ix-ed');
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i]; ln.style.fontSize = '';
      if (ln.scrollWidth > ln.clientWidth + 1) ln.style.fontSize = (parseFloat(getComputedStyle(ln).fontSize) * ln.clientWidth / ln.scrollWidth * 0.985).toFixed(2) + 'px';
    }
    if (noise) sizeNoise();
  }

  /* ======================================================================
     Static noise (small canvas, scaled up pixelated)
     ====================================================================== */
  function sizeNoise() {
    var W = Math.max(1, el.W), c = el.noise, w = clamp(Math.round(W / 3.4), 128, 440), hgt = clamp(Math.round(w * el.H / W), 60, 440);
    if (noise && noise.w === w && noise.h === hgt) return;
    c.width = w; c.height = hgt;
    var g = c.getContext('2d'); if (!g) { noise = null; return; }
    var img = g.createImageData(w, hgt);
    noise = { g: g, img: img, buf: new Uint32Array(img.data.buffer), w: w, h: hgt };
  }
  function drawNoise(band) {
    if (!noise) return;
    var b = noise.buf, n = b.length, w = noise.w, i, v;
    for (i = 0; i < n; i++) { v = (Math.random() * 255) | 0; b[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
    if (band) {   // a brighter rolling bar
      var y0 = ((Math.random() * noise.h) | 0), rows = 3 + ((Math.random() * 10) | 0), end = Math.min(n, (y0 + rows) * w);
      for (i = y0 * w; i < end; i++) b[i] = 0xffffffff;
    }
    noise.g.putImageData(noise.img, 0, 0);
  }

  /* ======================================================================
     Camera flashes
     ====================================================================== */
  /* Flash pops, jolts, flying clippings and scraps are all CSS animations fed by custom properties: starting one is a
     style write and a class flip (two identical keyframe sets, a/b, so flipping restarts it) with nothing read back. */
  var popI = 0;
  function pop(strength, big, front) {
    if (REDUCED) return;
    var pool = front ? el.popsF : el.pops; if (!pool.length) return;
    var p = pool[popI++ % pool.length], W = el.W, H = el.H, m = Math.min(W, H);
    var size = m * (big ? 0.6 + Math.random() * 0.5 : 0.26 + Math.random() * 0.36);
    p.style.cssText = '--px:' + (Math.random() * W).toFixed(0) + 'px;--py:' + (Math.random() * H).toFixed(0) + 'px;--ps:' + (size / 100).toFixed(3) +
      ';--po:' + (clamp(strength, 0, 1) * (front ? 0.5 : 1)).toFixed(2) + ';--pd:' + (170 + Math.random() * 190).toFixed(0) + 'ms';
    p._b = !p._b; p.className = 'ix-pop ' + (p._b ? 'b' : 'a');
  }
  function flashRate(t) { var r = CFG.FLASH_RATE, v = r[0][1]; for (var i = 0; i < r.length; i++) if (t >= r[i][0]) v = r[i][1]; return v; }
  function flashTick(t) {
    if (t < 0.6) return;
    if (nextFlash < t - 1) nextFlash = t;
    var guard = 0;
    while (t >= nextFlash && guard++ < 4) {
      pop(0.6 + Math.random() * 0.4, Math.random() < 0.14, false);
      if (Math.random() < 0.45) pop(0.6 + Math.random() * 0.4, false, true);
      if (Math.random() < 0.3) pop(0.5 + Math.random() * 0.4, false, false);   // photographers fire in pairs
      nextFlash += -Math.log(1 - Math.random() * 0.999) / flashRate(t);
    }
  }
  function jolt(amount) {
    if (REDUCED || !(amount > 0)) return;
    el.clipEls.forEach(function (c, i) {
      c.style.setProperty('--jd', (((i % 2) ? 1 : -1) * amount * (0.6 + Math.random() * 0.8)).toFixed(2) + 'deg');
      c._b = !c._b; c.classList.toggle('ja', !c._b); c.classList.toggle('jb', c._b);
    });
  }

  /* ======================================================================
     Reel
     ====================================================================== */
  var KEEP = 4;   // cards left in the pile under the top one
  function showCard(i, animate) {
    var k;
    for (k = 0; k < cards.length; k++) {
      var c = cards[k], on = k <= i && k > i - KEEP;
      if (on) {
        if (!c.classList.contains('on')) { c.classList.add('on'); if (!animate || k !== i) c.classList.add('still'); }
        if (k < i) { c.classList.add('under'); c.classList.add('still'); } else c.classList.remove('under');
      } else if (c.classList.contains('on')) c.classList.remove('on', 'under', 'still');
    }
    el.title.style.visibility = i >= KEEP - 1 ? 'hidden' : '';
    el.title.classList.toggle('under', i >= 0);
    reelIdx = i;
  }
  function countLE(arr, t) { var n = 0; while (n < arr.length && arr[n] <= t) n++; return n; }

  /* ======================================================================
     Phases
     ====================================================================== */
  function setPhase(p) { phase = p; phaseT = 0; el.root.setAttribute('data-phase', p); }

  function enterTerminal() { setPhase('terminal'); }

  function enterStatic() {
    setPhase('static');
    sizeNoise();
    P.staticOn(0.35);
  }
  function tickStatic() {
    var p = clamp(phaseT * 1000 / CFG.STATIC_MS, 0, 1), burst = Math.random();
    drawNoise(p > 0.3 && burst > 0.5);
    var o = 0.1 + 0.7 * p * p + (burst > 0.82 ? 0.3 : 0) * (0.4 + p);
    el.noise.style.opacity = clamp(o, 0, 0.96).toFixed(3);
    if (!REDUCED) {
      var amp = 2 + 26 * p * p, tear = burst > 0.7 - 0.35 * p;
      var tx = tear ? (Math.random() * 2 - 1) * amp : 0, ty = (p > 0.75 && burst > 0.6) ? (Math.random() * 2 - 1) * 40 * p : 0;
      el.screen.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px)' + (tear && p > 0.4 ? ' skewX(' + ((Math.random() * 2 - 1) * 5 * p).toFixed(2) + 'deg)' : '');
      el.screen.style.filter = burst > 0.88 ? 'brightness(' + (1.6 + p).toFixed(2) + ') contrast(1.4)' : (burst < 0.06 + 0.1 * p ? 'brightness(.25)' : '');
    }
    P.staticLevel(0.3 + 0.7 * p + (burst > 0.8 ? 0.5 : 0));
    if (phaseT * 1000 >= CFG.STATIC_MS) enterOff();
  }

  function enterOff() {
    el.screen.style.transform = ''; el.screen.style.filter = '';
    setPhase('off');
    P.staticOff(); P.blip();
  }

  function dropTerminal() {      // the terminal world is not coming back: take its DOM (three copies of the list) out of the document
    if (el.term && el.term.parentNode) el.term.parentNode.removeChild(el.term);
    el.term = null; noise = null;
  }
  function enterPre() {
    setPhase('pre');
    dropTerminal();
    el.root.classList.add('ix-stage-on');           // the stage is laid out (invisible) from here on
    var at = QS.fast ? Math.max(0, CFG.THX_END - CFG.PRE_FAST) : 0;
    clock = new Clock(P.thx, at);
    dotBorn = at;
    P.playThx(at).then(function (ok) {
      if (ok || !clock || clock.el !== P.thx || phase !== 'pre') return;
      clock.toWall();                                // the sound cannot play: nothing to wait for, go on to the fade-in
      clock.t = Math.max(clock.t, CFG.THX_END - CFG.WARM_UP);
    });
    beam(at);
  }
  var runMax = 0;
  function thxEnv(t) {
    var e = CFG.THX_ENV, x = t / 0.25, i = Math.floor(x);
    if (i < 0) return 0; if (i >= e.length - 1) return 0;
    return e[i] + (e[i + 1] - e[i]) * (x - i);
  }
  /** The dot left by the dead tube; the sound stretches it into a line and lights it. */
  function beam(t) {
    var env = thxEnv(t);
    if (env > runMax) runMax = env;
    var dot = Math.exp(-(t - dotBorn) / 0.9);                 // afterglow of the power-off
    var W = el.W * 0.86, minK = 7 / W;
    var k = minK + (1 - minK) * ease(clamp(runMax * 1.08, 0, 1));
    var bright = clamp(Math.max(dot, Math.pow(env, 0.6)), 0.05, 1);
    var warm = ease(clamp(runMax * 1.4, 0, 1));               // phosphor green → paper white as it grows
    var tf = 'scaleX(' + k.toFixed(4) + ') scaleY(' + (1 + env * 1.6).toFixed(3) + ')';
    el.beamG.style.transform = tf; el.beamW.style.transform = tf;
    el.beamG.style.opacity = (bright * (1 - warm)).toFixed(3);
    el.beamW.style.opacity = (bright * warm).toFixed(3);
    el.glow.style.transform = 'scaleX(' + k.toFixed(4) + ') scaleY(' + (0.25 + env * 0.75).toFixed(3) + ')';
    el.glow.style.opacity = (env * env * 0.9).toFixed(3);
  }
  var warmed = false;
  /** Start the five videos and get every layer of the stage rasterized while it is still (all but) invisible. */
  function warm() {
    if (warmed) return; warmed = true;
    el.root.classList.add('ix-stage-on');
    if (parseFloat(el.stage.style.opacity || 0) < 0.004) el.stage.style.opacity = '0.004';
    playVideos();
  }
  function playVideos() { videos.forEach(function (v) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }); }
  function tickPre(now, dt) {
    var t = clock.tick(now, dt);
    beam(t);
    if (t >= CFG.THX_END - CFG.WARM_UP) warm();
    if (t >= CFG.THX_END || P.thx.ended) enterIntro(0, false);
  }

  function enterIntro(at, freeze) {
    P.stopThx(0.25); P.staticOff();
    el.root.classList.add('ix-stage-on');
    el.root.setAttribute('data-skin', 'paper');
    setPhase('intro');
    dropTerminal();
    warm(); playVideos();
    clock = new Clock(P.jungle, at);
    barIdx = countLE(CFG.BARS, at); hitIdx = countLE(CFG.SNARE_HITS, at); nextFlash = at;
    lastHitT = hitIdx ? CFG.SNARE_HITS[hitIdx - 1] : -10;
    showCard(countLE(sched, at) - 1, false);
    if (freeze) { clock.frozen = true; clock.t = at; P.cueJungle(at); }
    else {
      P.playJungle(at, at < 0.5 ? 0.6 : 0.05).then(function (ok) { if (!ok && clock && clock.el === P.jungle) clock.toWall(); });
      P.cameraOn(at < 0.5 ? 2 : 0.3);
    }
    stageAt(at);
  }
  function stageAt(t) {
    var f = clamp(t / CFG.FADE_IN, 0, 1);
    el.stage.style.opacity = f >= 1 ? '1' : Math.max(0.004, ease(f)).toFixed(3);
    if (f >= 1 && !el.open) { el.open = true; el.root.classList.add('ix-open'); }   // the desk covers everything now: drop the overlay's own black
    // the beam dissolves as the stage comes up
    var pf = clamp(1 - t / 0.7, 0, 1);
    if (pf > 0) { el.beamG.style.opacity = (parseFloat(el.beamG.style.opacity || 0) * pf).toFixed(3); el.beamW.style.opacity = (parseFloat(el.beamW.style.opacity || 0) * pf).toFixed(3); el.glow.style.opacity = '0'; }
    else if (el.beamW.style.display !== 'none') { el.beamG.style.display = el.beamW.style.display = el.glow.style.display = 'none'; }
    // the build: push in a little on every snare hit, then pull back before the drop
    var hits = CFG.SNARE_HITS, h0 = hits[0], last = hits[hits.length - 1], s = 1, heat = 0;
    if (t >= h0) {
      var bp = clamp((t - h0) / (CFG.DROP_AT - h0), 0, 1);
      s = 1 + CFG.BUILD_ZOOM * (bp + 0.45 * Math.exp(-(t - lastHitT) / 0.07));
      heat = 0.75 * bp * bp;
      if (t > last) { var q = clamp((t - last) / (CFG.DROP_AT - last), 0, 1); s *= 1 - CFG.BUILD_ZOOM * 1.7 * q * q; heat *= 1 - 0.6 * q; }
      if (CFG.BUILD_ZOOM) el.clips.style.transform = 'scale(' + s.toFixed(4) + ')';
    } else if (el.clips.style.transform) el.clips.style.transform = '';
    el.heat.style.opacity = heat.toFixed(3);
  }
  function tickIntro(now, dt) {
    var raw = clock.tick(now, dt);
    var t = clock.mode === 'media' ? raw - P.latency() : raw;   // what is being heard right now
    while (reelIdx + 1 < sched.length && t >= sched[reelIdx + 1]) { showCard(reelIdx + 1, true); mark('card', reelIdx, t); }
    while (barIdx < CFG.BARS.length && t >= CFG.BARS[barIdx]) { barIdx++; pop(1, true, false); pop(0.9, false, true); pop(0.8, false, false); }
    while (hitIdx < CFG.SNARE_HITS.length && t >= CFG.SNARE_HITS[hitIdx]) {
      lastHitT = CFG.SNARE_HITS[hitIdx]; hitIdx++;
      pop(1, true, false); pop(1, false, true); pop(0.9, false, false); pop(0.8, true, true);
      jolt(CFG.BUILD_JOLT * (0.5 + hitIdx * 0.12));
    }
    flashTick(t);
    stageAt(t);
    if (!armed && !clock.frozen && t >= CFG.DROP_AT - CFG.BAM_ARM) arm((CFG.DROP_AT - CFG.BAM_LEAD - t) * 1000);
    if (t >= CFG.DROP_AT - CFG.BAM_LEAD - frameDt / 2) bam(t);   // the frame nearest the drop, not the first one past it
  }

  /* ======================================================================
     BAM
     ====================================================================== */
  /** A zigzag band: the shock front. polygon(evenodd) = a star + the same star smaller, so the page shows through the middle. */
  function starPath(seed, spikes, inner, hole) {
    var r = rng(seed), outer = [], n = spikes * 2, i, a, rad;
    for (i = 0; i < n; i++) {
      a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.1; rad = (i % 2 ? inner * (0.85 + r() * 0.3) : 0.74 + r() * 0.26) * 50;
      outer.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    function pt(p, k) { return (50 + p[0] * k).toFixed(2) + '% ' + (50 + p[1] * k).toFixed(2) + '%'; }
    var pts = outer.map(function (p) { return pt(p, 1); }); pts.push(pt(outer[0], 1));
    outer.forEach(function (p) { pts.push(pt(p, hole)); }); pts.push(pt(outer[0], hole));
    return 'polygon(evenodd,' + pts.join(',') + ')';
  }
  /** Start every BAM animation (flash, shock front, shake, clippings / cards / scraps flying off) `delayMs` from now.
   *  They are CSS animations of transform and opacity only, so once started they are timed by the compositor: the
   *  impact lands on the drop even if the main thread is busy at that moment (css/intro.css section 7). */
  var armed = false;
  function arm(delayMs) {
    if (armed) return; armed = true;
    el.root.style.setProperty('--bam-delay', Math.max(0, delayMs).toFixed(0) + 'ms');
    el.root.classList.add('ix-stage-on', 'ix-bam-on');
  }
  function bam(t) {
    if (phase === 'bam' || phase === 'done') return;
    var from = phase;
    if (!armed) { el.clips.style.transform = ''; el.stage.style.opacity = '1'; arm(0); }   // skip, or a frame so long it jumped the arming window
    mark('bam', -1, t);
    setPhase('bam');
    release();                                            // the app is on screen from this frame on
    if (!bammed) { bammed = true; try { if (opts.onBam) opts.onBam(); } catch (e) { if (window.console) console.error(e); } }
    P.cameraOff(1.2);
    if (from === 'skip') { P.staticOff(); P.stopThx(0.1); }
    else if (Math.abs(songNow() - CFG.DROP_AT) > 0.4) P.cueJungle(CFG.DROP_AT);   // the song was not keeping up (stalled, or not allowed to play): it goes on from the drop, like the page
    P.handoff();
  }
  function buildScraps() {
    var kinds = ['', 'ln', '', 'p2', 'ln', 'k', 'r'], out = [];
    if (REDUCED) return out;
    for (var i = 0; i < 18; i++) {
      var s = h('i', 'ix-scrap ' + kinds[i % kinds.length]), big = i % 4 === 1, w = big ? 60 + rand() * 90 : 10 + rand() * 44, hh = big ? 40 + rand() * 60 : 6 + rand() * 30;
      s.style.width = w.toFixed(0) + 'px'; s.style.height = hh.toFixed(0) + 'px'; s.style.margin = (-hh / 2).toFixed(0) + 'px 0 0 ' + (-w / 2).toFixed(0) + 'px';
      s._a = rand() * Math.PI * 2; s._d = 0.4 + rand() * 0.7;
      s.style.setProperty('--fr', ((rand() * 2 - 1) * 800).toFixed(0) + 'deg');
      s.style.setProperty('--fd', (560 + rand() * 320).toFixed(0) + 'ms');
      out.push(s);
    }
    return out;
  }
  /** Where everything goes at the BAM: straight out from the middle of the screen, spinning. Set as custom properties
   *  whenever the layout changes, so the impact frame itself only has to flip a class. */
  function aimFlight() {
    var cx = el.W / 2, cy = el.H / 2, far = Math.max(el.W, el.H);
    function aim(f, dx, dy, dist) {
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      f.style.setProperty('--fx', (dx / len * dist).toFixed(0) + 'px');
      f.style.setProperty('--fy', (dy / len * dist).toFixed(0) + 'px');
    }
    el.clipEls.forEach(function (c) { aim(c, c._cx - cx, c._cy - cy, far * c._fd); });
    cards.concat([el.title]).forEach(function (c) { aim(c, Math.cos(c._fa), Math.sin(c._fa), far * c._fd); });
    (el.scraps || []).forEach(function (s) { aim(s, Math.cos(s._a), Math.sin(s._a), far * s._d); });
  }
  function setSpin(f, r) {
    f._fd = f.classList.contains('ix-card') ? 0.8 + r() * 0.4 : 0.5 + r() * 0.16; f._fa = r() * Math.PI * 2;
    f.style.setProperty('--fr', ((r() < 0.5 ? -1 : 1) * (150 + r() * 330)).toFixed(0) + 'deg');
    f.style.setProperty('--fd', (680 + r() * 200).toFixed(0) + 'ms');
  }
  function finish() {
    if (phase === 'done') return;
    phase = 'done';
    el.root.setAttribute('data-phase', 'done');
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('resize', layout);
    window.removeEventListener('orientationchange', layout);
    document.removeEventListener('visibilitychange', onVisible);
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', layout);
    if (skipOff) skipOff();
    var vids = videos; videos = [];
    vids.forEach(function (v) { try { v.pause(); } catch (e) { /* ignore */ } });
    release();
    if (el.root && el.root.parentNode) el.root.parentNode.removeChild(el.root);
    el = {}; cards = []; noise = null; hold.pointer = hold.key = false; hold.charge = 0; clock = clock ? { t: clock.t, mode: clock.mode } : null;   // nothing keeps the overlay's DOM alive
    setTimeout(function () { vids.forEach(function (v) { try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ } }); vids = []; }, 1500);   // free the decoders once the page has settled
    var done = opts.onDone; opts = {};
    try { if (done) done(); } catch (e) { if (window.console) console.error(e); }
  }
  /** The overlay no longer owns the page: the app can be seen, scrolled and used. */
  function release() {
    root.classList.remove('intro-active');
    inerted.forEach(function (n) { try { n.inert = false; } catch (e) { /* ignore */ } });
    inerted = [];
  }
  /** Something in the sequence threw: never leave the site locked behind a broken overlay. */
  function bail(err) {
    if (window.console) console.error('[INTRO]', err);
    try { release(); } catch (e) { /* ignore */ }
    if (!bammed) { bammed = true; try { if (opts.onBam) opts.onBam(); } catch (e) { /* ignore */ } }
    try { P.staticOff(); P.stopThx(0); P.cameraOff(0.2); P.handoff(); } catch (e) { /* ignore */ }
    try { finish(); } catch (e) {
      phase = 'done'; cancelAnimationFrame(raf); raf = 0;
      var o = document.querySelector('.intro'); if (o && o.parentNode) o.parentNode.removeChild(o);
    }
  }

  /* ======================================================================
     Skip (press and hold)
     ====================================================================== */
  function skip() {
    if (phase === 'gate' || phase === 'skip' || phase === 'bam' || phase === 'done' || phase === 'idle' || armed) return;
    var j = P.jungle, fired = false;
    setPhase('skip');
    dropTerminal();
    el.root.classList.add('ix-stage-on');
    P.staticOff(); P.stopThx(0.12);
    skipOff = function () { j.removeEventListener('seeked', onSeeked); skipOff = null; skipGo = null; };
    skipGo = function () {
      if (fired) return; fired = true;
      skipOff();
      P.playJungle(CFG.DROP_AT, 0);
      bam(CFG.DROP_AT);
    };
    function onSeeked() { if (Math.abs(j.currentTime - CFG.DROP_AT) < 0.25) skipGo && skipGo(); }
    j.addEventListener('seeked', onSeeked);
    P.cueJungle(CFG.DROP_AT);
    skipDeadline = CFG.SKIP_SEEK_WAIT_MS / 1000;
  }
  function bindSkip() {
    var b = el.skip;
    function down(e) { if (e.button != null && e.button > 0) return; hold.pointer = true; try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } e.preventDefault(); }
    function up() { hold.pointer = false; }
    if (window.PointerEvent) {
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    } else {
      b.addEventListener('mousedown', function (e) { hold.pointer = true; e.preventDefault(); });
      window.addEventListener('mouseup', up);
    }
    b.addEventListener('touchend', up); b.addEventListener('touchcancel', up);
    b.addEventListener('touchstart', function (e) { hold.pointer = true; if (e.cancelable) e.preventDefault(); }, { passive: false });   // no long-press callout / magnifier
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) { e.preventDefault(); });
    b.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) hold.key = true; } });
    b.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') { e.preventDefault(); hold.key = false; } });
    b.addEventListener('blur', function () { hold.key = false; });
  }
  function tickSkip(dt) {
    if (phase === 'gate' || phase === 'skip' || phase === 'bam' || phase === 'done') return;
    var holding = hold.pointer || hold.key, before = hold.charge;
    if (holding) hold.charge = Math.min(1, hold.charge + dt * 1000 / CFG.SKIP_HOLD_MS);
    else if (hold.charge > 0) hold.charge = Math.max(0, hold.charge - dt * 1000 / CFG.SKIP_DRAIN_MS);
    if (hold.charge !== before) { el.skip.style.setProperty('--charge', hold.charge.toFixed(4)); el.skip.classList.toggle('is-hot', hold.charge > 0); }
    if (hold.charge >= 1) skip();
  }

  /* ======================================================================
     Gate
     ====================================================================== */
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var wants = ['500 13px "IBM Plex Mono"', '400 40px "Anton"', '700 40px "UnifrakturCook"', 'italic 900 40px "Playfair Display"'];
    return Promise.all(wants.map(function (f) { return document.fonts.load(f).catch(function () {}); })).then(function () { layout(); });
  }
  var fontsDone = false;
  function gateReady() { return fontsDone && P.progress() >= 0.66; }
  function onGateTap(e) {
    if (gate.tapped) return;
    gate.tapped = true; gate.t0 = performance.now();
    gate.byKey = !!e && e.detail === 0;                            // Enter / Space on the focused control
    P.unlock();                                                    // AudioContext + every <audio>, inside the gesture
    videos.forEach(function (v) {                                  // and every <video>
      try { var p = v.play(); if (p && p.then) p.then(function () { if (!warmed) v.pause(); }, function () {}); } catch (e) { /* ignore */ }
    });
    if (gateReady()) leaveGate();
  }
  function tickGate(now) {
    if (!gate.tapped) return;
    var waited = now - gate.t0;
    if (gateReady() || waited >= CFG.GATE_WAIT_MS) { leaveGate(); return; }
    if (waited > 250) {                                             // real loading state, only when it is actually needed
      el.play.classList.add('is-loading');
      el.play.style.setProperty('--p', clamp(Math.max(P.progress(), waited / CFG.GATE_WAIT_MS), 0, 1).toFixed(3));
    }
  }
  function leaveGate() {
    el.play.blur();
    var at = QS.t != null && QS.t !== '' ? parseFloat(QS.t) : NaN;
    if (isFinite(at)) { enterIntro(clamp(at, 0, CFG.DROP_AT + 5), !!QS.freeze); return; }
    switch (QS.phase) {
      case 'static': enterStatic(); break;
      case 'pre': enterPre(); break;
      case 'intro': enterIntro(0, false); break;
      case 'bam': setPhase('terminal'); skip(); break;
      default: enterTerminal();
    }
    // started from the keyboard: the skip control takes the focus, so Space / Enter can be held straight away
    try { if (gate.byKey && el.skip && phase !== 'bam' && phase !== 'done') el.skip.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  /* ======================================================================
     Main loop
     ====================================================================== */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { lastNow = now; return; }   // nothing moves while the tab is hidden (most browsers send no frames then anyway)
    var dt = Math.min(0.5, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
    if (dt > 0.15 && phase !== 'gate') mark('hitch', Math.round(dt * 1000), clock ? clock.t : null);   // a long frame (diagnostic)
    if (dt > 0) frameDt += (clamp(dt, 1 / 240, 0.05) - frameDt) * 0.2;
    phaseT += dt;
    try {
      switch (phase) {
        case 'gate': tickGate(now); break;
        case 'terminal': if (phaseT * 1000 >= CFG.TERMINAL_MS) enterStatic(); break;
        case 'static': tickStatic(); break;
        case 'off': if (phaseT * 1000 >= CFG.POWEROFF_MS) enterPre(); break;
        case 'pre': tickPre(now, dt); break;
        case 'intro': tickIntro(now, dt); break;
        case 'skip': if (phaseT >= skipDeadline && skipGo) skipGo(); break;
        case 'bam': if (phaseT * 1000 >= CFG.BAM_MS) finish(); break;
      }
      tickSkip(dt);
    } catch (e) { bail(e); }
  }
  function onVisible() {
    if (document.hidden) {
      hold.pointer = hold.key = false;
      videos.forEach(function (v) { try { v.pause(); } catch (e) { /* ignore */ } });   // nothing decodes while nobody is looking
      return;
    }
    lastNow = performance.now();
    if (phase === 'intro' || (phase === 'pre' && warmed)) playVideos();
  }

  /* ======================================================================
     Public
     ====================================================================== */
  function shouldPlay() {
    var hash = location.hash || '';
    if (hash !== '' && hash !== '#' && hash !== '#/' && hash !== '#/intro') return false;
    return !/(^|[?&])nointro(=|&|$)/.test(location.search || '');
  }
  function start(o) {
    if (started) return;
    started = true; opts = o || {};
    P = window.PLAYER;
    if (!P || !document.body) { started = false; try { if (opts.onBam) opts.onBam(); if (opts.onDone) opts.onDone(); } catch (e) { /* ignore */ } return; }
    games = matchups();
    sched = buildSchedule(games.length);
    root.classList.add('intro-active');
    build();
    // the page under the overlay cannot be tabbed into or read out until the BAM
    try {
      if ('inert' in HTMLElement.prototype) [].forEach.call(document.body.children, function (n) {
        if (n === el.root || n.inert || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(n.tagName)) return;
        n.inert = true; inerted.push(n);
      });
    } catch (e) { /* ignore */ }
    layout();
    bindSkip();
    P.prepare();
    fontsReady().then(function () { fontsDone = true; });
    setTimeout(function () { fontsDone = true; }, 2500);
    el.play.addEventListener('click', onGateTap);
    try { el.play.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', layout);
    document.addEventListener('visibilitychange', onVisible);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', layout);   // a font that arrives late: fit the names again
    phase = 'gate'; phaseT = 0; lastNow = performance.now();
    raf = requestAnimationFrame(frame);
  }

  window.INTRO = {
    shouldPlay: shouldPlay,
    start: start,
    log: log,
    config: CFG,
    schedule: function () { return (sched.length ? sched : buildSchedule(matchups().length)).slice(); },
    state: function () { return { phase: phase, t: clock ? Math.round(clock.t * 1000) / 1000 : null, card: reelIdx, clock: clock ? clock.mode : null, charge: hold.charge }; }
  };
})();
