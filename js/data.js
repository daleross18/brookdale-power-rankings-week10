// ============================================================================
//  BROOKDALE LEAGUE — 2026 WEEK 10 POWER RANKINGS — DATA
//
//  teams[]            week-10 power rankings, in rank order. `tagline` is the headline under the name.
//                     `pre` = where the team stood in the preseason rankings (name, rank, odds).
//  oddsByRank[]       the preseason odds table by rank slot. A team's current implied odds are the odds of the
//                     slot it holds now; the change is measured against its own preseason slot (`pre`).
//                     A team may carry `oddsNow` (same shape as a row of the table) to set its current odds by hand.
//  season.standings   Yahoo standings through week 9.
//  season.weeks       every matchup, weeks 1-9: [slugA, pointsA, projectedA, slugB, pointsB, projectedB].
//  season.remaining   weeks 10-14 pairings from Yahoo's schedule (+ Yahoo's projections).
//  season.rosters   current rosters (week 10); season.preseasonRosters = draft-day rosters.
//  season.positionPoints   optional; see the note at the bottom of this file.
//  Write-ups live in writeups.js (keyed by slug). All-time history lives in history.js (keyed by historyKey).
// ============================================================================

window.BROOKDALE = {
  league: "The Brookdale League",
  leagueId: "341380",
  // `headline` is the banner across the top of the cutscene and of the rankings page.
  edition: { season: 2026, week: 10, date: "2026-11-11", title: "Week 10 Power Rankings", headline: "WEEK 10: RIVALRY WEEK" },

  teams: [
    { rank: 1,  slug: "dhhate",               code: "TTT", name: "Tre Tucker Time",      manager: "Oliver", historyKey: "Oliver",
      tagline: "SEASONS OVER",
      profile: "img/dhhate-profile.jpg", meme: "img/dhhate-meme.jpg",
      pre: { rank: 8, name: "DHhate" },
      oddsNow: { projectedRecord: "10-4", playoff: { pct: 90, odds: "-900" }, finals: { pct: 40, odds: "+150" }, championship: { pct: 24, odds: "+315" } } },
    { rank: 2,  slug: "hammertime",           code: "HAM", name: "HammerTime",           manager: "Caleb",  historyKey: "Caleb",
      tagline: "BEST OF THE REST",
      profile: "img/hammertime-profile.jpg", meme: "img/hammertime-meme.jpg",
      pre: { rank: 2, name: "HammerTime" } },
    { rank: 3,  slug: "hoes-mad",             code: "HOE", name: "Hoes Mad",             manager: "Alex",   historyKey: "Alex",
      tagline: "SINK OR SWIM",
      profile: "img/hoes-mad-profile.jpg", meme: "img/hoes-mad-meme.jpg",
      pre: { rank: 1, name: "Hoes Mad" } },
    { rank: 4,  slug: "saxwillruintheleague", code: "SAX", name: "SaxWillRuinTheLeague", manager: "Dale",   historyKey: "Dale",
      tagline: "CAN HE SURVIVE UNTIL WEEK 12",
      profile: "img/saxwillruintheleague-profile.jpg", meme: "img/saxwillruintheleague-meme.jpg",
      pre: { rank: 4, name: "SaxWillRuinTheLeague" } },
    { rank: 5,  slug: "hogwash",              code: "HOG", name: "Hogwash",              manager: "Belsky", historyKey: "Belsky",
      tagline: "TREADING WATER",
      profile: "img/hogwash-profile.jpg", meme: "img/hogwash-meme.jpg",
      pre: { rank: 10, name: "Hogwash" } },
    { rank: 6,  slug: "schkattebooboo",       code: "GAV", name: "GAVESUX",              manager: "Ben",    historyKey: "Ben",
      tagline: "LOW SKILL AND GOOD VARIANCE",
      profile: "img/schkattebooboo-profile.jpg", meme: "img/schkattebooboo-meme.jpg",
      pre: { rank: 6, name: "Schkattebooboo" } },
    { rank: 7,  slug: "mac-and-movies",       code: "MAC", name: "Mac and Movies",       manager: "Ethan",  historyKey: "Ethan",
      tagline: "GOING DOWN WITH THE SHIP",
      profile: "img/mac-and-movies-profile.jpg", meme: "img/mac-and-movies-meme.jpg",
      pre: { rank: 9, name: "Mac and Movies" } },
    { rank: 8,  slug: "mr-glass-reborn",      code: "DOC", name: "Fantasy Doc",          manager: "Gabe",   historyKey: "Gabe",
      tagline: "HIGH SKILL AND BAD VARIANCE",
      profile: "img/mr-glass-reborn-profile.jpg", meme: "img/mr-glass-reborn-meme.jpg",
      pre: { rank: 3, name: "Mr. Glass Reborn" } },
    { rank: 9,  slug: "eyes-wide-shut",       code: "EWS", name: "Eyes Wide Shut",       manager: "Sam",    historyKey: "Van",
      tagline: "COMING BACK FROM CANCUN",
      profile: "img/eyes-wide-shut-profile.jpg", meme: "img/eyes-wide-shut-meme.jpg",
      pre: { rank: 7, name: "Eyes Wide Shut" } },
    { rank: 10, slug: "killer-whales",        code: "KW",  name: "Killer Whales",        manager: "Chris",  historyKey: "Chris",
      tagline: "NOTHING TO DO AT THIS POINT",
      profile: "img/killer-whales-profile.jpg", meme: "img/killer-whales-meme.jpg",
      pre: { rank: 5, name: "Killer Whales" } }
  ],

  // Preseason odds by rank slot (index 0 = rank 1).
  oddsByRank: [
    { projectedRecord: "10-4",   playoff: { pct: 80, odds: "-400" }, finals: { pct: 34, odds: "+190" },  championship: { pct: 19, odds: "+425" } },
    { projectedRecord: "9-5",    playoff: { pct: 76, odds: "-315" }, finals: { pct: 30, odds: "+230" },  championship: { pct: 16, odds: "+525" } },
    { projectedRecord: "9-5",    playoff: { pct: 75, odds: "-300" }, finals: { pct: 29, odds: "+245" },  championship: { pct: 15, odds: "+565" } },
    { projectedRecord: "8-6",    playoff: { pct: 69, odds: "-225" }, finals: { pct: 24, odds: "+315" },  championship: { pct: 12, odds: "+735" } },
    { projectedRecord: "8-6",    playoff: { pct: 68, odds: "-210" }, finals: { pct: 23, odds: "+335" },  championship: { pct: 11, odds: "+800" } },
    { projectedRecord: "7-7",    playoff: { pct: 60, odds: "-150" }, finals: { pct: 18, odds: "+455" },  championship: { pct: 8,  odds: "+1150" } },
    { projectedRecord: "7-7",    playoff: { pct: 58, odds: "-140" }, finals: { pct: 17, odds: "+490" },  championship: { pct: 8,  odds: "+1150" } },
    { projectedRecord: "5-9",    playoff: { pct: 45, odds: "+120" }, finals: { pct: 11, odds: "+810" },  championship: { pct: 5,  odds: "+1900" } },
    { projectedRecord: "5-9",    playoff: { pct: 44, odds: "+125" }, finals: { pct: 10, odds: "+900" },  championship: { pct: 4,  odds: "+2400" } },
    { projectedRecord: "2-11-1", playoff: { pct: 25, odds: "+300" }, finals: { pct: 4,  odds: "+2400" }, championship: { pct: 2,  odds: "+4900" } }
  ],

  season: {
    year: 2026,
    weeksPlayed: 9,
    regularSeasonWeeks: 14,
    playoffTeams: 6,

    // Yahoo standings through week 9 (order = Yahoo rank: win%, then points for).
    standings: [
      { slug: "dhhate",               w: 7, l: 2, t: 0, pf: 1205.52, pa: 1033.08, streak: "W-1", waiver: 10, moves: 9 },
      { slug: "hammertime",           w: 6, l: 3, t: 0, pf: 1046.96, pa: 992.64,  streak: "W-2", waiver: 3,  moves: 23 },
      { slug: "hoes-mad",             w: 5, l: 4, t: 0, pf: 1007.80, pa: 958.62,  streak: "W-1", waiver: 2,  moves: 14 },
      { slug: "saxwillruintheleague", w: 5, l: 4, t: 0, pf: 986.04,  pa: 1037.30, streak: "W-1", waiver: 9,  moves: 37 },
      { slug: "hogwash",              w: 5, l: 4, t: 0, pf: 980.30,  pa: 944.34,  streak: "L-1", waiver: 8,  moves: 30 },
      { slug: "schkattebooboo",       w: 4, l: 5, t: 0, pf: 1017.92, pa: 996.86,  streak: "L-1", waiver: 1,  moves: 27 },
      { slug: "mr-glass-reborn",      w: 4, l: 5, t: 0, pf: 978.66,  pa: 1015.88, streak: "L-1", waiver: 7,  moves: 28 },
      { slug: "mac-and-movies",       w: 3, l: 6, t: 0, pf: 967.62,  pa: 985.84,  streak: "L-3", waiver: 6,  moves: 16 },
      { slug: "killer-whales",        w: 3, l: 6, t: 0, pf: 937.26,  pa: 1088.50, streak: "L-2", waiver: 5,  moves: 24 },
      { slug: "eyes-wide-shut",       w: 3, l: 6, t: 0, pf: 937.14,  pa: 1012.16, streak: "W-2", waiver: 4,  moves: 19 }
    ],

    // [slugA, pointsA, projectedA, slugB, pointsB, projectedB] — final results, in Yahoo's listing order.
    weeks: [
      { week: 1, games: [
        ["saxwillruintheleague", 123.26, 111.34, "mac-and-movies",  119.44, 109.39],
        ["hammertime",           138.32, 114.32, "hoes-mad",         75.22,  97.86],
        ["hogwash",              132.06,  99.65, "eyes-wide-shut",  125.20, 106.35],
        ["killer-whales",         94.76, 109.86, "dhhate",          155.16, 110.28],
        ["schkattebooboo",       103.56, 108.12, "mr-glass-reborn", 108.16, 110.93] ] },
      { week: 2, games: [
        ["saxwillruintheleague",  88.94, 113.56, "hogwash",          79.30, 101.40],
        ["hammertime",           103.16, 112.17, "eyes-wide-shut",   87.16, 106.60],
        ["mac-and-movies",       121.08, 102.50, "dhhate",          135.48, 111.82],
        ["hoes-mad",             130.18, 110.04, "mr-glass-reborn",  87.00, 106.68],
        ["killer-whales",        109.82, 115.70, "schkattebooboo",   87.52,  92.53] ] },
      { week: 3, games: [
        ["saxwillruintheleague", 144.08, 116.75, "hammertime",       95.52, 110.52],
        ["mac-and-movies",        90.16, 102.93, "schkattebooboo",  108.24, 107.94],
        ["hogwash",              101.64, 107.48, "dhhate",          130.04, 112.99],
        ["eyes-wide-shut",        88.74, 108.45, "hoes-mad",        136.88, 110.76],
        ["killer-whales",        104.66, 109.65, "mr-glass-reborn",  82.00,  92.08] ] },
      { week: 4, games: [
        ["saxwillruintheleague", 106.06, 120.88, "eyes-wide-shut",   96.00, 101.39],
        ["hammertime",           146.98, 116.06, "dhhate",          106.62, 118.26],
        ["mac-and-movies",       126.08, 112.76, "mr-glass-reborn", 121.44, 114.32],
        ["hogwash",              106.88, 108.07, "schkattebooboo",  108.40, 117.12],
        ["hoes-mad",             146.12, 115.19, "killer-whales",   102.22, 110.48] ] },
      { week: 5, games: [
        ["saxwillruintheleague", 120.56, 115.60, "hoes-mad",        127.56, 116.49],
        ["hammertime",           153.84, 111.62, "schkattebooboo",  153.06, 121.86],
        ["mac-and-movies",       141.94, 113.70, "killer-whales",   105.80, 112.62],
        ["hogwash",              131.32, 110.62, "mr-glass-reborn",  81.54, 108.24],
        ["eyes-wide-shut",       126.44, 107.63, "dhhate",          151.90, 113.97] ] },
      { week: 6, games: [
        ["saxwillruintheleague",  89.00,  79.27, "dhhate",          131.32, 121.16],
        ["hammertime",            95.20, 109.35, "mr-glass-reborn", 122.66, 106.13],
        ["mac-and-movies",        97.54,  99.17, "hoes-mad",         59.76, 110.55],
        ["hogwash",              131.78, 116.61, "killer-whales",    82.84, 114.74],
        ["eyes-wide-shut",        91.02, 114.71, "schkattebooboo",   75.28, 112.00] ] },
      { week: 7, games: [
        ["saxwillruintheleague",  91.92, 118.00, "schkattebooboo",  143.52, 114.82],
        ["hammertime",            82.52, 104.96, "killer-whales",   146.40, 114.73],
        ["mac-and-movies",       109.06, 109.13, "hogwash",         114.40, 112.32],
        ["eyes-wide-shut",        86.28, 114.46, "mr-glass-reborn", 124.92, 104.88],
        ["hoes-mad",             115.84, 118.71, "dhhate",          120.28, 122.79] ] },
      { week: 8, games: [
        ["saxwillruintheleague",  89.06, 111.02, "mr-glass-reborn", 148.78, 107.90],
        ["hammertime",           109.46, 122.59, "mac-and-movies",   75.32, 109.66],
        ["hogwash",              100.80,  80.74, "hoes-mad",         96.36, 109.01],
        ["eyes-wide-shut",       128.30, 118.33, "killer-whales",    94.90, 115.29],
        ["schkattebooboo",       135.18, 116.42, "dhhate",          125.18, 121.08] ] },
      { week: 9, games: [
        ["saxwillruintheleague", 133.16, 113.21, "killer-whales",    95.86, 112.27],
        ["hammertime",           121.96, 110.12, "hogwash",          82.12, 105.18],
        ["mac-and-movies",        87.00, 115.84, "eyes-wide-shut",  108.00, 109.43],
        ["hoes-mad",             119.88, 121.05, "schkattebooboo",  103.16, 116.34],
        ["mr-glass-reborn",      102.16, 105.39, "dhhate",          149.54, 121.96] ] }
    ],

    // Weeks 10-14, from Yahoo's schedule. games = [slugA, slugB]; proj = Yahoo's projection for each side as of Nov 11.
    remaining: [
      { week: 10, games: [["saxwillruintheleague", "mac-and-movies"], ["hammertime", "hoes-mad"], ["hogwash", "eyes-wide-shut"], ["killer-whales", "dhhate"], ["schkattebooboo", "mr-glass-reborn"]],
        proj: [[110.52, 117.84], [119.35, 118.15], [105.21, 105.88], [112.95, 121.22], [105.96, 107.65]] },
      { week: 11, games: [["saxwillruintheleague", "hogwash"], ["hammertime", "eyes-wide-shut"], ["mac-and-movies", "dhhate"], ["hoes-mad", "mr-glass-reborn"], ["killer-whales", "schkattebooboo"]],
        proj: [[83.92, 74.14], [107.10, 66.99], [99.15, 93.52], [66.94, 92.32], [80.78, 88.06]] },
      { week: 12, games: [["saxwillruintheleague", "eyes-wide-shut"], ["hammertime", "dhhate"], ["mac-and-movies", "mr-glass-reborn"], ["hogwash", "schkattebooboo"], ["hoes-mad", "killer-whales"]],
        proj: [[116.13, 96.45], [117.01, 116.44], [114.43, 114.77], [100.71, 105.01], [112.89, 108.40]] },
      { week: 13, games: [["saxwillruintheleague", "dhhate"], ["hammertime", "mr-glass-reborn"], ["mac-and-movies", "hoes-mad"], ["hogwash", "killer-whales"], ["eyes-wide-shut", "schkattebooboo"]],
        proj: [[96.94, 102.38], [101.73, 110.64], [98.71, 108.10], [75.88, 80.17], [85.96, 100.36]] },
      { week: 14, games: [["saxwillruintheleague", "mr-glass-reborn"], ["hammertime", "mac-and-movies"], ["hogwash", "hoes-mad"], ["eyes-wide-shut", "killer-whales"], ["schkattebooboo", "dhhate"]],
        proj: [[114.10, 108.65], [114.40, 103.92], [101.35, 90.07], [83.22, 82.15], [89.30, 112.01]] }
    ],

    // Optional. Fill in to enable the "by position" breakdown on the team-page points chart:
    //   positionPoints: { "<slug>": [ { QB: 21.4, RB: 38.2, WR: 30.1, TE: 9.0, "W/R/T": 12.3, K: 8, DEF: 6 }, ...one object per week ] }
    positionPoints: null,

    // Current rosters (Yahoo "Starting Rosters", week 10). slot = lineup slot (BN = bench), pos = the player's position.
    // status: Q questionable, D doubtful, O out, IR / IR-R injured reserve. bye: true = on bye in week 10.
    rosters: {
      "dhhate": {
        starters: [
          { slot: "QB", pos: "QB", name: "Joe Burrow", team: "Cin" },
          { slot: "RB", pos: "RB", name: "Kenneth Walker III", team: "KC" },
          { slot: "RB", pos: "RB", name: "Rico Dowdle", team: "Pit" },
          { slot: "WR", pos: "WR", name: "Jaxon Smith-Njigba", team: "Sea" },
          { slot: "WR", pos: "WR", name: "Garrett Wilson", team: "NYJ", status: "Q" },
          { slot: "TE", pos: "TE", name: "Isaiah Likely", team: "NYG" },
          { slot: "W/R/T", pos: "WR", name: "Chris Olave", team: "NO" },
          { slot: "K", pos: "K", name: "Jake Bates", team: "Det" },
          { slot: "DEF", pos: "DEF", name: "Packers", team: "GB" }
        ],
        bench: [
          { slot: "BN", pos: "WR", name: "Tre Tucker", team: "LV" },
          { slot: "BN", pos: "RB", name: "Bucky Irving", team: "TB", bye: true },
          { slot: "BN", pos: "TE", name: "Travis Kelce", team: "KC" },
          { slot: "BN", pos: "QB", name: "Kirk Cousins", team: "Min" },
          { slot: "BN", pos: "RB", name: "David Montgomery", team: "Hou", status: "Q" },
          { slot: "BN", pos: "RB", name: "Seth McGowan", team: "Ind" }
        ]
      },
      "hammertime": {
        starters: [
          { slot: "QB", pos: "QB", name: "Josh Allen", team: "Buf" },
          { slot: "RB", pos: "RB", name: "James Cook III", team: "Buf" },
          { slot: "RB", pos: "RB", name: "Blake Corum", team: "LAR" },
          { slot: "WR", pos: "WR", name: "Ja'Marr Chase", team: "Cin" },
          { slot: "WR", pos: "WR", name: "Justin Jefferson", team: "Min" },
          { slot: "TE", pos: "TE", name: "Tyler Warren", team: "Ind" },
          { slot: "W/R/T", pos: "WR", name: "Tetairoa McMillan", team: "Car" },
          { slot: "K", pos: "K", name: "Tyler Bass", team: "Buf" },
          { slot: "DEF", pos: "DEF", name: "Browns", team: "Cle" }
        ],
        bench: [
          { slot: "BN", pos: "TE", name: "Harold Fannin Jr.", team: "Cle", status: "Q" },
          { slot: "BN", pos: "RB", name: "Ashton Jeanty", team: "LV" },
          { slot: "BN", pos: "QB", name: "Bryce Young", team: "Car" },
          { slot: "BN", pos: "RB", name: "Mike Washington Jr.", team: "LV" },
          { slot: "BN", pos: "K", name: "Chris Boswell", team: "Pit" },
          { slot: "BN", pos: "DEF", name: "Buccaneers", team: "TB", bye: true }
        ]
      },
      "hoes-mad": {
        starters: [
          { slot: "QB", pos: "QB", name: "Drake Maye", team: "NE" },
          { slot: "RB", pos: "RB", name: "Bijan Robinson", team: "Atl" },
          { slot: "RB", pos: "RB", name: "Cam Skattebo", team: "NYG" },
          { slot: "WR", pos: "WR", name: "CeeDee Lamb", team: "Dal" },
          { slot: "WR", pos: "WR", name: "A.J. Brown", team: "NE", status: "Q" },
          { slot: "TE", pos: "TE", name: "Sam LaPorta", team: "Det" },
          { slot: "W/R/T", pos: "RB", name: "Woody Marks", team: "Hou", status: "Q" },
          { slot: "K", pos: "K", name: "Will Reichard", team: "Min" },
          { slot: "DEF", pos: "DEF", name: "Texans", team: "Hou" }
        ],
        bench: [
          { slot: "BN", pos: "QB", name: "Brock Purdy", team: "SF" },
          { slot: "BN", pos: "RB", name: "Tyler Allgeier", team: "Ari" },
          { slot: "BN", pos: "WR", name: "Jaylen Waddle", team: "Den", status: "Q", bye: true },
          { slot: "BN", pos: "WR", name: "Jordan Addison", team: "Min" },
          { slot: "BN", pos: "WR", name: "Marvin Harrison Jr.", team: "Hou", status: "Q" },
          { slot: "BN", pos: "RB", name: "Khalil Herbert", team: "Atl" }
        ]
      },
      "saxwillruintheleague": {
        starters: [
          { slot: "QB", pos: "QB", name: "C.J. Stroud", team: "Hou" },
          { slot: "RB", pos: "RB", name: "Jahmyr Gibbs", team: "Det" },
          { slot: "RB", pos: "RB", name: "Jonathan Taylor", team: "Ind" },
          { slot: "WR", pos: "WR", name: "Stefon Diggs", team: "Was" },
          { slot: "WR", pos: "WR", name: "Christian Watson", team: "GB" },
          { slot: "TE", pos: "TE", name: "Kyle Pitts Sr.", team: "Atl" },
          { slot: "W/R/T", pos: "WR", name: "Denzel Boston", team: "Cle", status: "Q" },
          { slot: "K", pos: "K", name: "Evan McPherson", team: "Cin" },
          { slot: "DEF", pos: "DEF", name: "Jaguars", team: "Jax" }
        ],
        bench: [
          { slot: "BN", pos: "TE", name: "Dallas Goedert", team: "Phi", bye: true },
          { slot: "BN", pos: "WR", name: "DeVonta Smith", team: "Phi", status: "O", bye: true },
          { slot: "BN", pos: "RB", name: "Jeremiyah Love", team: "Ari", status: "IR" },
          { slot: "BN", pos: "WR", name: "Davante Adams", team: "LAR", status: "IR" },
          { slot: "BN", pos: "RB", name: "Audric Estime", team: "NO" },
          { slot: "BN", pos: "QB", name: "Geno Smith", team: "NYJ" }
        ]
      },
      "hogwash": {
        starters: [
          { slot: "QB", pos: "QB", name: "Matthew Stafford", team: "LAR" },
          { slot: "RB", pos: "RB", name: "Christian McCaffrey", team: "SF" },
          { slot: "RB", pos: "RB", name: "Jordan Mason", team: "Min" },
          { slot: "WR", pos: "WR", name: "Malik Nabers", team: "NYG" },
          { slot: "WR", pos: "WR", name: "Carnell Tate", team: "Ten", status: "Q" },
          { slot: "TE", pos: "TE", name: "Brock Bowers", team: "LV" },
          { slot: "W/R/T", pos: "WR", name: "KC Concepcion Jr.", team: "Cle" },
          { slot: "K", pos: "K", name: "Matt Gay", team: "LV" },
          { slot: "DEF", pos: "DEF", name: "Ravens", team: "Bal" }
        ],
        bench: [
          { slot: "BN", pos: "WR", name: "Deebo Samuel Sr.", team: "SF", status: "Q" },
          { slot: "BN", pos: "RB", name: "Josh Jacobs", team: "GB", status: "O" },
          { slot: "BN", pos: "RB", name: "D'Andre Swift", team: "Chi", bye: true },
          { slot: "BN", pos: "QB", name: "Lamar Jackson", team: "Bal", status: "IR" },
          { slot: "BN", pos: "RB", name: "Kaelon Black", team: "SF" },
          { slot: "BN", pos: "QB", name: "Bo Nix", team: "Den", bye: true }
        ]
      },
      "schkattebooboo": {
        starters: [
          { slot: "QB", pos: "QB", name: "Patrick Mahomes", team: "KC" },
          { slot: "RB", pos: "RB", name: "Quinshon Judkins", team: "Cle" },
          { slot: "RB", pos: "RB", name: "Jaylen Warren", team: "Pit" },
          { slot: "WR", pos: "WR", name: "Tee Higgins", team: "Cin" },
          { slot: "WR", pos: "WR", name: "DK Metcalf", team: "Pit" },
          { slot: "TE", pos: "TE", name: "Trey McBride", team: "Ari" },
          { slot: "W/R/T", pos: "WR", name: "Rashee Rice", team: "KC" },
          { slot: "K", pos: "K", name: "Jason Myers", team: "Sea" },
          { slot: "DEF", pos: "DEF", name: "Chiefs", team: "KC" }
        ],
        bench: [
          { slot: "BN", pos: "WR", name: "Puka Nacua", team: "LAR", status: "O" },
          { slot: "BN", pos: "RB", name: "Alvin Kamara", team: "NO", status: "Q" },
          { slot: "BN", pos: "QB", name: "Caleb Williams", team: "Chi", bye: true },
          { slot: "BN", pos: "RB", name: "Omarion Hampton", team: "LAC" },
          { slot: "BN", pos: "RB", name: "Emmett Johnson", team: "KC" },
          { slot: "BN", pos: "WR", name: "Rome Odunze", team: "Chi", bye: true }
        ]
      },
      "mac-and-movies": {
        starters: [
          { slot: "QB", pos: "QB", name: "Jared Goff", team: "Det", status: "Q" },
          { slot: "RB", pos: "RB", name: "Ollie Gordon II", team: "Mia" },
          { slot: "RB", pos: "RB", name: "Chase Brown", team: "Cin" },
          { slot: "WR", pos: "WR", name: "Amon-Ra St. Brown", team: "Det", status: "Q" },
          { slot: "WR", pos: "WR", name: "Parker Washington", team: "Jax" },
          { slot: "TE", pos: "TE", name: "George Kittle", team: "SF" },
          { slot: "W/R/T", pos: "WR", name: "George Pickens", team: "Dal", status: "Q" },
          { slot: "K", pos: "K", name: "Spencer Shrader", team: "Ind" },
          { slot: "DEF", pos: "DEF", name: "Seahawks", team: "Sea" }
        ],
        bench: [
          { slot: "BN", pos: "WR", name: "Ryan Flournoy", team: "Dal" },
          { slot: "BN", pos: "RB", name: "Rachaad White", team: "Was" },
          { slot: "BN", pos: "RB", name: "Travis Etienne Jr.", team: "NO", status: "IR-R" },
          { slot: "BN", pos: "QB", name: "Jordan Love", team: "GB" },
          { slot: "BN", pos: "RB", name: "Kyle Monangai", team: "Chi", status: "O", bye: true },
          { slot: "BN", pos: "WR", name: "Keenan Allen", team: "SF" }
        ]
      },
      "mr-glass-reborn": {
        starters: [
          { slot: "QB", pos: "QB", name: "Tyler Shough", team: "NO" },
          { slot: "RB", pos: "RB", name: "Bhayshul Tuten", team: "Jax", status: "Q" },
          { slot: "RB", pos: "RB", name: "Kyren Williams", team: "LAR" },
          { slot: "WR", pos: "WR", name: "DJ Moore", team: "Buf" },
          { slot: "WR", pos: "WR", name: "Nico Collins", team: "Hou" },
          { slot: "TE", pos: "TE", name: "T.J. Hockenson", team: "Min", status: "Q" },
          { slot: "W/R/T", pos: "RB", name: "Tony Pollard", team: "Ten" },
          { slot: "K", pos: "K", name: "Ka'imi Fairbairn", team: "Hou" },
          { slot: "DEF", pos: "DEF", name: "Vikings", team: "Min" }
        ],
        bench: [
          { slot: "BN", pos: "TE", name: "Dalton Kincaid", team: "Buf", status: "Q" },
          { slot: "BN", pos: "QB", name: "Jayden Daniels", team: "Was" },
          { slot: "BN", pos: "WR", name: "Luther Burden III", team: "Chi", status: "Q", bye: true },
          { slot: "BN", pos: "WR", name: "Germie Bernard", team: "Pit" },
          { slot: "BN", pos: "WR", name: "Josh Downs", team: "KC" },
          { slot: "BN", pos: "RB", name: "Corey Kiner", team: "NE" }
        ]
      },
      "eyes-wide-shut": {
        starters: [
          { slot: "QB", pos: "QB", name: "Dak Prescott", team: "Dal" },
          { slot: "RB", pos: "RB", name: "Chuba Hubbard", team: "Car" },
          { slot: "RB", pos: "RB", name: "Breece Hall", team: "NYJ" },
          { slot: "WR", pos: "WR", name: "Matthew Golden", team: "GB" },
          { slot: "WR", pos: "WR", name: "Jalen Coker", team: "Car" },
          { slot: "TE", pos: "TE", name: "Tucker Kraft", team: "GB" },
          { slot: "W/R/T", pos: "RB", name: "Jadarian Price", team: "Sea" },
          { slot: "K", pos: "K", name: "Cam Little", team: "Jax" },
          { slot: "DEF", pos: "DEF", name: "Rams", team: "LAR" }
        ],
        bench: [
          { slot: "BN", pos: "WR", name: "Mike Evans", team: "SF", status: "Q" },
          { slot: "BN", pos: "RB", name: "Rhamondre Stevenson", team: "NE", status: "D" },
          { slot: "BN", pos: "RB", name: "Saquon Barkley", team: "Phi", bye: true },
          { slot: "BN", pos: "WR", name: "Ladd McConkey", team: "LAC", status: "Q" },
          { slot: "BN", pos: "WR", name: "Emeka Egbuka", team: "TB", bye: true },
          { slot: "BN", pos: "RB", name: "Braelon Allen", team: "NYJ" }
        ]
      },
      "killer-whales": {
        starters: [
          { slot: "QB", pos: "QB", name: "Trevor Lawrence", team: "Jax" },
          { slot: "RB", pos: "RB", name: "Javonte Williams", team: "Dal" },
          { slot: "RB", pos: "RB", name: "Derrick Henry", team: "Bal" },
          { slot: "WR", pos: "WR", name: "Drake London", team: "Atl" },
          { slot: "WR", pos: "WR", name: "Zay Flowers", team: "Bal" },
          { slot: "TE", pos: "TE", name: "Hunter Henry", team: "NE", status: "Q" },
          { slot: "W/R/T", pos: "RB", name: "Zach Charbonnet", team: "Sea" },
          { slot: "K", pos: "K", name: "Brandon Aubrey", team: "Dal" },
          { slot: "DEF", pos: "DEF", name: "Steelers", team: "Pit" }
        ],
        bench: [
          { slot: "BN", pos: "TE", name: "Colston Loveland", team: "Chi", bye: true },
          { slot: "BN", pos: "RB", name: "Jonah Coleman", team: "Den", bye: true },
          { slot: "BN", pos: "WR", name: "Jameson Williams", team: "Det" },
          { slot: "BN", pos: "RB", name: "Aaron Jones Sr.", team: "Min" },
          { slot: "BN", pos: "WR", name: "Jordyn Tyson", team: "NO" },
          { slot: "BN", pos: "RB", name: "TreVeyon Henderson", team: "NE", status: "O" }
        ]
      }
    },

    // Draft-day rosters (from the preseason edition), for roster-turnover stats.
    preseasonRosters: {
      "dhhate": [{ pos: "QB", name: "Joe Burrow", team: "Cin" }, { pos: "RB", name: "Kenneth Walker III", team: "KC" }, { pos: "RB", name: "David Montgomery", team: "Hou" }, { pos: "WR", name: "Jaxon Smith-Njigba", team: "Sea" }, { pos: "WR", name: "Chris Olave", team: "NO" }, { pos: "TE", name: "Isaiah Likely", team: "NYG" }, { pos: "W/R/T", name: "DeVonta Smith", team: "Phi" }, { pos: "K", name: "Cameron Dicker", team: "LAC" }, { pos: "DEF", name: "Broncos", team: "Den" }, { pos: "WR", name: "Garrett Wilson", team: "NYJ" }, { pos: "RB", name: "Rico Dowdle", team: "Pit" }, { pos: "RB", name: "Kyle Monangai", team: "Chi" }, { pos: "WR", name: "Michael Pittman Jr.", team: "Pit" }, { pos: "RB", name: "Mike Washington Jr.", team: "LV" }, { pos: "TE", name: "Greg Dulcich", team: "Mia" }],
      "hammertime": [{ pos: "QB", name: "Jalen Hurts", team: "Phi" }, { pos: "RB", name: "James Cook III", team: "Buf" }, { pos: "RB", name: "Javonte Williams", team: "Dal" }, { pos: "WR", name: "Justin Jefferson", team: "Min" }, { pos: "WR", name: "Zay Flowers", team: "Bal" }, { pos: "TE", name: "Tyler Warren", team: "Ind" }, { pos: "W/R/T", name: "Tetairoa McMillan", team: "Car" }, { pos: "K", name: "Tyler Loop", team: "Bal" }, { pos: "DEF", name: "Rams", team: "LAR" }, { pos: "WR", name: "Christian Watson", team: "GB" }, { pos: "RB", name: "RJ Harvey", team: "Den" }, { pos: "RB", name: "Blake Corum", team: "LAR" }, { pos: "WR", name: "DK Metcalf", team: "Pit" }, { pos: "QB", name: "Trevor Lawrence", team: "Jax" }, { pos: "WR", name: "Jakobi Meyers", team: "Jax" }],
      "hoes-mad": [{ pos: "QB", name: "Drake Maye", team: "NE" }, { pos: "RB", name: "Bijan Robinson", team: "Atl" }, { pos: "RB", name: "Cam Skattebo", team: "NYG" }, { pos: "WR", name: "CeeDee Lamb", team: "Dal" }, { pos: "WR", name: "A.J. Brown", team: "NE" }, { pos: "TE", name: "Sam LaPorta", team: "Det" }, { pos: "W/R/T", name: "Jaylen Waddle", team: "Den" }, { pos: "K", name: "Harrison Mevis", team: "LAR" }, { pos: "DEF", name: "Texans", team: "Hou" }, { pos: "RB", name: "Jonathon Brooks", team: "Car" }, { pos: "RB", name: "Jacory Croskey-Merritt", team: "Was" }, { pos: "WR", name: "Quentin Johnston", team: "LAC" }, { pos: "RB", name: "Kenny Gainwell", team: "TB" }, { pos: "WR", name: "Jalen Nailor", team: "LV" }, { pos: "RB", name: "Brian Robinson", team: "Atl" }],
      "saxwillruintheleague": [{ pos: "QB", name: "Jayden Daniels", team: "Was" }, { pos: "RB", name: "Jahmyr Gibbs", team: "Det" }, { pos: "RB", name: "Jeremiyah Love", team: "Ari" }, { pos: "WR", name: "Drake London", team: "Atl" }, { pos: "WR", name: "Davante Adams", team: "LAR" }, { pos: "TE", name: "Harold Fannin Jr.", team: "Cle" }, { pos: "W/R/T", name: "Breece Hall", team: "NYJ" }, { pos: "K", name: "Chase McLaughlin", team: "TB" }, { pos: "DEF", name: "Jaguars", team: "Jax" }, { pos: "RB", name: "TreVeyon Henderson", team: "NE" }, { pos: "RB", name: "Chuba Hubbard", team: "Car" }, { pos: "WR", name: "Stefon Diggs", team: "Was" }, { pos: "WR", name: "Terry McLaurin", team: "Was" }, { pos: "QB", name: "Matthew Stafford", team: "LAR" }, { pos: "RB", name: "Rachaad White", team: "Was" }],
      "hogwash": [{ pos: "QB", name: "Lamar Jackson", team: "Bal" }, { pos: "RB", name: "Christian McCaffrey", team: "SF" }, { pos: "RB", name: "D'Andre Swift", team: "Chi" }, { pos: "WR", name: "Malik Nabers", team: "NYG" }, { pos: "WR", name: "Carnell Tate", team: "Ten" }, { pos: "TE", name: "Brock Bowers", team: "LV" }, { pos: "W/R/T", name: "Courtland Sutton", team: "Den" }, { pos: "K", name: "Eddy Pineiro", team: "SF" }, { pos: "DEF", name: "Steelers", team: "Pit" }, { pos: "RB", name: "Josh Jacobs", team: "GB" }, { pos: "WR", name: "Romeo Doubs", team: "NE" }, { pos: "WR", name: "Chris Godwin Jr.", team: "TB" }, { pos: "RB", name: "Jordan Mason", team: "Min" }, { pos: "RB", name: "Tyler Allgeier", team: "Ari" }, { pos: "RB", name: "Kaleb Johnson", team: "GB" }],
      "schkattebooboo": [{ pos: "QB", name: "Caleb Williams", team: "Chi" }, { pos: "RB", name: "Omarion Hampton", team: "LAC" }, { pos: "RB", name: "Bhayshul Tuten", team: "Jax" }, { pos: "WR", name: "Puka Nacua", team: "LAR" }, { pos: "WR", name: "Rashee Rice", team: "KC" }, { pos: "TE", name: "Kyle Pitts Sr.", team: "Atl" }, { pos: "W/R/T", name: "Tee Higgins", team: "Cin" }, { pos: "K", name: "Jason Myers", team: "Sea" }, { pos: "DEF", name: "Vikings", team: "Min" }, { pos: "RB", name: "Bucky Irving", team: "TB" }, { pos: "RB", name: "Jaylen Warren", team: "Pit" }, { pos: "WR", name: "Michael Wilson", team: "Ari" }, { pos: "WR", name: "KC Concepcion", team: "Cle" }, { pos: "RB", name: "Woody Marks", team: "Hou" }, { pos: "QB", name: "Jaxson Dart", team: "NYG" }],
      "mac-and-movies": [{ pos: "QB", name: "Bo Nix", team: "Den" }, { pos: "RB", name: "Chase Brown", team: "Cin" }, { pos: "RB", name: "Travis Etienne Jr.", team: "NO" }, { pos: "WR", name: "Amon-Ra St. Brown", team: "Det" }, { pos: "WR", name: "George Pickens", team: "Dal" }, { pos: "TE", name: "Travis Kelce", team: "KC" }, { pos: "W/R/T", name: "Rome Odunze", team: "Chi" }, { pos: "K", name: "Chris Boswell", team: "Pit" }, { pos: "DEF", name: "Seahawks", team: "Sea" }, { pos: "TE", name: "George Kittle", team: "SF" }, { pos: "WR", name: "Parker Washington", team: "Jax" }, { pos: "RB", name: "J.K. Dobbins", team: "Den" }, { pos: "WR", name: "De'Zhaun Stribling", team: "SF" }, { pos: "RB", name: "Keaton Mitchell", team: "LAC" }, { pos: "WR", name: "Rashid Shaheed", team: "Sea" }],
      "mr-glass-reborn": [{ pos: "QB", name: "Justin Herbert", team: "LAC" }, { pos: "RB", name: "Jonathan Taylor", team: "Ind" }, { pos: "RB", name: "De'Von Achane", team: "Mia" }, { pos: "WR", name: "Nico Collins", team: "Hou" }, { pos: "WR", name: "Luther Burden III", team: "Chi" }, { pos: "TE", name: "Trey McBride", team: "Ari" }, { pos: "W/R/T", name: "Quinshon Judkins", team: "Cle" }, { pos: "K", name: "Ka'imi Fairbairn", team: "Hou" }, { pos: "DEF", name: "Eagles", team: "Phi" }, { pos: "WR", name: "Marvin Harrison Jr.", team: "Ari" }, { pos: "RB", name: "Tony Pollard", team: "Ten" }, { pos: "WR", name: "Jordan Addison", team: "Min" }, { pos: "RB", name: "Aaron Jones Sr.", team: "Min" }, { pos: "WR", name: "Makai Lemon", team: "Phi" }, { pos: "WR", name: "Wan'Dale Robinson", team: "Ten" }],
      "eyes-wide-shut": [{ pos: "QB", name: "Dak Prescott", team: "Dal" }, { pos: "RB", name: "Jadarian Price", team: "Sea" }, { pos: "RB", name: "Saquon Barkley", team: "Phi" }, { pos: "WR", name: "Ladd McConkey", team: "LAC" }, { pos: "WR", name: "Emeka Egbuka", team: "TB" }, { pos: "TE", name: "Tucker Kraft", team: "GB" }, { pos: "W/R/T", name: "Derrick Henry", team: "Bal" }, { pos: "K", name: "Cam Little", team: "Jax" }, { pos: "DEF", name: "Patriots", team: "NE" }, { pos: "WR", name: "Mike Evans", team: "SF" }, { pos: "RB", name: "Rhamondre Stevenson", team: "NE" }, { pos: "WR", name: "Alec Pierce", team: "Ind" }, { pos: "WR", name: "Jalen Coker", team: "Car" }, { pos: "WR", name: "Matthew Golden", team: "GB" }, { pos: "WR", name: "Ja'Kobi Lane", team: "Bal" }],
      "killer-whales": [{ pos: "QB", name: "Josh Allen", team: "Buf" }, { pos: "RB", name: "Kyren Williams", team: "LAR" }, { pos: "RB", name: "Ashton Jeanty", team: "LV" }, { pos: "WR", name: "Jameson Williams", team: "Det" }, { pos: "WR", name: "Ja'Marr Chase", team: "Cin" }, { pos: "TE", name: "Colston Loveland", team: "Chi" }, { pos: "W/R/T", name: "MarShawn Lloyd", team: "GB" }, { pos: "K", name: "Brandon Aubrey", team: "Dal" }, { pos: "DEF", name: "Chargers", team: "LAC" }, { pos: "WR", name: "DJ Moore", team: "Buf" }, { pos: "WR", name: "Jayden Reed", team: "GB" }, { pos: "RB", name: "Chris Rodriguez Jr.", team: "Jax" }, { pos: "WR", name: "Josh Downs", team: "Ind" }, { pos: "WR", name: "Brian Thomas Jr.", team: "Jax" }, { pos: "RB", name: "Jonah Coleman", team: "Den" }]
    }
  }
};
