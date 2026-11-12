// ============================================================================
//  history-view.js — view 'history' (#/history): the league's record, 2014 to now.
//
//  Reads window.HISTORY (js/history.js, finished seasons, keyed by manager first name = team.historyKey),
//  window.BROOKDALE (current teams) and window.STATS (current standings). Styles: css/history.css.
//
//  Sections, top to bottom
//    1. <year> standings        current season through the last played week (STATS.league.standings), cut line after 6th
//    2. Finish by year          year × current manager; the current season is the first row, set in italic ("wk 9")
//                               and left out of the averages
//    3. Champions               one row per finished season: champion, team, record, PF, runner-up, last place;
//                               then the title count and the current managers without a title
//    4. All time                one row per current manager, sortable; best / worst of a column marked
//    5. Record book             league records computed from HISTORY (records() below); the last two entries are about
//                               the current rosters and carry the current year in their label
//
//  Every table sits in a .hist-box: the box shades its right edge while there is more table to scroll to (phones).
//
//  Names: a manager is shown under the name this site uses for him (team.manager), looked up through
//  team.historyKey — HISTORY's "Van" is shown as "Sam". A manager with no current team is "departed" (set in italic).
//  The current season never enters an all-time number (averages, titles, playoff counts, records).
// ============================================================================
(function () {
  'use strict';
  var APP = window.APP;
  if (!APP) return;
  var h = APP.h, F = APP.fmt;

  var HALF_PPR_FROM = 2019;          // HISTORY.avgPFHalf / avgPAHalf are per-game averages from this season on

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function maxBy(arr, f) {
    var best = -Infinity;
    arr.forEach(function (x) { var v = f(x); if (isNum(v) && v > best) best = v; });
    return { v: best, items: arr.filter(function (x) { return f(x) === best; }) };
  }
  function minBy(arr, f) {
    var best = Infinity;
    arr.forEach(function (x) { var v = f(x); if (isNum(v) && v < best) best = v; });
    return { v: best, items: arr.filter(function (x) { return f(x) === best; }) };
  }

  // ---------- model ----------
  function model() {
    var B = window.BROOKDALE || {}, H = window.HISTORY || {}, S = window.STATS || null;
    var season = B.season || {};
    var teams = B.teams || [];
    var M = {
      H: H,
      teams: teams,
      year: (B.edition && B.edition.season) || season.year || null,
      editionWeek: (B.edition && B.edition.week) || null,
      week: (S && S.weeksPlayed) || season.weeksPlayed || (season.weeks || []).length || 0,
      cut: (S && S.playoffTeams) || season.playoffTeams || 6,
      managers: H.managers || {},
      seasons: (H.seasons || []).slice().sort(function (a, b) { return a.year - b.year; }),
      champs: (H.champions || []).slice().sort(function (a, b) { return a.year - b.year; }),
      teamByKey: {},
      seedByKey: {},
      boxes: []                      // scrolling table boxes of this mount: [{ scroller, table, mark }]
    };
    teams.forEach(function (t) { M.teamByKey[t.historyKey || t.manager] = t; });

    // current standings: STATS order (win%, then PF); without STATS, the order of season.standings
    var rows = [];
    if (S && S.league && S.league.standings) {
      rows = S.league.standings.map(function (t) {
        return { seed: t.seed, slug: t.slug, name: t.name, manager: t.manager, key: t.historyKey || t.manager,
          rec: S.recordText(t.record), pf: t.pf, pa: t.pa, streak: t.streak };
      });
    } else {
      rows = (season.standings || []).map(function (s, i) {
        var t = APP.team(s.slug) || {};
        return { seed: i + 1, slug: s.slug, name: t.name || s.slug, manager: t.manager || '', key: t.historyKey || t.manager,
          rec: APP.record(s.slug), pf: s.pf, pa: s.pa, streak: s.streak };
      });
    }
    M.standings = rows;
    rows.forEach(function (r) { M.seedByKey[r.key] = r.seed; });

    M.firstYear = M.seasons.length ? M.seasons[0].year : null;
    M.lastYear = M.seasons.length ? M.seasons[M.seasons.length - 1].year : null;
    M.name = function (key) { var t = M.teamByKey[key]; return t ? t.manager : key; };
    M.departed = function (key) { return !M.teamByKey[key]; };
    return M;
  }

  // ---------- small builders ----------
  // a manager's name; departed managers are set in italic
  function who(M, key) {
    return h('span', { class: ['hist-who', M.departed(key) ? 'is-departed' : ''] }, M.name(key));
  }
  // an old team name: printed as-is; names carrying emoji are printed in black and white like everything else
  function teamName(text) {
    var s = String(text == null ? '' : text);
    return h('span', { class: ['hist-tn', /[^\u0000-ɏ‐-‧]/.test(s) ? 'hist-tn--bw' : ''] }, APP.wbr(s));
  }
  function teamLink(t) {
    return h('a.hist-link', { href: APP.teamHref(t.slug) }, APP.wbr(t.name));
  }
  // a table in its sideways scroll container, inside a box that shades the right edge while more table lies that way
  function scrollBox(M, table) {
    var sc = APP.tableWrap(table), box = h('div.hist-box', sc);
    function mark() { box.classList.toggle('is-more', sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 2); }
    sc.addEventListener('scroll', mark, { passive: true });
    M.boxes.push({ scroller: sc, table: table, mark: mark });
    return box;
  }
  function section(cls, head) {
    return h('section', { class: ['hist-sec', cls] }, head, Array.prototype.slice.call(arguments, 2));
  }

  // ---------- 1. current standings ----------
  function buildStandings(M) {
    var body = M.standings.map(function (r) {
      var st = String(r.streak || '');
      return h('tr', { class: r.seed === M.cut && M.standings.length > M.cut ? 'cut' : '' },
        h('th.team', { scope: 'row' },
          h('span.hist-st',
            h('span.hist-st__seed.num', r.seed),
            h('a.hist-link.hist-st__id', { href: APP.teamHref(r.slug) },
              h('span.hist-st__name', APP.wbr(r.name)),
              h('span.hist-st__mgr', h('span.sr-only', ', '), r.manager)))),
        h('td.hist-st__mgrcol', r.manager),
        h('td.ctr', r.rec),
        h('td.num', F.pts(r.pf)),
        h('td.num', F.pts(r.pa)),
        h('td.ctr', { class: st.charAt(0) === 'W' ? 'w' : st.charAt(0) === 'L' ? 'l' : 't' }, st));
    });
    var table = h('table.data.data--sticky.hist-standings',
      h('thead', h('tr',
        h('th', { scope: 'col' }, 'Team'),
        h('th.hist-st__mgrcol', { scope: 'col' }, 'Manager'),
        h('th.ctr', { scope: 'col' }, 'W-L'),
        h('th.num', { scope: 'col' }, 'PF'),
        h('th.num', { scope: 'col' }, 'PA'),
        h('th.ctr', { scope: 'col' }, 'Strk'))),
      h('tbody', body));
    return section('hist-sec--now',
      APP.sectionHead((M.year ? M.year + ' ' : '') + 'standings', M.week ? 'Through week ' + M.week : null),
      scrollBox(M, table));
  }

  // ---------- 2. finish by year ----------
  function fin(kind, text, srText) {
    return h('span', { class: 'hist-fin hist-fin--' + kind }, text, srText ? h('span.sr-only', ' ' + srText) : null);
  }
  function buildGrid(M) {
    var cols = M.teams.map(function (t) { return t.historyKey || t.manager; });
    var teamCount = function (s) { return (s.standings || []).length; };

    var head = h('tr', h('th.hist-grid__y', { scope: 'col' }, 'Year'),
      cols.map(function (k) { return h('th', { scope: 'col' }, h('span.hist-grid__mgr', M.name(k))); }));

    var rows = [];
    if (M.year && M.standings.length) {
      rows.push(h('tr.hist-grid__live',
        h('th.hist-grid__y', { scope: 'row' }, M.year, h('small', 'wk ' + M.week)),
        cols.map(function (k) {
          var seed = M.seedByKey[k];
          if (!isNum(seed)) return h('td', fin('na', '–', 'not in league'));
          return h('td', fin(seed <= M.cut ? 'live-in' : 'live-out', seed,
            'after week ' + M.week + (seed <= M.cut ? ', in a playoff spot' : ', outside the playoff spots')));
        })));
    }
    M.seasons.slice().reverse().forEach(function (s) {
      var last = teamCount(s);
      rows.push(h('tr',
        h('th.hist-grid__y', { scope: 'row' }, s.year),
        cols.map(function (k) {
          var st = (s.standings || []).filter(function (x) { return x.manager === k; })[0];
          if (!st || !isNum(st.rank)) return h('td', fin('na', '–', 'not in league'));
          if (st.rank === 1) return h('td', fin('champ', 1, 'champion'));
          if (st.rank === last) return h('td', fin('last', st.rank, 'last place'));
          return h('td', st.playoffs ? fin('po', st.rank, 'playoffs') : fin('out', st.rank, 'missed playoffs'));
        })));
    });

    // the average covers the finished seasons only; its row says which
    var span = M.firstYear === M.lastYear ? String(M.firstYear)
      : M.firstYear + '–' + (Math.floor(M.firstYear / 100) === Math.floor(M.lastYear / 100) ? String(M.lastYear).slice(2) : M.lastYear);
    var foot = h('tr',
      h('th.hist-grid__y', { scope: 'row' }, 'Avg', h('small', span)),
      cols.map(function (k) {
        var m = M.managers[k];
        return h('td', m && isNum(m.avgFinish) ? F.num(m.avgFinish, 2) : '');
      }));

    var table = h('table.data.data--sticky.hist-grid',
      h('colgroup', h('col.hist-grid__ycol'), cols.map(function () { return h('col'); })),
      h('thead', head), h('tbody', rows), M.seasons.length ? h('tfoot', foot) : null);

    var key = h('ul.hist-key', { 'aria-hidden': 'true' },
      h('li', fin('champ', 1), 'Champion'),
      h('li', fin('po', 4), 'Playoffs'),
      h('li', fin('out', 8), 'Missed'),
      h('li', fin('last', 10), 'Last'),
      M.year && M.standings.length ? h('li', fin('live-in', 3), M.year + ' standing, week ' + M.week) : null);

    return section('hist-sec--grid', APP.sectionHead('Finish by year'), scrollBox(M, table), key);
  }

  // ---------- 3. champions ----------
  function buildChampions(M) {
    var roll = h('div.hist-roll', { role: 'table', 'aria-label': 'Champions by year' },
      h('div.hist-roll__head', { role: 'row' },
        ['Year', 'Champion', 'Team', 'W-L', 'PF', 'Runner-up', 'Last place'].map(function (t, i) {
          return h('span', { role: 'columnheader', class: i === 3 || i === 4 ? 'hist-roll__r' : '' }, t);
        })));
    M.champs.slice().reverse().forEach(function (c) {
      var s = M.seasons.filter(function (x) { return x.year === c.year; })[0];
      var st = (s && s.standings) || [];
      var ru = st.filter(function (x) { return x.rank === 2; })[0];
      var last = st.length ? st.filter(function (x) { return x.rank === st.length; })[0] : null;
      roll.appendChild(h('div.hist-roll__row', { role: 'row' },
        h('span.hist-roll__year', { role: 'cell' }, c.year),
        h('span.hist-roll__champ', { role: 'cell' }, who(M, c.manager)),
        h('span.hist-roll__team', { role: 'cell' }, teamName(c.team)),
        h('span.hist-roll__rec.num', { role: 'cell' }, c.record || ''),
        h('span.hist-roll__pf.num', { role: 'cell' }, isNum(c.pf) ? [F.pts(c.pf), h('i.hist-roll__k', { 'aria-hidden': 'true' }, 'PF')] : ''),
        h('span.hist-roll__also', { role: 'none' },
          h('span.hist-roll__ru', { role: 'cell' }, h('i.hist-roll__k', { 'aria-hidden': 'true' }, '2nd'), ru ? who(M, ru.manager) : ''),
          h('span.hist-roll__last', { role: 'cell' }, h('i.hist-roll__k', { 'aria-hidden': 'true' }, 'Last'), last ? who(M, last.manager) : ''))));
    });

    // title count (everyone who has won), and the current managers still without one
    var count = {};
    M.champs.forEach(function (c) { count[c.manager] = (count[c.manager] || 0) + 1; });
    var titled = Object.keys(count).sort(function (a, b) {
      return count[b] - count[a] || (M.departed(a) - M.departed(b)) || M.name(a).localeCompare(M.name(b));
    });
    var never = Object.keys(M.managers).map(function (k) { return M.managers[k]; })
      .filter(function (m) { return !(m.titles || []).length; })
      .sort(function (a, b) { return b.seasonsPlayed - a.seasonsPlayed || M.name(a.name).localeCompare(M.name(b.name)); });
    var tally = h('dl.hist-book.hist-tally',
      recItem(M, { label: 'Titles', rows: titled.map(function (k) { return { key: k, value: String(count[k]) }; }) }),
      never.length ? recItem(M, { label: 'No title (seasons)',
        rows: never.map(function (m) { return { key: m.name, value: String(m.seasonsPlayed) }; }) }) : null);

    var anyDeparted = M.champs.some(function (c) { return M.departed(c.manager); });
    return section('hist-sec--champs', APP.sectionHead('Champions', M.firstYear ? M.firstYear + '–' + M.lastYear : null),
      h('div.hist-champs', h('div.hist-champs__roll', roll, anyDeparted ? departedKey() : null), tally));
  }
  function departedKey() {
    return h('p.hist-note', h('span.hist-who.is-departed', 'Italic'), ' no longer in the league');
  }

  // ---------- 4. all-time table ----------
  var COLS = [
    { key: 'name', label: 'Manager' },
    { key: 'team', label: 'Team' },
    { key: 'seasons', label: 'Seasons', num: true, first: -1 },
    { key: 'avg', label: 'Avg finish', num: true, better: 'low', d: 2 },
    { key: 'titles', label: 'Titles', num: true, better: 'high' },
    { key: 'ru', label: '2nd', num: true, better: 'high' },
    { key: 'last', label: 'Last', num: true, better: 'low' },
    { key: 'po', label: 'Playoffs', num: true, better: 'high' },
    { key: 'pfg', label: 'PF/G', num: true, better: 'high', d: 2 },
    { key: 'pag', label: 'PA/G', num: true, better: 'low', d: 2 },
    { key: 'moves', label: 'Moves', num: true, first: -1 }
  ];
  function buildAllTime(M) {
    var data = Object.keys(M.managers).map(function (k) {
      var m = M.managers[k], t = M.teamByKey[k];
      return {
        key: k, name: M.name(k), t: t || null, team: t ? t.name : (m.currentTeam || ''),
        seasons: m.seasonsPlayed, avg: m.avgFinish,
        titles: (m.titles || []).length, ru: (m.runnerUps || []).length, last: (m.lastPlace || []).length,
        po: m.playoffAppearances, pfg: m.avgPFHalf, pag: m.avgPAHalf,
        moves: m.movesSeasons ? m.totalMoves : null          // no season with a transaction count → no number
      };
    });
    // best / worst of a column: only where one direction is better, and only when at most three share the mark
    var mark = {};
    COLS.forEach(function (c) {
      if (!c.better) return;
      var vals = data.map(function (r) { return r[c.key]; }).filter(isNum);
      if (!vals.length) return;
      var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
      if (hi === lo) return;
      var best = c.better === 'low' ? lo : hi, worst = c.better === 'low' ? hi : lo;
      var n = function (v) { return vals.filter(function (x) { return x === v; }).length; };
      mark[c.key] = { best: n(best) <= 3 ? best : null, worst: n(worst) <= 3 ? worst : null };
    });

    var sortKey = 'avg', sortDir = 1;
    var tbody = h('tbody');
    var ths = COLS.map(function (c) {
      return h('th', { scope: 'col', class: c.num ? 'num' : c.key === 'team' ? 'hist-at__team' : '' },
        h('button.data__sort', { type: 'button', onclick: function () { sortBy(c); } }, c.label));
    });
    function sortBy(c) {
      if (sortKey === c.key) sortDir = -sortDir;
      else { sortKey = c.key; sortDir = c.first || (c.better === 'high' ? -1 : 1); }
      draw();
    }
    function cellText(r, c) {
      var v = r[c.key];
      if (c.key === 'po') return isNum(v) ? v + '/' + r.seasons : '';
      if (!c.num) return v;
      return isNum(v) ? F.num(v, c.d || 0) : '';
    }
    function draw() {
      var rows = data.slice().sort(function (a, b) {
        var x = a[sortKey], y = b[sortKey], d;
        if (typeof x === 'string' || typeof y === 'string') d = String(x).localeCompare(String(y)) * sortDir;
        else if (!isNum(x) || !isNum(y)) d = (isNum(y) ? 1 : 0) - (isNum(x) ? 1 : 0);       // no value: always last
        else d = (x - y) * sortDir;
        return d || (a.avg - b.avg) || a.name.localeCompare(b.name);
      });
      tbody.textContent = '';
      rows.forEach(function (r) {
        tbody.appendChild(h('tr', COLS.map(function (c) {
          if (c.key === 'name') {
            return h('th.team', { scope: 'row' }, r.t
              ? h('a.hist-link.hist-at__who', { href: APP.teamHref(r.t.slug) },
                  h('span', r.name), h('span.hist-at__sub', h('span.sr-only', ', '), APP.wbr(r.t.name)))
              : r.name);
          }
          if (c.key === 'team') return h('td.hist-at__team', r.t ? teamLink(r.t) : teamName(r.team));
          var mk = mark[c.key], v = r[c.key], text = cellText(r, c);
          if (mk && isNum(v) && v === mk.best) return h('td.num', h('span.hist-best', text, h('span.sr-only', ' best')));
          if (mk && isNum(v) && v === mk.worst) return h('td.num', h('span.hist-worst', text, h('span.sr-only', ' worst')));
          return h('td.num', text);
        })));
      });
      ths.forEach(function (th, i) {
        if (COLS[i].key === sortKey) th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
        else th.removeAttribute('aria-sort');
      });
    }
    draw();

    var moveYears = M.seasons.filter(function (s) { return (s.standings || []).some(function (x) { return isNum(x.moves); }); })
      .map(function (s) { return s.year; });
    var notes = [];
    if (M.lastYear >= HALF_PPR_FROM) notes.push('PF/G, PA/G ' + HALF_PPR_FROM + '–' + M.lastYear);
    if (moveYears.length) notes.push('Moves ' + moveYears[0] + '–' + moveYears[moveYears.length - 1]);

    var table = h('table.data.data--sticky.hist-at', h('thead', h('tr', ths)), tbody);
    return section('hist-sec--at', APP.sectionHead('All time', M.firstYear ? M.firstYear + '–' + M.lastYear : null),
      scrollBox(M, table),
      h('p.hist-note.hist-note--key',
        h('span.hist-best', 'Best in column'), h('span.hist-worst', 'Worst in column'),
        notes.map(function (n) { return h('span', n); })));
  }

  // ---------- 5. record book ----------
  // → [{ label, rows: [{ key (HISTORY manager name) | text, value, note (string | node) }] }]
  function records(M) {
    var H = M.H;
    var mgrs = Object.keys(M.managers).map(function (k) { return M.managers[k]; });
    if (!mgrs.length) return [];
    var out = [];
    function add(label, rows) { rows = (rows || []).filter(Boolean); if (rows.length) out.push({ label: label, rows: rows }); }
    function ord(n) { return F.ordinal(n); }

    var gByYear = {};
    mgrs.forEach(function (m) { (m.seasons || []).forEach(function (s) { if (isNum(s.g)) gByYear[s.year] = s.g; }); });
    // every finished season of every manager (departed included), with points per game
    var all = [];
    M.seasons.forEach(function (s) {
      (s.standings || []).forEach(function (st) {
        var r = Object.assign({ year: s.year }, st);
        r.ppg = isNum(st.pf) && gByYear[s.year] ? st.pf / gByYear[s.year] : null;
        all.push(r);
      });
    });
    function seasonRows(res, digits) {
      return res.items.map(function (r) {
        return { key: r.manager, value: F.num(res.v, digits), note: [r.year + ', ', teamName(r.team)] };
      });
    }

    var reign = M.champs[M.champs.length - 1];
    if (reign) {
      var titles = M.champs.filter(function (c) { return c.manager === reign.manager; }).map(function (c) { return c.year; });
      var others = titles.filter(function (y) { return y !== reign.year; });
      add('Reigning champion', [{ key: reign.manager, value: String(reign.year),
        note: [teamName(reign.team), ', ' + ord(titles.length) + ' title' + (others.length ? ' (also ' + others.join(', ') + ')' : '')] }]);
    }
    var never = mgrs.filter(function (m) { return !(m.titles || []).length; });
    var st = maxBy(mgrs, function (m) { return m.activePlayoffStreak; });
    if (st.v > 0) add('Longest active playoff streak', st.items.map(function (m) { return { key: m.name, value: plural(st.v, 'season') }; }));
    var dr = maxBy(mgrs, function (m) { return m.activePlayoffDrought; });
    if (dr.v > 0) add('Longest active playoff drought', dr.items.map(function (m) { return { key: m.name, value: plural(dr.v, 'season') }; }));
    var rate = maxBy(mgrs.filter(function (m) { return m.seasonsPlayed >= 3; }),
      function (m) { return Math.round((m.playoffAppearances / m.seasonsPlayed) * 1000); });
    add('Best playoff rate, 3+ seasons', rate.items.map(function (m) {
      return { key: m.name, value: m.playoffAppearances + ' of ' + m.seasonsPlayed, note: Math.round(rate.v / 10) + '%' };
    }));
    var wait = maxBy(never, function (m) { return m.seasonsPlayed; });
    add('Longest wait for a first title', wait.items.map(function (m) { return { key: m.name, value: plural(wait.v, 'season') }; }));
    var since = minBy(mgrs.filter(function (m) { return isNum(m.lastTitle); }), function (m) { return m.lastTitle; });
    add('Longest since last title', since.items.map(function (m) { return { key: m.name, value: 'since ' + since.v }; }));
    var ru = maxBy(never, function (m) { return (m.runnerUps || []).length; });
    if (ru.v > 0) add('Most runner-up finishes without a title', ru.items.map(function (m) {
      return { key: m.name, value: String(ru.v), note: m.runnerUps.join(', ') };
    }));

    var bestAvg = minBy(mgrs, function (m) { return m.avgFinish; });
    add('Best average finish', bestAvg.items.map(function (m) { return { key: m.name, value: F.num(bestAvg.v, 2) }; }));
    var worstAvg = maxBy(mgrs, function (m) { return m.avgFinish; });
    add('Worst average finish', worstAvg.items.map(function (m) {
      return { key: m.name, value: F.num(worstAvg.v, 2), note: m.seasonsPlayed < 3 ? plural(m.seasonsPlayed, 'season') : null };
    }));
    var worst3 = maxBy(mgrs.filter(function (m) { return m.seasonsPlayed >= 3; }), function (m) { return m.avgFinish; });
    if (worst3.items.length && worst3.items[0] !== worstAvg.items[0]) {
      add('Worst average finish, 3+ seasons', worst3.items.map(function (m) { return { key: m.name, value: F.num(worst3.v, 2) }; }));
    }
    var lp = maxBy(mgrs, function (m) { return (m.lastPlace || []).length; });
    if (lp.v > 0) add('Most last-place finishes', lp.items.map(function (m) {
      return { key: m.name, value: String(lp.v), note: m.lastPlace.join(', ') };
    }));

    // year over year, consecutive seasons only
    var yoy = [], byMgr = {};
    all.forEach(function (r) { (byMgr[r.manager] = byMgr[r.manager] || []).push(r); });
    Object.keys(byMgr).forEach(function (k) {
      var l = byMgr[k].sort(function (a, b) { return a.year - b.year; });
      for (var i = 1; i < l.length; i++) {
        if (l[i].year === l[i - 1].year + 1 && isNum(l[i].rank) && isNum(l[i - 1].rank)) {
          yoy.push({ key: k, from: l[i - 1], to: l[i], d: l[i - 1].rank - l[i].rank });
        }
      }
    });
    function yoyRows(res) {
      return res.items.map(function (y) {
        return { key: y.key, value: ord(y.from.rank) + ' to ' + ord(y.to.rank), note: y.from.year + ' to ' + y.to.year };
      });
    }
    var jump = maxBy(yoy, function (y) { return y.d; });
    if (jump.v > 0) add('Biggest rise, one season to the next', yoyRows(jump));
    var fall = minBy(yoy, function (y) { return y.d; });
    if (fall.v < 0) add('Biggest drop, one season to the next', yoyRows(fall));

    // this edition's power rank against the all-time order (by average finish)
    var histRank = {};
    mgrs.slice().sort(function (a, b) { return a.avgFinish - b.avgFinish; }).forEach(function (m, i) { histRank[m.name] = i + 1; });
    var gaps = M.teams.filter(function (t) { return histRank[t.historyKey]; })
      .map(function (t) { return { t: t, h: histRank[t.historyKey], d: t.rank - histRank[t.historyKey] }; });
    function gapRows(res) {
      return res.items.map(function (g) {
        return { key: g.t.historyKey, value: ord(g.t.rank), note: ord(g.h) + ' all-time by average finish' };
      });
    }
    var wk = M.editionWeek ? 'Week ' + M.editionWeek + ' ranking' : 'Current ranking';
    var over = minBy(gaps, function (g) { return g.d; });
    if (over.items.length && over.v < 0) add(wk + ' furthest above all-time rank', gapRows(over));
    var under = maxBy(gaps, function (g) { return g.d; });
    if (under.items.length && under.v > 0) add(wk + ' furthest below all-time rank', gapRows(under));

    add('Most points per game, one season', seasonRows(maxBy(all, function (r) { return r.ppg; }), 2));
    add('Fewest points per game, one season', seasonRows(minBy(all, function (r) { return r.ppg; }), 2));
    add('Most points against, one season', seasonRows(maxBy(all, function (r) { return r.pa; }), 2));
    if (M.lastYear >= HALF_PPR_FROM) {
      var hiPA = maxBy(mgrs, function (m) { return m.avgPAHalf; });
      add('Most points against per game, since ' + HALF_PPR_FROM, hiPA.items.map(function (m) { return { key: m.name, value: F.num(hiPA.v, 2) }; }));
      var loPA = minBy(mgrs, function (m) { return m.avgPAHalf; });
      add('Fewest points against per game, since ' + HALF_PPR_FROM, loPA.items.map(function (m) { return { key: m.name, value: F.num(loPA.v, 2) }; }));
    }

    // transactions: counted only in the seasons that have them
    var moveRows = all.filter(function (r) { return isNum(r.moves); });
    if (moveRows.length) {
      var span = moveRows[0].year + '–' + moveRows[moveRows.length - 1].year;
      var totals = {};
      moveRows.forEach(function (r) { totals[r.manager] = (totals[r.manager] || 0) + r.moves; });
      var totalList = Object.keys(totals).map(function (k) { return { key: k, moves: totals[k] }; });
      var mvAll = maxBy(totalList, function (x) { return x.moves; });
      add('Most moves, ' + span, mvAll.items.map(function (x) { return { key: x.key, value: F.num(mvAll.v) }; }));
      if (mvAll.items.every(function (x) { return M.departed(x.key); })) {
        var mvCur = maxBy(totalList.filter(function (x) { return !M.departed(x.key); }), function (x) { return x.moves; });
        add('Most moves by a current manager, ' + span, mvCur.items.map(function (x) { return { key: x.key, value: F.num(mvCur.v) }; }));
      }
      var mvHi = maxBy(moveRows, function (r) { return r.moves; });
      add('Most moves, one season', mvHi.items.map(function (r) { return { key: r.manager, value: F.num(mvHi.v), note: String(r.year) }; }));
      var mvLo = minBy(moveRows, function (r) { return r.moves; });
      add('Fewest moves, one season', mvLo.items.map(function (r) { return { key: r.manager, value: F.num(mvLo.v), note: String(r.year) }; }));
      add('Moves by all managers', [{ text: span, value: F.num(totalList.reduce(function (a, x) { return a + x.moves; }, 0)) }]);
    }

    var names = maxBy(mgrs, function (m) {
      var seen = {};
      (m.teamNames || []).forEach(function (x) { if (x.team) seen[x.team] = 1; });
      return Object.keys(seen).length;
    });
    if (names.v > 1) add('Most team names', names.items.map(function (m) {
      return { key: m.name, value: String(names.v), note: 'in ' + plural(m.seasonsPlayed, 'season') };
    }));

    // the current rosters (the old page closed its list with these): players carrying an injury status, and running
    // backs ranked in the top 30 at the position by season points (PLAYERS.posRank)
    var rosters = ((window.BROOKDALE || {}).season || {}).rosters;
    if (rosters && M.year) {
      var squads = M.teams.map(function (t) {
        var r = rosters[t.slug];
        return r ? { key: t.historyKey || t.manager, players: (r.starters || []).concat(r.bench || []) } : null;
      }).filter(Boolean);
      var hurt = maxBy(squads, function (s) { return s.players.filter(function (p) { return !!p.status; }).length; });
      if (hurt.v > 0) add('Most players with an injury status, ' + M.year + (M.editionWeek ? ' week ' + M.editionWeek : ''),
        hurt.items.map(function (s) { return { key: s.key, value: String(hurt.v) }; }));
      var P = window.PLAYERS || {}, byName = P.byName;
      if (byName) {
        var rbs = maxBy(squads, function (s) {
          return s.players.filter(function (p) {
            var q = byName[p.name];
            return p.pos === 'RB' && q && isNum(q.posRank) && q.posRank <= 30;
          }).length;
        });
        if (rbs.v > 0) add('Most top-30 running backs by points, ' + M.year + (P.throughWeek ? ' through week ' + P.throughWeek : ''),
          rbs.items.map(function (s) { return { key: s.key, value: String(rbs.v) }; }));
      }
    }
    return out;
  }

  // one record: <div class="hist-rec"><dt>label</dt><dd>name ……… value<small>note</small></dd>…</div>
  function recItem(M, rec) {
    return h('div.hist-rec', h('dt', rec.label), rec.rows.map(function (r) {
      return h('dd',
        h('span.hist-line',
          r.key ? who(M, r.key) : h('span.hist-who.hist-who--plain', r.text || ''),
          h('i.hist-line__dots', { 'aria-hidden': 'true' }),
          h('b.hist-line__val.num', r.value)),
        r.note ? h('small.hist-line__note', r.note) : null);
    }));
  }
  function buildBook(M) {
    var recs = records(M);
    if (!recs.length) return null;
    var anyDeparted = recs.some(function (rec) { return rec.rows.some(function (r) { return r.key && M.departed(r.key); }); });
    return section('hist-sec--book', APP.sectionHead('Record book', M.firstYear ? M.firstYear + '–' + M.lastYear : null),
      h('dl.hist-book', recs.map(function (rec) { return recItem(M, rec); })),
      anyDeparted ? departedKey() : null);
  }

  // ---------- view ----------
  APP.register('history', {
    mount: function (root) {
      APP.setTitle('History');
      var M = model();
      var hasHistory = M.seasons.length > 0;
      root.appendChild(h('div.page.hist',
        h('h1.sr-only', 'League history'),
        h('div.hist-top',
          M.standings.length ? buildStandings(M) : null,
          hasHistory || M.standings.length ? buildGrid(M) : null),
        hasHistory && M.champs.length ? buildChampions(M) : null,
        Object.keys(M.managers).length ? buildAllTime(M) : null,
        hasHistory ? buildBook(M) : null));

      // edge shades follow the tables' size (viewport, fonts arriving); everything is released on unmount
      var markAll = function () { M.boxes.forEach(function (b) { b.mark(); }); };
      var ro = null;
      if (window.ResizeObserver) {
        ro = new ResizeObserver(markAll);
        M.boxes.forEach(function (b) { ro.observe(b.scroller); ro.observe(b.table); });
      } else {
        window.addEventListener('resize', markAll);
      }
      markAll();
      return function cleanup() {
        if (ro) ro.disconnect(); else window.removeEventListener('resize', markAll);
        M.boxes.length = 0;
      };
    }
  });
})();
