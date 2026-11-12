// ============================================================================
//  sim.js — the 'sim' view (#/sim, #/sim?seed=<uint32>): roll the rest of the season on top of the real results.
//  Reads window.SIM_ENGINE (js/sim-engine.js) and window.BROOKDALE. Styles: css/sim.css.
//
//  On arrival nothing is simulated: the page shows the remaining schedule (weeks 10–14 pairings), the real standings
//  through week 9, the playoff seeds as they stand, the Monte Carlo odds and the real results of weeks 1–9.
//  "Simulate rest of season" draws a seed, puts it in the URL (#/sim?seed=…, location.replace: rolls do not pile up
//  in the back button, and the router still hears about it) and plays SIM_ENGINE.simulate(seed): weeks 10–14 one at
//  a time, then weeks 15–17 (wild card + consolation, semifinals + placement games, final + third place), ending on
//  the champion and the last-place team. Tap the stage or "Skip" to finish at once. A URL that already carries a
//  seed shows that season immediately; "Copy link" copies that URL. The seed itself is never printed on the page
//  (on this page "seed" means a playoff seed).
//
//  Page parts (top to bottom)
//    .sim-ctl      Simulate / Simulate again, Copy link
//    .sim-stage    the desk: result slips during a roll, then the champion and last-place clippings
//    weeks 10–14   pairings, then simulated scores (tabs on phones, five columns from 1000px)
//    standings     through week 9 … 14 (SIM_ENGINE.standingsThrough); week buttons appear once a season is rolled
//    playoffs      bracket + consolation; before a roll it shows the seeds as they stand, without scores
//    odds          Monte Carlo table, filled in slices with SIM_ENGINE.createRun() so the page never blocks;
//                  the first 10,000 seasons equal SIM_ENGINE.baseline(); "Run 10,000 more" grows the sample.
//                  The table is repainted at fixed sample sizes (MC_PAINT_AT), not on a clock, so a slow phone
//                  spends its time simulating instead of repainting
//    weeks 1–9     the real results
// ============================================================================
(function () {
  'use strict';
  var APP = window.APP, ENGINE = window.SIM_ENGINE, B = window.BROOKDALE;
  if (!APP || !ENGINE || !B || !B.season) return;
  var h = APP.h, fmt = APP.fmt;

  var SEASON = B.season;
  var PLAYED = SEASON.weeksPlayed;                    // 9
  var REG = SEASON.regularSeasonWeeks;                // 14
  var CUT = SEASON.playoffTeams;                      // 6
  var WC = REG + 1, SEMI = REG + 2, FINAL = REG + 3, DONE = REG + 4;   // playoff weeks 15, 16, 17; DONE = all shown
  var STEP_MS = { week: 520, playoff: 1000, last: 1250 };
  var MC_SLICE = 20;                                   // seasons per engine call (well under a millisecond on a laptop, a few on a
                                                       // slow phone); the clock is read after every call, so one turn never runs
                                                       // more than one slice past its budget
  var MC_BUDGET_MS = 8;                                // work per turn of the event loop
  var MC_MORE = 10000;
  var MC_PAINT_AT = [0.02, 0.1, 0.3, 0.6];              // repaint the table at these shares of a run, and at its end
  var MC_MAX = 1000000;

  var S = null;                                        // state of the mounted view
  var RUN = null;                                      // the Monte Carlo run; kept between visits so the odds are not re-simulated

  // ---------- small helpers ----------
  function teamName(slug) { var t = APP.team(slug); return t ? t.name : String(slug || ''); }
  function recText(r) { return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); }
  function reduced() { return /[?&]reduce\b/.test(location.search); }   // OS Reduce Motion is deliberately ignored; ?reduce opts out
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function parseSeed(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!/^\d{1,10}$/.test(s)) return null;
    var n = Number(s);
    return n <= 4294967295 ? n : null;
  }
  // "1,205.52" / "10,000" without toLocaleString (slow on phones, and called for every score on the page)
  function commas(str) { return str.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pts(n) {
    if (n == null || isNaN(n)) return '';
    var parts = Number(n).toFixed(2).split('.');
    return commas(parts[0]) + '.' + parts[1];
  }
  function count(n) { return commas(String(Math.round(n))); }
  function pct(p) {
    if (p == null || isNaN(p)) return '';
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    var v = p * 100;
    if (v < 0.05) return '<0.1%';
    if (v >= 99.95) return '>99.9%';
    return v.toFixed(1) + '%';
  }
  function whole(p) {                                   // the implied odds are whole percents in data.js
    if (p == null || isNaN(p)) return '';
    var v = p * 100, r = Math.round(v);
    return (Math.abs(v - r) < 1e-6 ? r : v.toFixed(1)) + '%';
  }
  function later(fn, ms) {
    var id = setTimeout(function () { if (S) { delete S.timers[id]; fn(); } }, ms);
    S.timers[id] = true;
    return id;
  }
  function clearTimers() { Object.keys(S.timers).forEach(function (id) { clearTimeout(+id); }); S.timers = {}; }

  // real games of a played week, in the engine's game shape
  function realGames(week) {
    var w = (SEASON.weeks || []).filter(function (x) { return x.week === week; })[0];
    return (w ? w.games : []).map(function (g) {
      return { a: g[0], sa: g[1], b: g[3], sb: g[4], winner: g[1] > g[4] ? g[0] : g[4] > g[1] ? g[3] : null };
    });
  }
  function pairings(week) {
    var w = (SEASON.remaining || []).filter(function (x) { return x.week === week; })[0];
    return (w ? w.games : []).map(function (g) { return { a: g[0], b: g[1] }; });
  }
  function simGames(week) { return S.sim.weeks[week - 1].games; }

  // standings rows { slug, w, l, t, pf, pa, seed } through a week (9 = the real table)
  function standings(week) {
    if (S.sim) return ENGINE.standingsThrough(S.sim, week);
    return (SEASON.standings || []).map(function (r, i) {
      return { slug: r.slug, w: r.w, l: r.l, t: r.t, pf: r.pf, pa: r.pa, seed: i + 1 };
    });
  }

  // ---------- one game: two lines, team and score ----------
  // g = { a, b, sa?, sb?, winner?, seedA?, seedB? }; a / b may be null (slot not decided yet)
  function sideEl(slug, points, seed, state) {
    return h('div.sim-game__side', { class: state ? 'is-' + state : null },
      seed != null ? h('span.sim-game__seed.num', seed) : null,
      h('span.sim-game__name', slug ? APP.wbr(teamName(slug)) : ' '),
      points != null ? h('span.sim-game__pts.num', pts(points)) : null,
      state === 'win' ? h('span.sr-only', ' won') : null);
  }
  function gameEl(g, tag) {
    var scored = g.sa != null && g.sb != null;
    var st = function (slug) { return !scored || !g.winner ? null : (g.winner === slug ? 'win' : 'loss'); };
    return h((tag || 'li') + '.sim-game', { class: scored ? 'is-final' : null },
      sideEl(g.a, scored ? g.sa : null, g.seedA, st(g.a)),
      sideEl(g.b, scored ? g.sb : null, g.seedB, st(g.b)));
  }
  function gamesList(games) { return h('ol.sim-games', games.map(function (g) { return gameEl(g); })); }

  // ---------- a set of weeks: tabs on phones, every week side by side on wide screens ----------
  function weekSet(first, last, idPrefix) {
    var tabs = [], panels = [], cur = null, reveal = 0;
    var seg = h('div.seg.seg--scroll.sim-weeks__tabs', { role: 'tablist', 'aria-label': 'Week' });
    var grid = h('div.sim-weeks__grid');
    for (var w = first; w <= last; w++) (function (week) {
      var tab = h('button', {
        type: 'button', role: 'tab', id: idPrefix + '-tab-' + week, 'aria-controls': idPrefix + '-wk-' + week,
        'aria-label': 'Week ' + week, 'aria-selected': 'false', onclick: function () { select(week); }
      }, week);
      var body = h('div.sim-week__body');
      var panel = h('section.sim-week', { id: idPrefix + '-wk-' + week, role: 'tabpanel', 'aria-labelledby': idPrefix + '-tab-' + week, dataset: { week: week } },
        h('h3.sim-week__head', 'Week ' + week), body);
      tabs.push(tab); panels.push({ week: week, el: panel, body: body, key: null });
      seg.appendChild(tab); grid.appendChild(panel);
    })(w);
    function select(week) {
      if (cur === week) return;
      cur = week;
      panels.forEach(function (p, i) {
        var on = p.week === week;
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        p.el.classList.toggle('is-on', on);
      });
      if (!reveal) reveal = requestAnimationFrame(showTab);      // measured in the next frame: no forced layout here
    }
    function showTab() {                                         // keep the selected tab inside a strip that scrolls
      reveal = 0;
      var t = tabs[cur - first];
      if (!t || !seg.clientWidth || seg.scrollWidth <= seg.clientWidth + 1) return;
      seg.scrollLeft = t.offsetLeft - (seg.clientWidth - t.offsetWidth) / 2;
    }
    function fill(week, games, key) {              // key: skip the rebuild when nothing changed
      var p = panels[week - first];
      if (!p || p.key === key) return;
      p.key = key;
      p.body.textContent = '';
      p.body.appendChild(gamesList(games));
      p.el.classList.toggle('is-sim', /^sim/.test(key));
    }
    return { el: h('div.sim-weeks', seg, grid), select: select, fill: fill };
  }

  // ---------- standings ----------
  function buildStandings() {
    var body = h('tbody');
    var table = h('table.data.sim-stand',
      h('thead', h('tr',
        h('th.num', { scope: 'col' }, h('span.sr-only', 'Seed')),
        h('th', { scope: 'col' }, 'Team'),
        h('th.num', { scope: 'col' }, 'W-L'),
        h('th.num', { scope: 'col' }, 'PF'),
        h('th.num', { scope: 'col' }, 'PA'))),
      body);
    var thru = h('div.seg.seg--block.sim-thru', { role: 'group', 'aria-label': 'Standings through week', hidden: true });
    var btns = [];
    for (var w = PLAYED; w <= REG; w++) (function (week) {
      var b = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Through week ' + week,
        onclick: function () { S.thru = week; renderStandings(); } }, week);
      btns.push(b); thru.appendChild(b);
    })(w);
    var aside = h('small.section-head__aside');
    var el = h('section.sim-sec.sim-sec--stand',
      h('h2.section-head', h('span', 'Standings'), aside),
      thru, APP.tableWrap(table));
    return { el: el, body: body, aside: aside, thru: thru, btns: btns };
  }
  function renderStandings() {
    var st = S.stand, week = S.sim ? S.thru : PLAYED;
    var rows = standings(week);
    st.aside.textContent = 'Through week ' + week;
    st.thru.hidden = !S.sim || S.playing;
    st.btns.forEach(function (b, i) { b.setAttribute('aria-pressed', PLAYED + i === week ? 'true' : 'false'); });
    st.body.textContent = '';
    rows.forEach(function (r, i) {
      st.body.appendChild(h('tr', { class: i === CUT - 1 ? 'cut' : null },
        h('td.num.sim-stand__seed', r.seed),
        h('td.team', h('a', { href: APP.teamHref(r.slug) }, APP.wbr(teamName(r.slug)))),
        h('td.num', recText(r)),
        h('td.num', pts(r.pf)),
        h('td.num', pts(r.pa))));
    });
  }

  // ---------- playoffs ----------
  function tie(g, label, cls) {
    return h('div.sim-tie', { class: [cls || '', !g.a && !g.b ? 'is-empty' : ''] },
      label ? h('div.sim-tie__label.label', label) : null,
      gameEl(g, 'div'));
  }
  function round(title, week, kids) {
    var none = kids.every(function (k) { return k.classList.contains('is-empty'); });
    return h('div.sim-round', { class: none ? 'is-empty' : null },
      h('h3.sim-round__head', h('span', title), h('small', 'Week ' + week)),
      kids);
  }
  // what the bracket knows after `shown` weeks: seeds only (< 15), then one more round of scores per week
  function bracketData(shown) {
    var sim = S.sim, out = {};
    if (!sim || shown < WC) {
      var rows = standings(Math.max(PLAYED, Math.min(shown, REG)));
      var s = function (n) { return rows[n - 1] ? rows[n - 1].slug : null; };
      var pair = function (x, y) { return { a: s(x), b: s(y), seedA: x, seedB: y }; };
      var open = function (x) { return x ? { a: s(x), b: null, seedA: x } : { a: null, b: null }; };
      out.byes = [{ slug: s(1), seed: 1 }, { slug: s(2), seed: 2 }];
      out.wc = [pair(3, 6), pair(4, 5)];
      out.semi = [open(1), open(2)];
      out.final = open(); out.third = open();
      out.r1 = [pair(7, 10), pair(8, 9)];
      out.seventh = open(); out.last = open();
      return out;
    }
    var strip = function (g) { return { a: g.a, b: g.b, seedA: g.seedA, seedB: g.seedB }; };
    var at = function (g, week) { return shown >= week ? g : strip(g); };
    var po = sim.playoffs, co = sim.consolation;
    out.byes = sim.byes.map(function (slug, i) { return { slug: slug, seed: i + 1 }; });
    out.wc = po.wc; out.r1 = co.r1;
    out.semi = po.semi.map(function (g) { return at(g, SEMI); });
    out.seventh = at(co.seventh, SEMI); out.last = at(co.last, SEMI);
    if (shown >= SEMI) { out.final = at(po.final, FINAL); out.third = at(po.third, FINAL); }
    else { out.final = { a: null, b: null }; out.third = { a: null, b: null }; }
    return out;
  }
  function renderBracket() {
    var shown = S.sim ? S.shown : PLAYED, d = bracketData(shown), br = S.bracket;
    br.aside.textContent = S.sim && shown >= WC ? 'Weeks ' + WC + '–' + FINAL
      : 'Seeds through week ' + Math.max(PLAYED, Math.min(shown, REG));
    br.box.textContent = '';
    br.box.appendChild(h('div.sim-bracket.sim-bracket--main',
      round('Wild card', WC, [
        tie(d.wc[0]), tie(d.wc[1]),
        h('div.sim-byes',
          h('div.sim-tie__label.label', 'Byes'),
          d.byes.map(function (b) {
            return h('div.sim-game__side', h('span.sim-game__seed.num', b.seed), h('span.sim-game__name', b.slug ? APP.wbr(teamName(b.slug)) : ' '));
          }))
      ]),
      round('Semifinals', SEMI, [tie(d.semi[0]), tie(d.semi[1])]),
      round('Final', FINAL, [tie(d.final, null, 'sim-tie--final'), tie(d.third, 'Third place')])));
    br.box.appendChild(h('h3.sim-bracket__sub', 'Consolation'));
    br.box.appendChild(h('div.sim-bracket.sim-bracket--cons',
      round('First round', WC, [tie(d.r1[0]), tie(d.r1[1])]),
      round('Placement', SEMI, [tie(d.seventh, 'Seventh place'), tie(d.last, 'Ninth place')])));
  }

  // ---------- weeks 10–14 ----------
  function renderRemaining() {
    for (var w = PLAYED + 1; w <= REG; w++) {
      if (S.sim && S.shown >= w) S.rest.fill(w, simGames(w), 'sim:' + S.sim.seed);
      else S.rest.fill(w, pairings(w), 'open');
    }
    S.restAside.textContent = !S.sim ? 'Schedule' : S.shown >= REG ? 'Simulated' : 'Simulating';
  }

  // ---------- the stage ----------
  function slipFor(week) {
    var sim = S.sim, kids = [];
    var group = function (label, games) {
      if (label) kids.push(h('div.sim-slip__label.label', label));
      kids.push(gamesList(games));
    };
    if (week <= REG) group(null, simGames(week));
    else if (week === WC) { group('Wild card', sim.playoffs.wc); group('Consolation', sim.consolation.r1); }
    else if (week === SEMI) { group('Semifinals', sim.playoffs.semi); group('Seventh place', [sim.consolation.seventh]); group('Ninth place', [sim.consolation.last]); }
    else { group('Final', [sim.playoffs.final]); group('Third place', [sim.playoffs.third]); }
    var r = APP.rot(sim.seed + ':' + week);
    return h('div.sim-pile__item', { style: { '--dx': (r * 3).toFixed(1) + 'px', '--dy': (APP.rot(week + ':' + sim.seed) * 2).toFixed(1) + 'px' } },
      APP.clipping({ class: ['sim-slip', week % 2 ? 'clipping--cut2' : 'clipping--cut3'], rot: r * 0.9 },
        h('div.sim-slip__head.headline', 'Week ' + week), kids));
  }
  function stagePlay() {
    var st = S.stage;
    st.el.hidden = false;
    st.el.classList.add('is-playing');
    st.fin.textContent = '';
    st.pile.textContent = '';
    st.live.hidden = false;
  }
  function stageSlip(week) {
    var pile = S.stage.pile;
    pile.appendChild(slipFor(week));
    while (pile.children.length > 3) pile.removeChild(pile.firstChild);
  }
  function resultClip(kind, slug, row, game, gameLabel) {
    var t = APP.team(slug) || { name: slug, manager: '', profile: '' };
    var champ = kind === 'champ';
    return h('div.sim-result.sim-result--' + kind,
      APP.clipping({ tag: 'a', href: APP.teamHref(slug), class: ['sim-result__paper', champ ? '' : 'clipping--aged clipping--cut2'], rot: champ ? -1.1 : 1.6 },
        champ ? null : h('i.tape'),
        h('div.sim-result__kicker', champ ? 'Champion' : 'Last place'),
        h(champ ? 'h2' : 'h3', { class: 'sim-result__name headline' }, APP.wbr(t.name)),
        h('div.sim-result__bot',
          t.profile ? APP.photo(t.profile, t.name, { class: 'sim-result__photo' }) : null,
          h('div.sim-result__cap',
            h('span.sim-result__mgr', t.manager),
            row ? h('span.sim-result__rec.num', recText(row)) : null,
            row ? h('span.sim-result__seed', 'No. ' + row.seed + ' seed') : null),
          game ? h('div.sim-result__game', h('div.label', gameLabel), gameEl(game, 'div')) : null)));
  }
  function stageFinal(animate) {
    var st = S.stage, sim = S.sim;
    var row = function (slug) { return sim.standings.filter(function (r) { return r.slug === slug; })[0]; };
    st.el.hidden = false;
    st.el.classList.remove('is-playing');
    st.el.classList.toggle('is-landing', !!animate);
    st.pile.textContent = '';
    st.live.hidden = true;
    st.fin.textContent = '';
    st.fin.appendChild(resultClip('champ', sim.champion, row(sim.champion), sim.playoffs.final, 'Final'));
    st.fin.appendChild(resultClip('last', sim.lastPlace, row(sim.lastPlace), null));
  }
  function stageHide() {
    var st = S.stage;
    st.el.hidden = true; st.el.classList.remove('is-playing', 'is-landing');
    st.pile.textContent = ''; st.fin.textContent = '';
  }

  // ---------- controls ----------
  function renderControls() {
    var c = S.ctl, sim = S.sim;
    c.go.textContent = sim ? 'Simulate again' : 'Simulate rest of season';
    c.copy.hidden = !sim;
  }
  function copyLink() {
    var url = location.href, btn = S.ctl.copy;
    var done = function (ok) {
      if (!S) return;
      btn.textContent = ok ? 'Link copied' : 'Copy failed';
      clearTimeout(S.ctl.copyTimer);
      S.ctl.copyTimer = setTimeout(function () { btn.textContent = 'Copy link'; }, 1800);   // only touches its own button
    };
    var legacy = function () {
      var ta = h('textarea', { readonly: true, style: 'position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0' });
      ta.value = url; document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, legacy);
    } else legacy();
  }
  // Replaces the current history entry (twenty rolls are not twenty presses of Back). Unlike history.replaceState
  // this fires hashchange, so the router's idea of the route stays in step with the address bar; update() below
  // sees the seed it is already showing and leaves the running roll alone.
  function setUrl(seed) {
    var hash = '#/sim?seed=' + seed;
    if (location.hash === hash) return;
    try { location.replace(hash); } catch (e) { location.hash = hash; }
  }

  // ---------- showing a season ----------
  function renderAll() {
    renderControls(); renderRemaining(); renderStandings(); renderBracket();
  }
  function showSeason(sim, animate) {
    clearTimers();
    S.sim = sim;
    S.playing = !!animate;
    if (!animate) {
      S.shown = DONE; S.thru = REG;
      renderAll(); stageFinal(false);
      return;
    }
    S.shown = PLAYED; S.thru = PLAYED;
    renderAll(); stagePlay();
    S.rest.select(PLAYED + 1);
    var seq = [];
    for (var w = PLAYED + 1; w <= FINAL; w++) seq.push(w);
    var i = 0;
    (function next() {
      if (i >= seq.length) { finish(true); return; }
      var week = seq[i++];
      S.shown = week;
      if (week <= REG) { S.thru = week; S.rest.select(week); renderRemaining(); renderStandings(); }
      renderBracket();
      stageSlip(week);
      later(next, week <= REG ? STEP_MS.week : week < FINAL ? STEP_MS.playoff : STEP_MS.last);
    })();
    requestAnimationFrame(function () {                 // next frame: the layout is already done, nothing is forced
      if (!S || !S.playing) return;
      try { S.stage.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
    });
  }
  function finish(animate) {
    if (!S || !S.sim) return;
    clearTimers();
    S.playing = false; S.shown = DONE; S.thru = REG;
    renderAll(); stageFinal(animate);
  }
  function clearSeason() {
    clearTimers();
    S.sim = null; S.playing = false; S.shown = PLAYED; S.thru = PLAYED;
    renderAll(); stageHide();
    S.rest.select(PLAYED + 1);
  }
  function roll() {
    var sim = ENGINE.simulate(ENGINE.randomSeed());
    setUrl(sim.seed);
    showSeason(sim, !reduced());
  }

  // ---------- odds (Monte Carlo) ----------
  function ordinal(n) { return fmt.ordinal(n); }
  function buildOdds() {
    var teams = B.teams, impliedByRank = B.oddsByRank || [];        // rank order; the engine is not touched here
    var rows = {};
    var body = h('tbody');
    teams.forEach(function (t) {
      var c = {
        poSim: h('td.num'), poImp: h('td.num.sim-odds__imp'), bye: h('td.num'),
        fiSim: h('td.num'), fiImp: h('td.num.sim-odds__imp'),
        chSim: h('td.num.sim-odds__ch'), chImp: h('td.num.sim-odds__imp'),
        last: h('td.num'), wins: h('td.num'),
        dist: h('span.sim-dist', { role: 'img' })
      };
      c.bars = [];
      for (var k = 0; k < teams.length; k++) { var bar = h('i', { class: k === CUT ? 'is-out is-cut' : k > CUT ? 'is-out' : null }); c.bars.push(bar); c.dist.appendChild(bar); }
      APP.tip(c.dist, '', 'Final seed');
      var imp = t.oddsNow || impliedByRank[t.rank - 1];
      if (imp) {
        c.poImp.textContent = whole(imp.playoff.pct / 100);
        c.fiImp.textContent = whole(imp.finals.pct / 100);
        c.chImp.textContent = whole(imp.championship.pct / 100);
      }
      rows[t.slug] = c;
      body.appendChild(h('tr',
        h('th.team', { scope: 'row' }, h('span.sim-odds__team', h('span.sim-odds__rk.num', t.rank), h('a', { href: APP.teamHref(t.slug) }, APP.wbr(t.name)))),
        c.poSim, c.poImp, c.bye, c.fiSim, c.fiImp, c.chSim, c.chImp, c.last, c.wins, h('td.sim-odds__dist', c.dist)));
    });
    var pair = function () { return [h('th.num', { scope: 'col' }, 'Sim'), h('th.num.sim-odds__imp', { scope: 'col' }, 'Implied')]; };
    var table = h('table.data.data--sticky.sim-odds',
      h('thead',
        h('tr',
          h('th', { scope: 'col', rowspan: 2 }, 'Team'),
          h('th.ctr.sim-odds__grp', { scope: 'colgroup', colspan: 2 }, 'Playoffs'),
          h('th.num', { scope: 'col', rowspan: 2 }, 'Bye'),
          h('th.ctr.sim-odds__grp', { scope: 'colgroup', colspan: 2 }, 'Finals'),
          h('th.ctr.sim-odds__grp', { scope: 'colgroup', colspan: 2 }, 'Champion'),
          h('th.num', { scope: 'col', rowspan: 2 }, 'Last place'),
          h('th.num', { scope: 'col', rowspan: 2 }, 'Avg wins'),
          h('th', { scope: 'col', rowspan: 2 }, 'Final seed')),
        h('tr.sim-odds__sub', pair(), pair(), pair())),
      body);
    var aside = h('small.section-head__aside', { 'aria-live': 'off' });
    var meter = h('span.bar.sim-odds__meter', { 'aria-hidden': 'true' });
    var more = h('button.btn.btn--sm', { type: 'button', disabled: true, onclick: runMore }, 'Run ' + count(MC_MORE) + ' more');
    var el = h('section.sim-sec.sim-sec--odds',
      h('h2.section-head', h('span', 'Odds'), aside),
      meter, APP.tableWrap(table),
      h('div.sim-odds__foot', more));
    return { el: el, rows: rows, aside: aside, meter: meter, more: more, run: null, target: 0, base: 0, busy: false, step: 0 };
  }
  function renderOdds() {
    var o = S.odds;
    if (!o.run || !o.run.n) return;
    var res = o.run.result(), n = res.n;
    res.teams.forEach(function (r) {
      var c = o.rows[r.slug];
      if (!c) return;
      c.poSim.textContent = pct(r.playoff);
      c.bye.textContent = pct(r.bye);
      c.fiSim.textContent = pct(r.finals);
      c.chSim.textContent = pct(r.champion);
      c.last.textContent = pct(r.lastPlace);
      c.wins.textContent = r.avgWins.toFixed(1);
      var lines = [], top = Math.max.apply(null, r.seedDist) || 1;      // bars are scaled to the team's likeliest seed
      r.seedDist.forEach(function (p, k) {
        c.bars[k].style.height = (p > 0 ? Math.max(6, Math.round(p / top * 100)) : 0) + '%';
        if (p > 0) lines.push(ordinal(k + 1) + '  ' + pct(p));
      });
      c.dist.setAttribute('data-tip', lines.join('\n'));
      c.dist.setAttribute('aria-label', 'Final seed: ' + lines.join(', '));
    });
    o.aside.textContent = count(n) + ' seasons';
    var span = Math.max(1, o.target - o.base);
    o.meter.style.setProperty('--v', Math.min(100, (n - o.base) / span * 100).toFixed(1) + '%');
    o.meter.classList.toggle('is-done', n >= o.target);
    o.more.disabled = o.busy || n >= MC_MAX;
  }
  function mcTick() {
    if (!S) return;
    var o = S.odds, t0 = now(), t = t0;
    if (!o.run) {                                        // first use of the engine: off the mount path, and a turn of its own
      var fresh = !RUN;
      if (fresh) RUN = ENGINE.createRun();
      o.run = RUN;
      o.base = RUN.n >= ENGINE.constants.defaultN ? Math.floor(RUN.n / MC_MORE) * MC_MORE : 0;      // a run cut short by leaving the page is finished
      o.target = Math.max(ENGINE.constants.defaultN, Math.ceil(RUN.n / MC_MORE) * MC_MORE);
      if (fresh) { o.timer = setTimeout(mcTick, 0); return; }
    }
    while (o.run.n < o.target && t - t0 < MC_BUDGET_MS) {
      o.run.add(Math.min(MC_SLICE, o.target - o.run.n));
      t = now();
    }
    if (o.run.n >= o.target) { o.busy = false; renderOdds(); return; }
    var share = (o.run.n - o.base) / (o.target - o.base);
    if (o.step < MC_PAINT_AT.length && share >= MC_PAINT_AT[o.step]) {
      while (o.step < MC_PAINT_AT.length && share >= MC_PAINT_AT[o.step]) o.step++;
      renderOdds();
    }
    o.timer = setTimeout(mcTick, 0);
  }
  function mcStart() {
    var o = S.odds;
    if (o.busy || (o.run && o.run.n >= o.target)) return;
    o.busy = true; o.step = 0;
    o.more.disabled = true;
    o.timer = setTimeout(mcTick, 0);
  }
  function runMore() {
    var o = S.odds;
    if (o.busy || !o.run) return;
    o.base = o.run.n;
    o.target = Math.min(MC_MAX, o.run.n + MC_MORE);
    mcStart();
  }

  // ---------- mount ----------
  function mount(root, params) {
    APP.setTitle('Season Sim');
    S = { timers: {}, sim: null, playing: false, shown: PLAYED, thru: PLAYED };

    var go = h('button.btn.btn--primary.sim-ctl__go', { type: 'button', onclick: roll });
    var copy = h('button.btn.sim-ctl__copy', { type: 'button', hidden: true, onclick: copyLink }, 'Copy link');
    S.ctl = { go: go, copy: copy };

    var pile = h('div.sim-pile', { 'aria-hidden': 'true' });
    var skip = h('button.btn.btn--sm.sim-stage__skip', { type: 'button' }, 'Skip');
    var live = h('div.sim-stage__live', pile, skip);
    var fin = h('div.sim-final');
    var stage = h('section.desk.sim-stage', { hidden: true, 'aria-label': 'Simulated season',
      onclick: function () { if (S && S.playing) finish(true); } }, live, fin);
    S.stage = { el: stage, pile: pile, live: live, fin: fin };

    S.rest = weekSet(PLAYED + 1, REG, 'sim-rest');
    S.restAside = h('small.section-head__aside');
    var restSec = h('section.sim-sec.sim-sec--rest',
      h('h2.section-head', h('span', 'Weeks ' + (PLAYED + 1) + '–' + REG), S.restAside), S.rest.el);

    S.stand = buildStandings();

    var brAside = h('small.section-head__aside'), brBox = h('div.sim-bracket-box');
    S.bracket = { aside: brAside, box: brBox };
    var brSec = h('section.sim-sec.sim-sec--bracket', h('h2.section-head', h('span', 'Playoffs'), brAside), brBox);

    S.odds = buildOdds();

    var past = weekSet(1, PLAYED, 'sim-past');
    for (var w = 1; w <= PLAYED; w++) past.fill(w, realGames(w), 'real');
    var pastSec = h('section.sim-sec.sim-sec--past',
      APP.sectionHead('Weeks 1–' + PLAYED, 'Results'), past.el);

    root.appendChild(h('div.sim',
      h('div.page.sim-top', h('h1.sr-only', 'Season Sim'), h('div.sim-ctl', go, copy)),
      stage,
      h('div.page.sim-body', restSec, S.stand.el, brSec, S.odds.el, pastSec)));

    S.rest.select(PLAYED + 1);
    past.select(PLAYED);
    var s0 = parseSeed(params && params.query && params.query.seed);
    if (s0 != null) showSeason(ENGINE.simulate(s0), false);
    else renderAll();
    mcStart();

    return function cleanup() {
      if (!S) return;
      clearTimers();
      clearTimeout(S.odds.timer);
      clearTimeout(S.ctl.copyTimer);
      S = null;
    };
  }

  function update(params) {
    if (!S) return;
    var s = parseSeed(params && params.query && params.query.seed);
    if (s == null) { if (S.sim) clearSeason(); return; }
    if (S.sim && S.sim.seed === s) return;             // our own roll (setUrl) or the season already on the page
    showSeason(ENGINE.simulate(s), false);
  }

  APP.register('sim', { mount: mount, update: update });
})();
