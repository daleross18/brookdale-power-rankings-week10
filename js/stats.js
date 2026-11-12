// ============================================================================
//  BROOKDALE LEAGUE — WEEK 10 — DERIVED STATS            window.STATS
//
//  Pure function of window.BROOKDALE (js/data.js). No DOM. Computed once at load.
//  Node:  global.window = global; require('./js/data.js'); const STATS = require('./js/stats.js');
//         (if BROOKDALE is not on the global yet, stats.js loads ./data.js itself)
//         STATS.build(otherBrookdaleObject) → a fresh STATS for any data object (used by tests).
//
//  CONVENTIONS
//    slug      team id string (BROOKDALE.teams[].slug)
//    Rec       { w, l, t }                    RecPct = { w, l, t, pct }
//    pct       win fraction 0..1, 3 decimals: (w + t/2) / games          (0.778, not 77.8)
//    points    numbers rounded to 2 decimals. Everything is a number (never a string) unless noted.
//    result    'W' | 'L' | 'T'
//    margin    signed from the team's side (pts − oppPts); negative in a loss. League-level margins are positive.
//    null      "no data" (e.g. average margin in losses for an unbeaten team). Never a made-up number.
//    sharing   STATS is shared by every view. Its arrays and objects are live: never sort / reverse / splice / edit them
//              in place (use .slice() first). The arrays RETURNED by rankings() and league.standingsAfter() are fresh
//              copies on every call (their row objects are still shared).
//              team.pre, team.odds.now, team.odds.pre and roster.starters / roster.bench are the BROOKDALE objects themselves.
//
//  ---------------------------------------------------------------------------
//  STATS
//    .weeksPlayed          9        number of played weeks (= entries in season.weeks)
//    .weeks                [1..9]   played week numbers, ascending
//    .regularSeasonWeeks   14
//    .playoffTeams         6
//    .teamCount            10
//    .teams                Team[]   in POWER-RANK order (same order as BROOKDALE.teams)
//    .bySlug               { [slug]: Team }      (same objects as .teams; no inherited keys, so bySlug[x] is
//                                                 undefined for anything that is not a team slug)
//    .games                Game[]   every played game, week order then Yahoo listing order
//    .league               League   (below)
//    .wouldBe(a, b)        → WouldBe | null      (null when a === b or a slug is unknown)
//    .withSchedule(a, b)   → Sched   | null      (a === b is allowed: a's real record; null when a slug is unknown)
//    .rankings(key, opts)  → RankRow[]           (below)
//    .rankOf(slug, key, opts) → { rank, tied, of, value, text } | null     text e.g. "2nd of 10", "T-3rd of 10";
//                                                 null for an unknown slug; rank null and text '' when the team has no value
//    .ordinal(n)           → "1st" "2nd" "3rd" "4th" "11th" ...
//    .recordText(rec)      → "7-2"  (or "7-2-1" when rec.t > 0)
//    .signed(n, digits=2)  → "+48.56" / "-7.00" / "0.00"  (string, for display; '' for null / undefined / NaN)
//    .build(B)             → new STATS object from any BROOKDALE-shaped object
//
//  ---------------------------------------------------------------------------
//  Game
//    { week, a, aPts, aProj, b, bPts, bProj,      a/b = slugs in Yahoo listing order
//      winner, loser,                              slugs; both null on a tie
//      margin,                                     |aPts − bPts|
//      total,                                      aPts + bPts
//      favorite,                                   slug with the higher projection (null if equal)
//      upset }                                     true when the projected favorite lost
//
//  ---------------------------------------------------------------------------
//  Team   (STATS.teams[i], STATS.bySlug[slug])
//    identity (copied from BROOKDALE.teams):
//      rank, slug, code, name, manager, historyKey, tagline, profile (image path), meme (image path), pre { rank, name }
//    rankDelta           pre.rank − rank   (positive = moved up since the preseason rankings)
//
//    record              { w, l, t }
//    games               games played
//    pct                 win fraction
//    pf, pa              points for / against (season totals)
//    diff                pf − pa
//    ppg, papg           per game
//    streak              "W-1" (string, from season.standings; built from streakType + '-' + streakLen if there is no row)
//    streakType          'W' | 'L' | 'T'      streakLen   number     (computed from results; agree with .streak)
//    waiver, moves       from season.standings (null if the team has no standings row)
//    seed                1..10 standings position (win%, then PF, then power-rank order if still level)
//    gamesBack           games behind the 6th seed (last playoff spot): ((w6 − w) + (l − l6)) / 2.
//                        0 for the 6th seed and anyone level with it, NEGATIVE for teams ahead of it.
//    gamesBackFirst      games behind the 1st seed (>= 0)
//    playoff             { in,        true when seed <= playoffTeams
//                          games,     in: games ahead of the 7th seed · out: games behind the 6th seed  (>= 0)
//                          pf }       in: pf − 7th seed's pf · out: 6th seed's pf − pf   (the tiebreaker gap; can be negative)
//
//    log                 WeekLog[]  one per played week, week order (log[0] = week 1)
//      { week,
//        opp,                       opponent slug
//        pts, proj,                 this team's score and Yahoo projection
//        oppPts, oppProj,
//        result,                    'W' | 'L' | 'T'
//        margin,                    pts − oppPts (signed)
//        vsProj,                    pts − proj (signed)
//        favored,                   true when proj > oppProj
//        weekRank,                  1..10 scoring rank that week (1 = top score; equal scores share a rank)
//        apW, apL, apT,             all-play that week: how many of the other nine this score beat / lost to / tied
//        xw,                        expected wins that week = (apW + apT/2) / 9      (3 decimals)
//        vsAvg,                     pts − league average score that week
//        cumW, cumL, cumT,          record after this week
//        cumPF, cumPA,              totals after this week
//        cumXW,                     expected wins after this week (2 decimals)
//        standing }                 league position after this week (win%, then cumulative PF, then power rank), 1..10
//
//    wouldBe             { [otherSlug]: WouldBe }   (all nine others; no entry for itself)
//    withSchedule        { [slug]: Sched }          (all ten, including its own slug = real record)
//    scheduleRange       { best:  { slug, w, l, t },      whose schedule gives this team its best record
//                          worst: { slug, w, l, t },      ... and its worst (own schedule excluded from both)
//                          better, same, worse }          how many of the nine other schedules give more / equal / fewer wins
//
//    allPlay             { w, l, t, pct }     record vs all nine others every week (w + l + t = 81)
//    xWins               expected wins = sum of weekly xw (2 decimals)
//    luck                (w + t/2) − xWins    (positive = more wins than the scoring earned)
//
//    scoring
//      { high: { pts, week, opp },  low: { pts, week, opp },      (the earliest week if a score repeats)
//        median, stdDev,            stdDev = sample standard deviation (n − 1) of weekly scores
//        range,                     high − low
//        avgMargin,                 mean of signed margins
//        avgMarginW,                mean margin in wins   (positive; null with no wins)
//        avgMarginL,                mean margin in losses (negative; null with no losses)
//        topWeeks,                  weeks as the league's top scorer
//        bottomWeeks,               weeks as the league's bottom scorer
//        topHalfWeeks,              weeks with weekRank <= 5
//        close:   { w, l, t },      games decided by less than 10      (a margin of exactly 10.00 is not close)
//        blowout: { w, l, t },      games decided by more than 30      (a margin of exactly 30.00 is not a blowout)
//        last3:   { w, l, t, ppg, papg, weeks: [7, 8, 9] },
//        longestW: { n, from, to }, longest win streak (weeks from..to; the earliest run if several are equal;
//                                   n = 0 and from/to = null if none)
//        longestL: { n, from, to } }
//
//    vsProj              this team against its own Yahoo projection
//      { beat, games,               weeks with pts > proj
//        avgDiff, totalDiff,        mean / sum of (pts − proj)
//        avgProj, totalProj,
//        favored:  { w, l, t },     record in weeks it was the projected favorite (proj > oppProj)
//        underdog: { w, l, t } }    record in weeks it was not (equal projections count here)
//    oppVsProj           its opponents against THEIR projection in the weeks they faced this team
//      { beat, games, avgDiff, totalDiff }
//
//    sos
//      { played:    { oppPpg, oppW, oppL, oppT, oppPct },      opponents faced: mean of their season ppg; their combined current record
//        remaining: { oppPpg, oppW, oppL, oppT, oppPct,        same for weeks 10–14 opponents
//                     games: RemGame[] } }
//    remaining           RemGame[]  (same array as sos.remaining.games) from season.remaining, week order;
//                                   only weeks after the last played week
//      { week, opp,
//        prev }                     the earlier meeting this season: { week, pts, oppPts, result } from this team's side, or null
//
//    odds
//      { now,                       BROOKDALE.oddsByRank[rank − 1]       { projectedRecord, playoff {pct, odds}, finals {..}, championship {..} }
//        pre,                       BROOKDALE.oddsByRank[pre.rank − 1]
//        delta: { playoff, finals, championship } }    now.pct − pre.pct, in percentage points (signed, 2 decimals)
//
//    positions           null today (season.positionPoints is null). When present:
//      { keys: ['QB','RB','WR','TE','W/R/T','K','DEF', ...],       positions found, canonical order
//        weeks: [ { week, total, byPos: { QB: 21.4, ... }, share: { QB: 0.18, ... } } ],
//        totals: { QB: ..., ... },  avg: { QB: ..., ... },  share: { QB: 0.19, ... } }     share = fraction of the summed position points
//    roster              null today (season.rosters is null). When present:
//      { starters: [...], bench: [...],                            as given in data.js
//        size, counts: { QB: 2, ... }, starterCounts: {...}, benchCounts: {...} }          players by `pos`
//
//  ---------------------------------------------------------------------------
//  WouldBe   STATS.wouldBe(a, b)  ===  STATS.bySlug[a].wouldBe[b]
//    A's score against B's score in every played week, as if they met every week.
//    { w, l, t,
//      weeks:  [ { week, a, b, result } ],      a / b = the two scores that week; result from A's side
//      actual: { week, a, b, result } | null,   the real head-to-head meeting (first one if several)
//      meetings: [ { week, a, b, result } ] }   every real meeting
//    wouldBe(a, b) is the mirror of wouldBe(b, a) (w ↔ l).
//
//  Sched     STATS.withSchedule(a, b)  ===  STATS.bySlug[a].withSchedule[b]
//    A's record if A had played B's opponents each week. In the week B played A, B's own score is the opponent score.
//    { w, l, t,
//      delta,                                   wins here − A's real wins
//      weeks: [ { week, opp, pts, oppPts, result } ] }     opp = slug whose score was used
//
//  ---------------------------------------------------------------------------
//  League   (STATS.league)
//    { games,                       number of played games (45)
//      avg, median,                 of all individual team scores
//      stdDev,                      sample standard deviation of all individual team scores
//      avgMargin,                   mean winning margin
//      weeks: [ { week, high, low, avg, median, topSlug, bottomSlug, games: Game[] } ],
//      high: { pts, slug, week, opp },          season-high single score
//      low:  { pts, slug, week, opp },          season-low single score
//      biggestBlowout: Game,  closestGame: Game,
//      highestTotal: Game,    lowestTotal: Game,          by combined score
//      favorites: { w, l, t },                  how the projected favorites did (t = tie game or equal projections)
//      standings: Team[],                       current order, seed 1 first
//      standingsAfter(week) → StandRow[] | null }         position order; null for a week that has not been played
//    StandRow  { pos, slug, w, l, t, pct, pf, pa, gb }    gb = games behind first place
//
//  ---------------------------------------------------------------------------
//  rankings(key, opts) → RankRow[]
//    key    dot path to a numeric Team field ('pf', 'ppg', 'pa', 'scoring.stdDev', 'allPlay.pct', 'luck',
//           'vsProj.avgDiff', 'sos.remaining.oppPpg', 'odds.delta.playoff', 'scoring.high.pts', 'record.w', ...)
//           or a function (team) => number.
//    opts   { asc: true } ranks the LOWEST value 1st (default: highest value is 1st).
//    RankRow { rank, tied, of, slug, team, value }     sorted best first. Equal values share a rank (1, 2, 2, 4) with tied = true
//           (teams level on value are listed in power-rank order). `of` = how many teams have a value.
//           Teams whose value is null / not a number come last with rank = null, tied = false, value = null.
//           An unknown key gives ten such rows (never throws).
// ============================================================================

