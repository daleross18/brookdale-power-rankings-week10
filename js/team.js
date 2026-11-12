// ============================================================================
//  team.js — view 'team' (#/t/<slug>): one team's page of the paper.
//
//  Top to bottom (css/team.css):
//    .tm-top      on the desk: team navigation (back to the rankings, previous / next by power rank), the main clipping
//                 (rank, movement since the preseason, tagline as the headline, profile photo, name, manager, record,
//                 preseason rank, former name) and the meme as a second clipping
//    .tm-page     on the paper, each block a section.tm-sec:
//      write-up   WRITEUPS[slug].text — only when it is not empty
//      would be   "WOULD BE x-x VS [team]": STATS.wouldBe(slug, other) with the week-by-week strip
//      odds       current implied odds, the change since week 1 and the week-1 values
//      season     line chart (js/charts.js): Standing / Record / Points, and Points by position when
//                 STATS.bySlug[slug].positions exists; the readout under it prints the selected week
//      results    the played games, then the remaining schedule
//      numbers    key numbers
//      roster     ROSTER.render(slug) when js/roster.js is loaded
//    .tm-foot     on the desk: previous / next team
//
//  Reads window.STATS when it mounts (not when the file loads). Left / right arrow keys go to the previous / next team
//  while nothing on the page has the focus.
// ============================================================================
(function () {
  'use strict';
  var APP = window.APP;
  if (!APP) return;
  var h = APP.h, fmt = APP.fmt;

  var lastMetric = 'standing';          // the chart keeps its metric while you page through the teams
  var lastSplit = 'total';

  function minus(text) { return String(text).replace(/^-/, '\u2212'); }          // a real minus sign, as fmt.signed prints
  function pts(n) { return minus(fmt.num(n, 2)); }
  function signed(n, d) { return fmt.signed(n, d == null ? 2 : d); }
  function wl(result) { return result === 'W' ? 'w' : result === 'L' ? 'l' : 't'; }
  function res(result) { return h('span.res.res--' + wl(result), result); }
  function opt(t) { return t.manager + ' (' + t.name + ')'; }
  function teamLink(t, cls) { return h('a' + (cls || ''), { href: APP.teamHref(t.slug) }, APP.wbr(t.name)); }

  // Sets the element in the biggest type that fits its box. The CSS font-size is the base; --fit-grow / --fit-shrink
  // are the limits as multiples of it, --fit-lines the most lines allowed and --fit-h (optional) a height budget as a
  // multiple of the element's width. Fewer lines win when they cost little: the fewest lines whose best size is at
  // least --fit-prefer (default 0.8) of the biggest size on offer.
  function fit(el) {
    if (!el) return;
    el.style.fontSize = '';
    if (!el.clientWidth) return;
    var cs = getComputedStyle(el), base = parseFloat(cs.fontSize);
    var lh = (parseFloat(cs.lineHeight) || base) / base;
    var hi0 = base * (parseFloat(cs.getPropertyValue('--fit-grow')) || 1);
    var lo0 = base * (parseFloat(cs.getPropertyValue('--fit-shrink')) || 0.6);
    var maxLines = parseInt(cs.getPropertyValue('--fit-lines'), 10) || 3;
    var prefer = parseFloat(cs.getPropertyValue('--fit-prefer')) || 0.8;
    var maxH = (parseFloat(cs.getPropertyValue('--fit-h')) || 0) * el.clientWidth || Infinity;
    var best = function (cap) {
      var ok = function (px) {
        el.style.fontSize = px + 'px';
        return el.scrollWidth <= el.clientWidth + 0.5 && Math.round(el.offsetHeight / (px * lh)) <= cap && el.offsetHeight <= maxH + 0.5;
      };
      if (!ok(lo0)) return 0;
      if (ok(hi0)) return hi0;
      var lo = lo0, hi = hi0;
      for (var i = 0; i < 7; i++) { var mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
      return lo;
    };
    var sizes = [], top = 0, L, size = 0;
    for (L = 1; L <= maxLines; L++) { sizes[L] = best(L); top = Math.max(top, sizes[L]); }
    for (L = 1; L <= maxLines; L++) { if (sizes[L] && sizes[L] >= top * prefer) { size = sizes[L]; break; } }
    el.style.fontSize = (Math.floor((size || lo0) * 4) / 4) + 'px';
  }

  // ---------------------------------------------------------------------------
  //  top: navigation + clippings
  // ---------------------------------------------------------------------------
  function stepLink(t, dir) {
    return h('a.tm-nav__step.tm-nav__step--' + dir, { href: APP.teamHref(t.slug), rel: dir },
      h('span.sr-only', dir === 'prev' ? 'Previous team: ' : 'Next team: '),
      h('span.tm-nav__no', String(t.rank)),
      h('span.tm-nav__name', t.name));
  }

  function buildTop(t, prev, next) {
    var delta = t.rankDelta || 0;
    var moveText = delta > 0 ? 'Up ' + delta + ' from preseason No. ' + t.pre.rank
      : delta < 0 ? 'Down ' + (-delta) + ' from preseason No. ' + t.pre.rank : '';
    var renamed = t.pre && t.pre.name && t.pre.name !== t.name;

    var head = h('p.headline.tm-card__head', t.tagline);
    var name = h('h1.tm-card__name', APP.wbr(t.name));
    var profile = APP.photo(t.profile, t.manager, { class: 'tm-card__photo' });
    profile.querySelector('img').loading = 'eager';

    var card = APP.clipping({ tag: 'article', class: 'tm-card' + (t.rank % 3 === 0 ? ' clipping--cut3' : t.rank % 3 === 2 ? ' clipping--cut2' : ''), rot: -0.7 },
      h('div.tm-card__top',
        h('div.tm-card__rank',
          h('span.tm-card__num', h('span.sr-only', 'Power rank '), String(t.rank)),
          delta ? APP.tip(APP.mover(delta, moveText), moveText) : null),
        head),
      h('div.tm-card__bot',
        profile,
        h('div.tm-card__cap',
          name,
          h('p.tm-card__mgr', t.manager),
          h('p.tm-card__meta',
            t.pre && t.pre.rank ? h('span', 'Preseason No. ' + t.pre.rank) : null,
            renamed ? h('span', 'formerly ' + t.pre.name) : null),
          h('p.tm-card__rec', h('span.sr-only', 'Record '), recText(t.record)))));

    var meme = null;
    if (t.meme) {
      var fig = APP.photo(t.meme, '', { class: 'tm-meme__photo' });
      var img = fig.querySelector('img');
      img.loading = 'eager';
      meme = APP.clipping({ class: 'tm-meme clipping--aged', rot: t.rank % 2 ? 2.1 : -2.2 }, h('i.tape'), fig);
      var shape = function () {                       // the meme is shown whole, at its own proportions
        if (!img.naturalWidth || !img.naturalHeight) return;
        fig.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
        meme.style.setProperty('--ar', (img.naturalWidth / img.naturalHeight).toFixed(3));
      };
      if (img.complete) shape(); else img.addEventListener('load', shape);
      img.addEventListener('error', function () { meme.hidden = true; });
    }

    var el = h('section.desk.tm-top',
      h('nav.tm-nav', { 'aria-label': 'Teams' },
        h('a.tm-nav__back', { href: '#/' }, 'Rankings'),
        h('div.tm-nav__steps', stepLink(prev, 'prev'), stepLink(next, 'next'))),
      h('div.tm-hero' + (meme ? '' : '.tm-hero--solo'), card, meme));
    return { el: el, fitted: [head, name] };
  }
  function recText(r) { return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); }

  // ---------------------------------------------------------------------------
  //  write-up
  // ---------------------------------------------------------------------------
  function buildWriteup(slug) {
    var w = window.WRITEUPS && window.WRITEUPS[slug];
    var text = w && typeof w.text === 'string' ? w.text.replace(/\r\n?/g, '\n').trim() : '';
    if (!text) return null;
    var paras = text.split(/\n[ \t]*\n+/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
    if (!paras.length) return null;
    return h('section.tm-sec.tm-writeup',
      h('div.prose.prose--cols.tm-writeup__text', paras.map(function (p) { return h('p', p); })));
  }

  // ---------------------------------------------------------------------------
  //  would be
  // ---------------------------------------------------------------------------
  function buildWouldBe(S, t, idx) {
    var others = S.teams.filter(function (o) { return o.slug !== t.slug; });
    if (!others.length) return null;
    var def = S.teams[idx === 0 ? 1 : idx - 1] || others[0];

    var rec = h('output.tm-wb__rec', { 'aria-live': 'polite' });
    var strip = h('ol.tm-wb__strip');
    var key = h('p.tm-wb__key');
    var select = h('select.select.tm-wb__sel', { 'aria-label': 'Opponent' },
      others.map(function (o) { return h('option', { value: o.slug }, opt(o)); }));
    select.value = def.slug;

    function render() {
      var o = S.bySlug[select.value], wb = o && S.wouldBe(t.slug, o.slug);
      if (!wb) return;
      rec.textContent = S.recordText(wb);
      var met = {};
      (wb.meetings || []).forEach(function (m) { met[m.week] = true; });
      strip.textContent = '';
      strip.appendChild(h('li.tm-wb__wk.tm-wb__wk--head', { 'aria-hidden': 'true' },
        h('span.tm-wb__n', 'Wk'),
        h('span.tm-wb__a', t.manager),
        h('span.tm-wb__b', o.manager),
        h('span.tm-wb__r')));
      wb.weeks.forEach(function (w) {
        strip.appendChild(h('li.tm-wb__wk' + (met[w.week] ? '.is-met' : ''),
          h('span.tm-wb__n', h('span.sr-only', 'Week '), String(w.week)),
          h('b.tm-wb__a.num', h('span.sr-only', t.manager + ' '), pts(w.a)),
          h('span.tm-wb__b.num', h('span.sr-only', o.manager + ' '), pts(w.b)),
          h('span.tm-wb__r', res(w.result))));
      });
      var weeks = (wb.meetings || []).map(function (m) { return m.week; });
      key.textContent = '';
      if (weeks.length) {
        key.appendChild(h('span.tm-wb__swatch', { 'aria-hidden': 'true' }));
        key.appendChild(document.createTextNode('Played each other in week ' + weeks.join(' and ')));
      }
    }
    select.addEventListener('change', render);
    render();

    var el = h('section.tm-sec.tm-wb',
      h('div.tm-wb__head',
        h('h2.headline.tm-wb__lead', 'Would be'),
        rec,
        h('span.headline.tm-wb__vs', 'vs'),
        select),
      strip,
      key);
    return { el: el, cleanup: function () { select.removeEventListener('change', render); } };
  }

  // ---------------------------------------------------------------------------
  //  odds
  // ---------------------------------------------------------------------------
  function buildOdds(t) {
    var o = t.odds;
    if (!o || !o.now) return null;
    var pre = o.pre || null, d = o.delta || {};
    function row(label, key) {
      var now = o.now[key], was = pre && pre[key], delta = d[key];
      if (!now) return null;
      var dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      return h('li.tm-odds__row',
        h('span.odds.tm-odds__chip',
          h('span.odds__label', label),
          h('span.odds__val', fmt.pct(now.pct, now.pct % 1 ? 1 : 0)),
          h('span.odds__val.tm-odds__line', now.odds),
          was && delta != null ? h('span.odds__delta.' + dir,
            h('span.sr-only', delta > 0 ? 'up ' : delta < 0 ? 'down ' : 'no change '),
            signed(delta, delta % 1 ? 1 : 0)) : null),
        was ? h('span.tm-odds__was',
          h('span.tm-odds__wk', 'Week 1'),
          h('span.num', fmt.pct(was.pct, was.pct % 1 ? 1 : 0)),
          h('span.num', was.odds)) : null);
    }
    var proj = o.now.projectedRecord ? h('li.tm-odds__row',
      h('span.odds.tm-odds__chip',
        h('span.odds__label', 'Projected'),
        h('span.odds__val', o.now.projectedRecord)),
      pre && pre.projectedRecord ? h('span.tm-odds__was',
        h('span.tm-odds__wk', 'Week 1'),
        h('span.num', pre.projectedRecord)) : null) : null;

    return h('section.tm-sec.tm-odds',
      APP.sectionHead('Implied odds', 'Change since week 1'),
      h('ul.tm-odds__list', row('Playoffs', 'playoff'), row('Finals', 'finals'), row('Championship', 'championship'), proj));
  }

  // ---------------------------------------------------------------------------
  //  season chart
  // ---------------------------------------------------------------------------
  function buildSeason(S, t) {
    var CH = window.CHARTS, log = t.log || [];
    if (!log.length) return null;
    var labels = log.map(function (l) { return String(l.week); });
    var xSub = log.map(function (l) { return { text: l.result, cls: wl(l.result) }; });
    var resultDot = function (i) { return { cls: wl(log[i].result) }; };
    var hasPos = !!(t.positions && t.positions.keys && t.positions.keys.length && t.positions.weeks && t.positions.weeks.length);
    var posByWeek = {};                    // positions.weeks leaves out weeks without data, so look them up by week number
    if (hasPos) t.positions.weeks.forEach(function (w) { if (w) posByWeek[w.week] = w; });
    var posAt = function (i, k) { var w = posByWeek[log[i].week]; return w && w.byPos && typeof w.byPos[k] === 'number' ? w.byPos[k] : null; };

    // league-wide scales, so every team page is drawn on the same axes
    var lo = Infinity, hi = -Infinity, swing = 1;
    S.teams.forEach(function (o) {
      (o.log || []).forEach(function (l) {
        lo = Math.min(lo, l.pts); hi = Math.max(hi, l.pts);
        swing = Math.max(swing, Math.abs(l.cumW - l.cumL));
      });
    });
    var pMin = Math.floor(lo / 10) * 10, pMax = Math.ceil(hi / 10) * 10;

    var metric = lastMetric, split = hasPos ? lastSplit : 'total';
    var sel = log.length - 1;
    var chart = null;

    var tabs = [['standing', 'Standing'], ['record', 'Record'], ['points', 'Points']].map(function (m) {
      return h('button', { type: 'button', role: 'tab', dataset: { metric: m[0] } }, m[1]);
    });
    var seg = h('div.seg.seg--block.tm-season__seg', { role: 'tablist', 'aria-label': 'Chart' }, tabs);
    var splitTabs = hasPos ? [['total', 'Total'], ['position', 'By position']].map(function (m) {
      return h('button', { type: 'button', dataset: { split: m[0] } }, m[1]);
    }) : [];
    var splitSeg = hasPos ? h('div.seg.tm-season__split', { role: 'group', 'aria-label': 'Points' }, splitTabs) : null;
    var plot = h('div.tm-season__plot');
    var read = h('div.tm-read', { 'aria-live': 'polite' });

    function cell(label, value, cls) {
      return h('div.tm-read__cell' + (cls || ''), h('span.label', label), h('b.num', value));
    }
    function readout() {
      var l = log[sel], o = S.bySlug[l.opp], lw = S.league.weeks[sel];
      read.textContent = '';
      read.appendChild(h('div.tm-read__game',
        h('span.tm-read__wk', 'Week ' + l.week),
        res(l.result),
        h('b.num', pts(l.pts) + '–' + pts(l.oppPts)),
        o ? h('span.tm-read__opp', 'vs ', teamLink(o)) : null));
      var cells;
      if (metric === 'points' && split === 'position' && hasPos) {
        cells = t.positions.keys.map(function (k) {
          var v = posAt(sel, k);
          return cell(k, v == null ? '–' : pts(v));
        });
      } else {
        cells = [
          cell('Record', l.cumW + '-' + l.cumL + (l.cumT ? '-' + l.cumT : '')),
          cell('Standing', S.ordinal(l.standing)),
          cell('Margin', signed(l.margin), '.' + wl(l.result)),
          lw ? cell('League avg', pts(lw.avg)) : null,
          cell('Week rank', S.ordinal(l.weekRank))
        ];
      }
      read.appendChild(h('div.tm-read__cells', cells));
    }

    function config() {
      var base = { labels: labels, xTitle: 'Wk', selected: sel, onSelect: function (i) { sel = i; readout(); } };
      if (metric === 'standing') {
        var n = S.teamCount, ticks = [];
        for (var p = 1; p <= n; p++) ticks.push({ v: p, text: String(p), faded: p > S.playoffTeams });
        base.series = [{ name: 'Standing', values: log.map(function (l) { return l.standing; }), kind: 'main', dot: resultDot,
          label: function (i) { return S.ordinal(log[i].standing); } }];
        base.y = { min: 0.5, max: n + 0.5, invert: true, ticks: ticks };
        base.marks = S.playoffTeams < n ? [{ y: S.playoffTeams + 0.5, cls: 'cut', name: 'Playoff line' }] : [];
        base.xSub = xSub;
        base.height = function (w) { return Math.round(Math.max(264, Math.min(340, w * 0.4))); };
        base.label = t.name + ': league standing after each week';
      } else if (metric === 'record') {
        var rt = [];
        for (var v = -swing; v <= swing; v++) {
          if (swing > 4 && v % 2) continue;
          rt.push({ v: v, text: v === 0 ? '.500' : (v > 0 ? '+' : '−') + Math.abs(v), strong: v === 0 });
        }
        base.series = [{ name: 'Record', values: log.map(function (l) { return l.cumW - l.cumL; }), kind: 'main',
          dot: function (i) { return { cls: wl(log[i].result), text: log[i].result }; },
          label: function (i) { var l = log[i]; return l.cumW + '-' + l.cumL + (l.cumT ? '-' + l.cumT : ''); } }];
        base.y = { min: -swing - 0.9, max: swing + 0.9, ticks: rt };
        base.marks = [];
        base.height = function (w) { return Math.round(Math.max(264, Math.min(340, w * 0.4))); };
        base.label = t.name + ': wins minus losses after each week';
      } else {
        base.series = [
          { name: 'League average', values: S.league.weeks.map(function (w) { return w.avg; }), kind: 'avg' },
          { name: 'Opponent', values: log.map(function (l) { return l.oppPts; }), kind: 'ref', dot: function () { return { cls: '' }; } },
          { name: t.name, values: log.map(function (l) { return l.pts; }), kind: 'main', dot: resultDot,
            label: function (i) { return pts(log[i].pts); } }
        ];
        base.y = { min: pMin, max: pMax, ticks: CH.ticks(pMin, pMax, 6).map(function (v) { return { v: v, text: String(v) }; }) };
        base.xSub = xSub;
        base.height = function (w) { return Math.round(Math.max(264, Math.min(340, w * 0.4))); };
        base.label = t.name + ': points each week, with the opponent and the league average';
      }
      return base;
    }

    function draw() {
      if (chart) { chart.destroy(); chart = null; }
      tabs.forEach(function (b) { b.setAttribute('aria-selected', b.dataset.metric === metric ? 'true' : 'false'); });
      splitTabs.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.split === split ? 'true' : 'false'); });
      if (splitSeg) splitSeg.hidden = metric !== 'points';
      if (CH) {
        if (metric === 'points' && split === 'position' && hasPos) {
          var P = t.positions, top = 0;
          P.keys.forEach(function (k) { log.forEach(function (l, i) { var v = posAt(i, k); if (v > top) top = v; }); });
          chart = CH.multiples(plot, {
            labels: labels, selected: sel, max: top,
            panels: P.keys.map(function (k) {
              return { name: k, note: P.avg && P.avg[k] != null ? 'avg ' + fmt.num(P.avg[k], 1) : '',
                values: log.map(function (l, i) { return posAt(i, k); }) };
            }),
            format: function (v) { return minus(fmt.num(v, 1)); },
            onSelect: function (i) { sel = i; readout(); },
            label: t.name + ': points by position each week'
          });
        } else {
          chart = CH.line(plot, config());
        }
      }
      readout();
    }

    function onTab(e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.dataset.metric === metric) return;
      metric = lastMetric = b.dataset.metric;
      draw();
    }
    function onSplit(e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || b.dataset.split === split) return;
      split = lastSplit = b.dataset.split;
      draw();
    }
    seg.addEventListener('click', onTab);
    if (splitSeg) splitSeg.addEventListener('click', onSplit);

    var el = h('section.tm-sec.tm-season',
      APP.sectionHead('Season', 'Weeks ' + log[0].week + '–' + log[log.length - 1].week),
      h('div.tm-season__ctl', seg, splitSeg),
      plot, read);
    return {
      el: el,
      start: draw,                         // drawn once the section is in the document (the chart measures its width)
      cleanup: function () {
        seg.removeEventListener('click', onTab);
        if (splitSeg) splitSeg.removeEventListener('click', onSplit);
        if (chart) { chart.destroy(); chart = null; }
      }
    };
  }

  // ---------------------------------------------------------------------------
  //  results + remaining schedule
  // ---------------------------------------------------------------------------
  function oppCell(S, slug) {
    var o = S.bySlug[slug];
    if (!o) return h('td.team', slug);
    return h('td.team.tm-opp', teamLink(o), h('span.tm-opp__mgr', o.manager));
  }
  function buildResults(S, t) {
    var log = t.log || [];
    if (!log.length) return null;
    var oppProj = 0;
    var rows = log.map(function (l) {
      oppProj += l.oppProj || 0;
      return h('tr',
        h('td.num.tm-res__wk', String(l.week)),
        oppCell(S, l.opp),
        h('td.num.tm-res__r', res(l.result), h('span.tm-sub.' + wl(l.result), signed(l.margin))),
        h('td.num', h('b', pts(l.pts)), h('span.tm-sub', pts(l.proj))),
        h('td.num', pts(l.oppPts), h('span.tm-sub', pts(l.oppProj))),
        h('td.num.tm-wide.' + wl(l.result), signed(l.margin)),
        h('td.num.tm-wide', pts(l.proj)),
        h('td.num.tm-wide', pts(l.oppProj)));
    });
    var table = h('table.data.data--dense.tm-res',
      h('thead', h('tr',
        h('th.num', { scope: 'col' }, 'Wk'),
        h('th', { scope: 'col' }, 'Opponent'),
        h('th.num.tm-res__r', { scope: 'col' }, h('span.sr-only', 'Result'), h('span.tm-sub', 'Margin')),
        h('th.num', { scope: 'col' }, 'Pts', h('span.tm-sub', 'Proj')),
        h('th.num', { scope: 'col' }, 'Opp', h('span.tm-sub', 'Proj')),
        h('th.num.tm-wide', { scope: 'col' }, 'Margin'),
        h('th.num.tm-wide', { scope: 'col' }, 'Proj'),
        h('th.num.tm-wide', { scope: 'col' }, 'Opp proj'))),
      h('tbody', rows),
      h('tfoot', h('tr',
        h('td'),
        h('td', 'Total'),
        h('td.num.tm-res__r', h('span.tm-res__rec', S.recordText(t.record)), h('span.tm-sub', signed(t.diff))),
        h('td.num', pts(t.pf), h('span.tm-sub', pts(t.vsProj.totalProj))),
        h('td.num', pts(t.pa), h('span.tm-sub', pts(oppProj))),
        h('td.num.tm-wide', signed(t.diff)),
        h('td.num.tm-wide', pts(t.vsProj.totalProj)),
        h('td.num.tm-wide', pts(oppProj)))));
    return h('section.tm-sec.tm-results', APP.sectionHead('Results', S.recordText(t.record)), table);
  }

  function buildRemaining(S, t) {
    var rem = t.remaining || [];
    if (!rem.length) return null;
    var rows = rem.map(function (g) {
      var o = S.bySlug[g.opp], p = g.prev;
      return h('tr',
        h('td.num.tm-res__wk', String(g.week)),
        o ? h('td.team.tm-opp', teamLink(o), h('span.tm-opp__mgr', o.manager + ', ' + S.recordText(o.record))) : h('td.team', g.opp),
        h('td.tm-rem__prev', p ? [res(p.result), h('span.num', pts(p.pts) + '–' + pts(p.oppPts)), h('span.tm-rem__wk', 'Wk ' + p.week)] : null));
    });
    var table = h('table.data.data--dense.tm-rem',
      h('thead', h('tr',
        h('th.num', { scope: 'col' }, 'Wk'),
        h('th', { scope: 'col' }, 'Opponent'),
        h('th', { scope: 'col' }, 'First meeting'))),
      h('tbody', rows));
    return h('section.tm-sec.tm-remaining',
      APP.sectionHead('Remaining', 'Weeks ' + rem[0].week + '–' + rem[rem.length - 1].week), table);
  }

  // ---------------------------------------------------------------------------
  //  key numbers
  // ---------------------------------------------------------------------------
  function buildNumbers(S, t) {
    function rank(key, opts) { var r = S.rankOf(t.slug, key, opts); return r && r.text ? r.text : ''; }
    function stat(label, value, sub, tip) {
      var lab = h('span.stat__label', label);
      if (tip) { lab.classList.add('tip'); APP.tip(lab, tip); }
      return h('div.stat', lab, h('b.stat__value', value), sub ? h('span.stat__sub', sub) : null);
    }
    function wk(x) { var o = S.bySlug[x.opp]; return 'Week ' + x.week + (o ? ' vs ' + o.manager : ''); }
    var sc = t.scoring, vp = t.vsProj, ap = t.allPlay;
    var paRank = S.rankOf(t.slug, 'pa');
    var items = [
      stat('Points for', pts(t.pf), rank('pf')),
      stat('Points against', pts(t.pa), paRank && paRank.rank ? (paRank.tied ? 'T-' : '') + S.ordinal(paRank.rank) + ' most' : ''),
      stat('All-play', ap.w + '-' + ap.l + (ap.t ? '-' + ap.t : ''), rank('allPlay.pct'),
        'Record against all nine other scores, every week'),
      stat('Expected wins', fmt.num(t.xWins, 2), rank('xWins'),
        'Each week counts as the share of the other nine teams outscored'),
      stat('Luck', signed(t.luck), rank('luck'), 'Wins minus expected wins'),
      sc && sc.high ? stat('High week', pts(sc.high.pts), wk(sc.high)) : null,
      sc && sc.low ? stat('Low week', pts(sc.low.pts), wk(sc.low)) : null,
      vp ? stat('Vs projection', signed(vp.avgDiff), 'a week, beat ' + vp.beat + ' of ' + vp.games) : null
    ];
    return h('section.tm-sec.tm-numbers', APP.sectionHead('Numbers'), h('div.stat-grid.tm-numbers__grid', items));
  }

  // ---------------------------------------------------------------------------
  //  foot: previous / next
  // ---------------------------------------------------------------------------
  function footLink(S, t, dir) {
    return APP.clipping({ tag: 'a', href: APP.teamHref(t.slug), class: 'tm-foot__link tm-foot__link--' + dir, rot: dir === 'prev' ? -1.1 : 1.2 },
      h('span.label.tm-foot__dir', dir === 'prev' ? 'Previous' : 'Next'),
      h('span.tm-foot__row',
        h('span.tm-foot__num', String(t.rank)),
        h('span.tm-foot__name', APP.wbr(t.name))),
      h('span.tm-foot__rec.num', S.recordText(t.record)));
  }

  // ---------------------------------------------------------------------------
  //  view
  // ---------------------------------------------------------------------------
  APP.register('team', {
    mount: function (root, params) {
      var S = window.STATS, slug = params && params.slug;
      var t = S && S.bySlug ? S.bySlug[slug] : null;
      if (!t) return function () {};
      APP.setTitle(t.name);

      var teams = S.teams, idx = teams.indexOf(t), n = teams.length;
      var prev = teams[(idx - 1 + n) % n], next = teams[(idx + 1) % n];
      var cleanups = [], alive = true;
      var safe = function (name, fn) { try { return fn(); } catch (e) { console.error('[team] ' + name + ' failed', e); return null; } };

      var top = buildTop(t, prev, next);
      root.appendChild(top.el);

      var page = h('div.page.tm-page');
      var add = function (part) {
        if (!part) return null;
        var el = part.el || part;
        page.appendChild(el);
        if (part.cleanup) cleanups.push(part.cleanup);
        return part;
      };
      add(safe('write-up', function () { return buildWriteup(slug); }));
      add(safe('would be', function () { return buildWouldBe(S, t, idx); }));
      add(safe('odds', function () { return buildOdds(t); }));
      var season = add(safe('season', function () { return buildSeason(S, t); }));
      add(safe('results', function () { return buildResults(S, t); }));
      add(safe('remaining', function () { return buildRemaining(S, t); }));
      add(safe('numbers', function () { return buildNumbers(S, t); }));
      if (window.ROSTER && typeof window.ROSTER.render === 'function') {
        var roster = safe('roster', function () { return window.ROSTER.render(slug); });
        if (roster && roster.nodeType === 1) page.appendChild(h('div.tm-sec.tm-roster', roster));
      }
      root.appendChild(page);

      if (n > 1) {
        root.appendChild(h('nav.desk.tm-foot', { 'aria-label': 'More teams' },
          h('div.tm-foot__in', footLink(S, prev, 'prev'), footLink(S, next, 'next')),
          h('a.tm-foot__back', { href: '#/' }, 'Rankings')));
      }

      if (season && season.start) safe('chart', season.start);

      // headline and name are set to fill their boxes; refit when the width or the fonts change
      var raf = 0, lastW = root.clientWidth;
      var refit = function () { if (alive) top.fitted.forEach(fit); };
      var queue = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(refit); };
      var onResize = function () { var w = root.clientWidth; if (w !== lastW) { lastW = w; queue(); } };
      refit();
      window.addEventListener('resize', onResize);
      if (document.fonts) {
        if (document.fonts.ready) document.fonts.ready.then(queue);
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', queue);
      }

      // left / right arrows page through the teams while nothing on the page is focused
      var onKey = function (e) {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var a = document.activeElement;
        if (a && a !== document.body && a !== root) return;
        if (document.documentElement.classList.contains('intro-active')) return;
        e.preventDefault();
        APP.go(APP.teamHref((e.key === 'ArrowLeft' ? prev : next).slug));
      };
      document.addEventListener('keydown', onKey);

      return function cleanup() {
        alive = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('keydown', onKey);
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', queue);
        cleanups.forEach(function (fn) { try { fn(); } catch (e) { console.error('[team] cleanup failed', e); } });
      };
    }
  });
})();
