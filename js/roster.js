// ============================================================================
//  roster.js — window.ROSTER: a team's current roster with half-PPR season stats and drafted / added markers.
//
//  Reads BROOKDALE.season.rosters, BROOKDALE.season.preseasonRosters (js/data.js) and PLAYERS (js/players.js).
//  Styles: css/roster.css (everything is under the .ros block; layout adapts to the width of the section itself
//  through a container query, so it can sit in a full page or in a narrower column).
//
//  ROSTER.render(slug)      → HTMLElement  <section class="ros">: heading "Roster", drafted / added counts (which are also
//                             the key to the two row marks), starters in lineup order, bench, key to the status tags.
//                             Every player row is a <button aria-expanded> that opens a panel with his points by week
//                             and his stat line. An added player another league team drafted says "drafted by <team>".
//                             Self-contained (own click handling, no cleanup needed). Unknown slug → an empty, hidden
//                             <section>.
//  ROSTER.summary(slug)     → { size, drafted, added,
//                               fromTeams: [{ slug, code, n }]   added players drafted by another league team, most first
//                               injured (status O / D / IR / IR-R), questionable (Q), onBye,
//                               pts, startersPts, benchPts, draftedPts, addedPts      season half-PPR totals, 2 decimals
//                               byPos: { QB|RB|WR|TE|K|DEF: { n, pts } },
//                               top: { name, pos, pts, ppg, posRank } | null }        highest season total on the roster
//                             Memoized: the same object on every call (do not edit it). Unknown slug → null.
//  ROSTER.isDrafted(slug, playerName) → { drafted, from }   drafted: the name is on THIS team's draft-day roster.
//                             from: slug of the other league team that drafted him (added players only), else null.
//                             Names match ignoring a trailing Jr./Sr./II/III/IV/V and periods / apostrophes.
//                             Unknown slug → null.
//  ROSTER.players(slug)     → [{ slot, pos, name, team, status, bye, starter, drafted, from, stats }] in display order
//                             (stats = the PLAYERS.byName entry or null). Memoized. Unknown slug → null.
//
//  Node:  global.window = global; require data.js, players.js, then this file → module.exports = ROSTER (render needs a DOM).
// ============================================================================
(function () {
  'use strict';

  var G = typeof window !== 'undefined' ? window : globalThis;
  var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  var STATUS_TEXT = {
    'Q': 'questionable', 'D': 'doubtful', 'O': 'out', 'IR': 'injured reserve', 'IR-R': 'IR, designated to return'
  };
  var STATUS_ORDER = ['Q', 'D', 'O', 'IR', 'IR-R'];
  var INJURED = { 'D': 1, 'O': 1, 'IR': 1, 'IR-R': 1 };
  var has = Object.prototype.hasOwnProperty;

  // ---------- data (resolved lazily, once) ----------
  var db = null;
  function data() {
    if (db) return db;
    var B = G.BROOKDALE || {};
    var season = B.season || {};
    var pre = season.preseasonRosters || {};
    var owner = {};                       // normalized name → slug of the (first) team that drafted him
    var draft = {};                       // slug → { normalized name: true } for that team's draft-day roster
    Object.keys(pre).forEach(function (slug) {
      draft[slug] = {};
      (pre[slug] || []).forEach(function (p) {
        var k = normName(p && p.name);
        if (!k) return;
        draft[slug][k] = true;
        if (!has.call(owner, k)) owner[k] = slug;
      });
    });
    var teams = {};
    (B.teams || []).forEach(function (t) { teams[t.slug] = t; });
    db = {
      rosters: season.rosters || {},
      owner: owner,
      draft: draft,
      teams: teams,
      players: (G.PLAYERS && G.PLAYERS.byName) || {},
      throughWeek: (G.PLAYERS && G.PLAYERS.throughWeek) || season.weeksPlayed || 0,
      scoring: (G.PLAYERS && G.PLAYERS.scoring) || 'half-PPR'
    };
    return db;
  }

  function normName(name) {
    return String(name == null ? '' : name).toLowerCase()
      .replace(/[.'’‘`]/g, '')
      .replace(/\s+/g, ' ').trim()
      .replace(/ (jr|sr|ii|iii|iv|v)$/, '');
  }
  function round2(n) { return Math.round(n * 100) / 100; }
  function knownSlug(slug) { var d = data(); return typeof slug === 'string' && has.call(d.rosters, slug) && !!d.rosters[slug]; }

  function isDrafted(slug, name) {
    if (!knownSlug(slug)) return null;
    var d = data(), k = normName(name);
    if (k && has.call(d.draft, slug) && has.call(d.draft[slug], k)) return { drafted: true, from: null };
    return { drafted: false, from: k && has.call(d.owner, k) ? d.owner[k] : null };
  }

  var playersMemo = {};
  function players(slug) {
    if (!knownSlug(slug)) return null;
    if (has.call(playersMemo, slug)) return playersMemo[slug];
    var d = data(), r = d.rosters[slug], out = [];
    function add(list, starter) {
      (list || []).forEach(function (p) {
        var how = isDrafted(slug, p.name);
        out.push({
          slot: p.slot, pos: p.pos, name: p.name, team: p.team,
          status: p.status || null, bye: !!p.bye, starter: starter,
          drafted: how.drafted, from: how.from,
          stats: has.call(d.players, p.name) ? d.players[p.name] : null
        });
      });
    }
    add(r.starters, true);
    add(r.bench, false);
    playersMemo[slug] = out;
    return out;
  }

  var summaryMemo = {};
  function summary(slug) {
    if (!knownSlug(slug)) return null;
    if (has.call(summaryMemo, slug)) return summaryMemo[slug];
    var d = data(), list = players(slug);
    var s = {
      size: list.length, drafted: 0, added: 0, fromTeams: [],
      injured: 0, questionable: 0, onBye: 0,
      pts: 0, startersPts: 0, benchPts: 0, draftedPts: 0, addedPts: 0,
      byPos: {}, top: null
    };
    POSITIONS.forEach(function (p) { s.byPos[p] = { n: 0, pts: 0 }; });
    var from = {};
    list.forEach(function (p) {
      var pts = p.stats && typeof p.stats.pts === 'number' ? p.stats.pts : 0;
      if (p.drafted) { s.drafted++; s.draftedPts += pts; }
      else {
        s.added++; s.addedPts += pts;
        if (p.from) from[p.from] = (from[p.from] || 0) + 1;
      }
      if (p.status === 'Q') s.questionable++;
      else if (p.status && has.call(INJURED, p.status)) s.injured++;
      if (p.bye) s.onBye++;
      s.pts += pts;
      if (p.starter) s.startersPts += pts; else s.benchPts += pts;
      if (!s.byPos[p.pos]) s.byPos[p.pos] = { n: 0, pts: 0 };
      s.byPos[p.pos].n++;
      s.byPos[p.pos].pts += pts;
      if (p.stats && (!s.top || pts > s.top.pts)) {
        s.top = { name: p.name, pos: p.pos, pts: p.stats.pts, ppg: p.stats.ppg, posRank: p.stats.posRank };
      }
    });
    ['pts', 'startersPts', 'benchPts', 'draftedPts', 'addedPts'].forEach(function (k) { s[k] = round2(s[k]); });
    Object.keys(s.byPos).forEach(function (p) { s.byPos[p].pts = round2(s.byPos[p].pts); });
    s.fromTeams = Object.keys(from).map(function (f) {
      return { slug: f, code: has.call(d.teams, f) && d.teams[f].code ? d.teams[f].code : f, n: from[f] };
    }).sort(function (a, b) { return b.n - a.n || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0); });
    summaryMemo[slug] = s;
    return s;
  }

  // ---------- formatting ----------
  function fix(n, digits) {
    if (typeof n !== 'number' || !isFinite(n)) return '–';
    var s = Math.abs(n).toFixed(digits == null ? 2 : digits).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + s.join('.');
  }
  function int(n) { return fix(n || 0, 0); }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function rankText(p) {
    var r = p.stats ? p.stats.posRank : null;
    return typeof r === 'number' && isFinite(r) ? p.pos + r : null;
  }
  function teamName(slug) { var t = data().teams; return has.call(t, slug) && t[slug].name ? t[slug].name : slug; }

  // highest single week at each position among all rostered players: the common scale of the weekly bars
  var posMaxMemo = null;
  function posMax(pos) {
    if (!posMaxMemo) {
      posMaxMemo = {};
      var all = data().players;
      Object.keys(all).forEach(function (name) {
        var q = all[name];
        (q.weeks || []).forEach(function (w) {
          if (typeof w === 'number' && w > (posMaxMemo[q.pos] || 0)) posMaxMemo[q.pos] = w;
        });
      });
    }
    return posMaxMemo[pos] || 1;
  }

  // ---------- stat line (PLAYERS line keys; missing = 0) ----------
  function statLines(p) {
    var L = (p.stats && p.stats.line) || {};
    function v(k) { return typeof L[k] === 'number' ? L[k] : 0; }
    var rows = [];
    var rushing = ['Rushing', [[int(v('rush_att')), 'car'], [int(v('rush_yd')), 'yds'], [int(v('rush_td')), 'TD']]];
    var receiving = ['Receiving', [[int(v('rec_tgt')), 'tgt'], [int(v('rec')), 'rec'], [int(v('rec_yd')), 'yds'], [int(v('rec_td')), 'TD']]];
    if (p.pos === 'QB') {
      rows.push(['Passing', [[int(v('pass_cmp')) + '/' + int(v('pass_att')), 'comp'], [int(v('pass_yd')), 'yds'],
        [int(v('pass_td')), 'TD'], [int(v('pass_int')), 'INT']]]);
      rows.push(rushing);
    } else if (p.pos === 'RB') {
      rows.push(rushing);
      rows.push(receiving);
    } else if (p.pos === 'WR' || p.pos === 'TE') {
      rows.push(receiving);
      if (v('rush_att') || v('rush_yd') || v('rush_td')) rows.push(rushing);
    } else if (p.pos === 'K') {
      rows.push(['Field goals', [[int(v('fgm')) + '/' + int(v('fga')), 'made'], [int(v('fgm_lng')), 'long'], [int(v('fgm_50p')), 'from 50+']]]);
      rows.push(['Extra points', [[int(v('xpm')) + '/' + int(v('xpa')), 'made']]]);
    } else if (p.pos === 'DEF') {
      rows.push(['Allowed', [[int(v('pts_allow')), 'pts'], [int(v('yds_allow')), 'yds']]]);
      var def = [[int(v('sack')), plural(v('sack'), 'sack', 'sacks')], [int(v('int')), 'INT'],
        [int(v('fum_rec')), 'fum rec'], [int(v('def_td')), 'TD']];
      if (v('def_st_td')) def.push([int(v('def_st_td')), 'special teams TD']);
      if (v('safe')) def.push([int(v('safe')), plural(v('safe'), 'safety', 'safeties')]);
      if (v('blk_kick')) def.push([int(v('blk_kick')), plural(v('blk_kick'), 'blocked kick', 'blocked kicks')]);
      rows.push(['Defense', def]);
    }
    if (v('fum_lost')) rows.push(['Fumbles', [[int(v('fum_lost')), 'lost']]]);
    return rows;
  }

  // ---------- DOM ----------
  function el(tag, cls, kids) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (kids != null) put(node, kids);
    return node;
  }
  function put(node, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) put(node, kid[i]); return; }
    node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function sr(text) { return el('span', 'sr-only', text); }
  function hidden(node) { node.setAttribute('aria-hidden', 'true'); return node; }

  function mark(p) {
    var m = el('span', 'ros__mark ' + (p.drafted ? 'ros__mark--d' : 'ros__mark--a'));
    return hidden(m);
  }
  function howText(p) {
    if (p.drafted) return 'Drafted';
    if (p.from) return 'Added, drafted by ' + teamName(p.from);
    return 'Added';
  }
  function tag(code, text, cls) {
    return el('span', 'ros__tag ' + cls, [hidden(el('span', null, code)), sr(text + ', ')]);
  }

  function weekBars(p, numbers) {
    var d = data(), n = d.throughWeek;
    var weeks = (p.stats && p.stats.weeks) || [];
    var max = posMax(p.pos), min = 0, i;
    if (numbers) for (i = 0; i < n; i++) if (typeof weeks[i] === 'number' && weeks[i] < min) min = weeks[i];
    var range = (max - min) || 1;
    var list = el(numbers ? 'ol' : 'span', numbers ? 'ros__weeks' : 'ros__spark');
    if (numbers) {
      list.style.setProperty('--z', ((-min / range) * 100).toFixed(2) + '%');
      list.style.setProperty('--ros-weeks', String(n));
    } else list.setAttribute('aria-hidden', 'true');
    for (i = 0; i < n; i++) {
      var w = typeof weeks[i] === 'number' ? weeks[i] : null;
      var bar = null;
      if (w != null) {
        var val = numbers ? w : Math.max(0, w);
        bar = el('i', 'ros__bar' + (val < 0 ? ' ros__bar--neg' : ''));
        bar.style.height = ((Math.abs(val) / range) * 100).toFixed(2) + '%';
        if (numbers) bar.style.bottom = (((Math.min(val, 0) - min) / range) * 100).toFixed(2) + '%';
        if (val === 0) bar.className += ' ros__bar--zero';
      }
      if (!numbers) { list.appendChild(el('span', 'ros__sp' + (w == null ? ' is-out' : ''), bar)); continue; }
      list.appendChild(el('li', 'ros__week' + (w == null ? ' is-out' : ''), [
        el('span', 'ros__wk', [sr('Week '), String(i + 1)]),
        hidden(el('span', 'ros__plot', bar)),
        w == null ? el('span', 'ros__wv', [hidden(el('span', null, '–')), sr('did not play')]) : el('span', 'ros__wv num', fix(w, 2))
      ]));
    }
    return list;
  }

  function panelContent(p) {
    var q = p.stats, kids = [];
    if (!q) return kids;
    kids.push(el('div', 'ros__facts', [
      el('span', 'ros__fact', [el('span', 'label', 'Games'), el('b', 'num', int(q.gp))]),
      rankText(p) ? el('span', 'ros__fact', [el('span', 'label', 'Rank'), el('b', 'num', rankText(p))]) : null
    ]));
    kids.push(el('div', 'ros__chart', [el('span', 'label', 'Points by week'), weekBars(p, true)]));
    var dl = el('dl', 'ros__lines');
    statLines(p).forEach(function (row) {
      var dd = el('dd', 'ros__line');
      row[1].forEach(function (pair) { dd.appendChild(el('span', 'ros__pair', [el('b', 'num', pair[0]), ' ' + pair[1]])); });
      dl.appendChild(el('div', 'ros__linerow', [el('dt', 'label', row[0]), dd]));
    });
    kids.push(dl);
    return kids;
  }

  var uid = 0;
  function row(p) {
    var q = p.stats, id = 'ros-p' + (++uid);
    var meta = el('span', 'ros__meta', [
      el('span', 'ros__tm', [p.team, ' ', p.pos, sr(', ')]),
      p.status ? tag(p.status, STATUS_TEXT[p.status] || p.status, p.status === 'Q' ? 'ros__tag--q' : 'ros__tag--out') : null,
      p.bye ? tag('BYE', 'on bye', 'ros__tag--bye') : null,
      !p.drafted && p.from ? hidden(el('span', 'ros__via', 'drafted by ' + teamName(p.from))) : null
    ]);
    var btn = el('button', 'ros__btn', [
      el('span', 'ros__slot', [p.slot, sr(', ')]),
      mark(p),
      el('span', 'ros__name', [p.name, sr(', ' + howText(p) + ', ')]),
      meta,
      el('span', 'ros__gp num', q ? [int(q.gp), sr(plural(q.gp, ' game, ', ' games, '))] : '–'),
      el('span', 'ros__pts num', q ? [fix(q.pts, 2), sr(' points, ')] : '–'),
      el('span', 'ros__ppg num', q ? [fix(q.ppg, 2), sr(' per game, ')] : '–'),
      el('span', 'ros__rank num', rankText(p) ? [sr('rank '), rankText(p)] : '–'),
      q ? weekBars(p, false) : el('span', 'ros__spark'),
      hidden(el('span', 'ros__chev'))
    ]);
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    if (!q) btn.disabled = true;
    var panel = el('div', 'ros__panel', el('div', 'ros__panel-in'));
    panel.id = id;
    var li = el('li', 'ros__row ' + (p.drafted ? 'ros__row--d' : 'ros__row--a'), [btn, panel]);
    li._player = p;
    return li;
  }

  function colHead(title) {
    return el('div', 'ros__cols', [
      el('h3', 'ros__group-name', title),
      hidden(el('span', 'ros__c ros__c--gp', 'GP')),
      hidden(el('span', 'ros__c ros__c--pts', 'Pts')),
      hidden(el('span', 'ros__c ros__c--ppg', 'PPG')),
      hidden(el('span', 'ros__c ros__c--rank', 'Rank')),
      hidden(el('span', 'ros__c ros__c--spark', 'Weeks 1–' + data().throughWeek))
    ]);
  }
  function group(title, list) {
    var ol = el('ol', 'ros__list');
    list.forEach(function (p) { ol.appendChild(row(p)); });
    return el('div', 'ros__group', [colHead(title), ol]);
  }

  function toggle(li) {
    var btn = li.querySelector('.ros__btn'), panel = li.querySelector('.ros__panel');
    var open = btn.getAttribute('aria-expanded') !== 'true';
    if (open && !li._built) {
      put(panel.firstChild, panelContent(li._player));
      li._built = true;
      void panel.offsetHeight;            // lay the closed panel out once so the first opening animates too
    }
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    li.classList.toggle('is-open', open);
  }

  function legend(list) {
    var items = [];
    STATUS_ORDER.forEach(function (code) {
      if (list.some(function (p) { return p.status === code; })) {
        items.push([el('span', 'ros__tag ' + (code === 'Q' ? 'ros__tag--q' : 'ros__tag--out'), code), ' ' + STATUS_TEXT[code]]);
      }
    });
    if (list.some(function (p) { return p.bye; })) items.push([el('span', 'ros__tag ros__tag--bye', 'BYE'), ' week 10 bye']);
    if (!items.length) return null;
    var ul = el('ul', 'ros__key');
    items.forEach(function (it) { ul.appendChild(el('li', null, it)); });
    return ul;
  }

  function render(slug) {
    var sec = el('section', 'ros');
    var list = players(slug);
    if (!list) { sec.hidden = true; return sec; }
    var d = data(), s = summary(slug);
    sec.setAttribute('data-team', slug);
    var scoring = d.scoring.charAt(0).toUpperCase() + d.scoring.slice(1);
    var head = el('h2', 'section-head', [el('span', null, 'Roster'),
      el('small', 'section-head__aside', scoring + ', weeks 1–' + d.throughWeek)]);
    var sum = el('p', 'ros__sum', [
      el('span', 'ros__sum-item', [mark({ drafted: true }), 'Drafted ', el('b', 'num', String(s.drafted)), ' of ' + s.size]),
      el('span', 'ros__sum-item', [mark({ drafted: false }), 'Added ', el('b', 'num', String(s.added))])
    ]);
    put(sec, [head, sum,
      group('Starters', list.filter(function (p) { return p.starter; })),
      group('Bench', list.filter(function (p) { return !p.starter; })),
      legend(list)]);
    sec.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.ros__btn') : null;
      if (btn && sec.contains(btn) && !btn.disabled) toggle(btn.parentNode);
    });
    return sec;
  }

  var ROSTER = { render: render, summary: summary, isDrafted: isDrafted, players: players };
  G.ROSTER = ROSTER;
  if (typeof module !== 'undefined' && module.exports) module.exports = ROSTER;
})();
