// ============================================================================
//  app.js — window.APP: hash router, view registry, masthead + nav shell, shared helpers, boot.
//
//  ROUTES            #/ (also '', '#', '#/intro') → 'front'      #/t/<slug> → 'team'  (params.slug)
//                    #/standings → 'standings'    #/history → 'history'    #/sim → 'sim'
//                    Anything else (or an unknown team slug) → 'front'.
//                    params = { slug?, rest: [extra path segments], query: {k: v from "?k=v" inside the hash} }
//
//  APP.register(name, view)   view = { mount(root, params) { …build into root…; return function cleanup() {} },
//                                      update(params) {}   // optional: same view, only rest/query changed (no remount)
//                                    }
//                             root is <main id="view" class="view view--<name>" data-view="<name>">, emptied before mount.
//                             A route whose view is not registered renders an empty root.
//  APP.go(hash)               navigate (renders synchronously). APP.go('#/standings')
//  APP.current()              { name, params } of the mounted route
//  APP.slam()                 front page "slam in" entrance (goes to #/ first if needed)
//  APP.boot()                 called once from index.html
//  APP.setTitle(text)         document title for the current route ("text — The Brookdale League"); reset on every route change
//
//  DOM helpers
//  APP.h(tag, attrs?, ...children)   h('a.btn.btn--sm', { href: '#/sim', onclick: fn, style: { '--rot': '1deg' } }, 'Run')
//                             tag: 'div', 'span.a.b', 'h2#id.c'.  attrs (optional plain object): class/className (string or
//                             array), style (string or object, custom properties allowed), dataset {…}, on<event>: fn,
//                             text: string, anything else → attribute (true → empty attribute; null/false → skipped).
//                             children: nodes, strings, numbers, nested arrays; null/false/undefined are skipped.
//  APP.svg(tag, attrs?, ...children) same, in the SVG namespace (for charts).
//  APP.wbr(text)              fragment with soft break opportunities inside camelCase names ("SaxWillRuinTheLeague")
//
//  Data helpers (read BROOKDALE; no derived stats here — those live in STATS)
//  APP.teams                  BROOKDALE.teams (rank order)
//  APP.team(slug)             team object or null
//  APP.standing(slug)         that team's row of season.standings or null
//  APP.record(slug)           "7-2" (or "7-2-1" with ties)
//  APP.teamHref(slug)         "#/t/<slug>"
//  APP.fmt.pts(n)             1205.52 → "1,205.52"        APP.fmt.num(n, digits)   → fixed decimals with thousands commas
//  APP.fmt.pct(n, digits)     45 → "45%"                  APP.fmt.signed(n, digits) → "+3.2" / "−1.0" / "0"
//  APP.fmt.ordinal(n)         3 → "3rd"                   APP.fmt.date('2026-11-11') → "November 11, 2026"
//
//  Component builders (classes are documented at the top of css/base.css)
//  APP.clipping(attrs, ...children)   <div class="clipping"> (pass tag: 'a' / href in attrs for a link; rot: number → --rot)
//  APP.photo(src, alt, attrs?)        <figure class="news-photo"><img loading="lazy"></figure>; very dark pictures are
//                                     brightened automatically so they survive the greyscale print treatment
//  APP.mover(delta, title?)           <span class="mover up|down|flat">n</span>  (delta > 0 = moved up). title becomes the
//                                     marker's tooltip (data-tip: hover and tap) and its screen-reader text.
//  APP.sectionHead(title, aside?)     <h2 class="section-head"><span>…</span><small class="section-head__aside">…</small></h2>
//  APP.tableWrap(table)               <div class="table-scroll"> around a table
//  APP.tip(el, text, title?)          gives el a tooltip (hover / tap / keyboard focus). Plain data-tip="…" attributes work too.
//  APP.rot(seed)                      deterministic rotation in degrees within ±2.5 for a string or number seed
// ============================================================================
(function () {
  'use strict';

  var B = window.BROOKDALE || {};
  var TEAMS = B.teams || [];
  var SEASON = B.season || {};
  var LEAGUE = B.league || 'The Brookdale League';
  var EDITION = B.edition || {};
  var BASE_TITLE = document.title;

  var NAV = [
    { href: '#/', label: 'Rankings', views: ['front', 'team'] },
    { href: '#/standings', label: 'Standings', views: ['standings'] },
    { href: '#/history', label: 'History', views: ['history'] },
    { href: '#/sim', label: 'Season Sim', views: ['sim'] }
  ];

  var views = {};
  var cur = { name: null, key: null, base: null, params: null, cleanup: null };
  var shell = { root: null, navLinks: [] };
  var booted = false;
  var pushIntent = false;        // true when the pending route change came from a link / APP.go (→ scroll to top)
  var scrollMemo = {};           // route key → scrollY, restored on back / forward

  // ---------- DOM helpers ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Node);
  }
  function append(el, kid) {
    if (kid == null || kid === false || kid === true) return;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) append(el, kid[i]); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function make(ns, tag, attrs, kids) {
    var parts = String(tag || 'div').split(/(?=[.#])/), name = 'div', id = null, cls = [];
    parts.forEach(function (p) {
      if (p.charAt(0) === '.') cls.push(p.slice(1));
      else if (p.charAt(0) === '#') id = p.slice(1);
      else if (p) name = p;
    });
    var el = ns ? document.createElementNS(ns, name) : document.createElement(name);
    if (id) el.id = id;
    if (!isPlainObject(attrs)) { kids = [attrs].concat(kids); attrs = null; }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') { cls = cls.concat(Array.isArray(v) ? v : String(v).split(/\s+/)); }
        else if (k === 'style') {
          if (typeof v === 'string') el.setAttribute('style', v);
          else Object.keys(v).forEach(function (p) {
            if (v[p] == null || v[p] === false) return;
            if (p.indexOf('-') >= 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p];
          });
        }
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { if (v[d] != null) el.dataset[d] = v[d]; });
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    cls = cls.filter(Boolean);
    if (cls.length) el.setAttribute('class', cls.join(' '));
    append(el, kids);
    return el;
  }
  function h(tag, attrs) { return make(null, tag, attrs, Array.prototype.slice.call(arguments, 2)); }
  function svg(tag, attrs) { return make(SVG_NS, tag, attrs, Array.prototype.slice.call(arguments, 2)); }

  function wbr(text) {
    var frag = document.createDocumentFragment();
    String(text == null ? '' : text).replace(/([a-z])([A-Z])/g, '$1\u0000$2').split('\u0000').forEach(function (piece, i) {
      if (i) frag.appendChild(document.createElement('wbr'));
      frag.appendChild(document.createTextNode(piece));
    });
    return frag;
  }

  // ---------- data helpers ----------
  var teamBySlug = {}, standingBySlug = {};
  TEAMS.forEach(function (t) { teamBySlug[t.slug] = t; });
  (SEASON.standings || []).forEach(function (s) { standingBySlug[s.slug] = s; });

  function team(slug) { return teamBySlug[slug] || null; }
  function standing(slug) { return standingBySlug[slug] || null; }
  function record(slug) {
    var s = standing(slug);
    if (!s) return '';
    return s.w + '-' + s.l + (s.t ? '-' + s.t : '');
  }
  function teamHref(slug) { return '#/t/' + encodeURIComponent(slug); }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var fmt = {
    num: function (n, digits) {
      if (n == null || isNaN(n)) return '';
      return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
    },
    pts: function (n) { return fmt.num(n, 2); },
    pct: function (n, digits) { return (n == null || isNaN(n)) ? '' : fmt.num(n, digits || 0) + '%'; },
    signed: function (n, digits) {
      if (n == null || isNaN(n)) return '';
      var s = fmt.num(Math.abs(n), digits || 0);
      if (Number(s.replace(/,/g, '')) === 0) return s;
      return (n > 0 ? '+' : '−') + s;
    },
    ordinal: function (n) {
      var v = Math.abs(n) % 100, s = ['th', 'st', 'nd', 'rd'];
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },
    date: function (iso) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
      return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : '';
    }
  };

  // ---------- component builders ----------
  function rot(seed) {
    var s = String(seed), x = 2166136261;
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    var u = ((x >>> 0) % 10000) / 10000;                 // 0..1
    var deg = 0.6 + u * 1.9;                             // 0.6..2.5, never dead level
    return Math.round((((x >>> 16) & 1) ? deg : -deg) * 100) / 100;
  }
  function clipping(attrs) {
    var kids = Array.prototype.slice.call(arguments, 1);
    if (!isPlainObject(attrs)) { kids.unshift(attrs); attrs = {}; }
    var a = {}, tag = 'div', r = null;
    Object.keys(attrs).forEach(function (k) {
      if (k === 'tag') tag = attrs[k]; else if (k === 'rot') r = attrs[k]; else a[k] = attrs[k];
    });
    if (a.href && tag === 'div') tag = 'a';
    var el = make(null, tag + '.clipping' + (tag === 'a' || tag === 'button' ? '.clipping--link' : ''), a, kids);
    if (r != null) el.style.setProperty('--rot', (typeof r === 'number' ? r + 'deg' : r));
    return el;
  }
  function photo(src, alt, attrs) {
    var img = h('img', { src: src, alt: alt == null ? '' : alt, loading: 'lazy', decoding: 'async', draggable: 'false' });
    var fig = make(null, 'figure.news-photo', attrs || {}, [img]);
    img.addEventListener('error', function () { fig.classList.add('is-missing'); });
    var level = function () { autoLevel(img, fig); };
    if (img.complete && img.naturalWidth) level(); else img.addEventListener('load', level);
    return fig;
  }
  // Print exposure: a very dark picture would turn into a black box once it is greyscaled and contrasted, so lift
  // it until its bright end (90th percentile of luma) sits near paper white. Well-exposed pictures are left alone.
  function autoLevel(img, fig) {
    try {
      var n = 32, c = document.createElement('canvas');
      c.width = c.height = n;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, n, n);
      var d = g.getImageData(0, 0, n, n).data, l = [];
      for (var i = 0; i < d.length; i += 4) l.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
      l.sort(function (a, b) { return a - b; });
      var p90 = l[Math.floor(l.length * 0.9)];
      var gain = Math.max(1, Math.min(5, 0.8 / Math.max(p90, 0.01)));
      if (gain > 1.08) fig.style.setProperty('--photo-gain', gain.toFixed(2));
    } catch (e) { /* canvas unavailable or tainted: keep the plain treatment */ }
  }
  function mover(delta, title) {
    var d = Number(delta) || 0;
    var dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    var words = d > 0 ? 'Up ' + d : d < 0 ? 'Down ' + (-d) : 'No change';
    // the explanation is a data-tip (hover, tap), never a title attribute: title is hover-only
    return h('span.mover.' + dir, { 'data-tip': title || null },
      h('span.sr-only', (title || words) + ' '), d ? h('span', { 'aria-hidden': 'true' }, Math.abs(d)) : null);
  }
  function sectionHead(title, aside) {
    return h('h2.section-head', h('span', title), aside ? h('small.section-head__aside', aside) : null);
  }
  function tableWrap(table) { return h('div.table-scroll', table); }

  // ---------- tooltip (data-tip): hover with a mouse, tap on touch, focus with the keyboard ----------
  var tipEl = null, tipFor = null, tipPinned = false;
  function tipTarget(node) { return node && node.closest ? node.closest('[data-tip]') : null; }
  function showTip(target, pinned) {
    var text = target.getAttribute('data-tip');
    if (!text) return;
    if (!tipEl) { tipEl = h('div.tip-pop', { role: 'tooltip', id: 'tip-pop', hidden: true }); document.body.appendChild(tipEl); }
    tipEl.textContent = '';
    var title = target.getAttribute('data-tip-title');
    if (title) tipEl.appendChild(h('span.tip-pop__title', title));
    tipEl.appendChild(document.createTextNode(text));
    tipEl.hidden = false;
    tipFor = target; tipPinned = !!pinned;
    var r = target.getBoundingClientRect();
    var w = tipEl.offsetWidth, ht = tipEl.offsetHeight, vw = document.documentElement.clientWidth, gap = 9;
    var cx = r.left + r.width / 2;
    var left = Math.max(8, Math.min(vw - w - 8, cx - w / 2));
    var above = r.top - ht - gap >= 4;
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(above ? r.top - ht - gap : r.bottom + gap) + 'px';
    tipEl.dataset.side = above ? 'top' : 'bottom';
    tipEl.style.setProperty('--tip-arrow', Math.max(12, Math.min(w - 12, cx - left)) + 'px');
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; tipFor = null; tipPinned = false; }
  function tip(el, text, title) {
    if (!el) return el;
    el.setAttribute('data-tip', text);
    if (title) el.setAttribute('data-tip-title', title);
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) el.setAttribute('tabindex', '0');
    el.setAttribute('aria-describedby', 'tip-pop');
    return el;
  }
  function wireTips() {
    document.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse' || tipPinned) return;
      var t = tipTarget(e.target);
      if (t && t !== tipFor) showTip(t, false);
    });
    document.addEventListener('pointerout', function (e) {
      if (e.pointerType !== 'mouse' || tipPinned || !tipFor) return;
      var to = tipTarget(e.relatedTarget);
      if (to !== tipFor) hideTip();
    });
    document.addEventListener('click', function (e) {
      var t = tipTarget(e.target);
      if (!t) { hideTip(); return; }
      if (tipFor === t && tipPinned) hideTip(); else showTip(t, true);
    });
    document.addEventListener('focusin', function (e) {
      var t = tipTarget(e.target);
      if (t && t === e.target && t.matches(':focus-visible')) showTip(t, false);
    });
    document.addEventListener('focusout', function (e) { if (tipFor && e.target === tipFor && !tipPinned) hideTip(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', function () { if (tipFor) hideTip(); }, { passive: true, capture: true });
    window.addEventListener('resize', hideTip);
  }

  // ---------- router ----------
  function parse(hash) {
    var s = String(hash || '').replace(/^#/, ''), query = {}, q = s.indexOf('?');
    if (q >= 0) {
      try { new URLSearchParams(s.slice(q + 1)).forEach(function (v, k) { query[k] = v; }); } catch (e) { /* ignore */ }
      s = s.slice(0, q);
    }
    var parts = s.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
    var head = parts[0];
    if (head === 't' && parts[1] && team(parts[1])) return { name: 'team', params: { slug: parts[1], rest: parts.slice(2), query: query } };
    if (head === 'standings' || head === 'history' || head === 'sim') return { name: head, params: { rest: parts.slice(1), query: query } };
    return { name: 'front', params: { rest: [], query: query } };
  }
  function keyOf(r) {
    var base = r.name + (r.params.slug ? ':' + r.params.slug : '');
    var q = Object.keys(r.params.query).sort().map(function (k) { return k + '=' + r.params.query[k]; }).join('&');
    return { base: base, full: base + '/' + r.params.rest.join('/') + '?' + q };
  }

  function buildShell() {
    var app = document.getElementById('app');
    if (!app) { app = h('div#app'); document.body.insertBefore(app, document.body.firstChild); }
    app.textContent = '';
    var editionTitle = EDITION.title || '';
    var editionDate = fmt.date(EDITION.date);
    shell.navLinks = NAV.map(function (n) { return h('a.nav__link', { href: n.href }, n.label); });
    shell.root = h('main#view.view', { tabindex: '-1' });
    append(app, [
      h('header.masthead',
        h('a.masthead__name', { href: '#/' }, LEAGUE),
        h('div.masthead__edition',
          h('span', editionTitle),
          editionDate ? h('time', { datetime: EDITION.date }, editionDate) : null)),
      h('nav.nav', { 'aria-label': 'Sections' }, shell.navLinks, h('span.nav__slot#player-slot')),   // slot: the music button docks here (PLAYER.dock)
      shell.root
    ]);
  }

  function markNav(name) {
    NAV.forEach(function (n, i) {
      var a = shell.navLinks[i];
      if (n.views.indexOf(name) >= 0) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function render() {
    if (!shell.root) return;
    var r = parse(location.hash), k = keyOf(r);
    var push = pushIntent; pushIntent = false;
    if (cur.key === k.full) return;                                   // same route: nothing to do

    var view = views[r.name];
    if (cur.base === k.base && view && typeof view.update === 'function' && cur.mounted === view) {
      cur.key = k.full; cur.params = r.params;                        // same view, only rest/query changed
      try { view.update(r.params); } catch (e) { console.error('[APP] update of "' + r.name + '" failed', e); }
      return;
    }

    var first = cur.key === null;
    if (!first) scrollMemo[cur.key] = window.scrollY || 0;
    unmount();
    hideTip();
    document.title = BASE_TITLE;

    var root = shell.root;
    root.className = 'view view--' + r.name;
    root.dataset.view = r.name;
    document.body.dataset.route = r.name;
    markNav(r.name);
    cur = { name: r.name, key: k.full, base: k.base, params: r.params, cleanup: null, mounted: null };
    mount(view);

    if (first) return;
    var y = (!push && scrollMemo[k.full]) || 0;                        // link / APP.go → top; back / forward → where you were
    window.scrollTo(0, y);
    try { root.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
  }
  function mount(view) {
    if (!view || typeof view.mount !== 'function') return;
    cur.mounted = view;
    try {
      var c = view.mount(shell.root, cur.params);
      cur.cleanup = typeof c === 'function' ? c : null;
    } catch (e) { console.error('[APP] mount of "' + cur.name + '" failed', e); }
  }
  function unmount() {
    if (typeof cur.cleanup === 'function') {
      try { cur.cleanup(); } catch (e) { console.error('[APP] cleanup of "' + cur.name + '" failed', e); }
    }
    cur.cleanup = null; cur.mounted = null;
    if (shell.root) shell.root.textContent = '';
  }

  function register(name, view) {
    views[name] = view;
    if (booted && cur.name === name && !cur.mounted) mount(view);     // registered late: fill the waiting root
  }

  function go(hash) {
    hash = String(hash == null ? '#/' : hash);
    if (hash.charAt(0) !== '#') hash = '#' + (hash.charAt(0) === '/' ? '' : '/') + hash;
    pushIntent = true;
    if (location.hash !== hash) location.hash = hash;                 // the hashchange that follows finds the route already rendered
    if (booted) render(); else pushIntent = false;
  }

  function slam() {
    if (!booted) return;
    if (cur.name !== 'front') go('#/');
    window.scrollTo(0, 0);
    var v = views.front;
    if (v && typeof v.slam === 'function') {
      try { v.slam(); } catch (e) { console.error('[APP] slam failed', e); }
    }
  }

  function setTitle(text) { document.title = text ? text + ' — ' + LEAGUE : BASE_TITLE; }

  function boot() {
    if (booted) return;
    booted = true;
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }
    buildShell();
    try { if (window.PLAYER && typeof PLAYER.dock === 'function') PLAYER.dock(document.getElementById('player-slot')); }
    catch (e) { console.error('[APP] PLAYER.dock failed', e); }
    wireTips();
    render();
    window.addEventListener('hashchange', render);
    document.addEventListener('click', function (e) {                  // in-app links: remember that this is a forward step
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || a.target === '_blank') return;
      var href = a.getAttribute('href');
      if (href.charAt(1) !== '/' && href !== '#') return;
      if (keyOf(parse(href)).full === cur.key) { window.scrollTo(0, 0); return; }   // already here: back to the top
      pushIntent = true;
    });

    var intro = window.INTRO, play = false;
    try { play = !!(intro && typeof intro.shouldPlay === 'function' && typeof intro.start === 'function' && intro.shouldPlay()); }
    catch (e) { console.error('[APP] INTRO.shouldPlay failed', e); }
    if (play) {
      try { intro.start({ onBam: function () { go('#/'); slam(); }, onDone: function () {} }); }
      catch (e) { console.error('[APP] INTRO.start failed', e); play = false; }
    }
    if (!play && /^#\/?intro\/?$/.test(location.hash)) {                // no intro to show: '#/intro' is just the front page
      try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { /* ignore */ }
    }
  }

  window.APP = {
    register: register, go: go, slam: slam, boot: boot, setTitle: setTitle,
    current: function () { return { name: cur.name, params: cur.params }; },
    h: h, svg: svg, wbr: wbr,
    teams: TEAMS, team: team, standing: standing, record: record, teamHref: teamHref, fmt: fmt,
    clipping: clipping, photo: photo, mover: mover, sectionHead: sectionHead, tableWrap: tableWrap, tip: tip, rot: rot
  };
})();
