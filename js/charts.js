// ============================================================================
//  charts.js — window.CHARTS: small dependency-free SVG charts in the paper's ink. No DOM outside the host you pass.
//  Styles live in css/team.css (section "charts": .chart, .chart__*, .chart-multi*), which index.html loads on every route.
//
//  Both charts are "one value per category" (here: per week). One category is always selected: hover with a mouse,
//  tap or drag sideways on touch (a finger that only scrolls the page past the chart selects nothing), arrow keys /
//  Home / End with the keyboard. The chart tells you through onSelect and you print that week's numbers in your own
//  readout. The charts redraw themselves when their host changes width.
//
//  CHARTS.line(host, cfg) → { el, select(i), selected(), redraw(), destroy() }
//    cfg.labels      ['1', '2', …]             x categories, in order
//    cfg.xTitle      'Wk'                      optional, printed in the gutter left of the x labels
//    cfg.xSub        [{ text: 'W', cls: 'w' }] optional second row under the x labels (cls: w | l | t)
//    cfg.series      [{ name, values: [n | null], kind: 'main' | 'ref' | 'avg',
//                       dot(i) → { cls: 'w' | 'l' | 't' | '', text?: 'W' } | null,     marker per point (none when omitted)
//                       label(i) → string }]                 'main' only: value printed above the selected column
//                    Draw order = array order, so put the 'main' series last. 'main' = heavy ink line, 'ref' = thin
//                    grey line with open markers, 'avg' = dotted line without markers.
//    cfg.y           { min, max, invert?: true, ticks: [{ v, text, strong?: true, faded?: true }] }
//    cfg.marks       [{ y, cls?: 'cut' | 'zero', name?: 'Playoff line' }]   horizontal rules; a name puts it in the legend
//    cfg.height      number | function (width) → number      (default: 46% of the width, 220–340px)
//    cfg.selected    index selected at first (default: the last one)
//    cfg.onSelect    function (i)              called on every change of the selected index (not for the first draw)
//    cfg.label       accessible name of the chart
//    A legend row is printed above the plot when there are two or more series or a named mark.
//
//  CHARTS.multiples(host, cfg) → same handle
//    Small multiples: one small column chart per panel on a shared y scale (0 … cfg.max; it reaches below zero when a
//    value is negative), all in step on the same selected category.
//    cfg.labels, cfg.selected, cfg.onSelect, cfg.label      as above
//    cfg.panels      [{ name: 'QB', values: [n | null], note?: 'avg 21.4' }]
//    cfg.max         top of the shared scale (default: the largest value)
//    cfg.format      function (v) → string    value printed above the selected column
//
//  CHARTS.scale(d0, d1, r0, r1) → function (v) → r        linear scale
//  CHARTS.ticks(min, max, target) → [numbers]             round tick values inside min…max (about `target` of them)
// ============================================================================
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var WIDE = 640;                                   // plots at least this wide are set one size up (.chart__svg--lg)

  function S(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = String(text);
    return e;
  }
  function H(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function scale(d0, d1, r0, r1_) {
    var k = d1 === d0 ? 0 : (r1_ - r0) / (d1 - d0);
    return function (v) { return r0 + (v - d0) * k; };
  }
  function ticks(min, max, target) {
    var span = max - min;
    if (!(span > 0)) return [min];
    var raw = span / Math.max(1, target || 5), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / p;
    var step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p, out = [];
    for (var v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  // calls back when the element's width changes; returns a stop function
  function watchWidth(el, cb) {
    var last = el.clientWidth, raf = 0, ro = null;
    var check = function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { var w = el.clientWidth; if (w && w !== last) { last = w; cb(); } });
    };
    if (window.ResizeObserver) { ro = new ResizeObserver(check); ro.observe(el); }
    else window.addEventListener('resize', check);
    return function () {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', check);
    };
  }

  // pointer + keyboard selection on one svg. indexAt(clientX) → index. Returns an unbind function.
  // Mouse: the column under the pointer. Touch / pen: a tap, or a sideways drag; a touch the page turns into a scroll
  // (pointercancel, the svg has touch-action: pan-y) selects nothing.
  function scrub(svg, count, indexAt, get, set) {
    var finger = null;                               // { id, x, y, drag } while a touch is down
    var onDown = function (e) {
      if (e.pointerType === 'mouse') { set(indexAt(e.clientX)); return; }
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false };
    };
    var onMove = function (e) {
      if (e.pointerType === 'mouse') { set(indexAt(e.clientX)); return; }
      if (!finger || e.pointerId !== finger.id) return;
      var dx = Math.abs(e.clientX - finger.x), dy = Math.abs(e.clientY - finger.y);
      if (!finger.drag && dx > 8 && dx > dy) finger.drag = true;
      if (finger.drag) set(indexAt(e.clientX));
    };
    var onUp = function (e) {
      if (!finger || e.pointerId !== finger.id) return;
      var still = Math.abs(e.clientX - finger.x) < 10 && Math.abs(e.clientY - finger.y) < 10;
      if (finger.drag || still) set(indexAt(e.clientX));
      finger = null;
    };
    var onCancel = function () { finger = null; };
    var onKey = function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var i = get(), n = count();
      if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else return;
      e.preventDefault(); e.stopPropagation();
      set(i);
    };
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onCancel);
    svg.addEventListener('keydown', onKey);
    return function () {
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onCancel);
      svg.removeEventListener('keydown', onKey);
    };
  }

  // ---------------------------------------------------------------------------
  //  line chart
  // ---------------------------------------------------------------------------
  function line(host, cfg) {
    var n = cfg.labels.length;
    var sel = clamp(cfg.selected == null ? n - 1 : cfg.selected, 0, Math.max(0, n - 1));
    var geo = { W: 320, left: 30, plotW: 280 };
    var series = cfg.series || [], marks = cfg.marks || [];

    var root = H('div', 'chart');
    var keys = [];
    if (series.length > 1) series.slice().reverse().forEach(function (s) { keys.push({ cls: 'chart__swatch--' + (s.kind || 'main'), text: s.name }); });
    marks.forEach(function (m) { if (m.name) keys.push({ cls: 'chart__swatch--' + (m.cls || 'mark'), text: m.name }); });
    if (keys.length) {
      var legend = H('div', 'chart__legend');
      keys.forEach(function (k) {
        var item = H('span', 'chart__key');
        item.appendChild(H('i', 'chart__swatch ' + k.cls));
        item.appendChild(document.createTextNode(k.text));
        legend.appendChild(item);
      });
      root.appendChild(legend);
    }
    var svg = S('svg', { 'class': 'chart__svg', role: 'img', tabindex: '0', 'aria-label': cfg.label || null });
    root.appendChild(svg);
    host.appendChild(root);

    function draw() {
      var W = Math.max(220, Math.floor(root.clientWidth || host.clientWidth || 320));
      var Ht = typeof cfg.height === 'function' ? cfg.height(W) : (cfg.height || Math.round(clamp(W * 0.46, 220, 340)));
      var tks = (cfg.y && cfg.y.ticks) || [];
      var big = W >= WIDE, CHAR = big ? 7.3 : 6.7, VCHAR = big ? 8.5 : 7.6;     // advance of one mono character: axis text, value flag
      var chars = (cfg.xTitle || '').length;
      tks.forEach(function (t) { chars = Math.max(chars, String(t.text == null ? t.v : t.text).length); });
      var left = Math.ceil(chars * CHAR) + 10, right = 8, top = 28, bottom = 26 + (cfg.xSub ? 17 : 0);
      var plotW = W - left - right, plotH = Ht - top - bottom;
      var X = function (i) { return left + plotW * (i + 0.5) / n; };
      var Y = cfg.y.invert ? scale(cfg.y.min, cfg.y.max, top, top + plotH) : scale(cfg.y.min, cfg.y.max, top + plotH, top);
      geo = { W: W, left: left, plotW: plotW };

      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Ht);
      svg.setAttribute('width', W); svg.setAttribute('height', Ht);
      svg.setAttribute('class', 'chart__svg' + (big ? ' chart__svg--lg' : ''));
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // selected column
      svg.appendChild(S('rect', { 'class': 'chart__band', x: r1(left + plotW * sel / n), y: top - 9, width: r1(plotW / n), height: plotH + 9 }));

      // y grid and tick labels
      tks.forEach(function (t) {
        var y = Math.round(Y(t.v)) + 0.5;
        svg.appendChild(S('line', { 'class': 'chart__grid' + (t.strong ? ' chart__grid--strong' : ''), x1: left, x2: left + plotW, y1: y, y2: y }));
        svg.appendChild(S('text', { 'class': 'chart__tick' + (t.strong ? ' chart__tick--strong' : '') + (t.faded ? ' chart__tick--faded' : ''), x: left - 7, y: y + 3.5, 'text-anchor': 'end' },
          t.text == null ? t.v : t.text));
      });
      marks.forEach(function (m) {
        var y = Math.round(Y(m.y)) + 0.5;
        svg.appendChild(S('line', { 'class': 'chart__mark chart__mark--' + (m.cls || 'mark'), x1: left, x2: left + plotW, y1: y, y2: y }));
      });

      // crosshair
      svg.appendChild(S('line', { 'class': 'chart__cross', x1: r1(X(sel)), x2: r1(X(sel)), y1: top - 9, y2: top + plotH }));

      // lines, then markers on top
      series.forEach(function (s) {
        var d = '', pen = false;
        s.values.forEach(function (v, i) {
          if (!isNum(v)) { pen = false; return; }
          d += (pen ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(v));
          pen = true;
        });
        if (d) svg.appendChild(S('path', { 'class': 'chart__line chart__line--' + (s.kind || 'main'), d: d }));
      });
      var labelAt = null;
      series.forEach(function (s) {
        var kind = s.kind || 'main';
        s.values.forEach(function (v, i) {
          if (!isNum(v)) return;
          var dot = s.dot ? s.dot(i) : null, rad = 0;
          if (dot) {
            rad = dot.text ? 9.5 : (kind === 'main' ? 5.5 : 3.5);
            if (i === sel && !dot.text) rad += 1.5;
            // a loss is a ring whose stroke sits outside this radius, a win a disc whose paper edge sits inside it:
            // draw the ring smaller so both look the same size
            var ring = kind === 'main' && dot.cls === 'l';
            var cls = 'chart__dot chart__dot--' + kind + (dot.cls ? ' is-' + dot.cls : '') + (i === sel ? ' is-sel' : '');
            svg.appendChild(S('circle', { 'class': cls, cx: r1(X(i)), cy: r1(Y(v)), r: ring ? rad - 1 : rad }));
            if (dot.text) svg.appendChild(S('text', { 'class': 'chart__dottext' + (dot.cls ? ' is-' + dot.cls : ''), x: r1(X(i)), y: r1(Y(v) + 3.8), 'text-anchor': 'middle' }, dot.text));
          }
          if (i === sel && s.label && kind === 'main') labelAt = { text: s.label(i), x: X(i) };
        });
      });

      // value of the selected point, flagged at the top of its column (clear of every line)
      if (labelAt && labelAt.text != null && labelAt.text !== '') {
        var text = String(labelAt.text), half = text.length * VCHAR / 2 + 2;
        svg.appendChild(S('text', { 'class': 'chart__value', x: r1(clamp(labelAt.x, half, W - half)), y: top - 13, 'text-anchor': 'middle' }, text));
      }

      // x axis
      var ay = top + plotH;
      svg.appendChild(S('line', { 'class': 'chart__axis', x1: left, x2: left + plotW, y1: ay + 0.5, y2: ay + 0.5 }));
      if (cfg.xTitle) svg.appendChild(S('text', { 'class': 'chart__tick chart__tick--title', x: left - 7, y: ay + 17, 'text-anchor': 'end' }, cfg.xTitle));
      cfg.labels.forEach(function (lab, i) {
        svg.appendChild(S('text', { 'class': 'chart__x' + (i === sel ? ' is-sel' : ''), x: r1(X(i)), y: ay + 17, 'text-anchor': 'middle' }, lab));
        var sub = cfg.xSub && cfg.xSub[i];
        if (sub) svg.appendChild(S('text', { 'class': 'chart__xsub' + (sub.cls ? ' is-' + sub.cls : '') + (i === sel ? ' is-sel' : ''), x: r1(X(i)), y: ay + 33, 'text-anchor': 'middle' }, sub.text));
      });
    }

    function select(i, quiet) {
      i = clamp(i | 0, 0, n - 1);
      if (i === sel) return;
      sel = i;
      draw();
      if (!quiet && typeof cfg.onSelect === 'function') cfg.onSelect(sel);
    }
    function indexAt(clientX) {
      var r = svg.getBoundingClientRect();
      var x = (clientX - r.left) * (geo.W / (r.width || geo.W));
      return clamp(Math.floor((x - geo.left) / geo.plotW * n), 0, n - 1);
    }

    draw();
    var unbind = scrub(svg, function () { return n; }, indexAt, function () { return sel; }, select);
    var unwatch = watchWidth(root, draw);

    return {
      el: root,
      select: function (i) { select(i, true); },
      selected: function () { return sel; },
      redraw: draw,
      destroy: function () { unbind(); unwatch(); if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  // ---------------------------------------------------------------------------
  //  small multiples of column charts
  // ---------------------------------------------------------------------------
  function multiples(host, cfg) {
    var n = cfg.labels.length;
    var sel = clamp(cfg.selected == null ? n - 1 : cfg.selected, 0, Math.max(0, n - 1));
    var panels = cfg.panels || [];
    var max = cfg.max;
    if (!isNum(max)) {
      max = 0;
      panels.forEach(function (p) { p.values.forEach(function (v) { if (isNum(v) && v > max) max = v; }); });
    }
    if (!(max > 0)) max = 1;
    var min = 0;                                     // 0, or the lowest value when one is negative (a defence can score below zero)
    panels.forEach(function (p) { p.values.forEach(function (v) { if (isNum(v) && v < min) min = v; }); });
    var fmt = cfg.format || function (v) { return String(v); };

    var root = H('div', 'chart-multi');
    root.setAttribute('role', 'group');
    if (cfg.label) root.setAttribute('aria-label', cfg.label);
    var built = panels.map(function (p) {
      var box = H('div', 'chart-multi__panel');
      var head = H('div', 'chart-multi__head');
      head.appendChild(H('b', 'chart-multi__name', p.name));
      if (p.note) head.appendChild(H('span', 'chart-multi__note', p.note));
      var svg = S('svg', { 'class': 'chart__svg chart-multi__svg', role: 'img', tabindex: '0', 'aria-label': p.name });
      box.appendChild(head); box.appendChild(svg);
      root.appendChild(box);
      return { p: p, box: box, svg: svg, geo: { W: 150, left: 2, plotW: 146 } };
    });
    host.appendChild(root);

    function drawOne(b) {
      var W = Math.max(110, Math.floor(b.box.clientWidth || 150)), Ht = 104;
      var left = 2, right = 2, top = 24, bottom = 18;
      var plotW = W - left - right, plotH = Ht - top - bottom;
      var band = plotW / n, bw = Math.max(3, Math.min(24, band - 3));
      var Y = scale(min, max, top + plotH, top), zero = Y(0);
      var svg = b.svg;
      b.geo = { W: W, left: left, plotW: plotW };
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Ht);
      svg.setAttribute('width', W); svg.setAttribute('height', Ht);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      svg.appendChild(S('rect', { 'class': 'chart__band', x: r1(left + band * sel), y: top - 7, width: r1(band), height: plotH + 7 }));
      b.p.values.forEach(function (v, i) {
        if (!isNum(v)) return;
        var y0 = v < 0 ? zero : Math.min(Y(v), zero - 1), y1 = v < 0 ? Math.max(Y(v), zero + 1) : zero;      // at least 1px tall
        svg.appendChild(S('rect', { 'class': 'chart__col' + (i === sel ? ' is-sel' : ''), x: r1(left + band * i + (band - bw) / 2), y: r1(y0), width: r1(bw), height: r1(y1 - y0) }));
      });
      var zy = Math.round(zero) + 0.5;
      svg.appendChild(S('line', { 'class': 'chart__axis', x1: left, x2: left + plotW, y1: zy, y2: zy }));
      var v = b.p.values[sel];
      if (isNum(v)) {
        var text = fmt(v), half = text.length * 7.3 / 2 + 1;
        svg.appendChild(S('text', { 'class': 'chart__value', x: r1(clamp(left + band * (sel + 0.5), half, W - half)), y: top - 10, 'text-anchor': 'middle' }, text));
      }
      [0, n - 1, sel].forEach(function (i, k) {
        if (k === 2 && (i === 0 || i === n - 1)) return;
        svg.appendChild(S('text', { 'class': 'chart__x' + (i === sel ? ' is-sel' : ''), x: r1(left + band * (i + 0.5)), y: top + plotH + 14, 'text-anchor': 'middle' }, cfg.labels[i]));
      });
    }
    function draw() { built.forEach(drawOne); }
    function select(i, quiet) {
      i = clamp(i | 0, 0, n - 1);
      if (i === sel) return;
      sel = i;
      draw();
      if (!quiet && typeof cfg.onSelect === 'function') cfg.onSelect(sel);
    }

    draw();
    var unbinds = built.map(function (b) {
      return scrub(b.svg, function () { return n; }, function (clientX) {
        var r = b.svg.getBoundingClientRect();
        var x = (clientX - r.left) * (b.geo.W / (r.width || b.geo.W));
        return clamp(Math.floor((x - b.geo.left) / b.geo.plotW * n), 0, n - 1);
      }, function () { return sel; }, select);
    });
    var unwatch = watchWidth(root, draw);

    return {
      el: root,
      select: function (i) { select(i, true); },
      selected: function () { return sel; },
      redraw: draw,
      destroy: function () { unbinds.forEach(function (u) { u(); }); unwatch(); if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  window.CHARTS = { line: line, multiples: multiples, scale: scale, ticks: ticks };
})();
