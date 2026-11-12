// ============================================================================
//  front.js — the front page IS the rankings: ten clippings on the desk, in rank order.
//  Registers the 'front' view. Also provides the slam-in entrance used by APP.slam().
//
//  Each clipping: rank numeral, movement versus the preseason rank (nothing when unchanged), the tagline as the
//  headline, the profile photo, team name, manager and W-L record. The whole clipping links to #/t/<slug>.
//  Layout: every <li> gets data-fmt (stack / wide / tall / lead / banner) for the current breakpoint (applyFormats);
//  css/front.css draws the formats and places the clippings.
//  Headline sizes are fitted in JS (fitHeadlines) so every headline fills its column like a set headline;
//  css/front.css holds the base sizes and the limits of the fit.
// ============================================================================
(function () {
  'use strict';
  var APP = window.APP;
  if (!APP) return;
  var h = APP.h;

  // resting tilt of each clipping (degrees), by rank. front.css scales these down on phones.
  var TILT = [-0.9, 1.7, -1.5, 1.3, -2.1, 1.1, -1.2, 2.2, -1.8, 1.4];
  var CUT = ['', 'clipping--cut2', 'clipping--cut3'];
  var AGED = { 3: true, 6: true, 8: true };          // a few pieces on yellowed stock, by rank

  // format of each clipping by breakpoint (see css/front.css). The desktop composition is drawn for ten teams.
  var DESKTOP = ['banner', 'wide', 'wide', 'wide', 'wide', 'tall', 'tall', 'stack', 'stack', 'stack'];
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  function formatFor(i, n) {
    if (!mq('(min-width: 700px)')) return i === 0 ? 'lead' : 'stack';
    if (n === DESKTOP.length && mq('(min-width: 1200px)')) return DESKTOP[i];
    if (i === 0) return 'banner';
    if (i === 1 || (i === n - 1 && n % 2 === 1)) return 'wide';     // rank 2 runs across; so does a last one left alone
    return 'stack';
  }
  function applyFormats() {
    if (!state) return;
    var n = state.items.length;
    state.items.forEach(function (li, i) {
      var f = formatFor(i, n);
      if (li.dataset.fmt !== f) li.dataset.fmt = f;
    });
  }

  var state = null;       // { list, items, heads, names, anims, timer } while mounted

  // The whole clipping is a link, so a tap goes to the team page: the movement marker carries no tooltip here,
  // only its text for screen readers.
  function frontMover(delta, text) {
    var m = APP.mover(delta, text);
    m.removeAttribute('data-tip');
    m.removeAttribute('title');
    return m;
  }

  function buildClip(t, i) {
    var delta = (t.pre && t.pre.rank ? t.pre.rank : t.rank) - t.rank;
    var moveText = delta > 0 ? 'Up ' + delta + ' from preseason No. ' + t.pre.rank
      : delta < 0 ? 'Down ' + (-delta) + ' from preseason No. ' + t.pre.rank : '';
    var paper = APP.clipping({
      tag: 'a', href: APP.teamHref(t.slug),
      class: ['fp-clip__paper', CUT[i % 3], AGED[t.rank] ? 'clipping--aged' : ''],
      style: { '--r': (TILT[i % TILT.length]) + 'deg' }
    },
      h('div.fp-clip__top',
        h('div.fp-clip__rank',
          h('span.fp-clip__num', h('span.sr-only', 'Rank '), String(t.rank)),
          delta ? frontMover(delta, moveText) : null),
        h('h2.fp-clip__head.headline', t.tagline)),
      h('div.fp-clip__bot',
        APP.photo(t.profile, '', { class: 'fp-clip__photo' }),
        h('div.fp-clip__cap',
          h('span.fp-clip__name', APP.wbr(t.name)),
          h('span.fp-clip__mgr', t.manager),
          h('span.fp-clip__rec', APP.record(t.slug)))));
    var img = paper.querySelector('img');
    if (img) img.loading = 'eager';                   // ten small pictures: all in place when the page is revealed
    return h('li.fp-clip' + (i === 0 ? '.fp-clip--lead' : ''), { dataset: { rank: t.rank } }, paper);
  }

  // ---- headline fit: the biggest type that still fits the headline's box ----
  // The CSS font-size is the starting point (and the look without JS). Type may grow to --fit-grow x that size and
  // shrink to --fit-shrink x. The box is the column width and either
  //   --fit-h: <n>      a height budget of n x the column width (the headline may re-break onto more lines to use it), or
  //   (no --fit-h)      the number of lines the CSS size already produces (capped at --fit-lines).
  function fitOne(el) {
    el.style.fontSize = '';
    var width = el.clientWidth;
    if (!width) return;
    var cs = getComputedStyle(el);
    var base = parseFloat(cs.fontSize);
    var lhRatio = (parseFloat(cs.lineHeight) || base) / base;
    var grow = parseFloat(cs.getPropertyValue('--fit-grow')) || 1.4;
    var shrink = parseFloat(cs.getPropertyValue('--fit-shrink')) || 0.7;
    var maxLines = parseInt(cs.getPropertyValue('--fit-lines'), 10) || 3;
    var budget = parseFloat(cs.getPropertyValue('--fit-h')) || 0;
    var lines = function (px) { return Math.max(1, Math.round(el.offsetHeight / (px * lhRatio))); };
    var maxH = budget ? budget * width : Infinity;
    var lo0 = base * shrink, hi0 = base * grow;
    // largest size at which the headline sets in at most `cap` lines inside the box (0 = not even at the smallest size)
    var best = function (cap) {
      var fits = function (px) {
        el.style.fontSize = px + 'px';
        return el.scrollWidth <= el.clientWidth + 0.5 && lines(px) <= cap && el.offsetHeight <= maxH + 0.5;
      };
      if (!fits(lo0)) return 0;
      if (fits(hi0)) return hi0;
      var lo = lo0, hi = hi0;
      for (var n = 0; n < 7; n++) { var mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }   // each probe is a reflow
      return lo;
    };
    var size;
    if (budget) {
      // try 1..maxLines lines; take the fewest lines that get within 12% of the biggest type on offer
      var sizes = [], top = 0, L;
      for (L = 1; L <= maxLines; L++) { sizes[L] = best(L); top = Math.max(top, sizes[L]); }
      for (L = 1; L <= maxLines; L++) { if (sizes[L] && sizes[L] >= top * 0.88) { size = sizes[L]; break; } }
    } else {
      el.style.fontSize = base + 'px';
      size = best(Math.min(lines(base), maxLines)) || best(maxLines);
    }
    el.style.fontSize = (Math.floor((size || lo0) * 4) / 4) + 'px';
  }
  function fitHeadlines() {
    if (!state) return;
    applyFormats();
    state.heads.forEach(fitOne);
    state.names.forEach(function (el, i) {            // only the banner sets its name large enough to need fitting
      if (state.items[i].dataset.fmt === 'banner') fitOne(el); else el.style.fontSize = '';
    });
  }

  // ---- slam-in: every clipping punches down onto the desk, lead first, ~1.2s in total ----
  var STEP = 78, DUR = 420, HIT = 0.6;
  function clearSlam() {
    if (!state) return;
    (state.anims || []).forEach(function (a) { try { a.cancel(); } catch (e) { /* ignore */ } });
    state.anims = [];
    clearTimeout(state.timer);
    document.documentElement.classList.remove('slamming');
  }
  function slam() {
    if (!state) return;
    clearSlam();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var papers = Array.prototype.slice.call(state.list.querySelectorAll('.fp-clip__paper'));
    if (reduce || !papers.length || typeof papers[0].animate !== 'function') return;

    document.documentElement.classList.add('slamming');
    var vw = window.innerWidth, vh = window.innerHeight;
    papers.forEach(function (p, i) {
      var rest = getComputedStyle(p).transform;
      var pre = rest && rest !== 'none' ? rest + ' ' : '';
      var r = p.getBoundingClientRect();
      // come in from the viewer's side of the screen, drifting in from away from the centre
      var dx = ((r.left + r.width / 2) - vw / 2) * 0.35 + (i % 2 ? 40 : -40);
      var dy = Math.min(vh, (r.top + r.height / 2)) * -0.12 - 30;
      var spin = (i % 2 ? 1 : -1) * (9 + (i * 5) % 8);
      var big = i === 0 ? 2.5 : 2.9;
      var a = p.animate([
        { transform: pre + 'translate(' + dx + 'px,' + dy + 'px) scale(' + big + ') rotate(' + spin + 'deg)', opacity: 0, easing: 'cubic-bezier(0.55, 0, 0.9, 0.35)' },
        { opacity: 1, offset: 0.22 },
        { transform: pre + 'translate(0px,0px) scale(0.955) rotate(0deg)', opacity: 1, offset: HIT, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
        { transform: pre + 'translate(0px,0px) scale(1.02) rotate(0deg)', opacity: 1, offset: 0.82, easing: 'ease-out' },
        { transform: pre + 'translate(0px,0px) scale(1) rotate(0deg)', opacity: 1 }
      ], { duration: DUR, delay: i * STEP, fill: 'backwards' });
      state.anims.push(a);
    });

    // the desk takes each hit: a short jolt at every landing, hardest for the lead
    var total = (papers.length - 1) * STEP + DUR;
    var frames = [{ transform: 'translate(0px,0px)', offset: 0 }];
    papers.forEach(function (p, i) {
      var t = (i * STEP + DUR * HIT) / total;
      var amp = i === 0 ? 9 : 4;
      frames.push({ transform: 'translate(0px,0px)', offset: Math.max(0, t - 0.004), easing: 'steps(1, start)' });
      frames.push({ transform: 'translate(' + (i % 2 ? amp * 0.4 : -amp * 0.4) + 'px,' + amp + 'px)', offset: t, easing: 'ease-out' });
    });
    frames.push({ transform: 'translate(0px,0px)', offset: 1 });
    frames.sort(function (a, b) { return a.offset - b.offset; });
    state.anims.push(state.list.animate(frames, { duration: total }));

    state.timer = setTimeout(clearSlam, total + 80);
  }

  APP.register('front', {
    mount: function (root) {
      var items = APP.teams.map(buildClip);
      var list = h('ol.fp__list' + (items.length === DESKTOP.length ? '.fp__list--ten' : ''), items);
      var ed = (window.BROOKDALE && BROOKDALE.edition) || {};
      if (ed.headline) {
        // banner headline across the top; text before the first colon is set as the red kicker
        var cut = ed.headline.indexOf(':');
        root.appendChild(h('div.fp-banner',
          h('p.fp-banner__text.headline',
            cut > 0 ? h('span.fp-banner__kick', ed.headline.slice(0, cut + 1)) : null,
            cut > 0 ? ' ' + ed.headline.slice(cut + 1).trim() : ed.headline)));
      }
      root.appendChild(h('section.desk.fp', { 'aria-label': 'Power rankings' },
        h('h1.sr-only', (window.BROOKDALE && BROOKDALE.edition && BROOKDALE.edition.title) || 'Power Rankings'),
        list));

      var st = state = {
        list: list, items: items, anims: [], timer: 0,
        heads: Array.prototype.slice.call(list.querySelectorAll('.fp-clip__head')),
        names: items.map(function (li) { return li.querySelector('.fp-clip__name'); })
      };
      fitHeadlines();

      var raf = 0, size = function () { return list.offsetWidth + 'x' + window.innerWidth; }, lastW = size();
      var refit = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { if (state === st) fitHeadlines(); }); };
      var onResize = function () { var w = size(); if (w !== lastW) { lastW = w; refit(); } };
      window.addEventListener('resize', onResize);
      if (document.fonts) {
        if (document.fonts.ready) document.fonts.ready.then(refit);
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
      }

      return function cleanup() {
        clearSlam();
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', refit);
        state = null;
      };
    },
    slam: slam
  });
})();