(function (root) {
  'use strict';

  // ---- small numeric helpers ------------------------------------------------
  function rnd(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    var m = Math.pow(10, d);
    var v = Math.round((x + (x >= 0 ? 1 : -1) * 1e-9) * m) / m;
    return v === 0 ? 0 : v;                       // no negative zero
  }
  function r2(x) { return rnd(x, 2); }
  function r3(x) { return rnd(x, 3); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function stdDev(a) {
    if (a.length < 2) return null;
    var m = mean(a), v = 0;
    for (var i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    return Math.sqrt(v / (a.length - 1));
  }
  function rec() { return { w: 0, l: 0, t: 0 }; }
  function add(r, result) { if (result === 'W') r.w++; else if (result === 'L') r.l++; else r.t++; return r; }
  function pctOf(r) { var g = r.w + r.l + r.t; return g ? r3((r.w + r.t / 2) / g) : 0; }
  function resultOf(a, b) { return a > b ? 'W' : a < b ? 'L' : 'T'; }
  function flip(result) { return result === 'W' ? 'L' : result === 'L' ? 'W' : 'T'; }

  function ordinal(n) {
    var v = Math.abs(n) % 100, s = ['th', 'st', 'nd', 'rd'];
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function recordText(r) { return r ? r.w + '-' + r.l + (r.t ? '-' + r.t : '') : ''; }
  function signed(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    var d = digits === undefined ? 2 : digits;
    var v = rnd(n, d);
    return (v > 0 ? '+' : '') + v.toFixed(d);
  }

  var POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'W/R/T', 'FLEX', 'K', 'DEF', 'DST', 'D/ST'];

  // ---- build ----------------------------------------------------------------
  function build(B) {
    var season = B.season;
    var order = B.teams.map(function (t) { return t.slug; });       // power-rank order
    var N = order.length;
    var orderIdx = {};
    order.forEach(function (s, i) { orderIdx[s] = i; });

    var weeksIn = (season.weeks || []).slice().sort(function (a, b) { return a.week - b.week; });
    var weekNums = weeksIn.map(function (w) { return w.week; });
    var W = weekNums.length;
    var lastPlayed = W ? weekNums[W - 1] : 0;
    var playoffTeams = season.playoffTeams || 6;

    // ---- games + per-team per-week cells ----
    var games = [];
    var gamesByWeek = [];
    var cell = {};                                                  // cell[slug][weekIndex]
    order.forEach(function (s) { cell[s] = []; });

    weeksIn.forEach(function (wk, wi) {
      var list = [];
      wk.games.forEach(function (g) {
        var a = g[0], aPts = g[1], aProj = g[2], b = g[3], bPts = g[4], bProj = g[5];
        var winner = aPts > bPts ? a : bPts > aPts ? b : null;
        var loser = aPts > bPts ? b : bPts > aPts ? a : null;
        var favorite = aProj > bProj ? a : bProj > aProj ? b : null;
        var game = {
          week: wk.week, a: a, aPts: aPts, aProj: aProj, b: b, bPts: bPts, bProj: bProj,
          winner: winner, loser: loser, margin: r2(Math.abs(aPts - bPts)), total: r2(aPts + bPts),
          favorite: favorite, upset: !!(favorite && loser && favorite === loser)
        };
        games.push(game); list.push(game);
        if (cell[a]) cell[a][wi] = { week: wk.week, opp: b, pts: aPts, proj: aProj, oppPts: bPts, oppProj: bProj };
        if (cell[b]) cell[b][wi] = { week: wk.week, opp: a, pts: bPts, proj: bProj, oppPts: aPts, oppProj: aProj };
      });
      gamesByWeek.push(list);
    });

    // ---- league per-week numbers, week ranks, all-play ----
    var leagueWeeks = [];
    var allScores = [];
    weeksIn.forEach(function (wk, wi) {
      var entries = order.filter(function (s) { return cell[s][wi]; })
        .map(function (s) { return { slug: s, pts: cell[s][wi].pts }; });
      var pts = entries.map(function (e) { return e.pts; });
      allScores = allScores.concat(pts);
      var avg = mean(pts);
      var top = entries[0], bottom = entries[0];
      entries.forEach(function (e) { if (e.pts > top.pts) top = e; if (e.pts < bottom.pts) bottom = e; });
      entries.forEach(function (e) {
        var c = cell[e.slug][wi], above = 0, below = 0, same = 0;
        entries.forEach(function (o) {
          if (o.slug === e.slug) return;
          if (o.pts > e.pts) above++; else if (o.pts < e.pts) below++; else same++;
        });
        c.weekRank = above + 1;
        c.apW = below; c.apL = above; c.apT = same;
        c.xwRaw = entries.length > 1 ? (below + same / 2) / (entries.length - 1) : 0;
        c.vsAvg = r2(e.pts - avg);
        c.isTop = above === 0; c.isBottom = below === 0;
      });
      leagueWeeks.push({
        week: wk.week, high: top ? top.pts : null, low: bottom ? bottom.pts : null,
        avg: r2(avg), median: r2(median(pts)),
        topSlug: top ? top.slug : null, bottomSlug: bottom ? bottom.slug : null,
        games: gamesByWeek[wi]
      });
    });

    // ---- standings after every week ----
    function standCompare(a, b) {
      return (b.pctRaw - a.pctRaw) || (b.pfRaw - a.pfRaw) || (orderIdx[a.slug] - orderIdx[b.slug]);
    }
    var cum = {};
    order.forEach(function (s) { cum[s] = { w: 0, l: 0, t: 0, pf: 0, pa: 0, xw: 0 }; });
    var standingsByWeek = [];
    weeksIn.forEach(function (wk, wi) {
      order.forEach(function (s) {
        var c = cell[s][wi], k = cum[s];
        if (!c) return;
        c.result = resultOf(c.pts, c.oppPts);
        add(k, c.result);
        k.pf += c.pts; k.pa += c.oppPts; k.xw += c.xwRaw;
        c.cumW = k.w; c.cumL = k.l; c.cumT = k.t;
        c.cumPF = r2(k.pf); c.cumPA = r2(k.pa); c.cumXW = r2(k.xw);
      });
      var rows = order.map(function (s) {
        var k = cum[s], g = k.w + k.l + k.t;
        // pf / pa rounded before comparing, so equal totals are equal whatever order they were summed in
        return { slug: s, w: k.w, l: k.l, t: k.t, pctRaw: g ? (k.w + k.t / 2) / g : 0, pfRaw: r2(k.pf), paRaw: r2(k.pa) };
      }).sort(standCompare);
      var lead = rows[0];
      var out = rows.map(function (r, i) {
        if (cell[r.slug][wi]) cell[r.slug][wi].standing = i + 1;
        return {
          pos: i + 1, slug: r.slug, w: r.w, l: r.l, t: r.t, pct: r3(r.pctRaw), pf: r.pfRaw, pa: r.paRaw,
          gb: ((lead.w - r.w) + (r.l - lead.l)) / 2
        };
      });
      standingsByWeek.push(out);
    });
    var finalRows = W ? standingsByWeek[W - 1] : order.map(function (s, i) {
      return { pos: i + 1, slug: s, w: 0, l: 0, t: 0, pct: 0, pf: 0, pa: 0, gb: 0 };
    });
    var finalBySlug = {};
    finalRows.forEach(function (r) { finalBySlug[r.slug] = r; });
    var sixth = finalRows[Math.min(playoffTeams, N) - 1];
    var seventh = finalRows[playoffTeams] || null;
    var first = finalRows[0];

    var standRowBySlug = {};
    (season.standings || []).forEach(function (r) { standRowBySlug[r.slug] = r; });

    // ---- teams ----
    var teams = B.teams.map(function (src) {
      var slug = src.slug;
      var cells = cell[slug].filter(Boolean);
      var fin = finalBySlug[slug];
      var sr = standRowBySlug[slug] || null;
      var g = cells.length;

      var log = cells.map(function (c) {
        return {
          week: c.week, opp: c.opp, pts: c.pts, proj: c.proj, oppPts: c.oppPts, oppProj: c.oppProj,
          result: c.result, margin: r2(c.pts - c.oppPts), vsProj: r2(c.pts - c.proj), favored: c.proj > c.oppProj,
          weekRank: c.weekRank, apW: c.apW, apL: c.apL, apT: c.apT, xw: r3(c.xwRaw), vsAvg: c.vsAvg,
          cumW: c.cumW, cumL: c.cumL, cumT: c.cumT, cumPF: c.cumPF, cumPA: c.cumPA, cumXW: c.cumXW,
          standing: c.standing
        };
      });

      var record = { w: fin.w, l: fin.l, t: fin.t };
      var ptsList = cells.map(function (c) { return c.pts; });
      var margins = cells.map(function (c) { return c.pts - c.oppPts; });

      // streaks
      var longestW = { n: 0, from: null, to: null }, longestL = { n: 0, from: null, to: null };
      var runType = null, runLen = 0, runFrom = null;
      cells.forEach(function (c) {
        if (c.result === runType) runLen++; else { runType = c.result; runLen = 1; runFrom = c.week; }
        if (runType === 'W' && runLen > longestW.n) longestW = { n: runLen, from: runFrom, to: c.week };
        if (runType === 'L' && runLen > longestL.n) longestL = { n: runLen, from: runFrom, to: c.week };
      });

      // all-play, expected wins
      var ap = rec(), xw = 0;
      cells.forEach(function (c) { ap.w += c.apW; ap.l += c.apL; ap.t += c.apT; xw += c.xwRaw; });

      // scoring profile
      var hi = null, lo = null;
      cells.forEach(function (c) { if (!hi || c.pts > hi.pts) hi = c; if (!lo || c.pts < lo.pts) lo = c; });
      var close = rec(), blowout = rec();
      cells.forEach(function (c) {
        var m = r2(Math.abs(c.pts - c.oppPts));      // rounded: 128.01 − 118.01 is 9.999999999999986 in floating point
        if (m < 10) add(close, c.result);
        if (m > 30) add(blowout, c.result);
      });
      var winM = cells.filter(function (c) { return c.result === 'W'; }).map(function (c) { return c.pts - c.oppPts; });
      var lossM = cells.filter(function (c) { return c.result === 'L'; }).map(function (c) { return c.pts - c.oppPts; });
      var tail = cells.slice(-3), last3 = rec();
      tail.forEach(function (c) { add(last3, c.result); });
      last3.ppg = r2(mean(tail.map(function (c) { return c.pts; })));
      last3.papg = r2(mean(tail.map(function (c) { return c.oppPts; })));
      last3.weeks = tail.map(function (c) { return c.week; });

      // projections
      var favored = rec(), underdog = rec();
      cells.forEach(function (c) { add(c.proj > c.oppProj ? favored : underdog, c.result); });
      var diffs = cells.map(function (c) { return c.pts - c.proj; });
      var oppDiffs = cells.map(function (c) { return c.oppPts - c.oppProj; });
      var projs = cells.map(function (c) { return c.proj; });

      var team = {
        rank: src.rank, slug: slug, code: src.code, name: src.name, manager: src.manager, historyKey: src.historyKey,
        tagline: src.tagline, profile: src.profile, meme: src.meme, pre: src.pre,
        rankDelta: src.pre ? src.pre.rank - src.rank : 0,

        record: record, games: g, pct: fin.pct,
        pf: fin.pf, pa: fin.pa, diff: r2(fin.pf - fin.pa),
        ppg: r2(g ? fin.pf / g : null), papg: r2(g ? fin.pa / g : null),
        streak: sr && sr.streak ? sr.streak : (runType ? runType + '-' + runLen : ''),
        streakType: runType, streakLen: runLen,
        waiver: sr ? sr.waiver : null, moves: sr ? sr.moves : null,
        seed: fin.pos,
        gamesBack: ((sixth.w - fin.w) + (fin.l - sixth.l)) / 2,
        gamesBackFirst: ((first.w - fin.w) + (fin.l - first.l)) / 2,
        playoff: null,

        log: log,
        wouldBe: {}, withSchedule: {}, scheduleRange: null,

        allPlay: { w: ap.w, l: ap.l, t: ap.t, pct: pctOf(ap) },
        xWins: r2(xw),
        luck: r2(record.w + record.t / 2 - xw),

        scoring: {
          high: hi ? { pts: hi.pts, week: hi.week, opp: hi.opp } : null,
          low: lo ? { pts: lo.pts, week: lo.week, opp: lo.opp } : null,
          median: r2(median(ptsList)), stdDev: r2(stdDev(ptsList)),
          range: hi ? r2(hi.pts - lo.pts) : null,
          avgMargin: r2(mean(margins)), avgMarginW: r2(mean(winM)), avgMarginL: r2(mean(lossM)),
          topWeeks: cells.filter(function (c) { return c.isTop; }).length,
          bottomWeeks: cells.filter(function (c) { return c.isBottom; }).length,
          topHalfWeeks: cells.filter(function (c) { return c.weekRank <= N / 2; }).length,
          close: close, blowout: blowout, last3: last3,
          longestW: longestW, longestL: longestL
        },

        vsProj: {
          beat: diffs.filter(function (d) { return d > 0; }).length, games: g,
          avgDiff: r2(mean(diffs)), totalDiff: r2(sum(diffs)),
          avgProj: r2(mean(projs)), totalProj: r2(sum(projs)),
          favored: favored, underdog: underdog
        },
        oppVsProj: {
          beat: oppDiffs.filter(function (d) { return d > 0; }).length, games: g,
          avgDiff: r2(mean(oppDiffs)), totalDiff: r2(sum(oppDiffs))
        },

        sos: null, remaining: null, odds: null, positions: null, roster: null
      };

      var isIn = fin.pos <= playoffTeams;
      team.playoff = {
        'in': isIn,
        games: isIn ? (seventh ? ((fin.w - seventh.w) + (seventh.l - fin.l)) / 2 : 0) : team.gamesBack,
        pf: isIn ? (seventh ? r2(fin.pf - seventh.pf) : 0) : r2(sixth.pf - fin.pf)
      };

      // odds
      var table = B.oddsByRank || [];
      var now = src.oddsNow || table[src.rank - 1] || null;
      var pre = src.pre ? (table[src.pre.rank - 1] || null) : null;
      function d(k) { return now && pre && now[k] && pre[k] ? r2(now[k].pct - pre[k].pct) : null; }
      team.odds = { now: now, pre: pre, delta: { playoff: d('playoff'), finals: d('finals'), championship: d('championship') } };

      return team;
    });

    var bySlug = Object.create(null);                               // no inherited keys: bySlug['constructor'] is undefined
    teams.forEach(function (t) { bySlug[t.slug] = t; });
    function own(o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }

    // ---- would-be records (all pairs) ----
    function computeWouldBe(a, b) {
      var out = { w: 0, l: 0, t: 0, weeks: [], actual: null, meetings: [] };
      for (var wi = 0; wi < W; wi++) {
        var ca = cell[a][wi], cb = cell[b][wi];
        if (!ca || !cb) continue;
        var row = { week: ca.week, a: ca.pts, b: cb.pts, result: resultOf(ca.pts, cb.pts) };
        add(out, row.result);
        out.weeks.push(row);
        if (ca.opp === b) out.meetings.push(row);
      }
      out.actual = out.meetings[0] || null;
      return out;
    }
    // ---- schedule swaps (all pairs, including self) ----
    function computeWithSchedule(a, b) {
      var out = { w: 0, l: 0, t: 0, delta: 0, weeks: [] };
      for (var wi = 0; wi < W; wi++) {
        var ca = cell[a][wi], cb = cell[b][wi];
        if (!ca || !cb) continue;
        var oppSlug = cb.opp === a ? b : cb.opp;
        var oppPts = cb.opp === a ? cb.pts : cb.oppPts;
        var result = resultOf(ca.pts, oppPts);
        add(out, result);
        out.weeks.push({ week: ca.week, opp: oppSlug, pts: ca.pts, oppPts: oppPts, result: result });
      }
      out.delta = out.w - bySlug[a].record.w;
      return out;
    }
    teams.forEach(function (ta) {
      teams.forEach(function (tb) {
        if (ta !== tb) ta.wouldBe[tb.slug] = computeWouldBe(ta.slug, tb.slug);
        ta.withSchedule[tb.slug] = computeWithSchedule(ta.slug, tb.slug);
      });
      var best = null, worst = null, better = 0, same = 0, worse = 0;
      var own = ta.record.w + ta.record.t / 2;
      teams.forEach(function (tb) {
        if (ta === tb) return;
        var s = ta.withSchedule[tb.slug], v = s.w + s.t / 2;
        var row = { slug: tb.slug, w: s.w, l: s.l, t: s.t, v: v };
        if (!best || v > best.v) best = row;
        if (!worst || v < worst.v) worst = row;
        if (v > own) better++; else if (v < own) worse++; else same++;
      });
      function strip(r) { return r ? { slug: r.slug, w: r.w, l: r.l, t: r.t } : null; }
      ta.scheduleRange = { best: strip(best), worst: strip(worst), better: better, same: same, worse: worse };
    });

    // ---- schedule strength ----
    function oppSummary(slugs) {
      var r = rec(), ppgs = [];
      slugs.forEach(function (s) {
        var o = bySlug[s];
        if (!o) return;
        r.w += o.record.w; r.l += o.record.l; r.t += o.record.t;
        if (o.ppg !== null) ppgs.push(o.ppg);
      });
      return { oppPpg: r2(mean(ppgs)), oppW: r.w, oppL: r.l, oppT: r.t, oppPct: pctOf(r) };
    }
    teams.forEach(function (t) {
      var rem = [];
      (season.remaining || []).forEach(function (wk) {
        if (wk.week <= lastPlayed) return;                            // already played: not "remaining"
        wk.games.forEach(function (gm) {
          var opp = gm[0] === t.slug ? gm[1] : gm[1] === t.slug ? gm[0] : null;
          if (!opp) return;
          var wb = t.wouldBe[opp], prev = wb && wb.actual
            ? { week: wb.actual.week, pts: wb.actual.a, oppPts: wb.actual.b, result: wb.actual.result } : null;
          rem.push({ week: wk.week, opp: opp, prev: prev });
        });
      });
      rem.sort(function (a, b) { return a.week - b.week; });
      var remaining = oppSummary(rem.map(function (r) { return r.opp; }));
      remaining.games = rem;
      t.sos = { played: oppSummary(t.log.map(function (l) { return l.opp; })), remaining: remaining };
      t.remaining = rem;
    });

    // ---- optional: position points ----
    var pp = season.positionPoints;
    if (pp) {
      teams.forEach(function (t) {
        var arr = pp[t.slug];
        if (!arr || !arr.length) return;
        var found = {};
        arr.forEach(function (o) { if (o) Object.keys(o).forEach(function (k) { found[k] = true; }); });
        var keys = POSITION_ORDER.filter(function (k) { return found[k]; })
          .concat(Object.keys(found).filter(function (k) { return POSITION_ORDER.indexOf(k) < 0; }));
        var totals = {}, n = 0;
        keys.forEach(function (k) { totals[k] = 0; });
        var weeks = [];
        arr.forEach(function (o, i) {
          if (!o) return;
          n++;
          var byPos = {}, total = 0, share = {};
          keys.forEach(function (k) { var v = typeof o[k] === 'number' ? o[k] : 0; byPos[k] = v; total += v; totals[k] += v; });
          keys.forEach(function (k) { share[k] = total ? r3(byPos[k] / total) : 0; });
          weeks.push({ week: weekNums[i] !== undefined ? weekNums[i] : i + 1, total: r2(total), byPos: byPos, share: share });
        });
        var grand = sum(keys.map(function (k) { return totals[k]; }));
        var avg = {}, share = {};
        keys.forEach(function (k) {
          avg[k] = r2(n ? totals[k] / n : null);
          share[k] = grand ? r3(totals[k] / grand) : 0;
          totals[k] = r2(totals[k]);
        });
        t.positions = { keys: keys, weeks: weeks, totals: totals, avg: avg, share: share };
      });
    }

    // ---- optional: rosters ----
    var rosters = season.rosters;
    if (rosters) {
      teams.forEach(function (t) {
        var r = rosters[t.slug];
        if (!r) return;
        var starters = r.starters || [], bench = r.bench || [];
        function count(list) {
          var c = {};
          list.forEach(function (p) { if (p && p.pos) c[p.pos] = (c[p.pos] || 0) + 1; });
          return c;
        }
        t.roster = {
          starters: starters, bench: bench, size: starters.length + bench.length,
          counts: count(starters.concat(bench)), starterCounts: count(starters), benchCounts: count(bench)
        };
      });
    }

    // ---- league ----
    var hiScore = null, loScore = null;
    teams.forEach(function (t) {
      t.log.forEach(function (l) {
        if (!hiScore || l.pts > hiScore.pts) hiScore = { pts: l.pts, slug: t.slug, week: l.week, opp: l.opp };
        if (!loScore || l.pts < loScore.pts) loScore = { pts: l.pts, slug: t.slug, week: l.week, opp: l.opp };
      });
    });
    function pick(better) {
      var best = null;
      games.forEach(function (g) { if (!best || better(g, best)) best = g; });
      return best;
    }
    var fav = rec();
    games.forEach(function (g) {
      if (!g.favorite || !g.winner) fav.t++; else if (g.favorite === g.winner) fav.w++; else fav.l++;
    });
    var league = {
      games: games.length,
      avg: r2(mean(allScores)), median: r2(median(allScores)), stdDev: r2(stdDev(allScores)),
      avgMargin: r2(mean(games.map(function (g) { return g.margin; }))),
      weeks: leagueWeeks,
      high: hiScore, low: loScore,
      biggestBlowout: pick(function (g, b) { return g.margin > b.margin; }),
      closestGame: pick(function (g, b) { return g.margin < b.margin; }),
      highestTotal: pick(function (g, b) { return g.total > b.total; }),
      lowestTotal: pick(function (g, b) { return g.total < b.total; }),
      favorites: fav,
      standings: finalRows.map(function (r) { return bySlug[r.slug]; }),
      standingsAfter: function (week) {
        var i = weekNums.indexOf(+week);
        return i < 0 ? null : standingsByWeek[i].slice();
      }
    };

    // ---- rankings ----
    function getter(key) {
      if (typeof key === 'function') return key;
      var parts = String(key).split('.');
      return function (t) {
        var v = t;
        for (var i = 0; i < parts.length && v !== null && v !== undefined; i++) v = v[parts[i]];
        return v;
      };
    }
    var rankCache = {};
    function rankings(key, opts) {
      var asc = !!(opts && opts.asc);
      var cacheKey = typeof key === 'string' ? key + (asc ? '|asc' : '|desc') : null;
      if (cacheKey && rankCache[cacheKey]) return rankCache[cacheKey].slice();
      var get = getter(key);
      var rows = teams.map(function (t) {
        var v = get(t);
        return { rank: null, tied: false, of: 0, slug: t.slug, team: t, value: typeof v === 'number' && isFinite(v) ? v : null };
      });
      var good = rows.filter(function (r) { return r.value !== null; });
      var bad = rows.filter(function (r) { return r.value === null; });
      good.sort(function (a, b) {
        return (asc ? a.value - b.value : b.value - a.value) || (orderIdx[a.slug] - orderIdx[b.slug]);
      });
      good.forEach(function (r, i) {
        r.of = good.length;
        if (i && good[i - 1].value === r.value) { r.rank = good[i - 1].rank; r.tied = true; good[i - 1].tied = true; }
        else r.rank = i + 1;
      });
      bad.forEach(function (r) { r.of = good.length; });
      var out = good.concat(bad);
      if (cacheKey) rankCache[cacheKey] = out;
      return out.slice();
    }
    function rankOf(slug, key, opts) {
      var rows = rankings(key, opts);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.slug !== slug) continue;
        return {
          rank: r.rank, tied: r.tied, of: r.of, value: r.value,
          text: r.rank === null ? '' : (r.tied ? 'T-' : '') + ordinal(r.rank) + ' of ' + r.of
        };
      }
      return null;
    }

    return {
      weeksPlayed: W,
      weeks: weekNums,
      regularSeasonWeeks: season.regularSeasonWeeks || W,
      playoffTeams: playoffTeams,
      teamCount: N,
      teams: teams,
      bySlug: bySlug,
      games: games,
      league: league,
      wouldBe: function (a, b) { var t = own(bySlug, a); return (t && a !== b && own(t.wouldBe, b)) || null; },
      withSchedule: function (a, b) { var t = own(bySlug, a); return (t && own(t.withSchedule, b)) || null; },
      rankings: rankings,
      rankOf: rankOf,
      ordinal: ordinal,
      recordText: recordText,
      signed: signed,
      build: build
    };
  }

  // ---- load -----------------------------------------------------------------
  var isNode = typeof module !== 'undefined' && module.exports;
  var data = root.BROOKDALE;
  if (!data && isNode && typeof require === 'function') {
    var shimmed = typeof root.window === 'undefined';
    if (shimmed) root.window = root;
    try { require('./data.js'); } catch (e) { /* data.js not available: STATS is just { build } */ }
    data = root.BROOKDALE || (root.window && root.window.BROOKDALE);
    if (shimmed) delete root.window;
  }
  var STATS = data ? build(data) : { build: build };
  root.STATS = STATS;
  if (isNode) module.exports = STATS;
})(typeof window !== 'undefined' ? window : globalThis);
