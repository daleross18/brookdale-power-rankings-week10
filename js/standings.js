// ============================================================================
//  standings.js — view 'standings' (#/standings).   Styles: css/standings.css (prefix st-).
//
//  1. Standings table in Yahoo order (STATS.league.standings). Sortable by every column header; the red playoff cut
//     is drawn in any sort whose order keeps the playoff teams together (always in seed order). Every data cell
//     carries a tooltip (APP.tip: hover, tap, keyboard focus) of terse "label: value" lines; no tooltip is taller
//     than a 375x667 phone can place. Arrow keys move between the cells of a table (one tab stop per table).
//  2. The +/− control at the start of a row opens that team's stat sheet: every stat of the tooltips, laid out in
//     groups, plus its week-by-week lines and remaining schedule. One sheet open at a time.
//     From 700px it opens under the row, pinned to the visible width of the table's scroll container (--st-w) so it
//     never scrolls sideways. On phones it is a bottom sheet over the page (dialog, Escape / Close / tap outside).
//  3. Season marks (six clippings on the desk): high / low single score, biggest blowout, closest game,
//     highest / lowest combined score.
//  4. Scores by week: teams x weeks grid, cell ink = that week's scoring rank, wins set bold and lettered W.
//  5. Weekly high and low scorers.
//
//  Everything is read from STATS. Roster numbers come from ROSTER.summary(slug) when window.ROSTER exists
//  (the Drafted and Roster columns and the Roster group of the sheet are left out when it does not).
// ============================================================================
(function () {
  'use strict';
  var APP = window.APP, STATS = window.STATS;
  if (!APP || !STATS) return;
  var h = APP.h, fmt = APP.fmt;

  // ---------- small formatters ----------
  function T(slug) { return STATS.bySlug[slug]; }
  function nm(slug) { var t = T(slug); return t ? t.name : String(slug); }
  function pts(n) { return n == null ? '' : fmt.pts(n); }
  function sg(n, d) { return n == null ? '' : fmt.signed(n, d == null ? 2 : d); }
  function rec(r) { return r ? STATS.recordText(r) : ''; }
  function pct3(p) { if (p == null) return ''; var s = Number(p).toFixed(3); return p < 1 ? s.replace(/^0/, '') : s; }
  function ord(n) { return STATS.ordinal(n); }
  function rk(slug, key, opts) { var r = STATS.rankOf(slug, key, opts); return r && r.text ? r.text : ''; }
  function wk(n) { return 'Wk ' + n; }
  function run(r) { return !r || !r.n ? '0' : r.n + ' (' + (r.from === r.to ? wk(r.from) : 'Wk ' + r.from + '–' + r.to) + ')'; }
  function runSub(r) { return !r || !r.n ? '' : (r.from === r.to ? 'Week ' + r.from : 'Weeks ' + r.from + '–' + r.to); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function gb(n) { return !n ? '—' : (Number.isInteger(n) ? String(n) : n.toFixed(1)); }
  function scoreLine(l) { return l.result + ' ' + pts(l.pts) + '–' + pts(l.oppPts); }
  function teamName(slug) { return h('span', APP.wbr(nm(slug))); }
  // the team as one link: name, and the manager under it
  function teamId(t, withManager) {
    return h('a.st-id', { href: APP.teamHref(t.slug) },
      h('span.st-id__name', APP.wbr(t.name)), withManager ? h('span.st-id__mgr', t.manager) : null);
  }
  function tipOn(el, title, lines) { return APP.tip(el, lines.filter(Boolean).join('\n'), title); }
  function reduceMotion() { return /[?&]reduce\b/.test(location.search); }   // OS Reduce Motion is deliberately ignored; ?reduce opts out

  // A table in its sideways scroll container, inside a box that shades its right / left edge while there is more
  // table in that direction. Returns the box; box.scroller is the scroll container.
  var boxes = [], boxRO = null;
  function markBox(box) {
    var sc = box.scroller, max = sc.scrollWidth - sc.clientWidth;
    box.classList.toggle('is-more', max - sc.scrollLeft > 2);
    box.classList.toggle('is-less', sc.scrollLeft > 2);
  }
  function scrollBox(table) {
    var sc = APP.tableWrap(table), box = h('div.st-box', sc);
    box.scroller = sc;
    sc.addEventListener('scroll', function () { markBox(box); }, { passive: true });
    if (!boxRO && window.ResizeObserver) {
      boxRO = new ResizeObserver(function (entries) {
        entries.forEach(function (e) { var b = e.target.parentNode; if (b && b.scroller) markBox(b); });
      });
    }
    if (boxRO) boxRO.observe(sc);
    boxes.push(box);
    return box;
  }
  function dropBoxes() { if (boxRO) boxRO.disconnect(); boxRO = null; boxes = []; }

  function rosterOf(slug) {
    var R = window.ROSTER;
    if (!R || typeof R.summary !== 'function') return null;
    try { return R.summary(slug) || null; } catch (e) { return null; }
  }
  var POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  // ---------- tooltip lines, per column ----------
  function tipRecord(t) {
    var s = t.scoring;
    return [
      'Record: ' + rec(t.record) + ' (' + pct3(t.pct) + ')',
      'Close games (under 10): ' + rec(s.close),
      'Blowouts (over 30): ' + rec(s.blowout),
      'Avg margin: ' + sg(s.avgMargin),
      s.avgMarginW != null ? 'Avg margin in wins: ' + sg(s.avgMarginW) : null,
      s.avgMarginL != null ? 'Avg margin in losses: ' + sg(s.avgMarginL) : null,
      'As favorite: ' + rec(t.vsProj.favored),
      'As underdog: ' + rec(t.vsProj.underdog)
    ];
  }
  function tipSeed(t) {
    var p = t.playoff, line = STATS.playoffTeams;
    return [
      'Seed: ' + ord(t.seed) + ' of ' + STATS.teamCount,
      'Games behind 1st: ' + (t.gamesBackFirst ? gb(t.gamesBackFirst) : '0'),
      p.in ? 'Playoff spot: in' : 'Playoff spot: out',
      p.in ? 'Games ahead of ' + ord(line + 1) + ': ' + gb(p.games).replace('—', '0')
           : 'Games behind ' + ord(line) + ': ' + gb(p.games).replace('—', '0'),
      p.in ? 'Points ahead of ' + ord(line + 1) + ': ' + sg(p.pf)
           : 'Points behind ' + ord(line) + ': ' + sg(p.pf),
      'Games left: ' + (STATS.regularSeasonWeeks - t.games)
    ];
  }
  function tipPF(t) {
    var s = t.scoring;
    return [
      'Points for: ' + pts(t.pf) + ' (' + rk(t.slug, 'pf') + ')',
      'High: ' + pts(s.high.pts) + ', ' + wk(s.high.week) + ' vs ' + nm(s.high.opp),
      'Low: ' + pts(s.low.pts) + ', ' + wk(s.low.week) + ' vs ' + nm(s.low.opp),
      'Top scorer of the week: ' + s.topWeeks,
      'Bottom scorer of the week: ' + s.bottomWeeks,
      'Top-half weeks: ' + s.topHalfWeeks + ' of ' + t.games
    ];
  }
  function tipPA(t) {
    return [
      'Points against: ' + pts(t.pa),
      'Fewest allowed: ' + rk(t.slug, 'pa', { asc: true }),
      'Per game: ' + pts(t.papg),
      'Point difference: ' + sg(t.diff) + ' (' + rk(t.slug, 'diff') + ')',
      'Opponents beat projection: ' + t.oppVsProj.beat + ' of ' + t.oppVsProj.games,
      'Opponents avg vs projection: ' + sg(t.oppVsProj.avgDiff)
    ];
  }
  function tipStreak(t) {
    var s = t.scoring;
    return [
      'Streak: ' + t.streak,
      'Wk ' + STATS.weeks[0] + '–' + STATS.weeks[STATS.weeks.length - 1] + ': ' + t.log.map(function (l) { return l.result; }).join(' '),
      'Longest win streak: ' + run(s.longestW),
      'Longest losing streak: ' + run(s.longestL)
    ];
  }
  function tipPPG(t) {
    var s = t.scoring;
    return [
      'Per game: ' + pts(t.ppg) + ' (' + rk(t.slug, 'ppg') + ')',
      'League average: ' + pts(STATS.league.avg),
      'Median: ' + pts(s.median),
      'Std deviation: ' + pts(s.stdDev),
      'Range: ' + pts(s.range),
      'Last 3: ' + pts(s.last3.ppg)
    ];
  }
  function tipAllPlay(t) {
    var a = t.allPlay, lines = ['All-play: ' + rec(a) + ' (' + pct3(a.pct) + ')', 'Rank: ' + rk(t.slug, 'allPlay.pct')];
    for (var i = 0; i < t.log.length; i += 3) {
      var part = t.log.slice(i, i + 3);
      lines.push((part.length > 1 ? 'Wk ' + part[0].week + '–' + part[part.length - 1].week : wk(part[0].week)) + ': ' +
        part.map(function (l) { return rec({ w: l.apW, l: l.apL, t: l.apT }); }).join(', '));
    }
    lines.push('Expected wins: ' + fmt.num(t.xWins, 2));
    return lines;
  }
  function tipLuck(t) {
    return [
      'Wins: ' + (t.record.w + t.record.t / 2),
      'Expected wins: ' + fmt.num(t.xWins, 2),
      'Luck: ' + sg(t.luck),
      'Rank: ' + rk(t.slug, 'luck')
    ];
  }
  function tipLast3(t) {
    var s = t.scoring.last3;
    var lines = t.log.filter(function (l) { return s.weeks.indexOf(l.week) >= 0; }).map(function (l) {
      return wk(l.week) + ': ' + scoreLine(l) + ' vs ' + nm(l.opp);
    });
    return lines.concat(['Record: ' + rec(s), 'Per game: ' + pts(s.ppg), 'Against per game: ' + pts(s.papg)]);
  }
  function tipSched(t) {
    var r = t.scheduleRange;
    return [
      'Own schedule: ' + rec(t.record),
      'Best schedule: ' + rec(r.best) + ' (' + nm(r.best.slug) + ')',
      'Worst schedule: ' + rec(r.worst) + ' (' + nm(r.worst.slug) + ')',
      'Schedules with more wins: ' + r.better,
      'Same wins: ' + r.same,
      'Fewer wins: ' + r.worse
    ];
  }
  function tipLeft(t) {
    var s = t.sos, lines = t.remaining.map(function (g) {
      return wk(g.week) + ': ' + nm(g.opp) + ' (' + rec(T(g.opp).record) + ')';
    });
    return lines.concat([
      'Combined: ' + rec({ w: s.remaining.oppW, l: s.remaining.oppL, t: s.remaining.oppT }) + ' (' + pct3(s.remaining.oppPct) + ')',
      'Their points per game: ' + pts(s.remaining.oppPpg),
      'Opponents so far: ' + rec({ w: s.played.oppW, l: s.played.oppL, t: s.played.oppT }) + ' (' + pct3(s.played.oppPct) + ')'
    ]);
  }
  function tipProj(t) {
    var v = t.vsProj;
    return [
      'Beat projection: ' + v.beat + ' of ' + v.games,
      'Avg vs projection: ' + sg(v.avgDiff),
      'Total vs projection: ' + sg(v.totalDiff),
      'Avg projection: ' + pts(v.avgProj),
      'As favorite: ' + rec(v.favored),
      'As underdog: ' + rec(v.underdog)
    ];
  }
  function tipPower(t) {
    var d = t.rankDelta;
    return [
      'Power rank: ' + t.rank,
      'Preseason: ' + t.pre.rank,
      'Change: ' + (d > 0 ? 'up ' + d : d < 0 ? 'down ' + (-d) : 'none')
    ];
  }
  function oddsLine(label, now, pre, delta) {
    return label + ': ' + now.pct + '% (' + now.odds + '), was ' + pre.pct + '% (' + sg(delta, 0) + ')';
  }
  function tipOdds(t) {
    var o = t.odds;
    if (!o || !o.now || !o.pre) return [];
    return [
      oddsLine('Playoffs', o.now.playoff, o.pre.playoff, o.delta.playoff),
      oddsLine('Finals', o.now.finals, o.pre.finals, o.delta.finals),
      oddsLine('Title', o.now.championship, o.pre.championship, o.delta.championship),
      'Projected record: ' + o.now.projectedRecord + ', was ' + o.pre.projectedRecord
    ];
  }
  function tipMoves(t) {
    return [
      'Moves: ' + t.moves + ' (' + rk(t.slug, 'moves') + ')',
      'Waiver priority: ' + t.waiver
    ];
  }
  // Roster numbers are split over two columns so neither tooltip grows taller than a small phone can show.
  function rosterRank(slug, key) {
    var mine = rosterOf(slug);
    if (!mine || mine[key] == null) return '';
    var higher = 0, level = 0;
    STATS.teams.forEach(function (o) {
      var r = rosterOf(o.slug);
      if (!r || r[key] == null) return;
      if (r[key] > mine[key]) higher++; else if (r[key] === mine[key]) level++;
    });
    return (level > 1 ? 'T-' : '') + ord(higher + 1) + ' of ' + STATS.teamCount;
  }
  function tipDrafted(t) {
    var r = rosterOf(t.slug);
    if (!r) return [];
    return [
      'Drafted: ' + r.drafted + ' of ' + r.size + ' (' + rosterRank(t.slug, 'drafted') + ')',
      'Added: ' + r.added
    ].concat((r.fromTeams || []).map(function (f) { return 'Drafted by ' + nm(f.slug) + ': ' + f.n; }), [
      'Injured: ' + r.injured,
      'Questionable: ' + r.questionable,
      'On bye this week: ' + r.onBye
    ]);
  }
  // season half-PPR totals of the players on the roster now (kickers and defenses are in the stat sheet only)
  function tipRosterPts(t) {
    var r = rosterOf(t.slug);
    if (!r || r.pts == null) return [];
    var lines = [
      'Roster pts: ' + pts(r.pts) + ' (' + rosterRank(t.slug, 'pts') + ')',
      r.startersPts != null ? 'Starters: ' + pts(r.startersPts) : null,
      r.benchPts != null ? 'Bench: ' + pts(r.benchPts) : null,
      r.draftedPts != null ? 'Drafted players: ' + pts(r.draftedPts) : null,
      r.addedPts != null ? 'Added players: ' + pts(r.addedPts) : null
    ];
    ['QB', 'RB', 'WR', 'TE'].forEach(function (p) {
      var b = r.byPos && r.byPos[p];
      if (b) lines.push(p + ': ' + pts(b.pts) + ' (' + b.n + ')');
    });
    if (r.top) lines.push('Top scorer: ' + r.top.name + ', ' + pts(r.top.pts));
    return lines;
  }

  // ---------- standings table ----------
  function last3Boxes(t) {
    var weeks = t.scoring.last3.weeks;
    return h('span.res-row', t.log.filter(function (l) { return weeks.indexOf(l.week) >= 0; }).map(function (l) {
      return h('span.res.res--' + l.result.toLowerCase(), l.result);
    }));
  }
  function columns(hasRoster) {
    var cols = [
      { key: 'rec', label: 'W-L', dir: 'desc', val: function (t) { return -t.seed; },
        cell: function (t) { return rec(t.record); }, tip: tipRecord },
      { key: 'gb', label: 'GB', dir: 'asc', val: function (t) { return t.gamesBackFirst; },
        cell: function (t) { return gb(t.gamesBackFirst); }, tip: tipSeed },
      { key: 'pf', label: 'PF', dir: 'desc', val: function (t) { return t.pf; },
        cell: function (t) { return pts(t.pf); }, tip: tipPF },
      { key: 'pa', label: 'PA', dir: 'desc', val: function (t) { return t.pa; },
        cell: function (t) { return pts(t.pa); }, tip: tipPA },
      { key: 'strk', label: 'Strk', dir: 'desc', val: function (t) { return (t.streakType === 'W' ? 1 : t.streakType === 'L' ? -1 : 0) * t.streakLen; },
        cell: function (t) { return h('span.' + t.streakType.toLowerCase(), t.streak); }, tip: tipStreak },
      { key: 'ppg', label: 'PPG', dir: 'desc', val: function (t) { return t.ppg; },
        cell: function (t) { return pts(t.ppg); }, tip: tipPPG },
      { key: 'ap', label: 'All-play', dir: 'desc', val: function (t) { return t.allPlay.pct; },
        cell: function (t) { return rec(t.allPlay); }, tip: tipAllPlay },
      { key: 'luck', label: 'Luck', dir: 'desc', val: function (t) { return t.luck; },
        cell: function (t) { return h('span.' + (t.luck > 0 ? 'up' : t.luck < 0 ? 'down' : 'flat'), sg(t.luck)); }, tip: tipLuck },
      { key: 'l3', label: 'Last 3', dir: 'desc', ctr: true, val: function (t) { var s = t.scoring.last3; return (s.w + s.t / 2) * 1000 + s.ppg; },
        cell: last3Boxes, tip: tipLast3 },
      { key: 'sched', label: 'Sched', dir: 'desc', val: function (t) { var r = t.scheduleRange; return r.best.w * 100 + r.worst.w; },
        cell: function (t) { var r = t.scheduleRange; return r.worst.w + '–' + r.best.w + ' W'; }, tip: tipSched },
      { key: 'left', label: 'Opp left', dir: 'desc', val: function (t) { return t.sos.remaining.oppPct; },
        cell: function (t) { var s = t.sos.remaining; return rec({ w: s.oppW, l: s.oppL, t: s.oppT }); }, tip: tipLeft },
      { key: 'proj', label: 'vs Proj', dir: 'desc', val: function (t) { return t.vsProj.beat * 1000 + t.vsProj.avgDiff; },
        cell: function (t) { return t.vsProj.beat + '/' + t.vsProj.games; }, tip: tipProj },
      { key: 'power', label: 'Power', dir: 'asc', val: function (t) { return t.rank; },
        cell: function (t) { return h('span.st-power', h('span', String(t.rank)), APP.mover(t.rankDelta)); }, tip: tipPower },
      { key: 'odds', label: 'Playoffs', dir: 'desc', val: function (t) { return t.odds && t.odds.now ? t.odds.now.playoff.pct : -1; },
        cell: function (t) { return t.odds && t.odds.now ? fmt.pct(t.odds.now.playoff.pct) : ''; }, tip: tipOdds },
      { key: 'moves', label: 'Moves', dir: 'desc', val: function (t) { return t.moves == null ? -1 : t.moves; },
        cell: function (t) { return t.moves == null ? '' : String(t.moves); }, tip: tipMoves }
    ];
    if (hasRoster) {
      cols.push({ key: 'draft', label: 'Drafted', dir: 'desc', val: function (t) { var r = rosterOf(t.slug); return r ? r.drafted : -1; },
        cell: function (t) { var r = rosterOf(t.slug); return r ? r.drafted + '/' + r.size : ''; }, tip: tipDrafted });
      if (rosterOf(STATS.league.standings[0].slug).pts != null) {
        cols.push({ key: 'rpts', label: 'Roster pts', dir: 'desc', val: function (t) { var r = rosterOf(t.slug); return r && r.pts != null ? r.pts : -1; },
          cell: function (t) { var r = rosterOf(t.slug); return r && r.pts != null ? pts(r.pts) : ''; }, tip: tipRosterPts });
      }
    }
    return cols;
  }

  // ---------- stat sheet ----------
  function stat(label, value, sub) {
    return h('div.stat', h('span.stat__label', label), h('b.stat__value', value), sub ? h('span.stat__sub', sub) : null);
  }
  function group(title, stats, extra) {
    return h('section.st-group', h('h4.st-group__title', title),
      stats && stats.length ? h('div.stat-grid', stats) : null, extra || null);
  }
  function resultsStrip(t) {
    return h('div.st-strip',
      t.log.map(function (l) {
        return h('span.st-strip__g', h('span.st-strip__wk', String(l.week)), h('span.res.res--' + l.result.toLowerCase(), l.result));
      }));
  }
  function weekTable(t) {
    var head = ['Wk', 'Opponent', '', 'Score', 'Opp', 'Margin', 'Proj', 'vs Proj', 'Wk rank', 'All-play'];
    var numCol = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    var table = h('table.data.data--dense.st-weeks',
      h('thead', h('tr', head.map(function (x, i) {
        return h('th' + (numCol[i] ? '.num' : ''), { scope: 'col' }, x || h('span.sr-only', 'Result'));
      }))),
      h('tbody', t.log.map(function (l) {
        return h('tr',
          h('td.num', String(l.week)),
          h('td.st-weeks__opp', teamName(l.opp)),
          h('td', h('span.res.res--' + l.result.toLowerCase(), l.result)),
          h('td.num', h(l.result === 'W' ? 'b' : 'span', pts(l.pts))),
          h('td.num', pts(l.oppPts)),
          h('td.num', sg(l.margin)),
          h('td.num', pts(l.proj)),
          h('td.num', sg(l.vsProj)),
          h('td.num', ord(l.weekRank)),
          h('td.num', rec({ w: l.apW, l: l.apL, t: l.apT })));
      })));
    var box = scrollBox(table);
    box.classList.add('st-box--plain');
    return box;
  }
  function remainingTable(t) {
    if (!t.remaining || !t.remaining.length) return null;
    var table = h('table.data.data--dense.st-rem',
      h('thead', h('tr',
        h('th.num', { scope: 'col' }, 'Wk'), h('th', { scope: 'col' }, 'Opponent'),
        h('th.num', { scope: 'col' }, 'W-L'), h('th', { scope: 'col' }, 'First meeting'))),
      h('tbody', t.remaining.map(function (g) {
        var p = g.prev;
        return h('tr',
          h('td.num', String(g.week)),
          h('td.st-weeks__opp', teamName(g.opp)),
          h('td.num', rec(T(g.opp).record)),
          h('td', p ? [h('span.res.res--' + p.result.toLowerCase(), p.result), ' ' + pts(p.pts) + '–' + pts(p.oppPts)] : ''));
      })));
    var box = scrollBox(table);
    box.classList.add('st-box--plain');
    return box;
  }
  function buildSheet(t, onClose) {
    var s = t.scoring, v = t.vsProj, o = t.odds, p = t.playoff, r = t.scheduleRange, sos = t.sos, line = STATS.playoffTeams;
    var groups = [];

    groups.push(group('Record', [
      stat('Record', rec(t.record), pct3(t.pct)),
      stat('Seed', ord(t.seed), 'of ' + STATS.teamCount),
      stat('Games behind 1st', t.gamesBackFirst ? gb(t.gamesBackFirst) : '0'),
      stat('Streak', t.streak),
      stat('Last 3', rec(s.last3), 'Weeks ' + s.last3.weeks[0] + '–' + s.last3.weeks[s.last3.weeks.length - 1]),
      stat('Close games', rec(s.close), 'under 10 points'),
      stat('Blowouts', rec(s.blowout), 'over 30 points'),
      stat('Longest win streak', String(s.longestW.n), runSub(s.longestW)),
      stat('Longest losing streak', String(s.longestL.n), runSub(s.longestL))
    ], resultsStrip(t)));

    groups.push(group('Scoring', [
      stat('Points for', pts(t.pf), rk(t.slug, 'pf')),
      stat('Per game', pts(t.ppg), 'League ' + pts(STATS.league.avg)),
      stat('Median', pts(s.median)),
      stat('Std deviation', pts(s.stdDev)),
      stat('High', pts(s.high.pts), [wk(s.high.week) + ' vs ', APP.wbr(nm(s.high.opp))]),
      stat('Low', pts(s.low.pts), [wk(s.low.week) + ' vs ', APP.wbr(nm(s.low.opp))]),
      stat('Range', pts(s.range)),
      stat('Last 3 per game', pts(s.last3.ppg)),
      stat('Weeks as top scorer', String(s.topWeeks)),
      stat('Weeks as bottom scorer', String(s.bottomWeeks)),
      stat('Top-half weeks', s.topHalfWeeks + ' of ' + t.games)
    ]));

    groups.push(group('Points against', [
      stat('Points against', pts(t.pa), rk(t.slug, 'pa', { asc: true }) + ' fewest'),
      stat('Per game', pts(t.papg)),
      stat('Point difference', sg(t.diff), rk(t.slug, 'diff')),
      stat('Avg margin', sg(s.avgMargin)),
      s.avgMarginW != null ? stat('Avg margin in wins', sg(s.avgMarginW)) : null,
      s.avgMarginL != null ? stat('Avg margin in losses', sg(s.avgMarginL)) : null,
      stat('Opponents beat projection', t.oppVsProj.beat + ' of ' + t.oppVsProj.games),
      stat('Opponents avg vs projection', sg(t.oppVsProj.avgDiff))
    ].filter(Boolean)));

    groups.push(group('All-play and luck', [
      stat('All-play', rec(t.allPlay), pct3(t.allPlay.pct) + ', ' + rk(t.slug, 'allPlay.pct')),
      stat('Expected wins', fmt.num(t.xWins, 2)),
      stat('Luck', sg(t.luck), rk(t.slug, 'luck'))
    ]));

    groups.push(group('Schedule', [
      stat('Best with another schedule', rec(r.best), [APP.wbr(nm(r.best.slug)), "'s"]),
      stat('Worst with another schedule', rec(r.worst), [APP.wbr(nm(r.worst.slug)), "'s"]),
      stat('Schedules with more wins', String(r.better), 'of 9'),
      stat('Schedules with same wins', String(r.same), 'of 9'),
      stat('Schedules with fewer wins', String(r.worse), 'of 9'),
      stat('Opponents so far', rec({ w: sos.played.oppW, l: sos.played.oppL, t: sos.played.oppT }), pct3(sos.played.oppPct) + ', ' + pts(sos.played.oppPpg) + ' per game'),
      stat('Opponents left', rec({ w: sos.remaining.oppW, l: sos.remaining.oppL, t: sos.remaining.oppT }), pct3(sos.remaining.oppPct) + ', ' + pts(sos.remaining.oppPpg) + ' per game')
    ], remainingTable(t)));

    groups.push(group('Projection', [
      stat('Beat projection', v.beat + ' of ' + v.games),
      stat('Avg vs projection', sg(v.avgDiff)),
      stat('Total vs projection', sg(v.totalDiff)),
      stat('Avg projection', pts(v.avgProj)),
      stat('As favorite', rec(v.favored)),
      stat('As underdog', rec(v.underdog))
    ]));

    var pic = [
      p.in ? stat('Games ahead of ' + ord(line + 1), gb(p.games).replace('—', '0'))
           : stat('Games behind ' + ord(line), gb(p.games).replace('—', '0')),
      p.in ? stat('Points ahead of ' + ord(line + 1), sg(p.pf)) : stat('Points behind ' + ord(line), sg(p.pf)),
      stat('Games left', String(STATS.regularSeasonWeeks - t.games))
    ];
    if (o && o.now && o.pre) {
      pic.push(
        stat('Playoff odds', o.now.playoff.pct + '%', o.now.playoff.odds + ', was ' + o.pre.playoff.pct + '% (' + sg(o.delta.playoff, 0) + ')'),
        stat('Finals odds', o.now.finals.pct + '%', o.now.finals.odds + ', was ' + o.pre.finals.pct + '% (' + sg(o.delta.finals, 0) + ')'),
        stat('Title odds', o.now.championship.pct + '%', o.now.championship.odds + ', was ' + o.pre.championship.pct + '% (' + sg(o.delta.championship, 0) + ')'),
        stat('Projected record', o.now.projectedRecord, 'was ' + o.pre.projectedRecord));
    }
    groups.push(group('Playoff picture', pic));

    groups.push(group('Power rank and moves', [
      stat('Power rank', String(t.rank)),
      stat('Preseason rank', String(t.pre.rank)),
      stat('Change', t.rankDelta ? APP.mover(t.rankDelta) : '0'),
      t.moves != null ? stat('Moves', String(t.moves), rk(t.slug, 'moves')) : null,
      t.waiver != null ? stat('Waiver priority', String(t.waiver)) : null
    ].filter(Boolean)));

    var ro = rosterOf(t.slug);
    if (ro) {
      var from = (ro.fromTeams || []).map(function (f) { return nm(f.slug) + ' ' + f.n; }).join(', ');
      var fromN = (ro.fromTeams || []).reduce(function (a, f) { return a + f.n; }, 0);
      var rs = [
        stat('Drafted', String(ro.drafted), 'of ' + ro.size),
        stat('Added', String(ro.added)),
        stat("From other teams' drafts", String(fromN), from),
        stat('Injured', String(ro.injured)),
        stat('Questionable', String(ro.questionable)),
        stat('On bye this week', String(ro.onBye)),
        ro.pts != null ? stat('Roster points', pts(ro.pts), "players' season totals") : null,
        ro.startersPts != null ? stat('Starters', pts(ro.startersPts)) : null,
        ro.benchPts != null ? stat('Bench', pts(ro.benchPts)) : null,
        ro.draftedPts != null ? stat('Drafted players', pts(ro.draftedPts)) : null,
        ro.addedPts != null ? stat('Added players', pts(ro.addedPts)) : null
      ];
      POS.forEach(function (k) {
        var b = ro.byPos && ro.byPos[k];
        if (b) rs.push(stat(k, pts(b.pts), plural(b.n, 'player', 'players')));
      });
      if (ro.top) {
        rs.push(stat('Top scorer', pts(ro.top.pts),
          ro.top.name + (ro.top.pos ? ', ' + ro.top.pos + (ro.top.posRank ? ro.top.posRank : '') : '')));
      }
      groups.push(group('Roster', rs.filter(Boolean)));
    }

    var closeTop = h('button.btn.btn--sm', { type: 'button', onclick: onClose }, 'Close');
    var closeBot = h('button.btn.btn--sm', { type: 'button', onclick: onClose }, 'Close');
    return h('div.st-sheet__paper', { id: 'st-sheet-' + t.slug },
      h('header.st-sheet__head',
        h('div.st-sheet__id',
          h('h3.st-sheet__name', APP.wbr(t.name)),
          h('span.st-sheet__mgr', t.manager)),
        h('div.st-sheet__acts',
          h('a.btn.btn--sm.btn--primary', { href: APP.teamHref(t.slug) }, 'Team page'),
          closeTop)),
      h('div.st-sheet__groups', groups),
      h('section.st-group.st-group--wide', h('h4.st-group__title', 'Week by week'), weekTable(t)),
      h('footer.st-sheet__foot',
        h('a.btn.btn--sm.btn--primary', { href: APP.teamHref(t.slug) }, 'Team page'),
        closeBot));
  }

  // On phones the sheet is a bottom sheet over the page (its own scroll, the table stays put underneath).
  function phone() { return !!(window.matchMedia && window.matchMedia('(max-width: 699px)').matches); }
  function openModal(t, paper, onClose) {
    var panel = h('div.st-modal__panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t.name + ' stat sheet', tabindex: '-1' }, paper);
    var modal = h('div.st-modal', h('div.st-modal__shade', { onclick: onClose }), panel);
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      var f = panel.querySelectorAll('a[href], button, [tabindex="0"]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    });
    document.body.appendChild(modal);
    document.documentElement.classList.add('st-lock');
    panel.focus({ preventScroll: true });
    return function close() {
      modal.remove();
      document.documentElement.classList.remove('st-lock');
    };
  }

  // ---------- keyboard: arrow keys move between the tooltip cells of a table ----------
  function rove(table) {
    function cells() { return Array.prototype.slice.call(table.querySelectorAll('tbody td[data-tip]')); }
    function reset() {
      var all = cells(), has = false;
      all.forEach(function (c) { if (c.tabIndex === 0) { if (has) c.tabIndex = -1; has = true; } });
      if (!has && all[0]) all[0].tabIndex = 0;
    }
    cells().forEach(function (c, i) { c.tabIndex = i ? -1 : 0; });
    table.addEventListener('keydown', function (e) {
      var cell = e.target;
      if (!cell || cell.tagName !== 'TD' || !cell.hasAttribute('data-tip')) return;
      var dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      var dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!dx && !dy) return;
      var next = null, row = cell.parentNode, col = cell.cellIndex;
      if (dx) {
        var sib = cell;
        do { sib = dx > 0 ? sib.nextElementSibling : sib.previousElementSibling; } while (sib && !sib.hasAttribute('data-tip'));
        next = sib;
      } else {
        var r = row;
        do {
          r = dy > 0 ? r.nextElementSibling : r.previousElementSibling;
          next = r && r.cells[col] && r.cells[col].hasAttribute('data-tip') && r.cells.length === row.cells.length ? r.cells[col] : null;
        } while (r && !next);
      }
      if (!next) return;
      e.preventDefault();
      cells().forEach(function (c) { c.tabIndex = -1; });
      next.tabIndex = 0;
      next.focus();
    });
    return reset;
  }

  // ---------- the standings section ----------
  function buildStandings(state) {
    var teams = STATS.league.standings.slice();
    var hasRoster = !!rosterOf(teams[0].slug);
    var cols = columns(hasRoster);
    var sort = { key: 'seed', dir: 'asc' };
    var open = null;                       // slug whose sheet is open
    var rows = {}, togs = {}, sheetRow = null, closeModal = null;
    var heads = {};

    function headCell(key, label, cls, dir) {
      var btn = h('button.data__sort', { type: 'button', onclick: function () { setSort(key, dir); } }, label);
      var th = h('th' + cls, { scope: 'col' }, btn);
      heads[key] = th;
      return th;
    }
    var thead = h('thead', h('tr',
      headCell('seed', 'Team', '.st-th-team', 'asc'),
      cols.map(function (c) { return headCell(c.key, c.label, c.ctr ? '.ctr' : '.num', c.dir); })));

    var tbody = h('tbody');
    teams.forEach(function (t) {
      var tog = h('button.st-tog', {
        type: 'button', 'aria-expanded': 'false', 'aria-controls': 'st-sheet-' + t.slug,
        'aria-label': t.name + ' stat sheet',
        onclick: function () { toggle(t.slug); }
      }, h('span.st-tog__box', { 'aria-hidden': 'true' }), h('span.st-tog__seed', { 'aria-hidden': 'true' }, String(t.seed)));
      togs[t.slug] = tog;
      var tr = h('tr', { dataset: { slug: t.slug } },
        h('td.team.st-team',
          h('div.st-teamcell', tog,
            teamId(t, true))),
        cols.map(function (c) {
          var td = h('td' + (c.ctr ? '.ctr' : '.num'), c.cell(t));
          var lines = c.tip(t);
          return lines && lines.length ? tipOn(td, t.name, lines) : td;
        }));
      rows[t.slug] = tr;
    });

    var table = h('table.data.data--sticky.st-table', { 'aria-label': 'Standings' }, thead, tbody);
    var box = scrollBox(table), wrap = box.scroller;
    wrap.classList.add('st-scroll');
    var resetRove = rove(table);
    // Escape closes the in-place sheet, from inside it or from its row
    table.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !open || !sheetRow) return;
      var at = e.target, slug = open;
      if (!sheetRow.contains(at) && !rows[slug].contains(at)) return;
      shut(); paint(); togs[slug].focus({ preventScroll: true });
    });

    function order() {
      var col = null;
      cols.forEach(function (c) { if (c.key === sort.key) col = c; });
      var val = col ? col.val : function (t) { return t.seed; };
      var m = sort.dir === 'asc' ? 1 : -1;
      return teams.slice().sort(function (a, b) { return (val(a) - val(b)) * m || a.seed - b.seed; });
    }
    function paint() {
      var list = order();
      var focused = document.activeElement;           // re-appending a row blurs whatever is focused inside it
      if (focused && !tbody.contains(focused)) focused = null;
      // the cut line is drawn whenever the current order keeps the playoff teams together (one boundary), in any sort
      var cutAt = -1, flips = 0;
      list.forEach(function (t, i) {
        if (i && (t.seed <= STATS.playoffTeams) !== (list[i - 1].seed <= STATS.playoffTeams)) { flips++; cutAt = i - 1; }
      });
      if (flips !== 1) cutAt = -1;
      list.forEach(function (t, i) {
        var tr = rows[t.slug];
        var cut = i === cutAt;
        var isOpen = open === t.slug;
        tr.classList.toggle('cut', !!cut && !isOpen);
        tr.classList.toggle('is-open', isOpen);
        tbody.appendChild(tr);
        if (isOpen && sheetRow) { sheetRow.classList.toggle('cut', !!cut); tbody.appendChild(sheetRow); }
      });
      Object.keys(heads).forEach(function (k) {
        if (k === sort.key) heads[k].setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
        else heads[k].removeAttribute('aria-sort');
      });
      resetRove();
      if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
    function setSort(key, dir) {
      if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else { sort.key = key; sort.dir = dir; }
      paint();
    }
    function shut() {
      if (sheetRow) { sheetRow.remove(); sheetRow = null; }
      if (closeModal) { closeModal(); closeModal = null; }
      if (open && togs[open]) togs[open].setAttribute('aria-expanded', 'false');
      open = null;
    }
    function toggle(slug) {
      var was = open;
      shut();
      if (was !== slug) {
        open = slug;
        var t = T(slug);
        var paper = buildSheet(t, function () { shut(); paint(); togs[slug].focus({ preventScroll: true }); });
        if (phone()) {
          closeModal = openModal(t, paper, function () { shut(); paint(); togs[slug].focus({ preventScroll: true }); });
        } else {
          paper.classList.add('clipping', 'clipping--flat');
          paper.setAttribute('role', 'region');
          paper.setAttribute('aria-label', t.name + ' stat sheet');
          sheetRow = h('tr.st-sheet-row', h('td', { colspan: cols.length + 1 }, h('div.st-sheet', paper)));
        }
        togs[slug].setAttribute('aria-expanded', 'true');
      }
      paint();
      boxes = boxes.filter(function (b) {                 // forget the tables of a sheet that has been closed
        if (b.isConnected) return true;
        if (boxRO) boxRO.unobserve(b.scroller);
        return false;
      });
      boxes.forEach(markBox);
      if (open && sheetRow) reveal(rows[open]);
    }
    // keep the opened row in view: bring it up under the nav when its sheet would start low on the screen
    function reveal(tr) {
      var nav = document.querySelector('.nav');
      var top = nav ? nav.getBoundingClientRect().bottom : 0;
      var r = tr.getBoundingClientRect();
      if (r.top >= top && r.bottom <= window.innerHeight * 0.45) return;
      window.scrollTo({ top: window.scrollY + r.top - top - 6, behavior: reduceMotion() ? 'auto' : 'smooth' });
    }

    // the sheet is as wide as the visible part of the table, not as wide as the table
    function size() { wrap.style.setProperty('--st-w', wrap.clientWidth + 'px'); }
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(size); ro.observe(wrap); }
    else window.addEventListener('resize', size);
    // crossing the phone breakpoint with a sheet open: close it (the two presentations do not convert)
    var mql = window.matchMedia ? window.matchMedia('(max-width: 699px)') : null;
    function onBreak() { if (open) { shut(); paint(); } }
    if (mql && mql.addEventListener) mql.addEventListener('change', onBreak);
    state.cleanups.push(function () {
      if (ro) ro.disconnect(); else window.removeEventListener('resize', size);
      if (mql && mql.removeEventListener) mql.removeEventListener('change', onBreak);
      shut();
    });
    size();
    paint();

    return h('section.st-sec',
      APP.sectionHead('Standings', 'Through Week ' + STATS.weeksPlayed),
      box);
  }

  // ---------- season marks ----------
  function gameLines(g) {
    var first = g.winner || g.a, second = first === g.a ? g.b : g.a;
    function ptsOf(slug) { return slug === g.a ? g.aPts : g.bPts; }
    return h('div.st-mark__game',
      h('span.st-mark__row.st-mark__row--w', teamName(first), h('span.num', pts(ptsOf(first)))),
      h('span.st-mark__row', teamName(second), h('span.num', pts(ptsOf(second)))));
  }
  function buildMarks() {
    var L = STATS.league;
    function single(label, x) {
      var log = T(x.slug).log.filter(function (l) { return l.week === x.week; })[0];
      return { label: label, big: pts(x.pts), week: x.week,
        body: h('div.st-mark__game',
          h('span.st-mark__row.st-mark__row--w', teamName(x.slug)),
          h('span.st-mark__row.st-mark__row--sub', h('span', (log ? log.result + ' ' : '') + 'vs ', APP.wbr(nm(x.opp))))) };
    }
    function game(label, g, big) { return { label: label, big: pts(big), week: g.week, body: gameLines(g) }; }
    var marks = [
      single('Season high', L.high),
      single('Season low', L.low),
      game('Biggest blowout', L.biggestBlowout, L.biggestBlowout.margin),
      game('Closest game', L.closestGame, L.closestGame.margin),
      game('Highest combined', L.highestTotal, L.highestTotal.total),
      game('Lowest combined', L.lowestTotal, L.lowestTotal.total)
    ];
    var cuts = ['', 'clipping--cut2', 'clipping--cut3'];
    return h('section.desk.st-desk', { 'aria-label': 'Season marks' },
      h('ul.st-marks', marks.map(function (m, i) {
        return h('li.st-marks__item',
          APP.clipping({ rot: APP.rot('mark-' + m.label) * 0.55, class: ['st-mark', cuts[i % 3], i === 1 || i === 4 ? 'clipping--aged' : ''] },
            h('div.st-mark__top',
              h('span.label', m.label),
              h('span.st-mark__wk', 'Week ' + m.week)),
            h('b.st-mark__big', m.big),
            m.body));
      })));
  }

  // ---------- scores by week ----------
  function buildGrid() {
    var teams = STATS.league.standings, L = STATS.league;
    var thead = h('thead', h('tr',
      h('th.st-th-team', { scope: 'col' }, 'Week'),
      STATS.weeks.map(function (w) { return h('th.ctr', { scope: 'col' }, h('span.sr-only', 'Week '), String(w)); })));
    var tbody = h('tbody', teams.map(function (t) {
      return h('tr',
        h('th.team.st-team', { scope: 'row' }, teamId(t, false)),
        t.log.map(function (l) {
          var td = h('td.st-g.st-g--' + l.result.toLowerCase(), { dataset: { rank: l.weekRank } },
            h('span.st-g__in',
              h('span.st-g__pts', pts(l.pts)),
              h('span.st-g__res', l.result)));
          return tipOn(td, t.name + ', Week ' + l.week, [
            'Opponent: ' + nm(l.opp),
            'Score: ' + pts(l.pts) + '–' + pts(l.oppPts) + ' (' + l.result + ')',
            'Margin: ' + sg(l.margin),
            'Week rank: ' + ord(l.weekRank) + ' of ' + STATS.teamCount,
            'Projection: ' + pts(l.proj) + ' (' + sg(l.vsProj) + ')'
          ]);
        }));
    }));
    var tfoot = h('tfoot', h('tr',
      h('th.st-team.st-foot', { scope: 'row' }, 'League average'),
      L.weeks.map(function (w) { return h('td.ctr', pts(w.avg)); })));
    var table = h('table.data.data--dense.data--sticky.st-grid', { 'aria-label': 'Scores by week' }, thead, tbody, tfoot);
    rove(table);
    var key = h('div.st-key', { 'aria-hidden': 'true' },
      h('span.st-key__label', 'Week rank'),
      h('span.st-key__scale', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].slice(0, STATS.teamCount).map(function (n) {
        return h('span.st-key__sw', { dataset: { rank: n } }, String(n));
      })));
    return h('section.st-sec.st-sec--grid',
      APP.sectionHead('Scores by week'),
      scrollBox(table), key);
  }

  // ---------- weekly high and low ----------
  function buildWeekly() {
    var L = STATS.league;
    function cell(week, slug, p) {
      var log = T(slug).log.filter(function (l) { return l.week === week; })[0];
      var td = h('td.st-hl', h('span.st-hl__in',
        h('span.st-hl__name', APP.wbr(nm(slug))), h('span.st-hl__pts.num', pts(p))));
      return log ? tipOn(td, nm(slug) + ', Week ' + week, [
        'Opponent: ' + nm(log.opp),
        'Score: ' + pts(log.pts) + '–' + pts(log.oppPts) + ' (' + log.result + ')',
        'Margin: ' + sg(log.margin),
        'vs league average: ' + sg(log.vsAvg)
      ]) : td;
    }
    var table = h('table.data.st-weekly', { 'aria-label': 'Weekly high and low' },
      h('thead', h('tr',
        h('th.num', { scope: 'col' }, 'Wk'),
        h('th', { scope: 'col' }, 'High'),
        h('th', { scope: 'col' }, 'Low'))),
      h('tbody', L.weeks.map(function (w) {
        return h('tr', h('th.num', { scope: 'row' }, String(w.week)), cell(w.week, w.topSlug, w.high), cell(w.week, w.bottomSlug, w.low));
      })));
    rove(table);
    return h('section.st-sec.st-sec--weekly',
      APP.sectionHead('Weekly high and low'),
      APP.tableWrap(table));
  }

  // ---------- view ----------
  APP.register('standings', {
    mount: function (root) {
      APP.setTitle('Standings');
      var state = { cleanups: [] };
      if (!STATS.league || !STATS.league.standings || !STATS.league.standings.length) return function () {};
      root.appendChild(h('div.page.st-page', buildStandings(state)));
      root.appendChild(buildMarks());
      root.appendChild(h('div.page.st-page.st-lower', buildGrid(), buildWeekly()));
      return function cleanup() { state.cleanups.forEach(function (fn) { fn(); }); dropBoxes(); };
    }
  });
})();
