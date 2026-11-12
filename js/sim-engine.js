// ============================================================================
//  sim-engine.js — window.SIM_ENGINE : rest-of-season simulation for the 2026 Brookdale League. No DOM.
//  Also loads in Node:  global.window = {}; require('./data.js'); const SIM = require('./sim-engine.js');
//
//  Everything is lazy: nothing is computed at script load. The first call to any function below (or the first
//  read of .teams / .constants / .calibration) reads window.BROOKDALE and sets the engine up once; it throws
//  'SIM_ENGINE: …' if the data is missing or malformed (unknown slug, duplicate rank, non-numeric odds).
//  Everything is deterministic: strengths and baseline() odds are identical for every visitor.
//  Everything returned is a fresh copy: callers may sort or edit what they get; it never changes the engine, the
//  BROOKDALE data, or what the next call returns.
//
//  MODEL
//   • Weeks 1..weeksPlayed (9) are the real results from BROOKDALE.season.weeks. They are never re-rolled.
//   • Weeks 10..14 are played on the real remaining schedule (BROOKDALE.season.remaining). Each side's score is
//     Normal(constants.mean + team.strength, constants.sd), kept within ±3 SD, rounded to the nearest 0.02 like
//     real Yahoo scores. Higher score wins. Simulated games never tie (an exact tie after rounding is broken by 0.02).
//   • constants.mean = average of all real 2026 scores; constants.sd = pooled within-team SD of those scores
//     (112 and 20 only if the data holds no real scores to derive them from).
//   • Final standings: win% (ties count half), then points for (then power rank, if both are equal).
//     Seeds 1–6 make the playoffs, 1 and 2 get byes.
//   • Playoffs: wild card 3v6 and 4v5 → semis (1 vs the lowest remaining seed, 2 vs the other) → final and
//     3rd-place game. Consolation: 7v10 and 8v9 → winners play for 7th, losers play the last-place game; its
//     loser is last place. Playoff/consolation games use the same score model and cannot tie.
//   • Strengths (points per week relative to the league mean; they sum to 0 before rounding to 0.01):
//       1. prior    = the strength the team's CURRENT RANK SLOT needs over a fresh 14-week season to make the
//                     playoffs oddsByRank[rank-1].playoff.pct of the time (this is the preseason sim's calibration).
//                     A better rank slot never gets a lower prior than a worse one.
//       2. strength = the prior moved, by at most ±constants.strengthWindow points, so that the team's simulated
//                     playoff probability GIVEN the nine banked weeks is as close as possible to that same
//                     current implied playoff % (team.target). Targets the banked results put out of reach are
//                     left at the window edge (team.clamped is 'lo' or 'hi'); what cannot be reached is shared
//                     evenly among the teams that are still free.
//   • RNG: mulberry32. simulate(seed) is fully reproducible from its 32-bit seed.
//
//  API
//   SIM_ENGINE.simulate(seed?) → one season. seed: any number (used as uint32); omitted → a random seed is drawn.
//     {
//       seed,                         // uint32 actually used
//       weeks: [                      // 14 entries, week 1..14
//         { week, played,             // played:true for the real weeks (1–9), false for simulated ones (10–14)
//           games: [ { week, a, b, sa, sb, winner, loser, tie } ×5 ] } ],
//                                     // a,b = slugs in schedule order; sa,sb = scores (numbers, 2 decimals);
//                                     // winner/loser = slugs (null only for a real tie, then tie:true)
//       standings: [ { slug, w, l, t, pf, pa, seed } ×10 ],   // final regular-season order, seed 1..10
//       playoffs:    { wc: [g, g], semi: [g, g], final: g, third: g },
//       consolation: { r1: [g, g], seventh: g, last: g },
//                                     // these g = { week (15|16|17), round, a, b, sa, sb, winner, loser, tie:false,
//                                     //             seedA, seedB }; a is always the better seed.
//                                     // round: 'wc'|'semi'|'final'|'third'|'r1'|'seventh'|'last'
//                                     // wc[0] = 3v6, wc[1] = 4v5; semi[0] = seed 1's game, semi[1] = seed 2's game
//                                     // r1[0] = 7v10, r1[1] = 8v9. Weeks: wc/r1 15, semi/seventh/last 16, final/third 17
//       byes: [slug, slug],           // seeds 1 and 2
//       champion, runnerUp, third, seventh, lastPlace          // slugs
//     }
//
//   SIM_ENGINE.standingsThrough(sim, week) → standings rows (same shape, `seed` = position) counting only
//     weeks 1..week of a simulate() result. week 9 = the real current standings; week 14 = sim.standings.
//
//   SIM_ENGINE.monteCarlo(n, seed0?) → aggregate of n seasons (seed0 defaults to constants.defaultSeed).
//     {
//       n, seed,
//       teams: [ row ×10 ],           // in rank order (same order as BROOKDALE.teams)
//       bySlug: { [slug]: row }       // same row objects
//     }
//     row = { slug, name, code, rank,
//             target,                 // calibration target = current implied playoff probability, 0..1
//             implied: { playoff, finals, championship },   // oddsByRank[rank-1], as 0..1
//             playoff, bye, oneSeed, finals, champion, runnerUp, third, lastPlace,   // probabilities 0..1
//             avgWins, avgSeed, avgPf,                       // means over the n seasons (final regular season)
//             seedDist: [10],         // seedDist[k] = P(final seed = k+1)
//             winsDist: [15] }        // winsDist[k] = P(final regular-season wins = k), k = 0..14
//     Season k of monteCarlo(n, seed0) is exactly simulate(floor(r() · 2^32)) for the k-th draw r() of
//     mulberry32(seed0), so any aggregate can be reproduced season by season.
//     NOTE for display: `playoff` (simulated) and `implied.playoff` (the odds table) differ for the teams whose
//     record already decides most of it — e.g. the 7-2 team simulates at ~100% against an implied 80%.
//
//   SIM_ENGINE.createRun(seed0?) → { n, add(k), result() }   // incremental Monte Carlo for progress bars:
//     add(k) simulates floor(k) more seasons (returns the run; k ≤ 0 or not a number adds nothing), n is the
//     number of seasons so far, result() returns the monteCarlo shape for all of them (all zeros while n is 0).
//     createRun(s).add(a).add(b).result() equals monteCarlo(a + b, s).
//
//   SIM_ENGINE.baseline() → monteCarlo(constants.defaultN, constants.defaultSeed), computed once and cached
//     (each call returns its own copy). Use this for the odds shown to everyone. (createRun() with no seed, filled
//     up to constants.defaultN seasons in chunks, gives the identical result without one long synchronous call.)
//
//   SIM_ENGINE.randomSeed() → a random uint32.
//
//   SIM_ENGINE.teams → [ { slug, name, code, rank, strength, mean, prior, lo, hi, clamped, target, achieved } ×10 ]
//     in rank order (a property, not a function). strength = points per week vs league average;
//     mean = constants.mean + strength; prior = see MODEL; lo/hi = prior ∓ constants.strengthWindow;
//     clamped = null | 'lo' | 'hi'; target = implied playoff probability (0..1);
//     achieved = the calibration's own estimate of the simulated playoff probability (0..1; a large monteCarlo()
//     lands within about a point of it).
//
//   SIM_ENGINE.constants → { mean: 111.84, sd: 22.2, weeks: 14, weeksPlayed: 9, playoffTeams: 6, byes: 2,
//     minScore: 30, maxZ: 3, strengthWindow: 8, calibrationSeasons: 6000, priorSeasons: 2000, calibrationSeed,
//     defaultN: 10000, defaultSeed }
//
//   SIM_ENGINE.calibration → { key, baked, iterations, priorIterations, rmse, maxAbs, record }
//     rmse/maxAbs = fit of achieved vs target over all ten teams (0..1 units). baked:true = the stored result for exactly this data was
//     used (see BAKED below); false = it was computed in the browser because data.js no longer matches.
//     record = the BAKED entry for this data.
//
//   SIM_ENGINE.create(data, opts?) → a separate engine built from another BROOKDALE-shaped object (tests).
//     opts: { strengthWindow, calibrationSeasons, priorSeasons, recalibrate (true = ignore BAKED) }; an option
//     that is missing or not a usable number falls back to the default.
//
//  COST (Node on an M1 Max; a phone is several times slower): the calibration for the shipped data is stored in
//  this file, so first use costs ≈ 2 ms; if data.js changes it is recomputed once on first use (≈ 85 ms).
//  monteCarlo(2000) ≈ 35 ms on a cold engine and 10–20 ms once warm, baseline() (10,000 seasons) ≈ 45–95 ms,
//  simulate() ≈ 0.05 ms. All are synchronous; for long runs call createRun().add(chunk) across frames instead of
//  one big monteCarlo().
// ============================================================================
(function (root) {
  'use strict';

  var TWO32 = 4294967296;

  // Calibration results for the shipped data, keyed by the fingerprint of everything the calibration reads
  // (teams and ranks, oddsByRank playoff %, every real score, the remaining schedule, the calibration constants).
  // When the fingerprint matches, the entry is used as-is and no calibration runs. When anything changes, the
  // calibration simply runs in the browser instead (same algorithm, same numbers) — nothing has to be edited here.
  // To store a new result (optional), run from the repo root and paste the printed entry below:
  //   node -e "global.window={};require('./js/data.js');var c=require('./js/sim-engine.js').create(window.BROOKDALE,{recalibrate:true}).calibration;console.log(JSON.stringify(c.key)+': '+JSON.stringify(c.record))"
  // Bump ALGO whenever the calibration code itself changes.
  var ALGO = 'cal-2';
  var BAKED = {
    '460f64f839216299': {
      prior: [8.22, 3.5, 2.67, 1.53, 0.75, -0.61, -0.61, -3.16, -4, -8.31],
      strength: [0.22, -4.5, -2.08, -2.19, -2.83, 1.55, 7.39, -1.26, 4, -0.31],
      achieved: [1, 0.9225, 0.7535, 0.6942, 0.6838, 0.6043, 0.4302, 0.4543, 0.2868, 0.1703],
      iterations: 7, priorIterations: 11, rmse: 0.0942, maxAbs: 0.1625
    }
  };

  // ---------- RNG (mulberry32, kept as module state so the hot loops allocate nothing) ----------
  var rs = 0, zSpare = 0;
  function rnd() {
    rs = (rs + 0x6D2B79F5) | 0;
    var t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / TWO32;
  }
  // Box–Muller: returns one standard normal, leaves an independent second one in zSpare.
  function gauss() {
    var u = rnd(); while (u === 0) u = rnd();
    var v = rnd(), r = Math.sqrt(-2 * Math.log(u)), th = 6.283185307179586 * v;
    zSpare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  function evenCount(x, dflt) { x = Number(x); return x >= 2 && x <= 1e6 ? 2 * Math.round(x / 2) : dflt; }

  function create(dataArg, optsArg) {
    var opts = optsArg || {};
    var WEEKS = 14, PLAYOFF_TEAMS = 6, BYES = 2, NT = 10;                 // WEEKS is re-read from the data in init()
    var MIN_SCORE = 30;                                                   // floor for a simulated score
    var Z_MAX = 3;                                                        // a simulated score stays within ±3 SD of the team mean
    var NO_DATA_MEAN = 112;                                               // league mean used only when no real week exists yet
    // max |strength − prior| in points. 0 = strengths come from the rank slots alone (simulated playoff odds then
    // miss the implied ones by 20 points RMS); unlimited = every playoff target is hit exactly, but only by making
    // the 7-2 rank-1 team a 70-point-a-week side and a 3-6 team the title favourite. Around 8 the simulated finals
    // and championship odds sit closest to the implied ones; wider windows keep improving the playoff fit but pull
    // those two apart.
    var WINDOW = Number(opts.strengthWindow); if (opts.strengthWindow == null || !(WINDOW >= 0)) WINDOW = 8;
    var PRIOR_BOUND = 40;                                                 // |prior| limit
    var CAL_SEASONS = evenCount(opts.calibrationSeasons, 6000);           // seasons per calibration pass (even)
    var FRESH_SEASONS = evenCount(opts.priorSeasons, 2000);               // seasons per pass for the priors (even)
    var CAL_SEED = 0xB200C0DE;
    var DEFAULT_N = 10000, DEFAULT_SEED = 0x2026010A;

    var ready = false;
    var T = [], implied = [];      // public team rows; implied odds per team (0..1)
    var idx = {};                  // slug → index (rank order)
    var MEAN = 0, SD = 0, weeksPlayed = 0;
    var mu = new Float64Array(NT), teamMean = new Float64Array(NT);
    var actualWeeks = [];          // frozen game objects for the real weeks
    var bankW = new Int32Array(NT), bankL = new Int32Array(NT), bankT = new Int32Array(NT);
    var bankPF = new Int32Array(NT), bankPA = new Int32Array(NT);          // hundredths of a point
    var remWeek = [], remA = null, remB = null, G = 0;                     // remaining games, flat
    var constants = null, calibration = null, baselineCache = null;

    // per-season scratch (filled by runSeason)
    var sW = new Int32Array(NT), sL = new Int32Array(NT), sPF = new Int32Array(NT), sPA = new Int32Array(NT);
    var order = new Int32Array(NT), seedOf = new Int32Array(NT);
    var gSA = null, gSB = null;                                            // simulated regular-season scores
    var pA = new Int32Array(10), pB = new Int32Array(10), pSA = new Int32Array(10), pSB = new Int32Array(10);
    var pWin = new Int32Array(10), pLose = new Int32Array(10);
    // playoff slots: 0,1 wc · 2,3 semi · 4 final · 5 third · 6,7 consolation r1 · 8 seventh · 9 last
    var P_ROUND = ['wc', 'wc', 'semi', 'semi', 'final', 'third', 'r1', 'r1', 'seventh', 'last'];
    var P_WEEK = [15, 15, 16, 16, 17, 17, 15, 15, 16, 16];

    function cents(x) { return Math.round(x * 100); }
    function pts(c) { return c / 100; }

    // ---------- setup ----------
    function init() {
      if (ready) return;
      var B = dataArg || root.BROOKDALE || (typeof globalThis !== 'undefined' ? globalThis.BROOKDALE : null);
      if (!B || !B.teams || !B.season) throw new Error('SIM_ENGINE: BROOKDALE data not loaded');
      if (B.teams.length !== NT) throw new Error('SIM_ENGINE: expected ' + NT + ' teams');
      var S = B.season, i;
      if (!Array.isArray(S.weeks) || !Array.isArray(S.remaining)) throw new Error('SIM_ENGINE: season.weeks / season.remaining missing');
      if (!Array.isArray(B.oddsByRank)) throw new Error('SIM_ENGINE: oddsByRank missing');
      // ranks must be a permutation of 1..10, each with a full row of odds — otherwise NaN would leak into every result
      var seenRank = {};
      B.teams.forEach(function (t) {
        var o = t.oddsNow || B.oddsByRank[t.rank - 1];
        if (seenRank[t.rank] || !o) throw new Error('SIM_ENGINE: bad or duplicate rank for ' + t.slug);
        seenRank[t.rank] = true;
        ['playoff', 'finals', 'championship'].forEach(function (k) {
          var v = o[k] ? o[k].pct : null;
          if (v == null || v === '' || !isFinite(Number(v))) throw new Error('SIM_ENGINE: oddsByRank[' + (t.rank - 1) + '].' + k + '.pct is not a number');
        });
      });
      // start clean, so a first attempt that threw part-way cannot be counted twice
      idx = {};
      for (i = 0; i < NT; i++) { bankW[i] = bankL[i] = bankT[i] = bankPF[i] = bankPA[i] = 0; }
      weeksPlayed = S.weeks.length;
      WEEKS = S.weeks.length + S.remaining.length;
      B.teams.forEach(function (t, k) { idx[t.slug] = k; });

      // real weeks → frozen game objects, banked records, score sample
      var per = [], all = [];
      for (i = 0; i < NT; i++) per.push([]);
      actualWeeks = S.weeks.map(function (w) {
        return { week: w.week, played: true, games: w.games.map(function (g) {
          var a = g[0], b = g[3], sa = g[1], sb = g[4], ia = idx[a], ib = idx[b];
          if (ia == null || ib == null) throw new Error('SIM_ENGINE: unknown team in week ' + w.week);
          var ca = cents(sa), cb = cents(sb), tie = ca === cb;
          bankPF[ia] += ca; bankPA[ia] += cb; bankPF[ib] += cb; bankPA[ib] += ca;
          if (tie) { bankT[ia]++; bankT[ib]++; } else if (ca > cb) { bankW[ia]++; bankL[ib]++; } else { bankW[ib]++; bankL[ia]++; }
          per[ia].push(sa); per[ib].push(sb); all.push(sa, sb);
          return { week: w.week, a: a, b: b, sa: sa, sb: sb, winner: tie ? null : (ca > cb ? a : b), loser: tie ? null : (ca > cb ? b : a), tie: tie };
        }) };
      });

      // league mean and pooled within-team SD of the real scores
      var sum = 0; all.forEach(function (x) { sum += x; });
      MEAN = all.length ? Math.round(sum / all.length * 100) / 100 : NO_DATA_MEAN;
      var ss = 0, df = 0;
      per.forEach(function (a) {
        if (a.length < 2) return;
        var m = 0; a.forEach(function (x) { m += x; }); m /= a.length;
        a.forEach(function (x) { ss += (x - m) * (x - m); }); df += a.length - 1;
      });
      SD = df > 0 ? Math.round(Math.sqrt(ss / df) * 10) / 10 : 20;
      if (!(SD > 1)) SD = 20;

      // remaining schedule
      var ra = [], rb = [];
      remWeek = S.remaining.map(function (w) {
        var first = ra.length;
        w.games.forEach(function (g) {
          if (idx[g[0]] == null || idx[g[1]] == null) throw new Error('SIM_ENGINE: unknown team in week ' + w.week);
          ra.push(idx[g[0]]); rb.push(idx[g[1]]);
        });
        return { week: w.week, first: first, count: ra.length - first };
      });
      G = ra.length; remA = Int32Array.from(ra); remB = Int32Array.from(rb);
      gSA = new Int32Array(G); gSB = new Int32Array(G);

      calibrate(B);

      for (i = 0; i < NT; i++) teamMean[i] = MEAN + mu[i];
      constants = { mean: MEAN, sd: SD, weeks: WEEKS, weeksPlayed: weeksPlayed, playoffTeams: PLAYOFF_TEAMS, byes: BYES,
        minScore: MIN_SCORE, maxZ: Z_MAX, strengthWindow: WINDOW, calibrationSeasons: CAL_SEASONS, priorSeasons: FRESH_SEASONS, calibrationSeed: CAL_SEED,
        defaultN: DEFAULT_N, defaultSeed: DEFAULT_SEED };
      ready = true;
    }

    // ---------- calibration ----------
    // Playoff probability of every team for strengths m, over nS (even) seasons of the given games, starting from
    // the given banked records. Uses the fixed normal draws in z (common random numbers), so it is a deterministic
    // function of m. base2W = 2·wins + ties, basePF in points.
    var cW = new Float64Array(NT), cPF = new Float64Array(NT), cKey = new Float64Array(NT), cCnt = new Int32Array(NT), cOrd = new Int32Array(NT);
    function calSeason(m, ga, gb, n, base2W, basePF, z, k, sd) {   // one season; counts its six playoff teams
      var g, i, j, a, b, x, y, ki;
      for (i = 0; i < NT; i++) { cW[i] = base2W[i]; cPF[i] = basePF[i]; }
      for (g = 0; g < n; g++) {
        a = ga[g]; b = gb[g];
        x = m[a] + sd * z[k]; y = m[b] + sd * z[k + 1]; k += 2;
        if (x > y) cW[a] += 2; else cW[b] += 2;
        cPF[a] += x; cPF[b] += y;
      }
      for (i = 0; i < NT; i++) {                                      // insertion sort by (wins, PF), best first
        ki = cKey[i] = cW[i] * 1e7 + cPF[i]; j = i - 1;
        while (j >= 0 && cKey[cOrd[j]] < ki) { cOrd[j + 1] = cOrd[j]; j--; }
        cOrd[j + 1] = i;
      }
      for (i = 0; i < PLAYOFF_TEAMS; i++) cCnt[cOrd[i]]++;
    }
    function playoffProb(m, ga, gb, base2W, basePF, nS, z, out) {
      var n = ga.length, s, i;
      for (i = 0; i < NT; i++) cCnt[i] = 0;
      for (s = 0; s < nS; s += 2) {                                   // antithetic pairs (z, −z): each pair of seasons
        calSeason(m, ga, gb, n, base2W, basePF, z, s * n, SD);        // shares one block of 2·n draws (two per game),
        calSeason(m, ga, gb, n, base2W, basePF, z, s * n, -SD);       // so nS seasons read exactly nS·n draws
      }
      for (i = 0; i < NT; i++) out[i] = cCnt[i] / nS;
    }

    // Euclidean projection of m onto { sum = 0, lo ≤ m ≤ hi } (bisection on the common shift).
    function project(m, lo, hi) {
      var i, a = Infinity, b = -Infinity, s, mid, it, v;
      for (i = 0; i < NT; i++) { if (m[i] - hi[i] < a) a = m[i] - hi[i]; if (m[i] - lo[i] > b) b = m[i] - lo[i]; }
      for (it = 0; it < 60; it++) {
        mid = (a + b) / 2; s = 0;
        for (i = 0; i < NT; i++) { v = m[i] - mid; s += v < lo[i] ? lo[i] : (v > hi[i] ? hi[i] : v); }
        if (s > 0) a = mid; else b = mid;
      }
      mid = (a + b) / 2;
      for (i = 0; i < NT; i++) { v = m[i] - mid; m[i] = v < lo[i] ? lo[i] : (v > hi[i] ? hi[i] : v); }
    }

    // Damped fixed-point fit of strengths to playoff targets: m ← project(m + step·(target − p(m))).
    // At its fixed point every team that is not pinned at a bound misses its target by the same amount (zero when
    // nothing is pinned). Returns the iterate that is closest to that fixed point — measured by how far one more
    // step would move it, per unit of step — so it cannot diverge. (Ranking the iterates by total squared error
    // instead would let the unreachable targets of the pinned teams decide, and pick an unconverged one.)
    function fit(target, lo, hi, start, gain, maxIter, evalFn) {
      var m = new Float64Array(NT), prev = new Float64Array(NT), best = new Float64Array(NT), p = new Float64Array(NT), bestP = new Float64Array(NT);
      var bestGap = Infinity, bestErr = Infinity, i, it, err, d, step, moved, gap, used = 0;
      for (i = 0; i < NT; i++) m[i] = start[i];
      project(m, lo, hi);
      for (it = 0; it < maxIter; it++) {
        evalFn(m, p); used++;
        err = 0;
        for (i = 0; i < NT; i++) { d = p[i] - target[i]; err += d * d; }
        if (!(err >= 0)) break;                                   // NaN guard
        step = gain / (1 + it / 12);
        for (i = 0; i < NT; i++) { prev[i] = m[i]; m[i] += step * (target[i] - p[i]); }
        project(m, lo, hi);
        moved = 0;
        for (i = 0; i < NT; i++) { d = Math.abs(m[i] - prev[i]); if (d > moved) moved = d; }
        gap = moved / step;
        if (gap < bestGap) { bestGap = gap; bestErr = err; for (i = 0; i < NT; i++) { best[i] = prev[i]; bestP[i] = p[i]; } }
        if (moved < 0.02) break;
      }
      return { mu: best, p: bestP, err: bestErr, iterations: used };
    }

    // Everything the calibration depends on, as one string → two 32-bit FNV-1a hashes.
    function fingerprint(B) {
      var S = B.season, parts = [ALGO, WINDOW, CAL_SEASONS, FRESH_SEASONS, CAL_SEED, PRIOR_BOUND];
      B.teams.forEach(function (t) { parts.push(t.slug + ':' + t.rank); });
      B.oddsByRank.forEach(function (o) { parts.push(o.playoff.pct); });
      B.teams.forEach(function (t) { if (t.oddsNow) parts.push('now:' + t.slug + ':' + t.oddsNow.playoff.pct); });   // hand-set current odds
      S.weeks.forEach(function (w) { parts.push('w' + w.week); w.games.forEach(function (g) { parts.push(g[0], cents(g[1]), g[3], cents(g[4])); }); });
      S.remaining.forEach(function (w) { parts.push('r' + w.week); w.games.forEach(function (g) { parts.push(g[0], g[1]); }); });
      var str = parts.join('|'), h1 = 0x811C9DC5, h2 = 0x01234567, c, i;
      for (i = 0; i < str.length; i++) {
        c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ (c + i), 0x01000193);
      }
      return ('0000000' + (h1 >>> 0).toString(16)).slice(-8) + ('0000000' + (h2 >>> 0).toString(16)).slice(-8);
    }

    // Runs both fits. Returns the calibration record (the same shape as an entry of BAKED).
    function computeCalibration(B) {
      var S = B.season, i, k;
      var target = new Float64Array(NT);
      for (i = 0; i < NT; i++) target[i] = Math.min(0.99, Math.max(0.01, (B.teams[i].oddsNow || B.oddsByRank[B.teams[i].rank - 1]).playoff.pct / 100));

      // one fixed block of normal draws shared by both fits
      var fa = [], fb = [];
      S.weeks.forEach(function (w) { w.games.forEach(function (g) { fa.push(idx[g[0]]); fb.push(idx[g[3]]); }); });
      for (k = 0; k < G; k++) { fa.push(remA[k]); fb.push(remB[k]); }
      var need = Math.max(FRESH_SEASONS * fa.length, CAL_SEASONS * G);     // two draws per game, one block per antithetic pair
      var z = new Float64Array(need);
      rs = CAL_SEED | 0;
      for (k = 0; k < need; k += 2) { z[k] = gauss(); z[k + 1] = zSpare; }

      var zero = new Float64Array(NT), lo = new Float64Array(NT), hi = new Float64Array(NT);

      // 1. prior: fresh 14-week season on the real schedule, no banked results
      for (i = 0; i < NT; i++) { lo[i] = -PRIOR_BOUND; hi[i] = PRIOR_BOUND; }
      var fga = Int32Array.from(fa), fgb = Int32Array.from(fb);
      var pf = fit(target, lo, hi, zero, 22, 40, function (m, out) { playoffProb(m, fga, fgb, zero, zero, FRESH_SEASONS, z, out); });
      // a better rank slot is never the weaker one: pool adjacent violators over the rank slots (keeps the sum)
      var bySlot = [], prior = new Float64Array(NT);
      for (i = 0; i < NT; i++) bySlot[B.teams[i].rank - 1] = pf.mu[i];
      var blocks = [];
      for (i = 0; i < NT; i++) {
        blocks.push({ sum: bySlot[i], n: 1 });
        while (blocks.length > 1 && blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n > blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n) {
          var top = blocks.pop(); blocks[blocks.length - 1].sum += top.sum; blocks[blocks.length - 1].n += top.n;
        }
      }
      k = 0;
      blocks.forEach(function (bl) { for (var q = 0; q < bl.n; q++) bySlot[k++] = bl.sum / bl.n; });
      for (i = 0; i < NT; i++) prior[i] = bySlot[B.teams[i].rank - 1];

      // 2. strength: given the banked weeks, within ±WINDOW of the prior
      var base2W = new Float64Array(NT), basePF = new Float64Array(NT);
      for (i = 0; i < NT; i++) {
        base2W[i] = 2 * bankW[i] + bankT[i]; basePF[i] = bankPF[i] / 100;
        lo[i] = prior[i] - WINDOW; hi[i] = prior[i] + WINDOW;
      }
      var res = fit(target, lo, hi, prior, 32, 60, function (m, out) { playoffProb(m, remA, remB, base2W, basePF, CAL_SEASONS, z, out); });

      var rec = { prior: [], strength: [], achieved: [], iterations: res.iterations, priorIterations: pf.iterations, rmse: 0, maxAbs: 0 };
      var maxAbs = 0, ok = res.err >= 0 && res.err < Infinity;
      for (i = 0; i < NT; i++) {
        var v = ok ? res.mu[i] : prior[i];
        if (!(v === v) || !(prior[i] === prior[i])) { v = 0; prior[i] = 0; }   // never let a NaN through
        rec.prior.push(round(prior[i], 100)); rec.strength.push(round(v, 100)); rec.achieved.push(ok ? round(res.p[i], 10000) : 0);
        var d = Math.abs(res.p[i] - target[i]); if (d > maxAbs) maxAbs = d;
      }
      rec.rmse = ok ? round(Math.sqrt(res.err / NT), 100000) : 0; rec.maxAbs = ok ? round(maxAbs, 10000) : 0;
      return rec;
    }
    function round(x, q) { return Math.round(x * q) / q; }

    function calibrate(B) {
      var key = fingerprint(B);
      var baked = !opts.recalibrate && BAKED[key];
      var rec = baked || computeCalibration(B);
      T = B.teams.map(function (t, n) {
        var st = rec.strength[n], pr = rec.prior[n], lo = round(pr - WINDOW, 100), hi = round(pr + WINDOW, 100);
        mu[n] = st;
        return { slug: t.slug, name: t.name, code: t.code, rank: t.rank, strength: st, mean: round(MEAN + st, 100),
          prior: pr, lo: lo, hi: hi, clamped: st <= lo + 0.011 ? 'lo' : (st >= hi - 0.011 ? 'hi' : null),
          target: Number((t.oddsNow || B.oddsByRank[t.rank - 1]).playoff.pct) / 100, achieved: rec.achieved[n] };
      });
      implied = B.teams.map(function (t) {
        var o = t.oddsNow || B.oddsByRank[t.rank - 1];
        return { playoff: Number(o.playoff.pct) / 100, finals: Number(o.finals.pct) / 100, championship: Number(o.championship.pct) / 100 };
      });
      calibration = { key: key, baked: !!baked, iterations: rec.iterations, priorIterations: rec.priorIterations, rmse: rec.rmse, maxAbs: rec.maxAbs,
        record: { prior: rec.prior.slice(), strength: rec.strength.slice(), achieved: rec.achieved.slice(),
          iterations: rec.iterations, priorIterations: rec.priorIterations, rmse: rec.rmse, maxAbs: rec.maxAbs } };
    }

    // ---------- one season (lean core; fills the scratch buffers) ----------
    var gA = 0, gB = 0;   // scores (hundredths) of the game just played
    function playScores(a, b) {
      var za = gauss(), zb = zSpare;
      while (za > Z_MAX || za < -Z_MAX) za = gauss();                    // no freak scores: redraw beyond ±3 SD
      while (zb > Z_MAX || zb < -Z_MAX) zb = gauss();
      var x = teamMean[a] + SD * za, y = teamMean[b] + SD * zb;
      var ca = Math.round(x * 50) * 2, cb = Math.round(y * 50) * 2;      // real scores are multiples of 0.02
      if (ca < MIN_SCORE * 100) ca = MIN_SCORE * 100;
      if (cb < MIN_SCORE * 100) cb = MIN_SCORE * 100;
      if (ca === cb) { if (x >= y) ca += 2; else cb += 2; }             // no ties
      gA = ca; gB = cb;
    }
    function playSlot(slot, a, b) {       // a = better seed
      playScores(a, b);
      pA[slot] = a; pB[slot] = b; pSA[slot] = gA; pSB[slot] = gB;
      if (gA > gB) { pWin[slot] = a; pLose[slot] = b; } else { pWin[slot] = b; pLose[slot] = a; }
    }
    function better(i, j) {               // true when i ranks ahead of j
      var wi = 2 * sW[i] + bankT[i], wj = 2 * sW[j] + bankT[j];          // every team has played the same number of games
      if (wi !== wj) return wi > wj;
      if (sPF[i] !== sPF[j]) return sPF[i] > sPF[j];
      return i < j;
    }
    function runSeason(seed) {
      rs = seed | 0;
      var i, j, g, a, b, t;
      for (i = 0; i < NT; i++) { sW[i] = bankW[i]; sL[i] = bankL[i]; sPF[i] = bankPF[i]; sPA[i] = bankPA[i]; }
      for (g = 0; g < G; g++) {
        a = remA[g]; b = remB[g];
        playScores(a, b);
        gSA[g] = gA; gSB[g] = gB;
        sPF[a] += gA; sPA[a] += gB; sPF[b] += gB; sPA[b] += gA;
        if (gA > gB) { sW[a]++; sL[b]++; } else { sW[b]++; sL[a]++; }
      }
      for (i = 0; i < NT; i++) order[i] = i;
      for (i = 1; i < NT; i++) {           // insertion sort by (win%, PF)
        t = order[i]; j = i - 1;
        while (j >= 0 && better(t, order[j])) { order[j + 1] = order[j]; j--; }
        order[j + 1] = t;
      }
      for (i = 0; i < NT; i++) seedOf[order[i]] = i + 1;

      // week 15
      playSlot(0, order[2], order[5]);
      playSlot(1, order[3], order[4]);
      playSlot(6, order[6], order[9]);
      playSlot(7, order[7], order[8]);
      // week 16: seed 1 meets the lowest remaining seed
      var w0 = pWin[0], w1 = pWin[1], hiSeed = seedOf[w0] < seedOf[w1] ? w0 : w1, loSeed = hiSeed === w0 ? w1 : w0;
      playSlot(2, order[0], loSeed);
      playSlot(3, order[1], hiSeed);
      a = pWin[6]; b = pWin[7]; if (seedOf[a] > seedOf[b]) { t = a; a = b; b = t; }
      playSlot(8, a, b);
      a = pLose[6]; b = pLose[7]; if (seedOf[a] > seedOf[b]) { t = a; a = b; b = t; }
      playSlot(9, a, b);
      // week 17
      a = pWin[2]; b = pWin[3]; if (seedOf[a] > seedOf[b]) { t = a; a = b; b = t; }
      playSlot(4, a, b);
      a = pLose[2]; b = pLose[3]; if (seedOf[a] > seedOf[b]) { t = a; a = b; b = t; }
      playSlot(5, a, b);
    }

    // ---------- simulate(seed) ----------
    function slugOf(i) { return T[i].slug; }
    function playoffGame(slot) {
      return { week: P_WEEK[slot], round: P_ROUND[slot], a: slugOf(pA[slot]), b: slugOf(pB[slot]), sa: pts(pSA[slot]), sb: pts(pSB[slot]),
        winner: slugOf(pWin[slot]), loser: slugOf(pLose[slot]), tie: false, seedA: seedOf[pA[slot]], seedB: seedOf[pB[slot]] };
    }
    function randomSeed() { return Math.floor(Math.random() * TWO32) >>> 0; }
    function simulate(seed) {
      init();
      seed = (seed == null || seed !== seed) ? randomSeed() : (Number(seed) >>> 0);
      runSeason(seed);
      var weeks = actualWeeks.map(function (w) {
        return { week: w.week, played: true, games: w.games.map(function (g) {
          return { week: g.week, a: g.a, b: g.b, sa: g.sa, sb: g.sb, winner: g.winner, loser: g.loser, tie: g.tie };
        }) };
      });
      remWeek.forEach(function (rw) {
        var games = [];
        for (var g = rw.first; g < rw.first + rw.count; g++) {
          var a = slugOf(remA[g]), b = slugOf(remB[g]), aw = gSA[g] > gSB[g];
          games.push({ week: rw.week, a: a, b: b, sa: pts(gSA[g]), sb: pts(gSB[g]), winner: aw ? a : b, loser: aw ? b : a, tie: false });
        }
        weeks.push({ week: rw.week, played: false, games: games });
      });
      var standings = [];
      for (var k = 0; k < NT; k++) {
        var i = order[k];
        standings.push({ slug: slugOf(i), w: sW[i], l: sL[i], t: bankT[i], pf: pts(sPF[i]), pa: pts(sPA[i]), seed: k + 1 });
      }
      return {
        seed: seed, weeks: weeks, standings: standings,
        playoffs: { wc: [playoffGame(0), playoffGame(1)], semi: [playoffGame(2), playoffGame(3)], final: playoffGame(4), third: playoffGame(5) },
        consolation: { r1: [playoffGame(6), playoffGame(7)], seventh: playoffGame(8), last: playoffGame(9) },
        byes: [slugOf(order[0]), slugOf(order[1])],
        champion: slugOf(pWin[4]), runnerUp: slugOf(pLose[4]), third: slugOf(pWin[5]), seventh: slugOf(pWin[8]), lastPlace: slugOf(pLose[9])
      };
    }

    function standingsThrough(sim, week) {
      init();
      var rec = T.map(function (t, i) { return { slug: t.slug, w: 0, l: 0, t: 0, pf: 0, pa: 0, seed: 0, _i: i }; });
      sim.weeks.forEach(function (w) {
        if (w.week > week) return;
        w.games.forEach(function (g) {
          var A = rec[idx[g.a]], B2 = rec[idx[g.b]], ca = cents(g.sa), cb = cents(g.sb);
          A.pf += ca; A.pa += cb; B2.pf += cb; B2.pa += ca;
          if (g.tie) { A.t++; B2.t++; } else if (g.winner === g.a) { A.w++; B2.l++; } else { B2.w++; A.l++; }
        });
      });
      var pct = function (r) { var n = r.w + r.l + r.t; return n ? (r.w + 0.5 * r.t) / n : 0; };
      rec.sort(function (x, y) { return pct(y) - pct(x) || y.pf - x.pf || x._i - y._i; });
      rec.forEach(function (r, k) { r.seed = k + 1; r.pf = pts(r.pf); r.pa = pts(r.pa); delete r._i; });
      return rec;
    }

    // ---------- Monte Carlo ----------
    function createRun(seed0) {
      init();
      seed0 = seed0 == null ? DEFAULT_SEED : (Number(seed0) >>> 0);
      var master = seed0 | 0, n = 0;
      var playoff = new Int32Array(NT), bye = new Int32Array(NT), one = new Int32Array(NT), finals = new Int32Array(NT);
      var champ = new Int32Array(NT), runner = new Int32Array(NT), third = new Int32Array(NT), last = new Int32Array(NT);
      var seedCnt = new Int32Array(NT * NT), winCnt = new Int32Array(NT * (WEEKS + 1));
      var sumW = new Float64Array(NT), sumSeed = new Float64Array(NT), sumPF = new Float64Array(NT);
      var run = {
        n: 0,
        add: function (k) {
          var c, i, s, seed;
          k = Math.floor(Number(k)); if (!(k > 0)) return run;                // whole seasons only
          for (c = 0; c < k; c++) {
            rs = master; seed = Math.floor(rnd() * TWO32); master = rs;       // next season seed from the master stream
            runSeason(seed);
            for (i = 0; i < NT; i++) {
              s = seedOf[i];
              if (s <= PLAYOFF_TEAMS) playoff[i]++;
              if (s <= BYES) bye[i]++;
              if (s === 1) one[i]++;
              seedCnt[i * NT + s - 1]++; winCnt[i * (WEEKS + 1) + sW[i]]++;
              sumW[i] += sW[i]; sumSeed[i] += s; sumPF[i] += sPF[i];
            }
            champ[pWin[4]]++; runner[pLose[4]]++; finals[pWin[4]]++; finals[pLose[4]]++; third[pWin[5]]++; last[pLose[9]]++;
          }
          n += k; run.n = n;
          return run;
        },
        result: function () {
          var d = n || 1, bySlug = {};
          var teams = T.map(function (t, i) {
            var sd = [], wd = [], k;
            for (k = 0; k < NT; k++) sd.push(seedCnt[i * NT + k] / d);
            for (k = 0; k <= WEEKS; k++) wd.push(winCnt[i * (WEEKS + 1) + k] / d);
            var im = implied[i];
            var row = { slug: t.slug, name: t.name, code: t.code, rank: t.rank, target: t.target,
              implied: { playoff: im.playoff, finals: im.finals, championship: im.championship },
              playoff: playoff[i] / d, bye: bye[i] / d, oneSeed: one[i] / d, finals: finals[i] / d, champion: champ[i] / d,
              runnerUp: runner[i] / d, third: third[i] / d, lastPlace: last[i] / d,
              avgWins: sumW[i] / d, avgSeed: sumSeed[i] / d, avgPf: sumPF[i] / d / 100, seedDist: sd, winsDist: wd };
            bySlug[t.slug] = row;
            return row;
          });
          return { n: n, seed: seed0, teams: teams, bySlug: bySlug };
        }
      };
      return run;
    }
    function monteCarlo(n, seed0) { return createRun(seed0).add(n).result(); }

    // Everything handed out is a copy: a caller that sorts or edits what it got cannot change the engine or what
    // the next caller sees. (T, constants, calibration and baselineCache themselves never leave this closure.)
    function copyFlat(o) { var c = {}, k; for (k in o) c[k] = o[k]; return c; }
    function copyResult(r) {
      var bySlug = {};
      var teams = r.teams.map(function (row) {
        var c = copyFlat(row);
        c.implied = copyFlat(row.implied); c.seedDist = row.seedDist.slice(); c.winsDist = row.winsDist.slice();
        bySlug[c.slug] = c;
        return c;
      });
      return { n: r.n, seed: r.seed, teams: teams, bySlug: bySlug };
    }
    function baseline() { init(); if (!baselineCache) baselineCache = monteCarlo(DEFAULT_N, DEFAULT_SEED); return copyResult(baselineCache); }

    var api = { simulate: simulate, standingsThrough: standingsThrough, monteCarlo: monteCarlo, createRun: createRun,
      baseline: baseline, randomSeed: randomSeed, create: create };
    Object.defineProperty(api, 'teams', { enumerable: true, get: function () { init(); return T.map(copyFlat); } });
    Object.defineProperty(api, 'constants', { enumerable: true, get: function () { init(); return copyFlat(constants); } });
    Object.defineProperty(api, 'calibration', { enumerable: true, get: function () {
      init();
      var c = copyFlat(calibration), r = copyFlat(calibration.record);
      r.prior = r.prior.slice(); r.strength = r.strength.slice(); r.achieved = r.achieved.slice();
      c.record = r;
      return c;
    } });
    return api;
  }

  var engine = create(null);
  root.SIM_ENGINE = engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
})(typeof window !== 'undefined' ? window : globalThis);
