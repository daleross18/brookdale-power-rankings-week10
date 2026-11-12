// ============================================================================
//  clutter.js — window.CLUTTER: the collage of print-shop debris AROUND the real content of every view.
//
//  Two phases (the user's words): "static page elements that animate on hover, and randomly animating elements popping
//  in and out all around screen. page should feel very cluttered all around main content but main content not covered".
//    static pieces    sit still; play a held-frame ("on twos") animation while the pointer is over them / when tapped
//    ambient pieces   snap in on a few held frames, sit, glitch once, snap out, rest, come back — each on its own clock
//
//  HOW THE CONTENT STAYS UNCOVERED (three independent guards)
//    1. z-order   every piece lives in a layer with z-index:-1 inside its host's stacking context (the page: #app in
//                 body's context; each .desk in its own). A negative layer paints above the host's background and
//                 below ALL of its content, so wherever a piece and content overlap, the piece is the hidden one.
//    2. layout    pieces are placed from a measurement of the real page: every content box is rasterised onto an
//                 occupancy grid ("hard" = text / tables / controls that sit on bare paper, "cover" = opaque things
//                 such as clippings and photos). Pieces are anchored on free cells. Each piece is a child of a REGION — a
//                 rectangle that contains no hard cell, with overflow hidden — so it cannot show behind bare text even
//                 when it is larger than the gap it sits in (that is the "tucked under the edge" look).
//    3. input     nothing here takes pointer events (pointer-events:none on the layers and everything in them).
//                 Hover / tap is found by arithmetic on pointer coordinates against the same grid, so taps always
//                 reach the content.
//  The layers are absolutely positioned, clipped and `contain: strict`: no layout shift, no extra scroll area.
//
//  WHEN IT RUNS   Nothing while html.intro-active or html.slamming is set; pieces burst in when both are gone (and the
//                 web fonts are in). Re-measured, debounced, on route change, resize, images settling and whenever the
//                 view's DOM changes. When the page changes SIZE (an expander, a simulated season) the layers go out of
//                 sight in that same frame, pieces that would now sit behind bare text are retired, and the rest comes
//                 back once the size has been still for ~150 ms. When only WORDS change (a label, a readout), the
//                 pieces those words now reach are retired before that frame is painted, and the page is re-measured. Planning is time-sliced (one category of one host per
//                 unit, yielding every ~10 ms); a piece that has not moved keeps its DOM node, so nothing flickers.
//  SCROLLING      No layout is read while scrolling. One sentinel per band of the page is watched by two
//                 IntersectionObservers: bands near the viewport have their pieces in the DOM (built a batch a frame),
//                 bands in it are "awake" (ambient scheduling, hover). Each video clipping has its own observer and
//                 holds a canvas only while part of it is on screen. On phones, while the page is actually scrolling:
//                 the reel is held, no canvas is created or drawn, nothing pops and nothing is re-measured; clippings
//                 that scrolled in get their pictures (two a beat) once it stops — "stopped" adapts to the frame rate,
//                 so slow frames never make the reel stop-start. One timer drives everything ambient; it stops when
//                 the tab is hidden and under html.reduce (everything still, ambient pieces simply stay put).
//
//  CLIPS          The eleven ATLAS clips, each its own slanted clipping with the cutscene's grain. A clip is repeated
//                 only when more than eleven clippings are on screen; where a screen has room for fewer, the clippings
//                 flip through the rest of the reel. A clipping is out of sight (.cl-blank) until its own canvas holds
//                 a picture — taken at once from a kept still of the reel — so no empty frame ever shows.
//  GUTTERS        Where the only free room is a gutter narrower than a piece (phones: ~12px each side; a full-width
//                 table on desktop), clips, photos and shapes bleed off the side of the sheet and a slice shows.
//  WORDS          Every string printed on a piece is read from BROOKDALE / HISTORY for the current route (scores, W/L,
//                 records, ranks, week labels, team names and codes, taglines, managers, the edition line, box scores
//                 = week + each side's code and points; on History the year, champion and points). On wide screens no
//                 lettering goes into the small pockets inside the content column, and none is ever shown cut by a gutter.
//
//  CLUTTER.stats()      { hosts, regions, specs, live, awake, canvases, timer, pending, ... } for tests
//  CLUTTER.relayout()   measure and place again now
//  CLUTTER.dump()       the measured boxes / regions / pieces (debugging)
//  CLUTTER.off(bool)    remove every layer from layout (display:none) / bring them back
// ============================================================================
(function () {
  'use strict';
  if (window.CLUTTER) return;

  var D = document, H = D.documentElement, W = window;
  var B = W.BROOKDALE || {}, TEAMS = B.teams || [], SEASON = B.season || {}, EDITION = B.edition || {};

  // ---------------------------------------------------------------------------
  //  small helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hashStr(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mix(a, b, c, d) {                       // integer hash → [0, 1)
    var h = (a | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (b | 0), 0x85ebca6b); h ^= h >>> 15;
    h = Math.imul(h ^ (c | 0), 0xc2b2ae35); h ^= h >>> 13;
    h = Math.imul(h ^ (d | 0), 0x27d4eb2f); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mk(tag, cls, text) { var e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function now() { return W.performance && performance.now ? performance.now() : Date.now(); }
  function isReduce() { return H.classList.contains('reduce'); }
  function isHeld() { return H.classList.contains('intro-active') || H.classList.contains('slamming'); }

  // ---------------------------------------------------------------------------
  //  state
  // ---------------------------------------------------------------------------
  var app = null, view = null, rootLayer = null;
  var hosts = [];                 // current hosts: [0] is the page, the rest are the desks of the mounted view
  var deskState = (typeof WeakMap === 'function') ? new WeakMap() : null;   // desk element → its host (kept while its geometry is unchanged)
  var rootHost = null;
  var routeKey = '', seed = 1, fontEpoch = 0;
  var started = false, disabled = false, held = true, shown = false;
  var kickTimer = 0, kickDue = 0, kickFirst = 0, rafPlan = 0, rafScroll = 0, rafMove = 0;
  var arriving = 0, arriveEnd = 0;
  var ioClip = null, ioLive = null, ioAwake = null, sentBox = null, sents = [], liveB = {}, awakeB = {}, bandKey = '', curP = null;
  var awake = [];                 // specs whose piece is in the viewport
  var tickTimer = 0, nextCycle = 0, scrolling = false, scrollT = 0;
  var clipUse = {}, clipTurn = 0, atlasStarted = false, reelAsked = false;
  var hot = null, tapTimer = 0, tapped = null;
  var lastPlanMs = 0, lastMeasureMs = 0, planCount = 0, measured = 0, lastVw = 0;
  var pool = null, planJob = 0, planning = false, baseVw = 0, baseVh = 0;
  var MOUNT_BATCH = 14;                 // pieces built per frame (5 on phones)

  // ---------------------------------------------------------------------------
  //  parameters for this viewport
  // ---------------------------------------------------------------------------
  function params() {
    var vw = H.clientWidth || W.innerWidth, vh = W.innerHeight, phone = vw < 700;
    // a phone's toolbars sliding in and out change the height by a few percent: keep the bands (and budgets) as they were
    if (vw === baseVw && Math.abs(vh - baseVh) < baseVh * 0.2) vh = baseVh; else { baseVw = vw; baseVh = vh; }
    var cap = clamp(Math.round(vw * vh / (phone ? 11000 : 15500)), 22, 120);
    return {
      vw: vw, vh: vh, phone: phone,
      cell: phone ? 4 : (vw < 1280 ? 6 : 8),            // occupancy grid resolution, px
      pad: phone ? 4 : 8,                               // clear space kept around bare text, px
      s: phone ? 1 : (vw < 1100 ? 1.22 : 1.45),         // piece scale
      cap: cap,                                         // pieces per screenful
      band: Math.max(160, Math.round(vh / 3)),          // budget band height
      capBand: Math.ceil(cap / 3),
      A0: phone ? 560 : 1150,                           // one piece per this much visible free area (binds only where room is tight)
      minR: 8, minIn: phone ? 18 : 26,
      clipMax: phone ? 3 : 4,
      strict: vw >= 1100                                // real side margins: keep lettering out of small pockets inside the column
    };
  }

  // ---------------------------------------------------------------------------
  //  real data for the lettering (nothing here is invented)
  // ---------------------------------------------------------------------------
  function fix2(n) { return (W.APP && APP.fmt && APP.fmt.pts) ? APP.fmt.pts(n) : Number(n).toFixed(2); }
  function shuffle(a, r) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function chunk(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n).join('  ')); return out; }
  function buildPool(route) {
    var r = rng(hashStr('pool:' + route.key));
    var by = {}, std = {};
    TEAMS.forEach(function (t) { by[t.slug] = t; });
    (SEASON.standings || []).forEach(function (s) { std[s.slug] = s; });
    var rec = function (slug) { var s = std[slug]; return s ? s.w + '-' + s.l + (s.t ? '-' + s.t : '') : ''; };
    var weeks = SEASON.weeks || [], rem = SEASON.remaining || [];
    var P = { scores: [], stamps: [], records: [], ranks: [], weeks: [], names: [], codes: [], tags: [], mgrs: [], photos: [], slugs: [], matches: [] };
    // a box score: the week, then each side's code and points, the winner's line first
    var box = function (g) {
      var A = by[g.a], Bt = by[g.b]; if (!A || !Bt) return null;
      var la = A.code + ' ' + fix2(g.ap), lb = Bt.code + ' ' + fix2(g.bp);
      return g.ap >= g.bp ? { k: 'Week ' + g.week, a: la, b: lb } : { k: 'Week ' + g.week, a: lb, b: la };
    };
    var date = (EDITION.date && W.APP && APP.fmt && APP.fmt.date) ? APP.fmt.date(EDITION.date) : '';
    var edWeek = EDITION.week ? 'Week ' + EDITION.week : '';
    var focus = route.name === 'team' ? by[route.slug] : null;
    var games = [];
    weeks.forEach(function (w) { (w.games || []).forEach(function (g) { games.push({ week: w.week, a: g[0], ap: g[1], b: g[3], bp: g[4] }); }); });

    if (focus) {
      var line = [];
      games.forEach(function (g) {
        if (g.a !== focus.slug && g.b !== focus.slug) return;
        var mine = g.a === focus.slug ? g.ap : g.bp, theirs = g.a === focus.slug ? g.bp : g.ap, opp = by[g.a === focus.slug ? g.b : g.a];
        P.scores.push(fix2(mine)); P.stamps.push(mine > theirs ? 'W' : mine < theirs ? 'L' : 'T');
        P.weeks.push('Week ' + g.week); line.push(fix2(mine)); P.matches.push(box(g));
        if (opp) { P.codes.push(opp.code); P.names.push(opp.name); P.photos.push(opp.profile); P.mgrs.push(opp.manager); }
      });
      rem.forEach(function (w) { P.weeks.push('Week ' + w.week); });
      P.records = [rec(focus.slug)]; P.ranks = [String(focus.rank)]; P.tags = [focus.tagline];
      P.names.unshift(focus.name); P.codes.unshift(focus.code); P.mgrs.unshift(focus.manager);
      P.photos = [focus.profile].concat(shuffle(P.photos, r));
      P.slugs = [focus.name + '  ' + rec(focus.slug), EDITION.title || '', date].concat(chunk(line, 3));
    } else {
      var last = weeks.length ? weeks[weeks.length - 1] : null;
      TEAMS.forEach(function (t) { P.records.push(rec(t.slug)); P.ranks.push(String(t.rank)); P.names.push(t.name); P.codes.push(t.code); P.tags.push(t.tagline); P.mgrs.push(t.manager); P.photos.push(t.profile); });
      if (route.name === 'standings') {
        games.forEach(function (g) { P.scores.push(fix2(g.ap), fix2(g.bp)); P.stamps.push(g.ap > g.bp ? 'W' : 'L', g.bp > g.ap ? 'W' : 'L'); P.matches.push(box(g)); });
        weeks.forEach(function (w) { P.weeks.push('Week ' + w.week); });
        (SEASON.standings || []).forEach(function (s) { P.scores.push(fix2(s.pf)); });
      } else if (route.name === 'sim') {
        rem.forEach(function (w) { P.weeks.push('Week ' + w.week); });
        if (last) last.games.forEach(function (g) { P.scores.push(fix2(g[1]), fix2(g[4])); P.stamps.push(g[1] > g[4] ? 'W' : 'L', g[4] > g[1] ? 'W' : 'L'); P.matches.push(box({ week: last.week, a: g[0], ap: g[1], b: g[3], bp: g[4] })); });
      } else if (route.name === 'history' && W.HISTORY) {
        var byKey = {};                                 // HISTORY is keyed by historyKey; the site shows the manager's name (its "Van" is Sam)
        TEAMS.forEach(function (t) { byKey[t.historyKey || t.manager] = t.manager; });
        (HISTORY.champions || []).forEach(function (c) {
          var who = c.manager ? (byKey[c.manager] || c.manager) : '';
          P.weeks.push(String(c.year)); if (c.record) P.records.push(c.record); if (c.pf) P.scores.push(fix2(c.pf)); if (who) P.mgrs.push(who);
          if (who && c.pf) P.matches.push({ k: String(c.year), a: who, b: fix2(c.pf) });                   // the champion's line of that year
        });
        P.stamps = ['W', 'L'];
      } else {
        if (last) last.games.forEach(function (g) { P.scores.push(fix2(g[1]), fix2(g[4])); P.stamps.push(g[1] > g[4] ? 'W' : 'L', g[4] > g[1] ? 'W' : 'L'); });
        games.forEach(function (g) { P.matches.push(box(g)); });
        if (edWeek) P.weeks.push(edWeek);
        if (last) P.weeks.push('Week ' + last.week);
        P.mgrs = []; P.names = [];                       // rankings page: a loose name beside another team's card reads as its label
      }
      P.slugs = [EDITION.title || '', date].concat(chunk(P.codes, 4), chunk(P.records, 4));
    }
    P.date = date; P.edWeek = edWeek;
    ['scores', 'stamps', 'records', 'weeks', 'names', 'codes', 'tags', 'mgrs', 'matches'].forEach(function (k) { P[k] = shuffle(P[k].filter(Boolean), r); });
    if (!focus) shuffle(P.photos, r);
    P.photos = P.photos.filter(Boolean); P.slugs = P.slugs.filter(Boolean);
    P.at = {};                                     // sequential cursors
    P.next = function (k) { var a = P[k]; if (!a || !a.length) return ''; var i = P.at[k] || 0; P.at[k] = i + 1; return a[i % a.length]; };
    return P;
  }

  // ---------------------------------------------------------------------------
  //  measuring the real layout (reads only; never called from an animation loop)
  // ---------------------------------------------------------------------------
  var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, BR: 1, WBR: 1, LINK: 1, META: 1 };
  var SOLID = { TABLE: 1, svg: 1, SVG: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, HR: 1, IFRAME: 1, AUDIO: 1, OBJECT: 1, PROGRESS: 1, METER: 1, DETAILS: 1 };
  var OPAQUE = { IMG: 1, CANVAS: 1, VIDEO: 1 };
  var range = null;

  function alphaOf(c) {
    if (!c || c === 'transparent') return 0;
    var m = /^rgba?\(([^)]+)\)/.exec(c);
    if (!m) return 1;
    var p = m[1].split(/[,\/\s]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }
  function side(w, s, c) { return s !== 'none' && s !== 'hidden' && parseFloat(w) > 0 && alphaOf(c) > 0.03; }
  function hasBox(cs) {
    return alphaOf(cs.backgroundColor) > 0.03 || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
      side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor) || side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor) ||
      side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor) || side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor) ||
      (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0);
  }
  function hasPseudo(el) {
    var a = getComputedStyle(el, '::before'), b = getComputedStyle(el, '::after'), ca = a && a.content, cb = b && b.content;
    return (!!ca && ca !== 'none' && ca !== 'normal' && a.display !== 'none') || (!!cb && cb !== 'none' && cb !== 'normal' && b.display !== 'none');
  }
  function hasText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    return false;
  }
  function quadOf(el, r, cs, sx, sy) {               // the four corners of a (possibly rotated) box, page coordinates
    var t = cs.transform, m = t && t !== 'none' ? /^matrix\(([^)]+)\)/.exec(t) : null;
    var x = r.left + sx, y = r.top + sy;
    if (!m || typeof el.offsetWidth !== 'number') return [x, y, r.width, r.height];
    var v = m[1].split(',').map(parseFloat), a = v[0], b = v[1], c = v[2], d = v[3];
    if (Math.abs(b) < 0.002 && Math.abs(c) < 0.002) return [x, y, r.width, r.height];
    var cx = x + r.width / 2, cy = y + r.height / 2, hw = el.offsetWidth / 2, hh = el.offsetHeight / 2;
    var P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], out = [];
    for (var i = 0; i < 4; i++) out.push(cx + a * P[i][0] + c * P[i][1], cy + b * P[i][0] + d * P[i][1]);
    return out;
  }

  function newHost(el, kind, x, y, w, h) { return { el: el, kind: kind, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), hard: [], cover: [], specs: [], regions: {}, layer: null, sig: '' }; }

  function walk(el, host, M) {
    for (var ch = el.firstElementChild; ch; ch = ch.nextElementSibling) {
      var tag = ch.tagName;
      if (SKIP[tag] || ch.__cl) continue;
      var cs = getComputedStyle(ch), disp = cs.display;
      if (disp === 'none' || cs.visibility === 'hidden') continue;
      if (disp === 'contents') { walk(ch, host, M); continue; }
      var pos = cs.position;
      if (pos === 'fixed') continue;                                  // overlays live above the page, not on it
      var r = ch.getBoundingClientRect();
      M.n++;
      var x = r.left + M.sx, y = r.top + M.sy, w = r.width, h = r.height;
      if (w <= 1.5 && h <= 1.5) { if (pos !== 'absolute' && ch.firstElementChild) walk(ch, host, M); continue; }   // .sr-only and collapsed boxes

      if (host.kind === 'paper' && ch.classList.contains('desk')) {   // a desk is its own host (and an opaque block of the page)
        var dh = newHost(ch, 'desk', x, y, w, h); dh.idx = M.hosts.length;
        M.hosts.push(dh); host.cover.push([x, y, w, h]); (host.desks = host.desks || []).push([x, y, w, h]);
        walk(ch, dh, M);
        continue;
      }
      if (pos === 'sticky') {                                          // measure where it rests, not where it is stuck
        var prev = ch.previousElementSibling, ny = prev ? prev.getBoundingClientRect().bottom + M.sy : y;
        host.cover.push([x, ny, w, h]);
        continue;
      }
      var plain = cs.mixBlendMode === 'normal' || !cs.mixBlendMode;
      if (plain && parseFloat(cs.opacity) > 0.9 && (OPAQUE[tag] || ch.classList.contains('clipping') || ch.classList.contains('news-photo') || alphaOf(cs.backgroundColor) >= 0.95)) {
        host.cover.push(quadOf(ch, r, cs, M.sx, M.sy));
        continue;
      }
      var ov = cs.overflowX, scrolls = ov === 'auto' || ov === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      if (SOLID[tag] || scrolls || hasBox(cs)) { host.hard.push([x, y, w, h]); continue; }
      if (hasText(ch)) {
        if (disp.indexOf('inline') !== 0) {                            // a block of text: only as wide as its lines
          range.selectNodeContents(ch);
          var rr = range.getBoundingClientRect();
          if (rr.width > 0 && rr.height > 0) {
            var x0 = Math.max(rr.left, r.left - 4), x1 = Math.min(rr.right, r.right + 4), y0 = Math.max(rr.top, r.top - 4), y1 = Math.min(rr.bottom, r.bottom + 4);
            if (x1 > x0 && y1 > y0) { host.hard.push([x0 + M.sx, y0 + M.sy, x1 - x0, y1 - y0]); continue; }
          }
        }
        host.hard.push([x, y, w, h]);
        continue;
      }
      if (!ch.firstElementChild) { if (hasPseudo(ch)) host.hard.push([x, y, w, h]); continue; }
      if (hasPseudo(ch)) { host.hard.push([x, y, w, h]); continue; }   // a decorated container: keep the whole box clear
      walk(ch, host, M);
    }
  }

  function sigOf(host, P) {
    var a = [host.kind, host.w, host.h, P.vw, P.cell, routeKey], i, j, r;
    if (host.kind === 'paper') a.push(host.x, host.y);
    for (i = 0; i < host.hard.length; i++) { r = host.hard[i]; a.push(Math.round(r[0] - host.x), Math.round(r[1] - host.y), Math.round(r[2]), Math.round(r[3])); }
    a.push('|');
    for (i = 0; i < host.cover.length; i++) { r = host.cover[i]; for (j = 0; j < r.length; j++) a.push(Math.round(r[j] - (j % 2 ? host.y : host.x) * (r.length === 8 || j < 2 ? 1 : 0))); }
    return String(hashStr(a.join(','))) + ':' + a.length;
  }

  function measure() {
    var t0 = now();
    if (!range) range = D.createRange();
    var sx = W.scrollX || W.pageXOffset || 0, sy = W.scrollY || W.pageYOffset || 0;
    var ar = app.getBoundingClientRect();
    var root = newHost(app, 'paper', ar.left + sx, ar.top + sy, ar.width, ar.height);
    var M = { sx: sx, sy: sy, n: 0, hosts: [root] };
    walk(app, root, M);
    measured = M.n; lastMeasureMs = now() - t0;
    return M.hosts;
  }

  // ---------------------------------------------------------------------------
  //  the piece library: what can be placed, and how big
  // ---------------------------------------------------------------------------
  //  cat      placement class.  share = part of a band's budget;  over = how much of its visible area may already be
  //           taken;  coreOver = how much of it may sit on the heart of a clip / photo;  minFrac / minAbs = how much of
  //           the piece must be visible (fraction, px² for phone / desktop);  in = how far inside a region's edge its
  //           centre stays (× its size; 0.5 = fully inside when there is room);  strip = may bleed off the side of the
  //           page through a gutter narrower than itself (only a slice of it shows — the rest is off the sheet)
  var CATS = [
    { id: 'clip',  max: 0.3,  z: 3, share: 0.26, over: 0.24, coreOver: 0.03, minFrac: 0.15, minAbs: [1500, 3400], in: 0.34, claim: 1, core: 1, amb: 0.22, strip: 1 },
    { id: 'photo', max: 0.14, z: 3, share: 0.09, over: 0.30, coreOver: 0.06, minFrac: 0.3,  minAbs: [900, 2000],  in: 0.36, claim: 1, core: 1, amb: 0.3,  strip: 1 },
    { id: 'scrap', max: 0.4,  z: 4, share: 0.21, over: 0.40, coreOver: 0.14, minFrac: 0.86, minAbs: [420, 900],   in: 0.5,  claim: 1, amb: 0.5,  text: 1 },
    { id: 'pop',   max: 0.22, z: 5, share: 0.10, over: 0.40, coreOver: 0.14, minFrac: 0.8,  minAbs: [420, 900],   in: 0.5,  claim: 1, amb: 0.62, text: 1 },
    { id: 'shape', max: 0.4,  z: 2, share: 0.17, over: 0.58, coreOver: 0.34, minFrac: 0.3,  minAbs: [220, 700],   in: 0.3,  claim: 1, amb: 0.5,  strip: 1 },
    { id: 'mark',  max: 0.5,  z: 6, share: 0.13, over: 0.26, coreOver: 0.18, minFrac: 0.36, minAbs: [90, 200],    in: 0.4,  claim: 1, amb: 0.4 },
    { id: 'under', max: 0.07, z: 1, share: 0.04, over: 1,    coreOver: 1,    minFrac: 0.32, minAbs: [900, 2600],  in: 0.26, claim: 0, amb: 0.12 }
  ];
  function shapesFor(cat, P) {
    var s = P.s, R = Math.round, out = [];
    var add = function (type, w, h, v, bonus) { out.push({ type: type, w: R(w), h: R(h), v: v || '', bonus: bonus || 0 }); };
    switch (cat.id) {
      case 'clip':
        if (!W.ATLAS) break;
        [156, 132, 110].forEach(function (w, i) { w = w * (P.phone ? 1 : s * 0.9); add('clip', w, w * 0.79, '', 0.16 - i * 0.07); });
        break;
      case 'photo':
        [78, 62].forEach(function (w, i) { w *= s; add('photo', w, w * 1.22, '', 0.1 - i * 0.05); });
        break;
      case 'scrap':
        add('scrap', 92 * s, 34 * s, 's', 0.06); add('scrap', 70 * s, 27 * s, 's'); add('scrap', 150 * s, 30 * s, 'l', 0.05); add('scrap', 112 * s, 24 * s, 'l');
        add('scrap', 40 * s, 52 * s, 'n', 0.04); add('scrap', 98 * s, 50 * s, 'm', 0.07);
        break;
      case 'pop':
        add('burst', 84 * s, 84 * s, '', 0.08); add('burst', 62 * s, 62 * s); add('stamp', 46 * s, 46 * s, '', 0.03); add('proof', 104 * s, 48 * s, '', 0.03);
        break;
      case 'shape':
        add('ht', 128 * s, 80 * s, '', 0.07); add('ht', 88 * s, 55 * s); add('hatch', 86 * s, 58 * s); add('speed', 116 * s, 116 * s, '', 0.05);
        add('kirby', 84 * s, 84 * s, '', 0.03); add('arrow', 66 * s, 36 * s, '', 0.02); add('ht', 18 * s, 96 * s, 'v'); add('hatch', 16 * s, 70 * s, 'v');
        add('spark', 17 * s, 17 * s, '', 0.02); add('arrow', 27 * s, 15 * s, 'sm');
        add('panel', 104 * s, 74 * s, '', 0.06); add('panel', 62 * s, 86 * s, 't', 0.03);
        break;
      case 'mark':
        add('reg', 26 * s, 26 * s, '', 0.06); add('crop', 22 * s, 22 * s); add('bars', 104 * s, 11 * s, 'h', 0.05); add('bars', 11 * s, 104 * s, 'v', 0.05);
        add('tape', 82 * s, 21 * s, '', 0.02); add('slug', 168 * s, 13 * s, 'h', 0.02); add('slug', 13 * s, 168 * s, 'v', 0.04);
        add('ticks', 96 * s, 9 * s, 'h', 0.03); add('ticks', 9 * s, 96 * s, 'v', 0.05);
        break;
      case 'under':
        add('paper', 150 * s, 112 * s, '', 0.05); add('paper', 104 * s, 138 * s);
        break;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  //  planning: occupancy grid → free regions → pieces
  // ---------------------------------------------------------------------------
  function plan(host, P) {
    var c = P.cell, gw = Math.max(1, Math.ceil(host.w / c)), gh = Math.max(1, Math.ceil(host.h / c));
    var hard = new Uint8Array(gw * gh), cov = new Uint8Array(gw * gh), pad = P.pad, i, j, x, y;

    host.hard.forEach(function (r) {
      var x0 = clamp(Math.floor((r[0] - host.x - pad) / c), 0, gw), x1 = clamp(Math.ceil((r[0] - host.x + r[2] + pad) / c), 0, gw);
      var y0 = clamp(Math.floor((r[1] - host.y - pad) / c), 0, gh), y1 = clamp(Math.ceil((r[1] - host.y + r[3] + pad) / c), 0, gh);
      for (var yy = y0; yy < y1; yy++) hard.fill(1, yy * gw + x0, yy * gw + x1);
    });
    host.cover.forEach(function (q) {
      var xx, yy, x0, x1, y0, y1;
      if (q.length === 4) {
        x0 = clamp(Math.round((q[0] - host.x) / c), 0, gw); x1 = clamp(Math.round((q[0] - host.x + q[2]) / c), 0, gw);
        y0 = clamp(Math.round((q[1] - host.y) / c), 0, gh); y1 = clamp(Math.round((q[1] - host.y + q[3]) / c), 0, gh);
        for (yy = y0; yy < y1; yy++) cov.fill(1, yy * gw + x0, yy * gw + x1);
        return;
      }
      var px = [q[0] - host.x, q[2] - host.x, q[4] - host.x, q[6] - host.x], py = [q[1] - host.y, q[3] - host.y, q[5] - host.y, q[7] - host.y];
      x0 = clamp(Math.floor(Math.min.apply(null, px) / c), 0, gw); x1 = clamp(Math.ceil(Math.max.apply(null, px) / c), 0, gw);
      y0 = clamp(Math.floor(Math.min.apply(null, py) / c), 0, gh); y1 = clamp(Math.ceil(Math.max.apply(null, py) / c), 0, gh);
      for (yy = y0; yy < y1; yy++) for (xx = x0; xx < x1; xx++) {
        var mx = (xx + 0.5) * c, my = (yy + 0.5) * c, inside = true, sgn = 0;
        for (var k = 0; k < 4; k++) {
          var n = (k + 1) % 4, cr = (px[n] - px[k]) * (my - py[k]) - (py[n] - py[k]) * (mx - px[k]);
          if (cr !== 0) { if (!sgn) sgn = cr > 0 ? 1 : -1; else if ((cr > 0 ? 1 : -1) !== sgn) { inside = false; break; } }
        }
        if (inside) cov[yy * gw + xx] = 1;
      }
    });

    // integral images: I = visible free cells (neither hard nor covered), Ih = hard cells
    var gw1 = gw + 1, I = new Int32Array(gw1 * (gh + 1)), Ih = new Int32Array(gw1 * (gh + 1));
    for (y = 0; y < gh; y++) {
      var rs = 0, rh = 0;
      for (x = 0; x < gw; x++) {
        i = y * gw + x; var hd = hard[i];
        rh += hd; if (!hd && !cov[i]) rs++;
        I[(y + 1) * gw1 + x + 1] = I[y * gw1 + x + 1] + rs;
        Ih[(y + 1) * gw1 + x + 1] = Ih[y * gw1 + x + 1] + rh;
      }
    }
    var sum = function (A, x0, y0, x1, y1) { return A[y1 * gw1 + x1] - A[y0 * gw1 + x1] - A[y1 * gw1 + x0] + A[y0 * gw1 + x0]; };

    // ---- regions: rectangles free of hard cells (row runs, grown up and down as far as they stay free) ----
    var regs = [], seen = {};
    var emit = function (x0, y0, x1, y1) {
      if ((x1 - x0) * c < P.minR) return;
      while (y0 > 0 && sum(Ih, x0, y0 - 1, x1, y0) === 0) y0--;
      while (y1 < gh && sum(Ih, x0, y1, x1, y1 + 1) === 0) y1++;
      if ((y1 - y0) * c < P.minR) return;
      var edge = x0 === 0 || x1 === gw || y0 === 0 || y1 === gh;
      if (!edge && Math.min(x1 - x0, y1 - y0) * c < P.minIn) return;       // a crack between two bits of content: leave it clean
      var k = x0 + ',' + y0 + ',' + x1;
      if (seen[k]) return; seen[k] = 1;
      var vis = sum(I, x0, y0, x1, y1) * c * c;
      if (vis < 90) return;
      regs.push({ id: k, x0: x0, y0: y0, x1: x1, y1: y1, vis: vis, area: (x1 - x0) * (y1 - y0) });
    };
    if (Ih[gh * gw1 + gw] === 0) emit(0, 0, gw, gh);
    else {
      var open = [];
      for (y = 0; y <= gh; y++) {
        var runs = [];
        if (y < gh) { x = 0; while (x < gw) { if (hard[y * gw + x]) { x++; continue; } var s0 = x; while (x < gw && !hard[y * gw + x]) x++; runs.push([s0, x]); } }
        var next = [];
        for (i = 0; i < runs.length; i++) {
          var found = null;
          for (j = 0; j < open.length; j++) if (open[j] && open[j][0] === runs[i][0] && open[j][1] === runs[i][1]) { found = open[j]; open[j] = null; break; }
          next.push(found || [runs[i][0], runs[i][1], y]);
        }
        for (j = 0; j < open.length; j++) if (open[j]) emit(open[j][0], open[j][2], open[j][1], y);
        open = next;
      }
    }
    regs.sort(function (a, b) { return b.area - a.area; });
    var keep = [];
    for (i = 0; i < regs.length && keep.length < 140; i++) {
      var a = regs[i], inside = false;
      for (j = 0; j < keep.length; j++) { var b = keep[j]; if (b.x0 <= a.x0 && b.x1 >= a.x1 && b.y0 <= a.y0 && b.y1 >= a.y1) { inside = true; break; } }
      if (!inside) keep.push(a);
    }
    regs = keep;
    regs.forEach(function (R) { R.px = R.x0 * c; R.py = R.y0 * c; R.pw = Math.min(host.w, R.x1 * c) - R.px; R.ph = Math.min(host.h, R.y1 * c) - R.py; });

    // ---- coarse grids for "is this spot already taken" ----
    var cf = 3, cw = Math.ceil(gw / cf), chh = Math.ceil(gh / cf), cs3 = c * cf;
    var cvis = new Uint8Array(cw * chh), claimed = new Uint8Array(cw * chh), core = new Uint8Array(cw * chh), marks = new Uint8Array(cw * chh);
    for (y = 0; y < chh; y++) for (x = 0; x < cw; x++) {
      if (sum(I, x * cf, y * cf, Math.min(gw, x * cf + cf), Math.min(gh, y * cf + cf)) > 0) cvis[y * cw + x] = 1;
    }

    // ---- budgets per band of the page (bands are global, so they do not move when a host does) ----
    var bandH = P.band, b0 = Math.floor(host.y / bandH), b1 = Math.floor((host.y + host.h - 1) / bandH), bands = {}, bi;
    for (bi = b0; bi <= b1; bi++) {
      var py0 = clamp(Math.floor((bi * bandH - host.y) / c), 0, gh), py1 = clamp(Math.ceil(((bi + 1) * bandH - host.y) / c), 0, gh);
      var visPx = py1 > py0 ? sum(I, 0, py0, gw, py1) * c * c : 0;
      // this host's part of the band (the page minus its desks; a desk: itself) decides its part of the cap
      var own = Math.max(0, Math.min(host.y + host.h, (bi + 1) * bandH) - Math.max(host.y, bi * bandH)) * host.w;
      (host.desks || []).forEach(function (d) { own -= Math.max(0, Math.min(d[1] + d[3], (bi + 1) * bandH) - Math.max(d[1], bi * bandH)) * d[2]; });
      var part = clamp(own / (P.vw * bandH), 0, 1);
      var nb = Math.min(Math.round(P.capBand * part), Math.round(visPx / P.A0));
      bands[bi] = { n: nb, left: nb, carry: 0, q: 0, got: 0, want: 0, types: {}, part: part };
    }

    var specs = [], hseed = seed ^ (host.kind === 'desk' ? hashStr('desk' + (host.idx || 0)) : 0);

    // the regions each band can draw from, weighted by how much visible room they have inside it
    for (bi = b0; bi <= b1; bi++) {
      var bd0 = bands[bi], acc = 0;
      bd0.y0 = clamp(Math.floor((bi * bandH - host.y) / c), 0, gh); bd0.y1 = clamp(Math.ceil(((bi + 1) * bandH - host.y) / c), 0, gh);
      bd0.regs = [];
      if (!bd0.n) continue;
      for (i = 0; i < regs.length; i++) {
        var Rg = regs[i], ry0 = Math.max(Rg.y0, bd0.y0), ry1 = Math.min(Rg.y1, bd0.y1);
        if (ry1 <= ry0) continue;
        var wv = sum(I, Rg.x0, ry0, Rg.x1, ry1);
        if (wv <= 0) continue;
        acc += wv; bd0.regs.push({ R: Rg, gy0: ry0, gy1: ry1, w: wv, cum: acc });
      }
      bd0.wsum = acc;
    }

    var ONE = { bars: 1, slug: 1, ticks: 1, tape: 1, proof: 1, spark: 1 };
    var NOSTRIP = { arrow: 1, spark: 1 }, MID = { clip: 1, kirby: 1, speed: 1 };
    var LOUD = { arrow: 1, slug: 1, bars: 1, ticks: 1 };
    var runCat = function (cat, ci) {
      var shapes = shapesFor(cat, P);
      if (!shapes.length) return;
      var bi, i, minAbs = cat.minAbs[P.phone ? 0 : 1], reach = Math.round(96 / c);
      var typeMax = cat.id === 'clip' || cat.id === 'under' ? 99 : (cat.id === 'mark' || cat.id === 'shape' ? 2 : 3);
      for (bi = b0; bi <= b1; bi++) {
        var band = bands[bi];
        band.want = band.n * cat.share + band.carry;
        var q = clamp(Math.round(band.want), 0, Math.min(band.left, Math.ceil(band.n * cat.max), cat.id === 'clip' ? Math.ceil((P.clipMax - (!P.phone && (bi & 1) ? 1 : 0)) * band.part) : 99)), got = 0;
        if (q > 0 && band.regs.length) {
          // a handful of tries per piece wanted: pick a region (by visible room), a shape, a spot; keep the ones that show enough
          var cands = [], tries = Math.min(220, q * (cat.id === 'clip' ? 30 : 18) + 10), k;
          for (k = 0; k < tries; k++) {
            var u = mix(hseed + ci * 131, bi, k, 1) * band.wsum, ri = 0;
            while (ri < band.regs.length - 1 && u > band.regs[ri].cum) ri++;
            var br = band.regs[ri], R = br.R, sh = shapes[Math.floor(mix(hseed + ci * 131, bi, k, 2) * shapes.length)];
            var w = sh.w, h = sh.h, need = Math.max(minAbs, (sh.type === 'slug' ? 0.92 : cat.minFrac) * w * h), strip = 0;
            if (Math.min(w, R.pw) * Math.min(h, R.ph) < need) {
              // a gutter at the side of the sheet, narrower than the piece: it may bleed off the page, a slice of it showing
              if (!cat.strip || NOSTRIP[sh.type] || R.pw < 10 || R.pw >= w * 0.55 || (R.x0 !== 0) === (R.x1 !== gw)) continue;
              strip = R.x0 === 0 ? -1 : 1;
              need = Math.max(cat.id === 'shape' ? 200 : 380, 0.45 * R.pw * Math.min(h, R.ph));
              if (R.pw * Math.min(h, R.ph) < need) continue;
            }
            // how close to each edge of the region the centre may go: at the host's own edges pieces bleed off freely
            var inL = Math.min(w * (R.x0 === 0 ? 0.12 : cat.in), R.pw / 2), inR = Math.min(w * (R.x1 === gw ? 0.12 : cat.in), R.pw / 2);
            var inT = Math.min(h * (R.y0 === 0 ? 0.2 : cat.in), R.ph / 2), inB = Math.min(h * (R.y1 === gh ? 0.2 : cat.in), R.ph / 2);
            var xa = R.px + inL, xb = R.px + R.pw - inR, ya = R.py + inT, yb = R.py + R.ph - inB;
            // anchor on a visible cell of this region inside the band (so tries are not wasted under the clippings) …
            var tv = Math.floor(mix(hseed + ci * 131, bi, k, 3) * br.w), lo = br.gy0, hi = br.gy1 - 1, mid;
            while (lo < hi) { mid = (lo + hi) >> 1; if (sum(I, R.x0, br.gy0, R.x1, mid + 1) > tv) hi = mid; else lo = mid + 1; }
            var gy = lo, tx = tv - sum(I, R.x0, br.gy0, R.x1, gy);
            lo = R.x0; hi = R.x1 - 1;
            while (lo < hi) { mid = (lo + hi) >> 1; if (sum(I, R.x0, gy, mid + 1, gy + 1) > tx) hi = mid; else lo = mid + 1; }
            var gx = lo;
            if (hard[gy * gw + gx] || cov[gy * gw + gx]) continue;
            // … then settle into the free run around it: centred when the gap is smaller than the piece, else anywhere that keeps most of it showing
            var mxw = Math.ceil(w / c), mxh = Math.ceil(h / c), l = gx, r = gx, t2 = gy, d2 = gy, o2;
            while (l > R.x0 && gx - l < mxw) { o2 = gy * gw + l - 1; if (hard[o2] || cov[o2]) break; l--; }
            while (r < R.x1 - 1 && r - gx < mxw) { o2 = gy * gw + r + 1; if (hard[o2] || cov[o2]) break; r++; }
            while (t2 > R.y0 && gy - t2 < mxh) { o2 = (t2 - 1) * gw + gx; if (hard[o2] || cov[o2]) break; t2--; }
            while (d2 < R.y1 - 1 && d2 - gy < mxh) { o2 = (d2 + 1) * gw + gx; if (hard[o2] || cov[o2]) break; d2++; }
            var runL = l * c, runR = (r + 1) * c, runT = t2 * c, runB = (d2 + 1) * c, jx = mix(hseed + ci * 131, bi, k, 4), jy = mix(hseed + ci * 131, bi, k, 6);
            var tuck = 0.5 - cat.in;                             // how far past the free run it may reach (× its size)
            var cx = (runR - runL) < w * (1 - 2 * tuck) ? (runL + runR) / 2 : clamp((gx + 0.5) * c + (jx - 0.5) * w * 0.8, runL + w * (0.5 - tuck), runR - w * (0.5 - tuck));
            var cy = (runB - runT) < h * (1 - 2 * tuck) ? (runT + runB) / 2 : clamp((gy + 0.5) * c + (jy - 0.5) * h * 0.8, runT + h * (0.5 - tuck), runB - h * (0.5 - tuck));
            cx = clamp(cx, Math.min(xa, xb), Math.max(xa, xb)); cy = clamp(cy, Math.min(ya, yb), Math.max(ya, yb));
            if (strip) {                                         // a clip shows its middle (the picture); a torn or cut piece its inner edge
              var showW = R.pw * (0.75 + 0.25 * jx);
              cx = MID[sh.type] ? R.px + R.pw / 2 + (jx - 0.5) * w * 0.4 : (strip < 0 ? R.px + showW - w / 2 : R.px + R.pw - showW + w / 2);
            }
            var X0 = Math.max(cx - w / 2, R.px), X1 = Math.min(cx + w / 2, R.px + R.pw), Y0 = Math.max(cy - h / 2, R.py), Y1 = Math.min(cy + h / 2, R.py + R.ph);
            var gx0 = clamp(Math.round(X0 / c), 0, gw), gx1 = clamp(Math.round(X1 / c), 0, gw), gy0 = clamp(Math.round(Y0 / c), 0, gh), gy1 = clamp(Math.round(Y1 / c), 0, gh);
            if (gx1 <= gx0 || gy1 <= gy0) continue;
            var vis = sum(I, gx0, gy0, gx1, gy1) * c * c;
            if (vis < need) continue;
            if (P.strict && (cat.text || LOUD[sh.type]) && Math.min(R.pw, R.ph) < 150) {
              // a small pocket between bits of content: no lettering, arrows or bars there (they could be read as part of the page)
              var above = sum(Ih, gx0, Math.max(0, gy0 - reach), gx1, gy0) > 0, below = sum(Ih, gx0, gy1, gx1, Math.min(gh, gy1 + reach)) > 0;
              if ((above && below) || (sum(Ih, 0, gy0, gx0, gy1) > 0 && sum(Ih, gx1, gy0, gw, gy1) > 0)) continue;
            } else if (!P.strict && host.kind === 'paper' && R.y0 !== 0 && (cat.text || LOUD[sh.type] || sh.type === 'spark')) {
              // phones and tablets: the column is the page, so a scrap, arrow or star on the same rows as a line of the page
              // (the free end of a matchup row, say) reads as a mark on that line. Photos, screens and shapes may sit there;
              // lettering and pointers go in the gaps between sections and beside the masthead.
              if (sum(Ih, 0, gy0, gx0, gy1) > 0 || sum(Ih, gx1, gy0, gw, gy1) > 0) continue;
            }
            cands.push({ sh: sh, R: R, cx: cx, cy: cy, X0: X0, X1: X1, Y0: Y0, Y1: Y1, vis: vis,
              score: Math.min(vis / (w * h), 0.94) + sh.bonus + 0.3 * mix(hseed + ci * 131, bi, k, 5) });
          }
          cands.sort(function (p, q2) { return q2.score - p.score; });
          for (i = 0; i < cands.length && got < q; i++) {
            var cd = cands[i];
            if ((band.types[cd.sh.type] || 0) >= (ONE[cd.sh.type] || typeMax)) continue;
            var ax0 = clamp(Math.floor(cd.X0 / cs3), 0, cw), ax1 = clamp(Math.ceil(cd.X1 / cs3), 0, cw), ay0 = clamp(Math.floor(cd.Y0 / cs3), 0, chh), ay1 = clamp(Math.ceil(cd.Y1 / cs3), 0, chh);
            var nV = 0, nC = 0, nK = 0, nM = 0, xx, yy, o, isMark = cat.id === 'mark';
            for (yy = ay0; yy < ay1; yy++) for (xx = ax0; xx < ax1; xx++) { o = yy * cw + xx; if (cvis[o]) { nV++; if (claimed[o]) nC++; if (core[o]) nK++; if (marks[o]) nM++; } }
            if (!nV || nC / nV > cat.over || nK / nV > cat.coreOver || (isMark && nM / nV > 0.08)) continue;   // marks may sit on other pieces, not on each other
            if (cat.claim) for (yy = ay0; yy < ay1; yy++) for (xx = ax0; xx < ax1; xx++) { o = yy * cw + xx; if (cvis[o]) { claimed[o] = 1; if (isMark) marks[o] = 1; } }
            if (cat.core) {
              var kx0 = clamp(Math.round((cd.cx - cd.sh.w * 0.36) / cs3), 0, cw), kx1 = clamp(Math.round((cd.cx + cd.sh.w * 0.36) / cs3), 0, cw);
              var ky0 = clamp(Math.round((cd.cy - cd.sh.h * 0.36) / cs3), 0, chh), ky1 = clamp(Math.round((cd.cy + cd.sh.h * 0.36) / cs3), 0, chh);
              for (yy = ky0; yy < ky1; yy++) for (xx = kx0; xx < kx1; xx++) core[yy * cw + xx] = 1;
            }
            got++; band.types[cd.sh.type] = (band.types[cd.sh.type] || 0) + 1;
            specs.push({ cat: cat, type: cd.sh.type, v: cd.sh.v, cx: Math.round(cd.cx), cy: Math.round(cd.cy), w: cd.sh.w, h: cd.sh.h, R: cd.R, vis: cd.vis, host: host,
              node: null, live: false, awake: false, st: '', t: 0, tg: 0, canvas: null, clip: '' });
          }
        }
        band.left -= got; band.carry = band.want - got;
      }
    };

    // the caller runs one category at a time (and may yield between them): next() → null while there is more, then the specs
    var at = 0;
    return {
      next: function () {
        if (at < CATS.length) { runCat(CATS[at], at); at++; return null; }
        specs.sort(function (p, q) { return (p.cy - q.cy) || (p.cx - q.cx); });
        host.grid = { c: c, gw: gw, gh: gh, gw1: gw1, I: I };
        host.regs = regs;
        return specs;
      }
    };
  }

  // ---------------------------------------------------------------------------
  //  dressing a placed piece: tilt, variant, lettering (deterministic; data handed out in page order)
  // ---------------------------------------------------------------------------
  var mctx = null, mcache = {};
  function textW(font, text) {                       // width of `text` at 100px in `font` (no layout involved)
    var k = fontEpoch + font + '|' + text;
    if (mcache[k]) return mcache[k];
    if (!mctx) { try { mctx = D.createElement('canvas').getContext('2d'); } catch (e) { mctx = null; } }
    var w = text.length * 55;
    if (mctx) { mctx.font = font; w = mctx.measureText(text).width || w; }
    return (mcache[k] = w);
  }
  var FONTS = {
    scream: '400 100px Anton, Impact, sans-serif',
    head: '800 100px "Playfair Display", Georgia, serif',
    data: '600 100px "IBM Plex Mono", ui-monospace, monospace',
    body: 'italic 500 100px "Source Serif 4", Georgia, serif'
  };
  function fit(text, fam, w, h, kh, padX, up) {
    var t = up ? String(text).toUpperCase() : String(text);
    var mw = textW(FONTS[fam], t) / 100;
    return Math.max(7, Math.min(h * kh, (w - 2 * padX) / Math.max(0.2, mw)));
  }
  // A tagline that does not fit is torn like a headline: its opening words or its closing words (never a middle run),
  // and not left hanging on a joining word. Always consecutive words of the real tagline.
  var JOIN = { AND: 1, AT: 1, WITH: 1, FROM: 1, TO: 1, OF: 1, OR: 1, THE: 1, A: 1, IN: 1, ON: 1 };
  function tagFragment(tag, maxChars, r) {
    var words = String(tag).split(/\s+/).filter(Boolean), out = [], len = 0, i;
    if (tag.length <= maxChars || words.length < 2) return tag;
    if (r < 0.38) {                                      // the opening
      for (i = 0; i < words.length; i++) { if (out.length && len + 1 + words[i].length > maxChars) break; out.push(words[i]); len += words[i].length + (out.length > 1 ? 1 : 0); }
      while (out.length > 1 && JOIN[out[out.length - 1].toUpperCase()]) out.pop();
    } else {                                             // the close
      for (i = words.length - 1; i >= 0; i--) { if (out.length && len + 1 + words[i].length > maxChars) break; out.unshift(words[i]); len += words[i].length + (out.length > 1 ? 1 : 0); }
      while (out.length > 1 && JOIN[out[0].toUpperCase()] && out[0].toUpperCase() !== 'THE') out.shift();
    }
    return out.join(' ');
  }

  function dress(sp, P, PL) {
    var h1 = mix(seed, sp.cx, sp.cy, sp.w), h2 = mix(seed ^ 0x51ed, sp.cy, sp.cx, sp.h), h3 = mix(seed ^ 0xa11ce, sp.cx + sp.w, sp.cy, 7);
    var sgn = h1 < 0.5 ? -1 : 1, desk = sp.host.kind === 'desk';
    sp.ew = sp.w; sp.eh = sp.h; sp.rot = 0; sp.cls = ''; sp.d = {};
    sp.h1 = h1; sp.h2 = h2; sp.h3 = h3;
    switch (sp.type) {
      case 'clip': sp.rot = sgn * (2.5 + h2 * 6.5); break;
      case 'photo': sp.rot = sgn * (4 + h2 * 8); sp.d.src = PL.next('photos'); if (!sp.d.src) sp.type = 'paper'; break;
      case 'scrap': {
        var kinds = sp.v === 'n' ? ['rank'] : sp.v === 'm' ? ['match'] : sp.v === 's' ? ['score', 'score', 'record', 'week', 'code'] : ['name', 'tag', 'tag', 'week', 'mgr'];
        var kind = kinds[Math.floor(h2 * kinds.length)], txt = '';
        if (kind === 'match') { var bx = PL.next('matches'); if (bx) { sp.d.m = bx; txt = bx.k + ' / ' + bx.a + ' / ' + bx.b; } }
        else if (kind === 'rank') txt = PL.next('ranks');
        else if (kind === 'score') txt = PL.next('scores');
        else if (kind === 'record') txt = PL.next('records');
        else if (kind === 'week') txt = PL.next('weeks');
        else if (kind === 'code') txt = PL.next('codes');
        else if (kind === 'name') txt = PL.next('names');
        else if (kind === 'mgr') txt = PL.next('mgrs');
        else if (kind === 'tag') { txt = PL.next('tags'); if (txt) txt = tagFragment(txt, sp.v === 'l' ? 16 : 9, h3); }
        if (!txt) { kind = 'score'; txt = PL.next('scores') || PL.next('records') || PL.next('codes'); }
        if (!txt) { sp.type = 'paper'; break; }
        sp.d.kind = kind; sp.d.text = txt;
        sp.rot = sgn * (2 + h1 * 8);
        var stock = h3 < 0.44 ? 'a' : h3 < 0.7 ? 'b' : h3 < 0.88 ? 'k' : 'r';
        if (kind === 'rank' || kind === 'match') stock = h3 < 0.6 ? 'a' : 'b';
        sp.d.stock = stock;
        break;
      }
      case 'burst': {
        var pick = h2 < 0.42 ? 'score' : h2 < 0.62 ? 'stamp' : h2 < 0.76 ? 'rank' : '';
        sp.d.text = pick === 'score' ? PL.next('scores') : pick === 'stamp' ? PL.next('stamps') : pick === 'rank' ? PL.next('ranks') : '';
        sp.d.kind = sp.d.text ? pick : ''; sp.d.fill = h3 < 0.4 ? 'p' : h3 < 0.7 ? 'm' : (sp.d.kind === 'score' || !sp.d.kind ? 'r' : 'p');
        sp.rot = sgn * (4 + h1 * 14);
        break;
      }
      case 'stamp': sp.d.text = PL.next('stamps'); if (!sp.d.text) { sp.type = 'reg'; break; } sp.rot = sgn * (7 + h2 * 14); break;
      case 'proof': sp.d.text = PL.edWeek; sp.d.sub = PL.date; if (!sp.d.text) { sp.type = 'tape'; sp.ew = sp.w; sp.eh = Math.round(sp.w * 0.24); } sp.rot = sgn * (4 + h2 * 9); break;
      case 'ht': sp.d.pat = h2 < 0.4 ? 1 : h2 < 0.75 ? 2 : 3; sp.d.ink = desk ? (h3 < 0.34 ? 'p' : h3 < 0.58 ? 't' : h3 < 0.8 ? 'm' : 'r') : (h3 < 0.4 ? 'k' : h3 < 0.62 ? 'r' : h3 < 0.84 ? 't' : 's');
        if (sp.v === 'v') { sp.ew = sp.h; sp.eh = sp.w; sp.rot = (sgn > 0 ? 90 : -90) + (h1 - 0.5) * 4; sp.d.pat = 1; }
        else sp.rot = (h1 < 0.5 ? 0 : 180) + (h2 - 0.5) * 30;
        break;
      case 'hatch': sp.d.x = h2 < 0.45; sp.d.ink = desk ? (h3 < 0.6 ? 'p' : 't') : (h3 < 0.6 ? 'k' : h3 < 0.8 ? 'r' : 't'); sp.rot = (h1 - 0.5) * 26; break;
      case 'speed': sp.rot = Math.round(h1 * 360); sp.d.ink = desk ? (h3 < 0.75 ? 'p' : 'm') : (h3 < 0.75 ? 'k' : 'r'); break;
      case 'kirby': sp.rot = Math.round(h1 * 360); sp.d.ink = desk ? (h3 < 0.5 ? 'p' : h3 < 0.8 ? 'r' : 't') : (h3 < 0.7 ? 'k' : 'r'); break;
      case 'arrow': {
        var toRight = sp.host.x + sp.cx < P.vw / 2;          // point at the middle of the page
        sp.rot = (toRight ? 0 : 180) + (h1 - 0.5) * 36; sp.d.ink = h3 < 0.5 ? 'r' : h3 < 0.78 ? (desk ? 'p' : 'k') : 'm';
        break;
      }
      case 'tape': sp.rot = (h1 - 0.5) * 70; break;
      case 'panel': sp.rot = sgn * (2 + h2 * 7); sp.d.fill = h3 < 0.4 ? 'ht' : h3 < 0.72 ? 'speed' : 'hatch'; sp.d.ink = h1 < 0.3 ? 'r' : h1 < 0.55 ? 't' : h1 < 0.8 ? 'm' : 's'; sp.d.pat = 1 + Math.floor(h2 * 3); break;
      case 'spark': sp.rot = Math.round(h1 * 90); sp.d.ink = h3 < 0.4 ? 'r' : h3 < 0.65 ? (desk ? 'p' : 'k') : h3 < 0.85 ? 'm' : 't'; break;
      case 'ticks': if (sp.v === 'v') { sp.ew = sp.h; sp.eh = sp.w; sp.rot = sgn > 0 ? 90 : -90; } break;
      case 'reg': case 'crop': sp.rot = (h1 - 0.5) * 3 + (sp.type === 'crop' ? Math.floor(h2 * 4) * 90 : 0); break;
      case 'bars': if (sp.v === 'v') { sp.ew = sp.h; sp.eh = sp.w; sp.rot = (sgn > 0 ? 90 : -90) + (h2 - 0.5) * 1.6; } else sp.rot = (h2 - 0.5) * 1.6; break;
      case 'slug': sp.d.text = PL.next('slugs'); if (!sp.d.text) { sp.type = 'bars'; }
        if (sp.v === 'v') { sp.ew = sp.h; sp.eh = sp.w; sp.rot = sgn > 0 ? 90 : -90; }
        break;
      case 'paper': sp.rot = sgn * (3 + h2 * 16); sp.d.stock = h3 < 0.5 ? 'a' : 'b'; break;
    }
    if (sp.type === 'paper' && !sp.d.stock) { sp.d.stock = h3 < 0.5 ? 'a' : 'b'; sp.rot = sgn * (3 + h2 * 12); }
    sp.rot = Math.round(sp.rot * 10) / 10;
    sp.amb = !isReduce() && mix(seed ^ 0xbeef, sp.cx, sp.cy, 3) < sp.cat.amb;
    sp.z = sp.cat.z;
    sp.key = sp.R.id + '/' + sp.type + sp.v + '/' + sp.cx + ',' + sp.cy + ',' + sp.w + '/' + (sp.d.text || sp.d.src || '') + (sp.amb ? 'a' : 's');
    sp.px = sp.host.x + sp.cx; sp.py = sp.host.y + sp.cy;         // page coordinates of the centre
    bandsOf(sp, P);
  }

  // ---------------------------------------------------------------------------
  //  drawing a piece (DOM is only built for pieces near the viewport)
  // ---------------------------------------------------------------------------
  var shapeCache = {};
  function tear(w, h, k, amp) {                         // an irregular torn outline, px (a few variants per size, cached)
    var ck = 't' + w + 'x' + h + ':' + (k % 6) + ':' + Math.round(amp);
    if (shapeCache[ck]) return shapeCache[ck];
    var r = rng(k % 6 + 17), pts = [], n, i, t;
    var stepLen = 13 + r() * 8;
    n = Math.max(2, Math.round(w / stepLen)); for (i = 0; i < n; i++) { t = i / n; pts.push((t * w).toFixed(1) + 'px ' + (r() * amp).toFixed(1) + 'px'); }
    n = Math.max(2, Math.round(h / stepLen)); for (i = 0; i < n; i++) { t = i / n; pts.push((w - r() * amp).toFixed(1) + 'px ' + (t * h).toFixed(1) + 'px'); }
    n = Math.max(2, Math.round(w / stepLen)); for (i = 0; i < n; i++) { t = i / n; pts.push(((1 - t) * w).toFixed(1) + 'px ' + (h - r() * amp).toFixed(1) + 'px'); }
    n = Math.max(2, Math.round(h / stepLen)); for (i = 0; i < n; i++) { t = i / n; pts.push((r() * amp).toFixed(1) + 'px ' + ((1 - t) * h).toFixed(1) + 'px'); }
    return (shapeCache[ck] = 'polygon(' + pts.join(',') + ')');
  }
  function star(k) {                                    // comic starburst, %
    var ck = 's' + (k % 7);
    if (shapeCache[ck]) return shapeCache[ck];
    var r = rng(k % 7 + 3), n = 9 + Math.floor(r() * 5), pts = [], a0 = r() * 6.283;
    for (var i = 0; i < n * 2; i++) {
      var a = a0 + i * Math.PI / n, rad = i % 2 ? 30 + r() * 7 : 43 + r() * 7;
      pts.push((50 + Math.cos(a) * rad).toFixed(1) + '% ' + (50 + Math.sin(a) * rad).toFixed(1) + '%');
    }
    return (shapeCache[ck] = 'polygon(' + pts.join(',') + ')');
  }
  function blob(k) {                                    // a rough patch outline, %
    var ck = 'b' + (k % 7);
    if (shapeCache[ck]) return shapeCache[ck];
    var r = rng(k % 7 + 11), n = 9 + Math.floor(r() * 4), pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * 6.283, rad = 38 + r() * 12; pts.push((50 + Math.cos(a) * rad * 1.05).toFixed(1) + '% ' + (50 + Math.sin(a) * rad).toFixed(1) + '%'); }
    return (shapeCache[ck] = 'polygon(' + pts.join(',') + ')');
  }
  function kirbyBg(k, w) {                              // Kirby dots: a crackle of solid discs, largest in the middle
    var r = rng(k), n = 9 + Math.floor(r() * 6), out = [];
    for (var i = 0; i < n; i++) {
      var a = r() * 6.283, d = Math.pow(r(), 0.7) * 40, rad = Math.max(1.5, (1 - d / 46) * w * (0.05 + r() * 0.09));
      out.push('radial-gradient(circle at ' + (50 + Math.cos(a) * d).toFixed(1) + '% ' + (50 + Math.sin(a) * d).toFixed(1) + '%, currentColor 0 ' + rad.toFixed(1) + 'px, transparent ' + (rad + 0.6).toFixed(1) + 'px)');
    }
    return out.join(',');
  }

  var assetsDone = false;
  function assets() {                                   // halftone masks + film grain, made once, handed to CSS as custom properties
    if (assetsDone) return; assetsDone = true;
    var ht = function (kind, gain) {
      var w = 160, h = 100, pitch = 8, out = '', row = 0;
      for (var y = pitch / 2; y < h; y += pitch * 0.866, row++) for (var x = (row % 2 ? pitch / 2 : 0) + pitch / 2; x < w; x += pitch) {
        var t = kind === 1 ? x / w : kind === 2 ? Math.min(1, Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2))) : clamp((x / w) * 0.62 + (1 - y / h) * 0.5, 0, 1);
        var rad = pitch * 0.62 * gain * Math.pow(1 - t, 0.85);
        if (rad > 0.4) out += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + Math.min(rad, pitch * 0.7).toFixed(2) + '"/>';
      }
      return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="none">' + out + '</svg>') + '")';
    };
    var st = H.style;
    for (var k = 1; k <= 3; k++) { st.setProperty('--cl-ht' + k, ht(k, 1)); st.setProperty('--cl-ht' + k + 'b', ht(k, 1.32)); }
    try {                                                // the same kind of grain the cutscene lays over its clips
      var cv = D.createElement('canvas'); cv.width = cv.height = 128;
      var g = cv.getContext('2d'), im = g.createImageData(128, 128), d = im.data, r = rng(7);
      for (var i = 0; i < d.length; i += 4) { var v = r() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.floor(r() * r() * 150); }
      g.putImageData(im, 0, 0);
      st.setProperty('--cl-grain', 'url(' + cv.toDataURL('image/png') + ')');
    } catch (e) { st.setProperty('--cl-grain', 'none'); }
  }

  var BUILD = {
    clip: function (sp, p, b) {
      var f = mk('div', 'cl-frame'), s = mk('div', 'cl-screen');
      f.appendChild(s); b.appendChild(f);
      if (sp.h3 < 0.55) { var t = mk('i', 'cl-tp'); t.style.cssText = (sp.h1 < 0.5 ? 'left:-9%;' : 'right:-9%;') + 'top:-5%;transform:rotate(' + (sp.h1 < 0.5 ? -34 : 31) + 'deg)'; b.appendChild(t); }
      sp.screen = s;
    },
    photo: function (sp, p, b) {
      var f = mk('div', 'cl-frame'), s = mk('div', 'cl-screen'), img = D.createElement('img');
      p.style.setProperty('--tear', tear(sp.ew, sp.eh, hashStr(sp.key), 4));
      img.alt = ''; img.decoding = 'async'; img.draggable = false; img.src = sp.d.src;
      s.appendChild(img); f.appendChild(s); b.appendChild(f);
    },
    scrap: function (sp, p, b) {
      var sh = mk('div', 'cl-sheet cl-sheet--' + sp.d.stock), k = sp.d.kind, w = sp.ew, h = sp.eh, t = mk('span', 'cl-t cl-t--' + k, sp.d.text), fs;
      p.style.setProperty('--tear', tear(w, h, hashStr(sp.key), Math.min(5, h * 0.14)));
      if (k === 'match') {                                    // three short lines: the week (or year), the winner, the loser
        var m = sp.d.m; t.textContent = '';
        fs = fit(m.a.length >= m.b.length ? m.a : m.b, 'data', w, h, 0.25, w * 0.1);
        t.appendChild(mk('span', 'cl-m__k', m.k));
        [m.a, m.b].forEach(function (ln, li) {             // "SAX 133.16" → code to the left, points to the right
          var row = mk('span', li ? 'cl-m__b' : 'cl-m__a'), cut = ln.lastIndexOf(' ');
          if (cut > 0) { row.appendChild(mk('span', '', ln.slice(0, cut))); row.appendChild(mk('span', '', ln.slice(cut + 1))); } else row.textContent = ln;
          t.appendChild(row);
        });
      }
      else if (k === 'rank') fs = fit(sp.d.text, 'scream', w, h, 0.86, w * 0.1);
      else if (k === 'score') fs = fit(sp.d.text, 'scream', w, h, 0.72, h * 0.22);
      else if (k === 'tag') fs = fit(sp.d.text, 'scream', w, h, 0.68, h * 0.24, true);
      else if (k === 'record') fs = fit(sp.d.text, 'data', w, h, 0.66, h * 0.24);
      else if (k === 'code') fs = fit(sp.d.text + 'MMM', 'data', w, h, 0.46, h * 0.2);
      else if (k === 'week') fs = fit(sp.d.text, 'head', w, h, 0.6, h * 0.24);
      else if (k === 'name') fs = fit(sp.d.text, 'head', w, h, 0.56, h * 0.26);
      else fs = fit(sp.d.text, 'body', w, h, 0.58, h * 0.26);
      t.style.fontSize = fs.toFixed(1) + 'px';
      if (k === 'rank' || k === 'score' || k === 'tag') t.setAttribute('data-t', sp.d.text);
      sh.appendChild(t); b.appendChild(sh);
    },
    burst: function (sp, p, b) {
      p.style.setProperty('--star', star(hashStr(sp.key)));
      b.appendChild(mk('i', 'cl-burst__o')); b.appendChild(mk('i', 'cl-burst__i cl-burst__i--' + sp.d.fill));
      if (sp.d.text) {
        var t = mk('span', 'cl-t cl-t--' + (sp.d.kind === 'stamp' ? 'wl cl-t--' + sp.d.text.toLowerCase() : sp.d.kind), sp.d.text);
        t.style.fontSize = fit(sp.d.text, 'scream', sp.ew * 0.56, sp.eh * 0.5, sp.d.text.length < 3 ? 0.9 : 0.6, 0).toFixed(1) + 'px';
        t.style.transform = 'rotate(' + (-sp.rot - 6).toFixed(1) + 'deg)';
        b.appendChild(t);
      }
    },
    stamp: function (sp, p, b) {
      var sh = mk('div', 'cl-sheet cl-sheet--' + (sp.h3 < 0.6 ? 'a' : 'b')), t = mk('span', 'cl-t cl-t--' + sp.d.text.toLowerCase(), sp.d.text);
      p.style.setProperty('--tear', tear(sp.ew, sp.eh, hashStr(sp.key), 3.5));
      t.style.fontSize = (sp.eh * 0.5).toFixed(1) + 'px';
      sh.appendChild(t); b.appendChild(sh);
    },
    proof: function (sp, p, b) {
      var t = mk('span', 'cl-t', sp.d.text);
      t.style.fontSize = fit(sp.d.text, 'scream', sp.ew, sp.eh, 0.5, sp.ew * 0.1, true).toFixed(1) + 'px';
      b.appendChild(t);
      if (sp.d.sub) { var s = mk('span', 'cl-t2', sp.d.sub); s.style.fontSize = Math.max(6.5, fit(sp.d.sub, 'data', sp.ew, sp.eh, 0.19, sp.ew * 0.09, true)).toFixed(1) + 'px'; b.appendChild(s); }
    },
    ht: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink + ' cl-ht--' + sp.d.pat; },
    hatch: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink + (sp.d.x ? ' cl-hatch--x' : ''); b.style.clipPath = blob(hashStr(sp.key)); },
    speed: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink; b.style.clipPath = blob(hashStr(sp.key) ^ 5); },
    kirby: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink; b.style.backgroundImage = kirbyBg(hashStr(sp.key), sp.ew); },
    arrow: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink; },
    panel: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink + ' cl-panel--' + sp.d.fill + ' cl-ht--' + sp.d.pat; b.appendChild(mk('i', 'cl-panel__in')); },
    spark: function (sp, p, b) { p.className += ' cl-ink-' + sp.d.ink; },
    ticks: function () {},
    tape: function () {},
    reg: function (sp, p, b) { b.appendChild(mk('i', 'cl-reg__o')); },
    crop: function () {},
    bars: function () {},
    slug: function (sp, p, b) {
      var t = mk('span', 'cl-t', sp.d.text);
      t.style.fontSize = Math.min(sp.eh * 0.74, 11.5, fit(sp.d.text + 'MM', 'data', sp.ew * 0.86, sp.eh, 0.74, 0, true)).toFixed(1) + 'px';
      b.appendChild(t);
    },
    paper: function (sp, p, b) {
      var sh = mk('div', 'cl-sheet cl-sheet--' + sp.d.stock + ' cl-sheet--lines');
      p.style.setProperty('--tear', tear(sp.ew, sp.eh, hashStr(sp.key), 7));
      sh.style.setProperty('--col', Math.round(sp.ew / (sp.h1 < 0.5 ? 2 : 3)) + 'px');
      b.appendChild(sh);
    }
  };

  function regionEl(host, R) {
    var e = host.regions[R.id];
    if (e && e.el.parentNode === host.layer) { if (e.w !== R.pw || e.h !== R.ph) { e.el.style.width = R.pw + 'px'; e.el.style.height = R.ph + 'px'; e.w = R.pw; e.h = R.ph; } return e.el; }
    var el = mk('div', 'cl-r');
    el.style.cssText = 'left:' + R.px + 'px;top:' + R.py + 'px;width:' + R.pw + 'px;height:' + R.ph + 'px';
    host.regions[R.id] = { el: el, w: R.pw, h: R.ph, n: 0 };
    host.layer.appendChild(el);
    return el;
  }

  function mount(sp) {
    var host = sp.host;
    if (!host.layer || !host.layer.isConnected) return;
    var p = sp.node;
    if (!p) {
      p = mk('div', 'cl-p cl-' + sp.type + (sp.amb ? ' cl-amb' : '') + (sp.h2 < 0.5 ? ' cl-alt' : ''));
      var st = p.style;
      st.left = (sp.cx - sp.ew / 2 - sp.R.px) + 'px'; st.top = (sp.cy - sp.eh / 2 - sp.R.py) + 'px';
      st.width = sp.ew + 'px'; st.height = sp.eh + 'px'; st.zIndex = sp.z;
      if (sp.rot) st.setProperty('--r', sp.rot + 'deg');
      var b = mk('div', 'cl-b');
      p.appendChild(b);
      (BUILD[sp.type] || BUILD.tape)(sp, p, b);
      if (sp.type === 'clip') { sp.blank = true; p.className += ' cl-blank'; }   // out of sight until its canvas has a picture
      sp.node = p;
    }
    var rel = regionEl(host, sp.R);
    host.regions[sp.R.id].n++;
    rel.appendChild(p);
    sp.live = true;
    if (sp.type === 'clip') {
      if (!ioClip && typeof IntersectionObserver === 'function') ioClip = new IntersectionObserver(seeClips, { rootMargin: '8px 0px' });
      if (ioClip) { p.__sp = sp; sp.seen = false; ioClip.observe(p); }
    }
  }
  function unmount(sp) {                                 // out of the document; the built node is kept for when it scrolls back
    if (sp.awake) sleep(sp);
    var p = sp.node, host = sp.host;
    if (p && ioClip && sp.type === 'clip') { ioClip.unobserve(p); sp.seen = false; }
    if (p && p.parentNode) p.parentNode.removeChild(p);
    var e = host.regions[sp.R.id];
    if (e && sp.live) { e.n--; if (e.n <= 0) { if (e.el.parentNode) e.el.parentNode.removeChild(e.el); delete host.regions[sp.R.id]; } }
    sp.live = false;
    if (hot === sp) hot = null;
    if (tapped === sp) tapped = null;
  }

  // ---------------------------------------------------------------------------
  //  clips
  // ---------------------------------------------------------------------------
  function pickClip() {                                  // the clip showing on the fewest pieces, taking turns through the reel
    var names = (W.ATLAS && ATLAS.clips) || [], n = names.length, best = -1, bu = 1e9;
    for (var i = 0; i < n; i++) { var k = (clipTurn + i) % n, u = clipUse[names[k]] || 0; if (u < bu) { bu = u; best = k; } }
    if (best < 0) return null;
    clipTurn = (best + 1) % n;
    return names[best];
  }
  function startAtlas() {
    if (!W.ATLAS) return;
    try { ATLAS.start(); atlasStarted = true; } catch (e) { /* ignore */ }
    if (reelAsked) return;
    reelAsked = true;                                      // clippings stay out of sight until there is a picture to print
    try {
      ATLAS.ready().then(function (ok) {
        if (!ok) return;
        H.classList.add('cl-reel');
        unblank(520);
      });
    } catch (e) { /* ignore */ }
  }
  // A clipping is out of sight (.cl-blank) until its canvas holds a picture, so there is never an empty frame on the
  // page. Its first picture is copied from one still of the whole reel (kept here, retaken at most every few seconds
  // and never while a phone is scrolling) — a canvas-to-canvas copy, not another read of the video.
  var still = null, stillT = -1e9;
  function reelStill() {
    var v = W.ATLAS && ATLAS.video, t = now();
    if (still && (scrolling || t - stillT < 3000)) return still;
    if (!v || v.readyState < 2 || !v.videoWidth) return still;
    try {
      if (!still) { still = D.createElement('canvas'); still.width = v.videoWidth; still.height = v.videoHeight; }
      still.getContext('2d').drawImage(v, 0, 0);
      stillT = t;
    } catch (e) { /* keep the one we have */ }
    return still;
  }
  function clipDraw(sp) {
    var c = sp.canvas;
    if (!c || !c.width) return false;
    var k = ATLAS.clips.indexOf(sp.clip), src = k < 0 ? null : reelStill();
    if (!src) return false;
    var cols = Math.max(1, Math.round(src.width / c.width));
    try { c.getContext('2d').drawImage(src, (k % cols) * c.width, Math.floor(k / cols) * c.height, c.width, c.height, 0, 0, c.width, c.height); } catch (e) { return false; }
    return true;
  }
  function unblank(spread) {
    for (var i = 0; i < awake.length; i++) {
      var sp = awake[i];
      if (sp.type !== 'clip' || !sp.blank || !sp.canvas || !sp.node || !clipDraw(sp)) continue;
      sp.blank = false;
      var cl = sp.node.classList;
      cl.remove('cl-blank');
      if (!isReduce() && sp.st === 'on') { if (spread) sp.node.style.setProperty('--d', Math.round(Math.random() * spread) + 'ms'); else sp.node.style.removeProperty('--d'); cl.remove('cl-gl', 'cl-flip'); cl.add('cl-pop'); }
    }
  }
  function seeClips(es) {                                // a clipping's own visibility: it holds a canvas only while some of it is on screen
    for (var k = 0; k < es.length; k++) {
      var sp = es[k].target.__sp;
      if (!sp) continue;
      sp.seen = es[k].isIntersecting;
      if (!sp.seen) clipOff(sp); else if (sp.awake && sp.st === 'on') clipOn(sp);
    }
  }
  function clipOn(sp, name) {
    if (!W.ATLAS || !sp.screen || sp.canvas || (ioClip && !sp.seen)) return;
    if (scrolling) return;                               // a phone in mid-scroll: no new canvases now — tick() hands them out when it stops
    name = name || pickClip();
    if (!name) return;
    var c = ATLAS.canvas(name);
    sp.canvas = c; sp.clip = name; clipUse[name] = (clipUse[name] || 0) + 1;
    sp.screen.appendChild(c);
    startAtlas();
    sp.blank = !clipDraw(sp);
    if (sp.node) sp.node.classList.toggle('cl-blank', sp.blank);
    if (isReduce()) {                                    // still picture: keep the first frame, stop painting
      var done = function () { unblank(0); W.requestAnimationFrame(function () { W.requestAnimationFrame(function () { if (sp.canvas === c) { try { ATLAS.release(c); } catch (e) { /* ignore */ } } }); }); };
      try { ATLAS.ready().then(done); } catch (e) { /* ignore */ }
    }
  }
  function clipOff(sp) {
    var c = sp.canvas;
    if (!c) return;
    try { ATLAS.release(c); } catch (e) { /* ignore */ }
    if (c.parentNode) c.parentNode.removeChild(c);
    c.width = c.height = 0;
    clipUse[sp.clip] = Math.max(0, (clipUse[sp.clip] || 1) - 1);
    sp.canvas = null; sp.clip = ''; sp.blank = true;
    if (sp.node) sp.node.classList.add('cl-blank');
  }

  // ---------------------------------------------------------------------------
  //  waking / sleeping pieces as the page scrolls
  // ---------------------------------------------------------------------------
  function wake(sp) {
    var p = sp.node, cl = p.classList, t = now(), r = mix(seed ^ 0x77, sp.cx, sp.cy, Math.floor(t / 1000));
    sp.awake = true; awake.push(sp);
    if (sp.type === 'clip') { cl.add('cl-on'); if (!sp.canvas) { sp.blank = true; cl.add('cl-blank'); } }
    cl.remove('cl-pop', 'cl-out', 'cl-gl', 'cl-hot', 'cl-tap', 'cl-flip');
    if (isReduce()) { cl.remove('cl-off'); sp.st = 'on'; sp.t = Infinity; sp.tg = 0; if (sp.type === 'clip') clipOn(sp); return; }
    if (arriving) {                                      // the burst-in: everything snaps in, a little apart
      if (sp.amb && r < 0.35) { cl.add('cl-off'); sp.st = 'off'; sp.t = t + 900 + r * 9000; return; }
      p.style.setProperty('--d', Math.round(mix(seed, sp.cx, sp.cy, 11) * (arriving === 2 ? 760 : 420)) + 'ms');
      cl.remove('cl-off'); cl.add('cl-pop');
      sp.st = 'on'; sp.t = sp.amb ? t + 3500 + r * 9000 : Infinity; sp.tg = sp.amb ? t + 1500 + r * 1500 : 0;
      if (sp.type === 'clip') clipOn(sp);
      return;
    }
    if (sp.amb && r < 0.4) { cl.add('cl-off'); sp.st = 'off'; sp.t = t + 300 + r * 6000; return; }
    cl.remove('cl-off');
    sp.st = 'on'; sp.t = sp.amb ? t + 1500 + r * 9000 : Infinity; sp.tg = 0;
    if (sp.type === 'clip') clipOn(sp);
  }
  function sleep(sp) {
    sp.awake = false;
    var i = awake.indexOf(sp); if (i >= 0) awake.splice(i, 1);
    if (sp.node) sp.node.classList.remove('cl-on', 'cl-pop', 'cl-out', 'cl-gl', 'cl-hot', 'cl-tap', 'cl-flip');
    if (sp.type === 'clip') clipOff(sp);
    if (hot === sp) hot = null;
  }

  // Which bands of the page are near / in the viewport comes from two IntersectionObservers on one sentinel per band,
  // so scrolling never makes this script read layout (not even scrollY).
  function inBands(set, sp) { for (var k = sp.b0; k <= sp.b1; k++) if (set[k]) return true; return false; }
  function sync() {                                      // which pieces exist / are awake for the bands now in range
    rafScroll = 0;
    if (!shown || disabled) return;
    var made = 0, more = false, moreSeen = false, hi, i, sp, specs;
    if (arriving && !planning && now() > arriveEnd) arriving = 0;
    // pass 0: what is in view (built first, a batch a frame); pass 1: the margin above and below
    for (var pass = 0; pass < 2; pass++) {
      for (hi = 0; hi < hosts.length; hi++) {
        specs = hosts[hi].specs;
        for (i = 0; i < specs.length; i++) {
          sp = specs[i];
          if (sp.dead) continue;
          var aw = inBands(awakeB, sp), live = aw || inBands(liveB, sp);
          if (pass === 0) {
            if (!live && sp.live) unmount(sp);
            else if (aw && !sp.live) { if (made < MOUNT_BATCH) { mount(sp); made++; } else moreSeen = true; }
            if (sp.live) { if (aw && !sp.awake) wake(sp); else if (!aw && sp.awake) sleep(sp); }
          } else if (live && !aw && !sp.live) { if (made < MOUNT_BATCH) { mount(sp); made++; } else more = true; }
        }
      }
    }
    schedule();
    if ((more || moreSeen) && !rafScroll) rafScroll = W.requestAnimationFrame(sync);
  }
  function askSync() { if (!rafScroll && shown) rafScroll = W.requestAnimationFrame(sync); }
  function setBands(P) {                                 // one sentinel per band of the page, watched by both observers
    if (!rootLayer || typeof IntersectionObserver !== 'function') { liveB = { all: 1 }; awakeB = { all: 1 }; return; }
    var key = P.band + ':' + P.vh, n = Math.max(1, Math.ceil(rootHost.h / P.band)), i, e;
    if (key !== bandKey || !sentBox || sentBox.parentNode !== rootLayer) {
      if (ioLive) ioLive.disconnect();
      if (ioAwake) ioAwake.disconnect();
      if (sentBox && sentBox.parentNode) sentBox.parentNode.removeChild(sentBox);
      bandKey = key; sents = []; liveB = {}; awakeB = {};
      sentBox = mk('div', 'cl-sents'); sentBox.__cl = true;
      rootLayer.appendChild(sentBox);
      var on = function (set) { return function (es) { for (var k = 0; k < es.length; k++) set[es[k].target.__band] = es[k].isIntersecting; askSync(); }; };
      ioLive = new IntersectionObserver(on(liveB), { rootMargin: Math.round(P.vh * 0.5) + 'px 0px' });
      ioAwake = new IntersectionObserver(on(awakeB), { rootMargin: '24px 0px' });
    }
    while (sents.length > n) { e = sents.pop(); ioLive.unobserve(e); ioAwake.unobserve(e); sentBox.removeChild(e); delete liveB[e.__band]; delete awakeB[e.__band]; }
    for (i = sents.length; i < n; i++) {
      e = mk('i', 'cl-sent'); e.__band = i; e.__cl = true;
      e.style.cssText = 'top:' + (i * P.band) + 'px;height:' + P.band + 'px';
      sentBox.appendChild(e); sents.push(e);
      ioLive.observe(e); ioAwake.observe(e);
    }
  }
  function bandsOf(sp, P) { sp.b0 = Math.floor((sp.py - sp.h * 0.6) / P.band); sp.b1 = Math.floor((sp.py + sp.h * 0.6) / P.band); if (liveB.all) { sp.b0 = sp.b1 = 'all'; } }

  // ---------------------------------------------------------------------------
  //  the one scheduler: ambient pieces pop in and out, clips flip through the reel
  // ---------------------------------------------------------------------------
  function schedule() {
    var need = shown && !disabled && !D.hidden && !isReduce() && awake.length > 0;
    if (need && !tickTimer) tickTimer = W.setTimeout(tick, 240);
    else if (!need && tickTimer) { W.clearTimeout(tickTimer); tickTimer = 0; }
  }
  // Phones: while the page is being scrolled the reel is held (no decoding, no canvas painting) and nothing pops; it all
  // picks up again a moment after the scroll stops. The handler itself only notes the time — it reads no layout.
  var owed = false, scrollGap = 0, idleSeen = 0, idleN = 0;             // typical time between scroll events of the scroll in progress; idle checks passed
  function onScroll() {
    var t = now(), gap = t - scrollT;
    scrollT = t;
    if (gap < 1500) scrollGap = scrollGap ? scrollGap * 0.6 + gap * 0.4 : gap; else scrollGap = 0;
    if (scrolling || !shown || !curP || !curP.phone || isReduce()) return;
    scrolling = true;
    if (W.ATLAS && atlasStarted) { try { ATLAS.pause(); } catch (e) { /* ignore */ } }
  }
  function tick() {
    tickTimer = 0;
    if (!shown || disabled || D.hidden || isReduce()) return;
    var t = now(), starts = 0, clips = 0, i, sp, cl;
    if (scrolling) {
      // stopped = two looks in a row without a new scroll event, and a pause well beyond the gaps of this scroll
      // (when frames are slow the gaps are long: the reel must not stop-start between them)
      if (scrollT !== idleSeen) { idleSeen = scrollT; idleN = 0; } else idleN++;
      if (idleN < 2 || t - scrollT < clamp(scrollGap * 2.5, 180, 1800)) { tickTimer = W.setTimeout(tick, 110); return; }
      scrolling = false;
      if (W.ATLAS && atlasStarted) { try { ATLAS.resume(); } catch (e) { /* ignore */ } }
      for (i = 0; i < awake.length; i++) { sp = awake[i]; if (sp.amb && sp.t !== Infinity) sp.t += 400; }   // nobody pops the instant the finger lifts
      owed = true;                                         // … but the clippings that scrolled in are owed their pictures
    }
    unblank(0);
    if (owed) {                                            // two a beat, so the hand-out is never one long task
      var given = 0; owed = false;
      for (i = 0; i < awake.length; i++) {
        sp = awake[i];
        if (sp.type !== 'clip' || sp.st !== 'on' || sp.canvas || (ioClip && !sp.seen)) continue;
        if (given < 2) { clipOn(sp); given++; } else { owed = true; break; }
      }
    }
    for (i = 0; i < awake.length; i++) {
      sp = awake[i];
      if (sp.type === 'clip' && sp.canvas) clips++;
      if (!sp.amb || !sp.node) continue;
      cl = sp.node.classList;
      if (sp.st === 'off') {
        if (t >= sp.t && starts < 2) {                   // at most two arrivals a beat: never a synchronised pulse
          starts++;
          sp.node.style.removeProperty('--d');
          cl.remove('cl-off', 'cl-out'); cl.add('cl-pop');
          if (sp.type === 'clip') clipOn(sp);
          sp.st = 'on'; sp.t = t + 3400 + Math.random() * 6200; sp.tg = t + 1200 + Math.random() * 1800;
        }
      } else if (sp.st === 'on') {
        if (sp.tg && t >= sp.tg) { sp.tg = 0; if (hot !== sp) { cl.remove('cl-pop'); cl.add('cl-gl'); } }
        else if (t >= sp.t && hot !== sp) { cl.remove('cl-pop', 'cl-gl', 'cl-tap'); cl.add('cl-out'); sp.st = 'out'; sp.t = t + 330; }
      } else if (sp.st === 'out') {
        if (t >= sp.t) { cl.add('cl-off'); cl.remove('cl-out'); if (sp.type === 'clip') clipOff(sp); sp.st = 'off'; sp.t = t + 1300 + Math.random() * 4200; }
      }
    }
    // fewer clippings on screen than clips on the reel: one of them flips to a clip that is not showing
    var total = (W.ATLAS && ATLAS.clips ? ATLAS.clips.length : 0);
    if (clips && clips < total && t >= nextCycle) {
      nextCycle = t + 2600 + Math.random() * 2600;
      var cands = awake.filter(function (s) { return s.type === 'clip' && s.canvas && !s.blank && s.st === 'on' && s !== hot && !s.node.classList.contains('cl-pop'); });
      if (cands.length) {
        sp = cands[Math.floor(Math.random() * cands.length)];
        var nm = pickClip();
        if (nm && nm !== sp.clip) { clipOff(sp); clipOn(sp, nm); cl = sp.node.classList; cl.remove('cl-gl', 'cl-tap'); cl.add('cl-flip'); }
      }
    }
    tickTimer = W.setTimeout(tick, owed ? 90 : 200 + Math.random() * 120);
  }
  function onAnimEnd(e) {
    var n = e.animationName;
    if (!n || n.slice(0, 3) !== 'cl-') return;
    var b = e.target, p = b && b.parentNode;
    if (!p || !p.classList || !b.classList || !b.classList.contains('cl-b')) return;
    if (n === 'cl-pop') p.classList.remove('cl-pop');
    else if (n === 'cl-glitch') p.classList.remove('cl-gl');
    else if (n === 'cl-flip') p.classList.remove('cl-flip');
  }

  // ---------------------------------------------------------------------------
  //  hover / tap, by arithmetic (no element of ours ever takes a pointer event)
  // ---------------------------------------------------------------------------
  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[data-tip],[tabindex]:not(#view)';
  function visibleAt(host, pageX, pageY) {
    var g = host.grid; if (!g) return false;
    var x = Math.floor((pageX - host.x) / g.c), y = Math.floor((pageY - host.y) / g.c);
    if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) return false;
    var I = g.I, w = g.gw1;
    return (I[(y + 1) * w + x + 1] - I[y * w + x + 1] - I[(y + 1) * w + x] + I[y * w + x]) > 0;
  }
  function pieceAt(pageX, pageY, slop) {
    var best = null;
    for (var i = 0; i < awake.length; i++) {
      var sp = awake[i];
      if (sp.st !== 'on' || (sp.type === 'clip' && sp.blank)) continue;
      var dx = pageX - sp.px, dy = pageY - sp.py;
      if (sp.rot) {                                        // into the piece's own (tilted) frame
        var an = -sp.rot * 0.017453292519943295, co = Math.cos(an), si = Math.sin(an), lx = dx * co - dy * si;
        dy = dx * si + dy * co; dx = lx;
      }
      if (Math.abs(dx) > Math.max(sp.ew, 20) / 2 + slop || Math.abs(dy) > Math.max(sp.eh, 20) / 2 + slop) continue;
      var R = sp.R, hx = pageX - sp.host.x, hy = pageY - sp.host.y;
      if (hx < R.px - slop || hy < R.py - slop || hx > R.px + R.pw + slop || hy > R.py + R.ph + slop) continue;
      if (!slop && !visibleAt(sp.host, pageX, pageY)) continue;
      if (!best || sp.z >= best.z) best = sp;
    }
    return best;
  }
  function setHot(sp) {
    if (hot === sp) return;
    if (hot && hot.node) hot.node.classList.remove('cl-hot');
    hot = sp;
    if (sp && sp.node) { sp.node.classList.remove('cl-pop', 'cl-gl', 'cl-tap', 'cl-flip'); sp.node.classList.add('cl-hot'); }
  }
  var moveX = 0, moveY = 0, moveT = null;
  // Is the thing under the pointer something a piece would be hidden by (a clipping, a photo, the stuck nav, any solid box)?
  // The grid knows covers where they rest; this also catches the edge of one and anything stuck or fixed over the page.
  var coverMemo = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function underCover(t) {
    for (var n = 0; t && t.nodeType === 1 && t !== view && t !== app && t !== D.body && n < 12; t = t.parentNode, n++) {
      if (t.classList.contains('desk')) return false;       // a desk is a host: its pieces lie on it, not under it
      var v = coverMemo ? coverMemo.get(t) : undefined;
      if (v === undefined) {
        var cs = getComputedStyle(t);
        v = OPAQUE[t.tagName] || t.classList.contains('clipping') || t.classList.contains('news-photo') || cs.position === 'sticky' || cs.position === 'fixed' || alphaOf(cs.backgroundColor) >= 0.95;
        if (coverMemo) coverMemo.set(t, !!v);
      }
      if (v) return true;
    }
    return false;
  }
  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    moveX = e.pageX; moveY = e.pageY; moveT = e.target;
    if (!rafMove) rafMove = W.requestAnimationFrame(doMove);
  }
  function doMove() {
    rafMove = 0;
    if (!shown || !awake.length || isReduce()) { setHot(null); return; }
    setHot(underCover(moveT) ? null : pieceAt(moveX, moveY, 0));   // only where the piece shows
  }
  function onDown(e) {
    if (!atlasStarted || (W.ATLAS && ATLAS.video && ATLAS.video.paused)) { if (awake.some(function (s) { return s.type === 'clip'; })) startAtlas(); }
    if (!shown || !awake.length || isReduce()) return;
    if (e.pointerType === 'mouse') return;                // the mouse has hover
    var t = e.target;
    if (t && t.closest && t.closest(INTERACTIVE)) return;
    var sp = pieceAt(e.pageX, e.pageY, 0) || pieceAt(e.pageX, e.pageY, 14);
    if (!sp || !sp.node) return;
    if (tapped && tapped.node) tapped.node.classList.remove('cl-tap');
    W.clearTimeout(tapTimer);
    tapped = sp;
    var cl = sp.node.classList; cl.remove('cl-pop', 'cl-gl', 'cl-flip'); cl.add('cl-tap');
    tapTimer = W.setTimeout(function () { if (tapped && tapped.node) tapped.node.classList.remove('cl-tap'); tapped = null; tapTimer = 0; }, 950);
  }

  // ---------------------------------------------------------------------------
  //  layers
  // ---------------------------------------------------------------------------
  function makeLayer(host) {
    var l = mk('div', 'cl-layer cl-layer--' + host.kind);
    l.__cl = true; l.setAttribute('aria-hidden', 'true');
    host.el.appendChild(l);
    host.layer = l; host.regions = {};
    return l;
  }
  function dropHost(host) {
    for (var i = 0; i < host.specs.length; i++) if (host.specs[i].live) unmount(host.specs[i]);
    host.specs = []; host.regions = {};
    if (host.layer && host.kind === 'desk') { if (host.layer.parentNode) host.layer.parentNode.removeChild(host.layer); host.layer = null; }
    else if (host.layer) { var rs = host.layer.querySelectorAll('.cl-r'); for (var j = 0; j < rs.length; j++) host.layer.removeChild(rs[j]); }
  }
  function clearAll() {
    for (var i = 0; i < hosts.length; i++) dropHost(hosts[i]);
    hosts = rootHost ? [rootHost] : [];
    awake = []; hot = null; tapped = null; clipUse = {}; planJob++; planning = false; arriving = 0;
    if (scrolling) { scrolling = false; if (W.ATLAS && atlasStarted) { try { ATLAS.resume(); } catch (e) { /* ignore */ } } }
    if (rootHost) { rootHost.specs = []; rootHost.sig = ''; }
  }

  // ---------------------------------------------------------------------------
  //  relayout: measure → (only where something moved) plan → mount
  // ---------------------------------------------------------------------------
  function currentRoute() {
    var cur = (W.APP && APP.current) ? APP.current() : null, name = (cur && cur.name) || D.body.getAttribute('data-route') || 'front';
    var slug = (cur && cur.params && cur.params.slug) || '';
    return { name: name, slug: slug, key: name + ':' + slug };
  }

  function purge(host, P) {                              // retire pieces of the old plan whose visible part now meets a bare-content box
    var pad = Math.max(1, P.pad - 2), hard = host.hard, i, j;
    for (i = 0; i < host.specs.length; i++) {
      var sp = host.specs[i];
      if (sp.dead) continue;
      var R = sp.R, half = Math.sqrt(sp.ew * sp.ew + sp.eh * sp.eh) / 2;
      var x0 = host.x + Math.max(sp.cx - half, R.px), x1 = host.x + Math.min(sp.cx + half, R.px + R.pw), y0 = host.y + Math.max(sp.cy - half, R.py), y1 = host.y + Math.min(sp.cy + half, R.py + R.ph);
      for (j = 0; j < hard.length; j++) {
        var r = hard[j];
        if (r[0] - pad < x1 && r[0] + r[2] + pad > x0 && r[1] - pad < y1 && r[1] + r[3] + pad > y0) { if (sp.live) unmount(sp); sp.dead = true; break; }
      }
    }
  }

  function clearFor(el) {                                // retire the live pieces that the words of `el` (as laid out now) reach
    if (!range) range = D.createRange();
    range.selectNodeContents(el);
    var r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    var pad = Math.max(1, (curP ? curP.pad : 6) - 2), sx = W.pageXOffset || 0, sy = W.pageYOffset || 0;
    var bx0 = r.left + sx - pad, bx1 = r.right + sx + pad, by0 = r.top + sy - pad, by1 = r.bottom + sy + pad;
    var desk = el.closest('.desk'), host = desk ? (deskState && deskState.get(desk)) : rootHost;
    if (!host || !host.specs) return;
    for (var i = 0; i < host.specs.length; i++) {
      var sp = host.specs[i];
      if (sp.dead || !sp.live) continue;
      var R = sp.R, half = Math.sqrt(sp.ew * sp.ew + sp.eh * sp.eh) * 0.62;      // its reach in any pose (a pop or a stamp swells it)
      var x0 = host.x + Math.max(sp.cx - half, R.px), x1 = host.x + Math.min(sp.cx + half, R.px + R.pw), y0 = host.y + Math.max(sp.cy - half, R.py), y1 = host.y + Math.min(sp.cy + half, R.py + R.ph);
      if (bx0 < x1 && bx1 > x0 && by0 < y1 && by1 > y0) { unmount(sp); sp.dead = true; }
    }
  }

  function relayout() {
    rafPlan = 0; kickDue = 0; kickFirst = 0;
    if (!started || disabled) return;
    held = isHeld();
    if (held) { if (shown) { shown = false; clearAll(); schedule(); } return; }
    if (!app.isConnected || !fontsIn) return;
    var quiet = now() - lastRO;
    if (quiet < 140) { kick(150 - quiet, 400); return; }   // the page is still changing size: stay out of sight until it stops
    if (scrolling && shown && !H.classList.contains('cl-stale') && now() - scrollT < 1500) { kick(260, 1200); return; }   // a phone in mid-scroll (a lazy image came in, say): measure when it stops
    var t0 = now(), P = params(), route = currentRoute(), fresh = false;
    if (P.vw !== lastVw) { lastVw = P.vw; clearAll(); }
    if (route.key !== routeKey) {
      clearAll();
      routeKey = route.key; seed = hashStr('clutter:' + route.key); pool = null; fresh = true;
    }
    var first = !shown;
    if (!rootLayer || !rootLayer.isConnected) {
      rootHost = newHost(app, 'paper', 0, 0, 0, 0);
      makeLayer(rootHost); rootLayer = rootHost.layer;
    }

    var found = measure(), nextHosts = [], todo = [];
    found.forEach(function (h, idx) {
      var prev = idx === 0 ? rootHost : (deskState && deskState.get(h.el));
      var sig = sigOf(h, P);
      if (prev && prev.layer && prev.layer.isConnected && prev.sig === sig) {
        if (prev.x !== h.x || prev.y !== h.y) {            // same shape, moved with the page: only the page coordinates change
          prev.x = h.x; prev.y = h.y;
          prev.specs.forEach(function (sp) { sp.px = prev.x + sp.cx; sp.py = prev.y + sp.cy; bandsOf(sp, P); });
        }
        nextHosts.push(prev);
        return;
      }
      var host = prev && prev.layer && prev.layer.isConnected ? prev : h;
      if (host !== h) { host.idx = h.idx; host.desks = h.desks; host.x = h.x; host.y = h.y; host.w = h.w; host.h = h.h; host.hard = h.hard; host.cover = h.cover;
        host.specs.forEach(function (sp) { sp.px = host.x + sp.cx; sp.py = host.y + sp.cy; bandsOf(sp, P); }); }
      if (!host.layer) makeLayer(host);
      else purge(host, P);                                 // content moved: anything now behind bare text goes at once, before the new plan
      if (idx > 0 && deskState) deskState.set(h.el, host);
      host.want = sig;                                     // becomes host.sig once its plan is in (an interrupted plan is simply redone)
      nextHosts.push(host); todo.push(host);
    });
    hosts.forEach(function (h) { if (nextHosts.indexOf(h) < 0) dropHost(h); });   // desks that are gone
    hosts = nextHosts;
    rootHost.h = found[0].h; rootHost.w = found[0].w;
    setBands(P); curP = P; MOUNT_BATCH = P.phone ? 5 : 14;
    lastMeasureMs = now() - t0;
    shown = true;
    H.classList.remove('cl-stale');
    if (!todo.length) { if (first || fresh) sync(); return; }   // nothing moved (no plan can be running: its hosts would be in todo)
    var job = ++planJob;
    planCount++;
    planning = true;
    if (!isReduce() && (first || fresh)) arriving = first ? 2 : 1;
    // time-sliced: grid set-up and each category of each host are separate units; yield to the browser every ~10 ms
    var cur = null, curHost = null;
    var step = function () {
      if (job !== planJob) return;
      var t1 = now(), done = false;
      do {
        if (!cur) {
          curHost = todo.shift();
          if (!curHost) { done = true; break; }
          if (!curHost.layer || !curHost.layer.isConnected) { curHost = null; continue; }
          assets();
          if (!pool) pool = buildPool(route);
          cur = plan(curHost, P);
          continue;
        }
        var specs = cur.next();
        if (!specs) continue;
        var host = curHost, old = {}, i, sp;
        cur = null; curHost = null;
        for (i = 0; i < host.specs.length; i++) { sp = host.specs[i]; if (sp.live) old[sp.key] = sp; }
        for (i = 0; i < specs.length; i++) dress(specs[i], P, pool);
        for (i = 0; i < specs.length; i++) {               // keep the pieces that did not move (same key): nothing flickers
          sp = specs[i];
          var o = old[sp.key];
          if (!o) continue;
          sp.node = o.node; sp.seen = o.seen; if (sp.node) sp.node.__sp = sp; sp.live = true; sp.awake = o.awake; sp.st = o.st; sp.t = o.t; sp.tg = o.tg; sp.canvas = o.canvas; sp.clip = o.clip; sp.screen = o.screen; sp.blank = o.blank;
          var ai = awake.indexOf(o); if (ai >= 0) awake[ai] = sp;
          if (hot === o) hot = sp; if (tapped === o) tapped = sp;
          if (host.regions[sp.R.id]) regionEl(host, sp.R);
          o.live = false; o.node = null; delete old[sp.key];
        }
        for (var k in old) { unmount(old[k]); old[k].node = null; }
        host.specs = specs; host.sig = host.want;
        if (!todo.length) done = true;
        lastPlanMs = Math.max(lastPlanMs, now() - t1);
        if (!done) { W.setTimeout(step, 0); sync(); return; }   // show this host's pieces before starting the next
      } while (!done && now() - t1 < 10);
      lastPlanMs = Math.max(lastPlanMs, now() - t1);
      if (!done) { W.setTimeout(step, 0); return; }
      planning = false; arriveEnd = now() + 700;
      sync();
    };
    lastPlanMs = 0;
    W.setTimeout(step, 0);
  }

  // debounced trigger: `delay` ms after the latest call, but never later than `max` ms after the first one.
  function kick(delay, max) {
    if (!started || disabled) return;
    var t = now();
    if (!kickFirst) { kickFirst = t; kickCap = Infinity; }
    kickCap = Math.min(kickCap, kickFirst + (max || 1400));
    var due = Math.min(t + delay, kickCap);
    if (kickTimer) W.clearTimeout(kickTimer);
    kickDue = due;
    kickTimer = W.setTimeout(function () {
      kickTimer = 0;
      if (D.hidden) { kickDue = 0; kickFirst = 0; pendingHidden = true; return; }
      if (!rafPlan) rafPlan = W.requestAnimationFrame(relayout);
    }, Math.max(0, due - t));
  }
  var pendingHidden = false, kickCap = Infinity, fontsIn = false, lastRO = -1e9;
  function noFx(v) { return String(v || '').split(/\s+/).filter(function (c) { return c && c.slice(0, 3) !== 'fx-'; }).join(' '); }
  function sameButFx(a, b) { return noFx(a) === noFx(b); }

  // ---------------------------------------------------------------------------
  //  wiring
  // ---------------------------------------------------------------------------
  function start() {
    if (started) return;
    app = D.getElementById('app'); view = D.getElementById('view');
    if (!app || !view) return;
    started = true;

    W.addEventListener('hashchange', function () {        // app.js has already rendered the new view (its listener came first)
      var r = currentRoute();
      if (r.key !== routeKey) { clearAll(); schedule(); }
      kick(60, 300);
    });
    var lastW = H.clientWidth;
    W.addEventListener('resize', function () {
      var w = H.clientWidth;
      if (w !== lastW) { lastW = w; lastRO = now(); if (rootLayer) H.classList.add('cl-stale'); }
      kick(180, 600);
    });
    W.addEventListener('orientationchange', function () { kick(250, 700); });
    W.addEventListener('scroll', onScroll, { passive: true });
    D.addEventListener('visibilitychange', function () {
      if (!D.hidden && pendingHidden) { pendingHidden = false; kick(60, 200); }
      schedule();
    });
    D.addEventListener('animationend', onAnimEnd);
    D.addEventListener('pointermove', onMove, { passive: true });
    D.addEventListener('pointerdown', onDown, { passive: true });
    D.addEventListener('mouseleave', function () { setHot(null); });
    app.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IMG' && !(e.target.closest && e.target.closest('.cl-layer'))) kick(200, 900); }, true);
    // the first layout waits for the web fonts (they move everything), but not for ever
    var go = function () { if (fontsIn) return; fontsIn = true; fontEpoch++; mcache = {}; kick(60, 300); };
    if (D.fonts && D.fonts.ready && D.fonts.status !== 'loaded') { D.fonts.ready.then(go); W.setTimeout(go, 1600); } else fontsIn = true;
    if (D.fonts && D.fonts.addEventListener) D.fonts.addEventListener('loadingdone', function () { fontEpoch++; mcache = {}; kick(120, 600); });

    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () { var h = isHeld(); if (h !== held || (isReduce() && tickTimer)) { held = h; kick(h ? 0 : 90, 200); } }).observe(H, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(function (recs) {
        var words = false, other = false, looked = [];
        for (var i = 0; i < recs.length; i++) {
          var rec = recs[i], t = rec.target, el = t.nodeType === 1 ? t : t.parentNode;
          if (!el || el.nodeType !== 1) continue;
          if (el.__cl || (el.classList && (el.classList.contains('cl-p') || el.classList.contains('cl-r') || el.classList.contains('cl-b') || el.classList.contains('cl-screen'))) || (el.closest && el.closest('.cl-layer'))) continue;   // our own
          if (rec.type === 'attributes') {
            if (t.tagName !== 'TABLE' && t.tagName !== 'svg' && t.closest('svg, table')) continue;                       // inside a box we treat as one block
            if (rec.attributeName === 'class' && sameButFx(rec.oldValue, t.getAttribute('class'))) continue;            // fx.js press / hover classes move nothing
            other = true;
            continue;
          }
          if (rec.type === 'childList') {
            var own = true, ns = rec.addedNodes, k;
            for (k = 0; k < ns.length && own; k++) if (!ns[k].__cl) own = false;
            ns = rec.removedNodes;
            for (k = 0; k < ns.length && own; k++) if (!ns[k].__cl) own = false;
            if (own) continue;
          }
          words = true;
          // new words set straight into an element on bare paper: any piece they now reach is gone before this frame is painted
          if (looked.length < 6 && looked.indexOf(el) < 0 && shown && !H.classList.contains('cl-stale')) {
            looked.push(el);
            if (hasText(el) && !el.closest('table, svg') && !underCover(el)) clearFor(el);
          }
        }
        if (words) kick(120, 450);                           // look again soon, and keep looking while they change
        else if (other) kick(260, 1500);
      }).observe(view, { childList: true, characterData: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style', 'open', 'aria-expanded'] });
    }
    if (typeof ResizeObserver === 'function') {
      // the page changed size: content has moved, so the layers go out of sight this very frame and come back re-measured
      var ro = new ResizeObserver(function () { lastRO = now(); if (shown) H.classList.add('cl-stale'); kick(160, 900); });
      ro.observe(app); ro.observe(view);
    }
    held = isHeld();
    if (fontsIn) kick(held ? 0 : 120, 400);
  }

  // ---------------------------------------------------------------------------
  //  public (tests / debugging)
  // ---------------------------------------------------------------------------
  W.CLUTTER = {
    relayout: function () { if (kickTimer) { W.clearTimeout(kickTimer); kickTimer = 0; } relayout(); },
    off: function (v) { disabled = !!v; H.classList.toggle('cl-none', disabled); if (disabled) { clearAll(); shown = false; routeKey = ''; schedule(); } else { kick(0, 0); } },
    stats: function () {
      var specs = 0, live = 0, regions = 0, by = {}, amb = 0;
      hosts.forEach(function (h) { specs += h.specs.length; regions += Object.keys(h.regions).length; h.specs.forEach(function (s) { if (s.live) live++; }); });
      awake.forEach(function (s) { by[s.type] = (by[s.type] || 0) + 1; if (s.amb) amb++; });
      return { hosts: hosts.length, regions: regions, specs: specs, live: live, awake: awake.length, awakeAmbient: amb, awakeByType: by,
        canvases: awake.filter(function (s) { return s.canvas; }).length, clips: awake.filter(function (s) { return s.canvas; }).map(function (s) { return s.clip; }),
        timer: !!tickTimer, planning: planning, pending: planning || !!kickTimer || !!rafPlan || !!rafScroll, shown: shown, held: held, planMs: Math.round(lastPlanMs * 10) / 10, measureMs: Math.round(lastMeasureMs * 10) / 10, measured: measured, plans: planCount,
        nodes: D.querySelectorAll('.cl-layer, .cl-layer *').length, route: routeKey };
    },
    _bench: function (data, P, route) {                   // time the planner on recorded boxes (node / tests)
      P = P || params(); route = route || { name: 'front', slug: '', key: 'front:' };
      seed = hashStr('clutter:' + route.key);
      var PL = buildPool(route), out = [];
      data.forEach(function (d, i) {
        var h = newHost(null, d.kind, d.x, d.y, d.w, d.h); h.hard = d.hard; h.cover = d.cover; h.idx = i; h.desks = d.desks;
        var t = now(), pl = plan(h, P), specs = null; while (!specs) specs = pl.next(); var t1 = now();
        for (var k = 0; k < specs.length; k++) dress(specs[k], P, PL);
        out.push({ kind: d.kind, cells: h.grid.gw * h.grid.gh, regs: h.regs.length, specs: specs.length, planMs: t1 - t, dressMs: now() - t1 });
      });
      return out;
    },
    dump: function () {
      return hosts.map(function (h) {
        return { kind: h.kind, x: h.x, y: h.y, w: h.w, h: h.h, hard: h.hard, cover: h.cover, desks: h.desks,
          regs: (h.regs || []).map(function (R) { return [R.px, R.py, R.pw, R.ph]; }),
          specs: h.specs.map(function (s) { return { type: s.type, cx: s.cx, cy: s.cy, w: s.w, h: s.h, amb: s.amb, live: s.live, awake: s.awake, st: s.st, vis: s.vis, reg: [s.R.px, s.R.py, s.R.pw, s.R.ph], text: s.d.text || '', sub: s.d.sub || '' }; }) };
      });
    }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
  W.addEventListener('load', function () { start(); kick(150, 500); });
})();
