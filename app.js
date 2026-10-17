/* The Rand Society members' app. Reads data.json (or window.TRS_DATA in the preview build) and renders one member's dashboard
   in two lenses: their Society role and their analyst seat. No build step: Preact + htm globals. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  // Launch screen: shown by index.html until the dashboard is ready, for at least 0.7 s from page start so it never flickers.
  function hideSplash(now) {
    var el = document.getElementById('splash');
    if (!el || el.getAttribute('data-out')) return;
    el.setAttribute('data-out', '1');
    var t = window.performance && performance.now ? performance.now() : 0;
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 450);
    }, now ? 0 : Math.max(0, 700 - t));
  }
  function fail(msg) { hideSplash(true); root.innerHTML = '<div class="boot">' + msg + '</div>'; }
  if (!window.preact || !window.preactHooks || !window.htm) { fail('The dashboard could not load. Check your connection, then reload the page.'); return; }
  var h = preact.h, render = preact.render;
  var useState = preactHooks.useState, useEffect = preactHooks.useEffect, useRef = preactHooks.useRef;
  var html = htm.bind(h);
  var PWA = !!window.TRS_PWA;

  // ---------- dates ----------
  var DAY = 86400000, NB = ' ';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_RX = /(\d) (?=(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/g;
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function D(ms) { return new Date(ms); }
  function mon(ms) { return MONTHS[D(ms).getUTCMonth()].slice(0, 3); }
  function dShort(ms) { return D(ms).getUTCDate() + NB + mon(ms); }
  function dMonth(ms) { return D(ms).getUTCDate() + NB + MONTHS[D(ms).getUTCMonth()]; }
  function wk(ms) { return WEEK[D(ms).getUTCDay()]; }
  function dLong(ms) { return wk(ms) + ' ' + dMonth(ms) + ' ' + D(ms).getUTCFullYear(); }
  function nbsp(s) { return String(s == null ? '' : s).replace(MONTH_RX, '$1' + NB); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function todaySAST() {
    var s = null;
    try { var q = /[?&]asof=(\d{4}-\d{2}-\d{2})/.exec(location.search); if (q) s = q[1]; } catch (e) { /* no query */ }
    if (!s && window.TRS_AS_OF) s = String(window.TRS_AS_OF);
    if (!s) { try { s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { s = null; } }
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) s = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
    return parseDay(s);
  }

  // ---------- data ----------
  function loadData() {
    if (window.TRS_DATA) return Promise.resolve(window.TRS_DATA);
    function fromCache(err) {
      if (!window.caches) throw err;
      return caches.match('data.json').then(function (r) { if (!r) throw err; return r.json(); });
    }
    return fetch('data.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(fromCache);
  }

  function prepare(raw) {
    if (!raw || !Array.isArray(raw.members) || !raw.members.length || !Array.isArray(raw.society)) throw new Error('The dates file has no members or Society dates.');
    var T = raw.term || {}, term = { name: T.name || 'H1', source: T.source || '', defaultTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(T.defaultTime || '') ? T.defaultTime : '' };
    DEFAULT_TIME = term.defaultTime;
    ['start', 'protectedEnd', 'resume', 'recessStart', 'recessEnd', 'fullProduction', 'close'].forEach(function (k) {
      term[k] = parseDay(T[k]);
      if (isNaN(term[k])) throw new Error('term.' + k + ' must be a YYYY-MM-DD date.');
    });
    function order(e) { return e.type === 'marker' ? 0 : e.type === 'deadline' ? 1 : 2; }
    function list(arr, track) {
      var out = [];
      (arr || []).forEach(function (e, i) {
        var ms = e ? parseDay(e.date) : NaN;
        if (!e || !e.key || isNaN(ms)) { try { console.warn('Skipped ' + track + ' item ' + (i + 1) + ': it needs a key and a YYYY-MM-DD date.'); } catch (x) { /* no console */ } return; }
        var end = e.end ? parseDay(e.end) : NaN;
        var range = !isNaN(end) && end !== ms;
        out.push(Object.assign({}, e, { ms: ms, endMs: isNaN(end) ? ms : end, range: range, roles: e.roles || {}, timeSet: e.time || '',
          time: e.time || (e.type === 'deadline' && !range ? term.defaultTime : '') }));
      });
      out.sort(function (a, b) { return a.ms - b.ms || order(a) - order(b); });
      return out;
    }
    var cycles = {};
    Object.keys(raw.cycles || {}).forEach(function (k) {
      var c = raw.cycles[k] || {};
      cycles[k] = { name: c.name || 'Cycle ' + k, pitch: parseDay(c.pitch), path: (c.path || []).map(function (p) { return { label: p.label, ms: parseDay(p.date) }; }).filter(function (p) { return !isNaN(p.ms); }) };
    });
    return {
      term: term, members: raw.members, society: list(raw.society, 'Society'), analyst: list(raw.analyst, 'analyst'),
      analystMeetings: raw.analystMeetings || {}, analystScorecard: raw.analystScorecard || [], rules: raw.rules || {},
      cycles: cycles, updated: parseDay(raw.updated), order: order,
      notice: raw.notice && raw.notice.id && raw.notice.text ? raw.notice : null,
      siteUrl: (raw.site && raw.site.url) || ''
    };
  }

  var DEFAULT_TIME = '';
  // ---------- model ----------
  function by(map, id, fallback) { return (map && map[id]) || fallback; }
  function fill(s, m) { return nbsp(String(s || '').replace(/\{sector\}/g, m.sector || '')); }
  function item(e, m, title, detail, part, label, tone, isKey) {
    return { key: e.key, ms: e.ms, endMs: e.endMs, range: e.range, type: e.type, time: e.time || '', ic: e.ic || 0,
      title: fill(title, m), detail: fill(detail, m), part: part, label: label, tone: tone, isKey: isKey, people: [],
      timeSet: e.timeSet || '', status: (e.status && e.status[m.id]) || '' };
  }
  // Who leads and supports, in Society-role names, for the detail panel.
  function people(P, e, everyone) {
    var lead = [], sup = [];
    P.members.forEach(function (x) { var r = e.roles[x.id]; if (r === 'lead') lead.push(x.roleShort || x.role); else if (r === 'support') sup.push(x.roleShort || x.role); });
    var out = [];
    if (lead.length) out.push({ k: 'Leads', v: lead.length === P.members.length ? 'Every Member' : lead.join(', ') });
    if (sup.length) out.push({ k: 'Supports', v: sup.join(', ') });
    if (everyone) out.push({ k: 'Attends', v: 'All Members' });
    return out;
  }

  function lensItems(P, m, lens) {
    var id = m.id, items = [];
    if (lens === 'society') {
      P.society.forEach(function (e) {
        var part = e.roles[id] || null;
        if (!(e.who === 'all' || e.who === 'some' || part)) return;
        var label = '', tone = 'quiet';
        if (part === 'lead') { label = by(e.labelBy, id, e.leadLabel || (e.type === 'deadline' ? 'Due' : 'You lead')); tone = 'lead'; }
        else if (part === 'support') { label = by(e.labelBy, id, e.supportLabel || 'You support'); tone = 'support'; }
        else if (e.who === 'some') { label = 'If writing'; }
        else if (e.type === 'meeting') { label = 'Meeting'; tone = 'meet'; }
        var it = item(e, m, by(e.titleBy, id, e.title), by(e.detailBy, id, e.detail), part, label, tone, e.type === 'meeting' || part === 'lead' || e.who === 'some');
        it.people = e.type === 'marker' ? [] : people(P, e, e.type === 'meeting');
        items.push(it);
      });
      return items;
    }
    var cyc = m.cycle || 'A';
    P.analyst.forEach(function (e) {
      if (e.cycle && e.cycle !== cyc) return;
      var part = e.roles[id] || (e.who === 'all' ? 'lead' : null);
      if (!part) return;
      var lead = part === 'lead';
      var it = item(e, m, by(e.titleBy, id, e.title), by(e.detailBy, id, e.detail), part,
        by(e.labelBy, id, lead ? (e.leadLabel || 'Due') : (e.supportLabel || 'You support')), lead ? 'lead' : 'support', lead);
      it.people = e.who === 'all' ? [{ k: 'Applies to', v: 'Every analyst' }] : people(P, e, false);
      items.push(it);
    });
    P.society.forEach(function (e) {
      if (e.type === 'meeting') {
        var note = P.analystMeetings[e.key];
        if (note && note.cycle && note.cycle !== cyc) note = null;
        var pitch = !!(note && note.label);
        var mt = item(e, m, (note && note.title) || e.title, (note && note.detail) || e.detail, pitch ? 'lead' : null, pitch ? note.label : 'Meeting', pitch ? 'lead' : 'meet', true);
        mt.people = people(P, e, true);
        items.push(mt);
      } else if (e.type === 'marker' && e.who === 'all') {
        items.push(item(e, m, e.title, e.detail, null, '', 'quiet', false));
      }
    });
    items.sort(function (a, b) { return a.ms - b.ms || P.order(a) - P.order(b); });
    return items;
  }

  function rangeText(a, b) {
    var sa = D(a), sb = D(b);
    if (sa.getUTCMonth() === sb.getUTCMonth()) return sa.getUTCDate() + '–' + sb.getUTCDate() + NB + mon(b);
    return dShort(a) + ' to ' + dShort(b);
  }
  function decorate(it, asOf) {
    var n = Math.round((it.ms - asOf) / DAY), nEnd = Math.round((it.endMs - asOf) / DAY);
    it.n = n; it.past = nEnd < 0; it.current = n <= 0 && nEnd >= 0;
    it.soon = it.current ? (it.range ? 'Now' : 'Today') : it.past ? 'Passed' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days';
    var s = D(it.ms);
    it.day = s.getUTCDate(); it.wk = wk(it.ms).slice(0, 3); it.mon = mon(it.ms);
    it.monthKey = s.getUTCFullYear() * 12 + s.getUTCMonth(); it.monthName = MONTHS[s.getUTCMonth()] + ' ' + s.getUTCFullYear();
    var meet = it.type === 'meeting';
    it.sub = meet ? '17:00 to 18:30 · Teams' : it.range ? (it.type === 'marker' ? 'Until ' + dShort(it.endMs) : rangeText(it.ms, it.endMs)) : (it.time && it.time !== DEFAULT_TIME) ? 'By ' + it.time : '';
    it.whenShort = it.range ? rangeText(it.ms, it.endMs) : wk(it.ms) + ' ' + dShort(it.ms) + (meet ? ', 17:00' : it.time ? ', by ' + it.time : '');
    it.whenLong = it.range
      ? wk(it.ms) + ' ' + dMonth(it.ms) + ' to ' + wk(it.endMs) + ' ' + dMonth(it.endMs)
      : dLong(it.ms) + (meet ? ' · 17:00 to 18:30 SAST' : it.time ? ' · by ' + it.time + ' SAST' : '');
    return it;
  }

  function buildModel(P, st) {
    var asOf = st.asOf, T = P.term;
    var mi = clamp(st.mi || 0, 0, P.members.length - 1), m = P.members[mi], lens = st.lens === 'analyst' ? 'analyst' : 'society';
    var phase = asOf < T.start ? 'pre' : asOf <= T.protectedEnd ? 'protected' : (asOf >= T.recessStart && asOf <= T.recessEnd) ? 'recess' : asOf > T.close ? 'closed' : 'open';
    var all = lensItems(P, m, lens).map(function (it) { return decorate(it, asOf); });
    var shown = st.all ? all : all.filter(function (it) { return it.isKey; });
    var pastItems = shown.filter(function (it) { return it.past; });
    var listed = st.showPast ? shown : shown.filter(function (it) { return !it.past; });
    var groups = [];
    listed.forEach(function (it) {
      var g = groups[groups.length - 1];
      if (!g || g.k !== it.monthKey) { g = { k: it.monthKey, name: it.monthName, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    var upIdx = 0, months = st.months || {};
    groups.forEach(function (g) {
      var up = g.items.some(function (it) { return !it.past; });
      var def = up ? upIdx++ < 2 : true;
      g.open = months[g.k] != null ? months[g.k] : def;
      var due = g.items.filter(function (it) { return it.part === 'lead' && it.type === 'deadline'; }).length;
      var meets = g.items.filter(function (it) { return it.type === 'meeting'; }).length;
      var bits = [];
      if (due) bits.push(due + ' due');
      if (meets) bits.push(meets + ' ' + plural(meets, 'meeting'));
      g.summary = bits.length ? bits.join(' · ') : g.items.length + ' ' + plural(g.items.length, 'date');
    });
    var firstUp = shown.filter(function (it) { return !it.past; })[0];
    var mine = all.filter(function (it) { return it.part === 'lead' && !it.past; });
    var next = mine[0] || all.filter(function (it) { return !it.past && it.isKey; })[0] || null;
    var nextLabel = !next ? '' : next.type === 'meeting' ? 'Your next meeting' : (next.part === 'lead' && next.type === 'deadline') ? 'Your next deadline' : 'Next for you';
    // seven days from today: what lands on each day in this view
    var week = [], wDue = 0, wMeet = 0, seen = {};
    for (var wi = 0; wi < 7; wi++) {
      var dayMs = asOf + wi * DAY;
      var on = all.filter(function (it) { return it.isKey && !(it.type === 'marker' && !it.part) && (it.ms === dayMs || (it.range && it.endMs === dayMs)); });
      on.forEach(function (it) { if (seen[it.key]) return; seen[it.key] = 1; if (it.type === 'meeting') wMeet++; else if (it.part === 'lead') wDue++; });
      week.push({ ms: dayMs, wk: wk(dayMs).slice(0, 3), d: D(dayMs).getUTCDate(), today: wi === 0, items: on,
        marks: on.slice(0, 3).map(function (it) { return it.type === 'meeting' ? 'meet' : it.part === 'lead' ? 'due' : 'other'; }),
        label: wk(dayMs) + ' ' + dMonth(dayMs) + (on.length ? ': ' + on.map(function (it) { return it.title; }).join('; ') : ': nothing scheduled') });
    }
    var weekBits = [];
    if (wDue) weekBits.push(wDue + ' ' + plural(wDue, 'deadline'));
    if (wMeet) weekBits.push(wMeet + ' ' + plural(wMeet, 'meeting'));
    var weekSummary = weekBits.length ? weekBits.join(' · ') : 'Nothing scheduled';
    // the other role: its next deadline, and how many fall within a week
    var otherLens = lens === 'society' ? 'analyst' : 'society';
    var oAll = lensItems(P, m, otherLens).map(function (it) { return decorate(it, asOf); });
    var oDue = oAll.filter(function (it) { return it.part === 'lead' && it.type === 'deadline' && !it.past; });
    var other = { lens: otherLens, label: otherLens === 'analyst' ? 'As a ' + m.sector + ' analyst' : 'As ' + (m.roleShort || m.role),
      next: oDue[0] || null, week: oDue.filter(function (it) { return it.n <= 7; }).length, all: oAll };

    var ics = P.society.filter(function (e) { return e.ic; });
    var nextIC = ics.filter(function (e) { return e.endMs >= asOf; })[0] || null;
    var hero = {};
    if (phase === 'pre' || phase === 'protected') { hero.h = 'Studies first.'; hero.p = 'Academic Priority runs to ' + dMonth(T.protectedEnd) + '. Society work resumes on ' + dMonth(T.resume) + '.'; }
    else if (phase === 'recess') { hero.h = 'Year-end recess.'; hero.p = 'Urgent matters only until ' + dMonth(T.recessEnd) + '. Full production resumes on ' + dMonth(T.fullProduction) + '.'; }
    else if (phase === 'closed') { hero.h = 'H1 is closed.'; hero.p = 'The term closed on ' + dMonth(T.close) + ' ' + D(T.close).getUTCFullYear() + '.'; }
    else { hero.h = 'The programme is open.'; hero.p = nextIC ? 'Next formal IC: ' + wk(nextIC.ms) + ' ' + dMonth(nextIC.ms) + ', 17:00.' : 'The controlled close is ' + dMonth(T.close) + '.'; }
    var phaseTag = { pre: ['Starts ' + dShort(T.start), 'quiet'], protected: ['Academic Priority', 'lead'], open: ['Programme open', 'now'], recess: ['Year-end recess', 'support'], closed: ['H1 closed', 'quiet'] }[phase];

    // timeline
    var span = T.close - T.start;
    function pos(ms) { return clamp((ms - T.start) / span, 0, 1) * 100; }
    function pct(v) { return v.toFixed(2) + '%'; }
    var months = [];
    for (var y = D(T.start).getUTCFullYear(), mo = D(T.start).getUTCMonth(); Date.UTC(y, mo, 1) <= T.close; mo++) {
      if (mo > 11) { mo = 0; y++; }
      var first = Date.UTC(y, mo, 1);
      if (first >= T.start) months.push({ label: MONTHS[mo].slice(0, 3), left: pct(pos(first)) });
    }
    var todayP = pos(asOf);
    var tl = {
      done: pct(asOf < T.start ? 0 : todayP),
      phases: [
        { label: 'Academic Priority', a: T.start, b: T.resume, now: phase === 'protected' || phase === 'pre' },
        { label: 'Foundation', a: T.resume, b: T.recessStart, now: phase === 'open' && asOf < T.recessStart },
        { label: 'Recess', a: T.recessStart, b: T.fullProduction, now: phase === 'recess', rec: true },
        { label: st.phone ? 'Research' : 'Research and pitches', a: T.fullProduction, b: T.close + DAY, now: phase === 'open' && asOf >= T.fullProduction }
      ].map(function (x) { return { label: x.label, left: pct(pos(x.a)), width: pct(pos(x.b) - pos(x.a)), now: x.now, rec: !!x.rec }; }),
      today: pct(todayP), showToday: asOf >= T.start && asOf <= T.close, flip: todayP > 78,
      ics: ics.map(function (e) { return { key: e.key, left: pct(pos(e.ms)), past: e.endMs < asOf }; }),
      dots: all.filter(function (it) { return it.part === 'lead' && it.type !== 'meeting'; }).map(function (it) { return { key: it.key, left: pct(pos(it.ms)), past: it.past, title: it.title + ', ' + dShort(it.ms) }; }),
      months: months
    };
    var deadlinesLeft = mine.filter(function (it) { return it.type !== 'meeting'; }).length;
    var stat3 = phase === 'pre' || phase === 'protected' ? { v: Math.max(0, Math.round((T.resume - asOf) / DAY)), l: 'days until work resumes, ' + dShort(T.resume) }
      : phase === 'recess' ? { v: Math.max(0, Math.round((T.fullProduction - asOf) / DAY)), l: 'days until full production, ' + dShort(T.fullProduction) }
      : phase === 'closed' ? { v: 0, l: 'days left in H1' }
      : { v: Math.max(0, Math.round((T.close - asOf) / DAY)), l: 'days to the close, ' + dShort(T.close) };
    var stats = [
      { v: nextIC ? dShort(nextIC.ms) : '–', l: nextIC ? 'Formal IC ' + nextIC.ic + ', Sunday 17:00' : 'No formal IC left' },
      { v: String(deadlinesLeft), l: lens === 'society' ? plural(deadlinesLeft, 'role deadline', 'role deadlines') + ' ahead' : plural(deadlinesLeft, 'analyst deadline', 'analyst deadlines') + ' ahead' },
      { v: String(stat3.v), l: stat3.l }
    ];

    // panels
    var cycle = P.cycles[m.cycle || 'A'] || { name: 'Pitch IC', path: [], pitch: NaN };
    var curSet = false;
    var path = cycle.path.map(function (s) {
      var state = 'todo';
      if (s.ms < asOf) state = 'done'; else if (!curSet) { state = 'cur'; curSet = true; }
      return { label: s.label, when: dShort(s.ms), state: state };
    });
    var pitchText = isNaN(cycle.pitch) ? cycle.name : dShort(cycle.pitch) + ', ' + cycle.name;
    var score = P.analystScorecard.map(function (r) { return { name: nbsp(by(r.nameBy, m.id, r.name)), when: nbsp(String(r.when || '').replace('{pitch}', pitchText)) }; });
    var shared = (P.rules.shared || []).map(function (r) {
      var c = { id: r.id, title: r.title, body: nbsp(String(r.body || '').replace(/\{time\}/g, DEFAULT_TIME || '17:00')), chip: r.chip || '', tone: 'quiet' };
      if (r.id === 'deadlines' && DEFAULT_TIME) c.chip = DEFAULT_TIME;
      if (r.id === 'ap') { c.chip = phase === 'protected' ? 'In force' : phase === 'pre' ? 'From ' + dShort(T.start) : 'Ended ' + dShort(T.protectedEnd); c.tone = phase === 'protected' ? 'lead' : 'quiet'; }
      return c;
    });
    var rules = lens === 'society'
      ? shared.concat(m.safeguard ? [{ id: 'safe', title: m.safeguard.title, body: nbsp(m.safeguard.body), chip: 'Your role', tone: 'support' }] : [])
      : (P.rules.analyst || []).map(function (r) { return { id: r.id, title: r.title, body: nbsp(r.body), chip: r.chip || '', tone: 'quiet' }; }).concat(shared);

    var t = D(asOf);
    return {
      m: m, mi: mi, lens: lens, phase: phase, hero: hero, phaseTag: phaseTag, all: all, shown: shown, groups: groups, pastCount: pastItems.length,
      nextKey: firstUp ? firstUp.key : null, next: next, nextLabel: nextLabel, week: week, weekSummary: weekSummary, other: other, tl: tl, stats: stats, cycle: cycle, path: path, score: score, rules: rules,
      todayLong: wk(asOf) + ' ' + dMonth(asOf) + ' ' + t.getUTCFullYear() + ' · SAST',
      todayShort: wk(asOf).slice(0, 3) + ' ' + dShort(asOf),
      term: T, updated: isNaN(P.updated) ? '' : dMonth(P.updated) + ' ' + D(P.updated).getUTCFullYear()
    };
  }

  // ---------- small pieces ----------
  var PHOTO = {
    hor: { d: 'img/d-research.webp', dp: '50% 46%', p: 'img/p-research.webp', pp: '50% 44%', sat: .7 },
    pres: { d: 'img/d-president.webp', dp: '50% 40%', p: 'img/p-president.webp', pp: '50% 34%', sat: .6 },
    pm: { d: 'img/d-portfolio.webp', dp: '50% 53%', p: 'img/p-portfolio.webp', pp: '50% 40%', sat: .65 },
    coo: { d: 'img/d-coo.webp', dp: '50% 35%', p: 'img/p-coo.webp', pp: '62% 30%', sat: .6 }
  };
  // The Society's TRS monogram, traced from the original logo. The path is inserted at build time from trs-mark.path.
  var TRS_D = 'M484.2 590.7C484.2 590.6 481.6 590.4 478.5 590.3C472.8 590 464.6 589.2 461.9 588.7C461.1 588.6 459.3 588.2 458 587.9C456.7 587.6 455 587.2 454.2 587.1C453.5 587 452.3 586.8 451.6 586.6C450.9 586.4 449.2 586 447.9 585.7C440.2 584.1 428 579.8 420.5 576.1C412.2 572 406.6 568.4 398.8 562.4C392.6 557.6 392.2 557.3 389.5 554.8C379.6 545.8 369.9 535.8 362.6 527.1C361 525.2 358.8 522.6 357.7 521.4C356 519.3 349.5 511.3 348.4 509.7C346.7 507.5 343.6 503.5 342 501.5C337.7 496.2 336.1 494.1 334.8 492.2C332.4 488.9 328.3 483.6 324.4 478.6C320.9 474.2 317.3 469.6 310 460.1C308.4 458.1 306.4 455.5 305.5 454.4C303.6 452 300 447.4 295.8 441.8C292.1 436.9 289.3 433.5 286.3 430.1C285.1 428.8 282.9 426.2 281.5 424.5C277.3 419.4 270 412.4 263.8 407.4C261.9 405.9 258.6 403.6 254.8 401.2C252.9 400 245.4 395.8 245.1 395.8C245.1 395.8 243.7 395.2 242.2 394.5C237.7 392.4 232.1 390.6 225.5 388.9C218.4 387 218.3 387 209.1 386C192.5 384.1 182.3 385.5 175.3 390.4C171 393.4 169.4 395.3 168.3 398.6L167.7 400.6 L167.7 451.6C167.6 519.2 167.8 524.3 170.6 536.6C171.9 542.4 173.7 546.6 176.3 550.2C179.5 554.5 179.6 554.7 179.4 555.4C179.3 555.8 178.9 556.2 178.3 556.4C176.6 557.1 166.7 558.5 160 559C158.1 559.1 155.7 559.4 154.5 559.5C141.9 560.9 140.2 561.3 137.6 563.9C136.1 565.4 134.9 567.6 134.3 569.9C133.8 572.2 133.8 577.7 134.3 580.1C134.8 582 134.9 583.1 134.5 583.7C133.9 584.9 135.3 584.9 90.5 584.9C50.9 584.9 48.3 584.9 46.9 584.4C44.3 583.6 43.1 582 42.5 578.2C42.1 575.9 42.3 572.2 42.9 570.3C43.3 569 44.2 567.7 45 567.2C46 566.7 48.5 566.2 52.4 565.8C54.6 565.5 58.1 565 60.1 564.7C62.2 564.5 65.7 564 67.9 563.8C74.8 562.9 82.3 561 86.4 559.1C93.2 555.9 97.2 552.2 100.5 546.2C101.8 543.7 102.6 541.6 103.5 538C105 531.6 105.3 529.3 106.1 518.4C107.1 505.3 107.1 505.8 107.1 341.4C107.1 167.9 107.2 179.1 105.7 160.2C105.2 153 104.9 151 103.6 144.4C102 136.2 99.3 130.7 95.3 127C92.8 124.7 86.5 121.8 82.6 121.1C82.1 121 79.9 120.6 77.8 120.1C74 119.3 67.5 118.4 62.9 118.1C56.3 117.7 52.7 117 51.1 116C49.4 115 48 112 47.6 108.9C47.4 107 48 104.1 49 102C50.6 98.8 51.9 98.5 66.1 98C69.8 97.8 73.6 97.6 74.7 97.5C78.3 97.1 83.3 96.8 91.6 96.5C96.2 96.4 106.6 96 114.9 95.8C130.9 95.2 140.9 94.9 155.5 94.5C160.5 94.3 167.4 94.1 170.8 94C180.2 93.6 195 93.3 201.8 93.2L208 93.2 L208.8 94L209.6 94.7 L209.7 103.5C209.8 109.5 209.7 112.7 209.5 113.3C209 115.1 208.9 115.1 197.8 115.3C185.9 115.5 184.6 115.7 179.2 117.6C176 118.8 175 119.3 172.9 120.9C169.4 123.5 168.4 125.8 167.6 132.5C167.2 136.4 167.1 154.8 167.5 167.5C167.6 171.9 167.6 206.7 167.5 249.2C167.4 290 167.5 324.4 167.6 325.6C167.8 328.1 168.6 331.4 169.3 332.8C169.9 334 171.6 335.7 173.6 337C176.2 338.7 181.6 340.8 185.6 341.7C195 343.8 199 344.3 211.2 344.8C219.2 345.1 227.3 344.9 234.8 344.1C240.8 343.5 253.3 341.3 257.1 340.1C258.2 339.8 261 339 263.4 338.3C275.6 334.7 286 330.1 296.9 323.4C303.8 319.2 307.8 316.1 313.7 310.7C324.5 300.6 332.7 289.3 337.6 277.4C339.8 271.9 342.1 265 343.1 260.6C345.1 252 345.3 250.8 345.9 243.3C346.6 233 346.6 227.6 345.6 217.6C345.2 213.2 344.8 211 343.5 205.5C342.4 201.1 339.8 193 338.5 190.6C338.1 189.8 337.6 188.5 337.4 187.8C336.8 185.9 334.2 180.3 332.8 177.9C326.7 167.1 320.8 159.3 312.6 151.1C305 143.4 296.4 137.2 286.4 132.2C284.9 131.5 283.3 130.6 282.8 130.1C281.1 128.8 281.2 129.2 281.2 113.3C281.3 98 281.3 97.6 282.5 97C283.2 96.6 285.3 96.7 289.4 97.4C291.4 97.7 294.8 98.2 296.9 98.5C303.6 99.4 305.6 99.7 307.6 100.4C308.8 100.7 311.3 101.3 313.4 101.7C315.4 102.1 318.1 102.8 319.2 103.1C320.4 103.4 322.7 104 324.4 104.5C336.8 107.6 350.1 113.6 362.8 121.7C371.3 127.1 378.3 133 384.4 139.8C391.7 148 395.8 153.9 400.6 163C404.4 170.3 408.1 181.4 410.5 192.5C410.8 193.8 411.4 198 411.9 201.8L412.9 208.6 L412.9 219.6L412.9 230.6 L412.1 236.2C410.1 249.7 409.6 252.3 406.2 263.9C402.7 275.8 399.6 283.5 394 293.9C385.2 310.2 373.8 324.7 361 335.9C350.8 344.9 347.1 347.5 338.2 352.1C331.7 355.5 331.6 355.6 330.3 356.8C328.9 358.1 328.4 359.8 328.4 362.2C328.4 364.4 328.9 366.2 330.2 368.5C331.1 370.3 337 380.1 339.6 384.4C340.6 385.9 342.1 388.4 343 389.9C343.9 391.4 345.7 394.3 347 396.2C348.3 398.2 351.2 402.9 353.4 406.6C355.6 410.2 358.1 414.2 359 415.4C361.8 419.7 365.5 425.4 366.9 427.9C368.2 430.2 372.6 436.8 376.7 442.8C377.6 444.1 381 449.1 384.2 453.9C389.8 462.2 391.1 464.1 393.9 467.6C396 470.2 396.3 470.7 401.1 477.4C406.3 484.5 409.1 488.2 411.4 491C412.2 492 414.1 494.5 415.6 496.5C420.3 502.7 424.4 507.7 429 512.9C429.8 513.7 431.2 515.4 432.2 516.6C436.6 521.7 438.4 523.7 444.6 530.1C452.1 537.9 457.1 542.7 459.8 545C460.8 545.9 462.8 547.6 464.1 548.9C474.2 558.1 481.5 563.2 491.8 568.1C497.6 570.9 500.7 572.2 504.9 573.4C510.7 575.1 511.1 575.2 514.4 575.6C519 576.2 522.5 577 523.8 577.7C525.9 578.7 526.9 581.1 526.3 583.4C525 588.3 515.7 590.4 493.1 590.7C488.3 590.7 484.3 590.7 484.2 590.7ZM146.1 584.8C142.7 584.5 141.6 583.7 140.5 580.3C139.7 577.9 139.5 573.5 140.1 571.4C141.2 567.4 143.1 566.3 150.5 565.8C152.2 565.6 155.3 565.3 157.2 565C159.2 564.7 162.8 564.3 165.1 564.1C171.6 563.5 174.8 563.1 181.8 561.8C190.8 560 195.8 558.3 200.6 555.1C202.8 553.7 206.2 550.3 207.5 548.3C212.2 541.3 214.3 532.8 215 517.6C215.3 511 215.6 488.1 215.6 475.5C215.6 470.2 215.6 450.2 215.5 431C215.4 404.9 215.5 395.9 215.7 395.1C216.2 393.5 216.9 393.1 218.9 393.3C219.9 393.4 221.6 393.8 222.8 394.1C223.9 394.5 225.9 395 227.2 395.4C233.6 397 243.5 401.1 250.2 405C254.5 407.5 258.3 410.4 264.4 415.7C269.9 420.6 273.6 424.4 274.5 426C275.6 428.1 275.7 429 275.5 447C275.1 483.9 275.3 511.1 276.1 519.5C276.2 520.3 276.4 522.7 276.6 524.9C277.4 533.6 278.3 538.1 280 542.8C281.8 547.8 287.2 553.7 292.5 556.6C294.8 557.8 301.4 560.2 305.2 561.1C308.9 562.1 315.7 563.4 317.6 563.6C321.1 563.9 326.2 564.5 329.2 565C331 565.3 333.9 565.6 335.8 565.8C341.7 566.3 343.6 566.8 344.8 568.2C345.9 569.5 346.1 570.6 346.1 574C346.1 577.3 345.8 579 344.9 581.1C344.3 582.4 342.7 584 341.6 584.6C341 584.8 318.2 584.9 244.6 584.9C191.7 584.9 147.4 584.8 146.1 584.8ZM303.2 520.9C295.4 520.6 284.7 519.5 283.5 518.9C283.1 518.7 282.6 518.1 282.4 517.7C281.8 516.4 281.5 511.8 281.5 504.4L281.5 497.8 L282.1 497.1C282.7 496.4 282.8 496.4 284.4 496.4C285.4 496.4 287.7 496.7 289.6 497.1C293.8 497.9 295.1 498 304.1 498.2C308.6 498.4 314.5 498.4 320.7 498.2L330.2 497.9 L331.2 498.5C332.3 499.1 332.6 499.5 337.7 506C339.4 508.1 341.9 511.3 343.2 513C346.1 516.5 346.6 517.5 346.2 518.3C345.9 519 345.1 519.2 342 519.6C336 520.5 330.6 520.8 318.1 520.9C311.2 520.9 304.6 520.9 303.2 520.9ZM202.7 503.8C201.3 503.4 199.7 502.9 199.1 502.6C197.8 502.1 189 499.6 185.8 498.8C184.3 498.5 181.4 498.1 179.2 497.9C177.1 497.7 175.2 497.5 174.9 497.4C173.8 496.9 173.8 497.9 173.7 461.8C173.6 426.2 173.6 425.8 174.6 425.8C175.1 425.8 176.2 427.1 176.9 428.6C177.3 429.3 178 430.5 178.5 431.2C179 432 179.7 433.2 180.1 433.9C180.5 434.6 181.3 435.7 181.8 436.5C182.3 437.3 183.6 439 184.6 440.4C190.3 448.4 195.8 454.6 203.1 460.9C209 466.1 209 466.1 209.3 468.9C209.5 471.1 209.3 501.2 209.1 502.7C208.8 504.7 207.2 504.9 202.7 503.8ZM423.7 496.7C423.3 496.4 422 494.9 420.8 493.3C419.6 491.7 418.2 489.8 417.6 489.1C415.6 486.7 407.6 476.3 406.7 474.8C405.9 473.5 405.8 472.4 406.4 471.4C406.7 471.1 407.8 470 408.9 469C413.6 464.7 417.5 459.7 420.5 454.3C422.3 451 422.6 450.3 424 446.5C425.2 443.1 425.5 441.7 426.3 437.5C426.8 434.8 426.9 433.6 426.9 427.9C426.9 421.5 426.8 421.3 426.1 417.8C425.4 414.5 423.9 410.1 422.3 406.4C421.1 403.7 417.9 398.9 414.4 394.4C408.1 386.4 394 376.6 375.8 367.5C368.9 364.1 361.4 360.8 352.1 357.1C349.9 356.3 348.5 355.2 348.5 354.4C348.5 353.7 349.1 353.1 352.7 350.5C359.9 345.3 363.1 342.6 369.5 336.4C377.7 328.4 382.6 322.7 387.9 315.1C394.4 305.9 394.7 305.5 396.6 305.9C397.8 306.2 405.9 309.5 411.1 312C413.9 313.2 414.3 313.4 417.6 315.2C418.6 315.8 421.5 317.3 424 318.6C429.5 321.5 433.1 323.7 440.2 328.4C455.8 338.6 466.4 348.4 474.3 360C480.9 369.8 484.2 377.4 487.1 389.6C487.9 393.1 488.2 394.8 488.6 400.5C489.2 407.9 489.1 414.9 488.1 421.8C487.7 424.6 485.8 432.5 484.7 436C480.7 448 473.7 459.8 464.7 469.5C462.9 471.5 460.7 473.7 459.9 474.4C459 475.1 457.2 476.7 455.9 478C450.8 482.7 444.1 487.4 434.6 492.8C426.6 497.4 425.1 497.9 423.7 496.7ZM217.1 338.8C216.8 338.6 216.3 338.2 216 337.9L215.5 337.1 L215.6 251.5C215.9 64.9 215.9 71.5 214.7 65.5C213.9 61.7 212.2 59.6 208.9 58.4C205.3 57.1 200.9 56.9 172.8 56.4C145.4 55.8 123.3 55.8 119.9 56.2C108.6 57.6 100.8 58.9 97.8 59.8C96.9 60.1 94.8 60.7 93 61.1C91.3 61.6 88.9 62.4 87.5 63C86.2 63.5 84.7 64.1 84.1 64.2C82.3 64.8 74.9 68.4 72.6 69.7C69.7 71.5 66.8 73.6 63.1 76.5C55.8 82.4 52.4 86.2 45.2 96.2C40.3 103.1 38 107.2 32.2 118.8C29 125.3 28.1 126.4 25.6 127.3C24.1 127.7 23.6 127.8 21.5 127.7C19 127.5 15.2 126.6 13.5 125.8C12.1 125 10.8 123.7 10.5 122.5C10.2 121.6 10.2 121.2 10.9 118.9C11.2 117.5 11.9 115.2 12.4 113.9C12.8 112.5 13.6 110 14.1 108.4C14.6 106.7 15.5 103.7 16.1 101.8C18.4 94.3 19 92 19.9 88.5C20.4 86.5 21.2 83.6 21.6 82.1C22.1 80.6 22.8 77.9 23.1 76.2C23.5 74.5 24.1 71.9 24.6 70.4C25.1 68.9 25.8 66.1 26.2 64.2C26.7 62.4 27.3 60 27.6 58.9C28.9 54.5 33.4 33.5 36.1 18.4C36.6 15.8 37.2 13.4 37.4 13C38.3 11.3 41.2 10.4 45.4 10.6C49.6 10.7 50.6 11.4 51.8 15.1C54.1 22.4 59.5 27.9 67.4 30.9C72.1 32.8 74 33.1 84.8 34.5L89.1 35.1 L257.8 35.2C379.3 35.3 428 35.2 432.1 35C440.7 34.6 448.9 33.4 452.6 32.1C459.5 29.6 463.5 26.2 468.3 18.4C471.4 13.5 472 13.1 476.7 13.3C481 13.5 483 14.5 483.4 16.4C483.6 17.2 482.7 22.6 481.6 27.4C480.7 31.3 479.6 37.2 479.1 40.5C478.9 42.1 478.5 44.4 478.2 45.6C477.9 46.9 477.6 49.4 477.4 51.2C477 55 475.6 65.9 475.3 67.7C474.9 69.5 474.2 78.3 473.5 88.4C473.4 90.4 473.1 93.6 473 95.4C472.7 100.1 472.4 109.9 472.4 119.5C472.4 129.3 472.5 128.8 469.7 130.2C467.7 131.2 465.2 131.6 461.6 131.4C459.3 131.3 458.5 131.2 457.4 130.7C454.8 129.5 454.1 128.3 453.4 123.4C452.9 120.5 451.4 113.1 450.9 110.9C450 107.7 447.9 101.3 446.9 98.9C446.3 97.5 445.7 96.1 445.6 95.8C445.4 94.9 442.1 88.8 440.8 86.6C438.1 82.4 432.4 75.6 429.1 72.9C423.2 68.1 414.3 63.5 406.7 61.4C405.4 61 403.4 60.4 402.1 60C399.6 59.2 394.9 58.3 387.6 57.4C385 57 381.6 56.6 380 56.4C373 55.5 364.4 55.3 344.2 55.7C308.4 56.5 288.5 57.1 285.6 57.6C282.3 58.2 280.5 59 279 60.7C278.3 61.4 277.6 62.4 277.4 62.8C276.9 63.8 276.1 67.2 275.8 69.9C275.3 73.9 274.9 100.1 275.1 122.5C275.2 134.4 275.3 185.1 275.3 235.2C275.3 326 275.3 326.2 274.8 327.2C274.1 328.5 273.2 328.9 266.6 331.1C259.2 333.5 255.9 334.5 253.5 334.9C252.3 335.1 249.6 335.6 247.5 336.1C240.4 337.5 238.9 337.7 234.6 338.1C232.3 338.3 229.3 338.6 228 338.8C225.1 339 217.8 339 217.1 338.8ZM282 323.3C281.8 323 281.5 322.4 281.4 321.9C281.3 321.5 281.3 308.9 281.3 294C281.4 271.3 281.4 266.8 281.7 266.2C282.2 265.4 282.5 265.3 283.3 265.2C284.1 265.2 289.3 267.1 292.2 268.4C294.6 269.5 301.5 272.2 305.1 273.4C306.6 273.9 308.2 274.4 308.5 274.6C308.9 274.8 310.2 275.3 311.5 275.6C312.8 276 314.5 276.6 315.4 276.9C316.2 277.3 318.1 277.9 319.6 278.4C323.3 279.5 326.4 280.8 327.2 281.5C328.2 282.5 328.1 283 325.4 287.4C323.8 290.1 320.9 294.1 317.8 297.8C315.1 300.9 307.8 308.3 305.8 309.9C299.9 314.3 297.9 315.7 293.9 318.1C284.1 323.9 283.1 324.3 282 323.3ZM205.9 304.2C197.8 300.4 183.9 290.6 176.8 283.7C173.9 280.9 173.9 281 173.7 273.6C173.6 270.2 173.5 247.8 173.6 223.9C173.6 183.1 173.7 180.3 174.1 179.6C176.7 174.8 192.4 163.3 203.9 157.8C208.3 155.8 208.9 155.9 209.3 159.4C209.6 162.2 209.5 300.6 209.3 302.6C209 304.9 208.2 305.2 205.9 304.2ZM455 247.2C453.5 246.6 452.8 245.5 451.4 241.6C450.9 240.2 450.3 238.4 449.9 237.5C449.6 236.6 448.8 234.5 448.1 232.9C444.8 223.8 439.4 212.8 435.2 206.2C430.2 198.5 427.9 195.9 418.8 187.7C417.3 186.4 415.9 185 415.7 184.5C415.4 184.1 414.6 182 414 179.9C411.2 171.1 407 161.8 402.1 153.5C399.5 149.1 399 147.9 399.5 147.3C400.1 146.7 402.3 147.1 406.9 148.5C409.2 149.2 412 150 413.2 150.3C416.1 151.1 425.2 154 425.8 154.3C426.7 154.7 437.7 157.8 439.9 158.2C441.3 158.4 443.6 158.6 446.1 158.6C450.6 158.6 451.1 158.5 454.2 156.7C455.7 155.9 456.4 155.6 457.6 155.5C460.5 155.3 463.7 156.8 464.5 158.7C464.8 159.6 464.8 162.1 464.2 173C464 178.3 464 181.2 464.2 189C464.4 194.1 464.6 199.9 464.8 201.8C465.4 212.3 465.9 217.1 466.6 222.9C468 233.7 468.6 240.1 468.5 242.2C468.4 243.8 468.3 244.1 467.5 244.9C466.5 245.9 465.3 246.3 461.6 247C458.7 247.5 456 247.6 455 247.2ZM282.6 163C282.2 162.9 281.9 162.4 281.7 162.1C281.3 161.1 281.1 143.4 281.5 141.3C282.1 138.2 284.2 137.9 288.6 140.4C295.9 144.6 304 151 308.9 156.4C312.6 160.6 312.4 160.7 302.6 161C294.5 161.3 290.2 161.7 285.8 162.9C284.2 163.3 283.4 163.3 282.6 163Z';
  function Logo(p) {
    return html`<svg width=${Math.round(p.size * 516 / 580)} height=${p.size} viewBox="10 10 516 580" aria-hidden="true" style="display:block;flex:none;color:#FFFFFF"><path fill="currentColor" fill-rule="evenodd" d=${TRS_D}></path></svg>`;
  }
  function Chev(p) { return html`<svg class=${'chev' + (p.open ? ' open' : '')} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`; }
  function Arrow(p) { return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${p.left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}></path></svg>`; }
  function Tag(p) { return p.text ? html`<span class=${'tag ' + (p.tone || 'quiet')}>${p.text}</span>` : null; }

  // Only the member's own photo is downloaded (data costs money); it fades in once it has loaded.
  function Photo(p) {
    var x = PHOTO[p.id], ref = useRef(null);
    useEffect(function () { var el = ref.current; if (el && el.complete && el.naturalWidth) el.classList.add('in'); });
    if (!x) return null;
    var src = p.phone ? x.p : x.d;
    return html`<img key=${src} ref=${ref} src=${src} alt="" decoding="async" onLoad=${function (ev) { ev.currentTarget.classList.add('in'); }} style=${'object-position:' + (p.phone ? x.pp : x.dp) + ';filter:saturate(' + x.sat + ') contrast(1.04)'} />`;
  }

  // ---------- sheet (side panel on desktop, bottom sheet on phones) ----------
  function Sheet(p) {
    var ref = useRef(null), drag = useRef(null);
    useEffect(function () {
      var prev = document.activeElement, el = ref.current;
      if (el) { var f = el.querySelector('[data-autofocus]') || el; try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
      var de = document.documentElement, ov = de.style.overflow; de.style.overflow = 'hidden';
      return function () { de.style.overflow = ov; if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { /* gone */ } } };
    }, []);
    function onKey(ev) {
      if (ev.key !== 'Tab' || !ref.current) return;
      var f = ref.current.querySelectorAll('button:not([disabled]), a[href]');
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
      else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
    function down(ev) { drag.current = { y: ev.clientY, dy: 0 }; try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* older browser */ } }
    function move(ev) { var d = drag.current; if (!d || !ref.current) return; d.dy = Math.max(0, ev.clientY - d.y); ref.current.style.transform = 'translateY(' + d.dy + 'px)'; }
    function up() { var d = drag.current; drag.current = null; if (!d) return; if (d.dy > 90) p.onClose(); else if (ref.current) ref.current.style.transform = ''; }
    return html`<div>
      <div class="scrim" onClick=${p.onClose}></div>
      <div ref=${ref} class=${'sheet ' + (p.phone ? 'bottom-sheet' : 'side-sheet')} role="dialog" aria-modal="true" aria-label=${p.label} tabindex="-1" onKeyDown=${onKey}>
        ${p.phone ? html`<div class="grab" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} aria-hidden="true"><i></i></div>` : null}
        ${p.children}
      </div>
    </div>`;
  }
  function CloseBtn(p) {
    return html`<button class="x" data-autofocus onClick=${p.onClose} aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>`;
  }
  function ItemSheet(p) {
    var it = p.it;
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label=${it.title}>
      <div class="sheet-head"><span class="when tnum">${it.whenLong}</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <h2 class="sheet-title">${it.title}</h2>
        <div class="sheet-tags"><${Tag} text=${it.label} tone=${it.tone} /><${Tag} text=${it.soon} tone=${it.current ? 'now' : it.past ? 'quiet' : 'when'} /></div>
        <p class="sheet-detail">${it.detail}</p>
        ${it.people.length ? html`<dl class="who">${it.people.map(function (x) { return html`<div key=${x.k}><dt>${x.k}</dt><dd>${x.v}</dd></div>`; })}</dl>` : null}
      </div>
      <div class="sheet-foot">
        <button class="step" onClick=${p.prev} disabled=${p.idx <= 0}><${Arrow} left=${true} />Earlier</button>
        <span class="pos tnum">${p.idx + 1} of ${p.total}</span>
        <button class="step" onClick=${p.next} disabled=${p.idx >= p.total - 1}>Later<${Arrow} /></button>
      </div>
    </${Sheet}>`;
  }
  function MemberSheet(p) {
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label="Choose your role">
      <div class="sheet-head"><span class="when">Saved on this device</span><${CloseBtn} onClose=${p.onClose} /></div>
      <h2 class="pick-title">Choose your role</h2>
      <ul class="pick">${p.members.map(function (m, i) {
        var cur = i === p.mi;
        return html`<li key=${m.id}><button onClick=${function () { p.pick(i); }} aria-current=${cur ? 'true' : 'false'}>
          <span class="nm"><b>${m.role}</b><span>${m.sector} analyst</span></span>
          ${cur ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F2340" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>` : null}
        </button></li>`;
      })}</ul>
    </${Sheet}>`;
  }

  // ---------- sections ----------
  function LensSwitch(p) {
    var M = p.M, A = p.A, right = M.lens === 'analyst';
    return html`<div class="lens" role="group" aria-label="Choose which deadlines to show">
      <span class=${'lens-ind' + (right ? ' right' : '')} aria-hidden="true"></span>
      <button class="lens-btn" aria-pressed=${right ? 'false' : 'true'} aria-label=${'Society role, ' + (M.m.roleShort || M.m.role) + (right && M.other.week ? ', ' + M.other.week + ' due within a week' : '')} onClick=${function () { A.setLens('society'); }}><span class="lens-k">Society role${right && M.other.week ? html`<span class="lens-due">${M.other.week} due</span>` : null}</span><span class="lens-v">${M.m.roleShort || M.m.role}</span></button>
      <button class="lens-btn" aria-pressed=${right ? 'true' : 'false'} aria-label=${'Analyst, ' + M.m.sector + (!right && M.other.week ? ', ' + M.other.week + ' due within a week' : '')} onClick=${function () { A.setLens('analyst'); }}><span class="lens-k">Analyst${!right && M.other.week ? html`<span class="lens-due">${M.other.week} due</span>` : null}</span><span class="lens-v">${M.m.sector}</span></button>
    </div>`;
  }

  function Mast(p) {
    var M = p.M, A = p.A, st = p.st, phone = st.phone;
    return html`<header class="mast on-navy">
      <div class="mast-photo" aria-hidden="true"><${Photo} id=${M.m.id} phone=${phone} /></div>
      <div class="mast-inner">
        <div class="topbar">
          <div class="brand"><${Logo} size=${phone ? 36 : 44} /><span class="brand-word">THE RAND SOCIETY</span></div>
          <div class="top-right">
            ${phone ? null : html`<span class="today tnum">${M.todayLong}</span>`}
            <button class="member-btn" onClick=${A.openMembers} aria-haspopup="dialog" aria-label=${'Change role. Showing ' + M.m.role}>${phone ? (M.m.pick || M.m.roleShort) : M.m.role}<${Chev} /></button>
          </div>
        </div>
        <div class="hero">
          <span class="eyebrow">${phone ? M.todayShort + ' · ' : ''}Term ${M.term.name}</span>
          <h1>${M.hero.h}</h1>
          <p>${M.hero.p}</p>
          ${phone ? null : html`<div style="margin-top:14px"><${LensSwitch} M=${M} A=${A} /></div>`}
        </div>
      </div>
    </header>`;
  }

  function NextCard(p) {
    var M = p.M, A = p.A, n = M.next, o = M.other;
    return html`<section class="card next" aria-labelledby="next-h">
      <div class="card-head"><h2 id="next-h" class="card-k">${M.nextLabel || 'Next for you'}</h2>${n ? html`<${Tag} text=${n.soon} tone=${n.current ? 'now' : 'when'} />` : null}</div>
      ${n ? html`<button class="next-main" onClick=${function () { A.openItem(n.key); }}>
        <span class="datebox tnum" aria-hidden="true"><span class="d">${n.day}</span><span class="m">${n.mon}</span></span>
        <span class="next-text"><span class="next-title">${n.title}</span><span class="next-meta"><${Tag} text=${n.label} tone=${n.tone} /><span class="tnum">${n.whenShort}</span></span></span>
      </button>` : html`<p class="next-empty">Nothing else is dated for you in this view.</p>`}
      <div class="week" role="group" aria-labelledby="wk-h">
        <div class="week-head"><span id="wk-h" class="then-k">This week</span><span class="week-sum tnum">${M.weekSummary}</span></div>
        <div class="week-days">${M.week.map(function (d) {
          var inner = html`<span class="wd">${d.today ? 'Today' : d.wk}</span><span class="wn tnum">${d.d}</span><span class="wm">${d.marks.map(function (k, i) { return html`<i key=${i} class=${k}></i>`; })}</span>`;
          return d.items.length
            ? html`<button key=${d.ms} class=${'wday has' + (d.today ? ' today' : '')} aria-label=${d.label} onClick=${function () { A.openItem(d.items[0].key); }}>${inner}</button>`
            : html`<div key=${d.ms} class=${'wday' + (d.today ? ' today' : '')} aria-label=${d.label} role="img">${inner}</div>`;
        })}</div>
      </div>
      ${o.next ? html`<button class="other" onClick=${function () { A.openOther(o.next.key); }}>
        <span class="other-k">${o.label}</span>
        <span class="other-t"><span class="tt">${o.next.title}</span><span class="dt tnum">${o.next.whenShort} · ${o.next.soon.toLowerCase()}</span></span>
        <${Arrow} />
      </button>` : null}
    </section>`;
  }

  function Changes(p) {
    var C = p.changes, A = p.A, rows = C.items.slice(0, 4), more = C.items.length - rows.length;
    var kindText = { moved: 'Moved', 'new': 'New', removed: 'Removed', rule: 'Rule' };
    return html`<section class="card changes" aria-labelledby="ch-h" role="status">
      <div class="ch-head">
        <span class="ch-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l2.5 2.5"></path><circle cx="12" cy="12" r="9"></circle></svg></span>
        <h2 id="ch-h" class="ch-title">${C.title}</h2>
        <button class="ch-ok" onClick=${A.dismissChanges}>Got it</button>
      </div>
      ${C.text ? html`<p class="ch-text">${C.text}</p>` : null}
      ${rows.length ? html`<ul class="ch-list">${rows.map(function (c, i) {
        var body = html`<span class=${'ch-kind ' + c.kind}>${kindText[c.kind]}</span><span class="ch-t">${c.title}</span><span class="ch-w tnum">${c.when}</span>`;
        return html`<li key=${i}>${c.kind === 'removed' || c.kind === 'rule' ? html`<div class="ch-row">${body}</div>` : html`<button class="ch-row" onClick=${function () { A.openAny(c.key); }}>${body}</button>`}</li>`;
      })}</ul>` : null}
      ${more > 0 ? html`<p class="ch-more">and ${more} more in the term plan.</p>` : null}
    </section>`;
  }

  function InstallCard(p) {
    var A = p.A, st = p.st;
    return html`<section class="card install-card" aria-labelledby="in-h">
      <div class="in-mark" aria-hidden="true"><${Logo} size=${30} /></div>
      <div class="in-text">
        <h2 id="in-h">Keep the app on your home screen</h2>
        ${st.canInstall ? html`<p>One tap opens it full screen, even offline.</p>` : html`<p>Tap <b>Share</b>${html`<svg class="share-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7"></path></svg>`}, then <b>Add to Home Screen</b>.</p>`}
      </div>
      <div class="in-actions">
        ${st.canInstall ? html`<button class="install" onClick=${A.install}>Install</button>` : null}
        <button class="in-later" onClick=${A.dismissInstall}>Not now</button>
      </div>
    </section>`;
  }

  function CalSheet(p) {
    var m = p.m, s = useState(false), copied = s[0], setCopied = s[1], ref = useRef(null);
    var url = p.calBase + m.link + '.ics', webcal = url.replace(/^https?:/, 'webcal:');
    var google = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
    var apple = html`<a key="a" class="cal-btn" href=${webcal}>Apple Calendar<small>iPhone, iPad and Mac</small></a>`;
    var goog = html`<a key="g" class="cal-btn" href=${google} target="_blank" rel="noopener">Google Calendar<small>Then switch on its notifications once</small></a>`;
    function copy() {
      function pick() { var el = ref.current; if (!el) return; var r = document.createRange(); r.selectNodeContents(el); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      try { navigator.clipboard.writeText(url).then(function () { setCopied(true); }, pick); } catch (e) { pick(); }
    }
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label="Add your dates to your calendar">
      <div class="sheet-head"><span class="when">${m.role} · ${m.sector} analyst</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <h2 class="sheet-title">Get reminders in your calendar</h2>
        <p class="sheet-detail">Your deadlines and meetings from both roles, with a reminder two days before each deadline and on the morning it is due. When dates change here, your calendar catches up by itself within a few hours.</p>
        <div class="cal-btns">${p.android ? [goog, apple] : [apple, goog]}</div>
        <div class="cal-copy">
          <span class="cal-k">Outlook, Huawei or another calendar app: subscribe with this link</span>
          <code ref=${ref} class="cal-url">${url}</code>
          <button class="step" onClick=${copy}>${copied ? 'Copied' : 'Copy link'}</button>
        </div>
      </div>
    </${Sheet}>`;
  }

  function TermCard(p) {
    var M = p.M, A = p.A, tl = M.tl;
    return html`<section class="card term" aria-labelledby="term-h">
      <div class="card-head"><h2 id="term-h" class="card-k">Term ${M.term.name}</h2><${Tag} text=${M.phaseTag[0]} tone=${M.phaseTag[1]} /></div>
      <div class="tl" aria-hidden="true">
        <div class="tl-track"></div>
        <div class="tl-done" style=${'width:' + tl.done}></div>
        ${tl.ics.map(function (d) { return html`<div key=${d.key} class=${'tl-ic' + (d.past ? ' past' : '')} style=${'left:' + d.left}></div>`; })}
        ${tl.dots.map(function (d) { return html`<button key=${d.key} tabindex="-1" class=${'tl-tick' + (d.past ? ' past' : '')} style=${'left:' + d.left} title=${d.title} onClick=${function () { A.openItem(d.key); }}><i></i></button>`; })}
        ${tl.showToday ? html`<div class=${'tl-today' + (tl.flip ? ' flip' : '')} style=${'left:' + tl.today}><span>Today</span><b></b></div>` : null}
        ${tl.months.map(function (mo) { return html`<div key=${mo.label} class="tl-mo" style=${'left:' + mo.left}>${mo.label}</div>`; })}
        ${tl.phases.map(function (ph) { return html`<div key=${ph.label} class=${'tl-ph' + (ph.now ? ' now' : '') + (ph.rec ? ' rec' : '')} style=${'left:' + ph.left + ';width:' + ph.width} title=${ph.label}>${ph.label}</div>`; })}
      </div>
      <div class="legend"><span><i class="lg-ic"></i>Formal IC</span><span><i class="lg-tick"></i>Your deadline</span><span><i class="lg-rec"></i>Recess</span></div>
      <div class="stats">${M.stats.map(function (s, i) { return html`<div key=${i} class="stat"><span class="v tnum">${s.v}</span><span class="l">${s.l}</span></div>`; })}</div>
    </section>`;
  }

  function Agenda(p) {
    var M = p.M, A = p.A, st = p.st;
    function row(it) {
      var cls = 'row' + (it.past ? ' past' : '') + (it.key === M.nextKey ? ' is-next' : '') + (it.type === 'marker' && !it.part ? ' marker' : '');
      return html`<li key=${it.key}><button class=${cls} onClick=${function () { A.openItem(it.key); }}>
        <span class="dd tnum"><b>${it.day}</b><small>${it.wk}</small></span>
        <span class="tx"><span class="tt">${it.title}</span>${it.sub ? html`<span class="sub tnum">${it.sub}</span>` : null}</span>
        <span class="tags"><${Tag} text=${it.label} tone=${it.tone} />${it.past ? null : html`<span class="soon tnum">${it.soon}</span>`}</span>
      </button></li>`;
    }
    return html`<section class="card agenda" aria-labelledby="ag-h">
      <div class="card-head">
        <h2 id="ag-h" class="card-title">Term plan</h2>
        <div class="seg" role="group" aria-label="Dates to show">
          <button aria-pressed=${st.all ? 'false' : 'true'} onClick=${function () { A.setAll(false); }}>Key dates</button>
          <button aria-pressed=${st.all ? 'true' : 'false'} onClick=${function () { A.setAll(true); }}>Everything</button>
        </div>
      </div>
      ${M.pastCount ? html`<button class="past-btn" onClick=${A.togglePast} aria-expanded=${st.showPast ? 'true' : 'false'}><${Chev} open=${st.showPast} />${st.showPast ? 'Hide earlier dates' : 'Show ' + M.pastCount + ' earlier ' + plural(M.pastCount, 'date')}</button>` : null}
      ${M.groups.length ? M.groups.map(function (g) {
        var id = 'm-' + g.k;
        return html`<div key=${g.k} class=${g.open ? '' : 'closed-m'}>
          <h3 class="month"><button class="month-btn" aria-expanded=${g.open ? 'true' : 'false'} aria-controls=${id} onClick=${function () { A.toggleMonth(g.k, !g.open); }}>
            <span class="mn">${g.name}</span><span class="mc tnum">${g.summary}</span><${Chev} open=${g.open} />
          </button></h3>
          ${g.open ? html`<ol id=${id} class="rows">${g.items.map(row)}</ol>` : null}
        </div>`;
      }) : html`<p class="empty">Every H1 date in this view has passed.</p>`}
      <button class="cal-row" onClick=${A.openCal}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>
        <span>Get reminders in your calendar</span><${Arrow} />
      </button>
    </section>`;
  }

  function Side(p) {
    var M = p.M, A = p.A, st = p.st, m = M.m;
    if (p.part === 'rules') return html`<${Rules} M=${M} A=${A} st=${st} />`;
    var top = M.lens === 'society'
      ? html`<section class="panel-navy on-navy" aria-labelledby="role-h">
          <span class="card-k">${m.role}</span>
          <h2 id="role-h">${m.focus}</h2>
          <p>${m.focusLine}</p>
          <ul class="own">${(m.owns || []).map(function (o, i) { return html`<li key=${i}><span>${o.name}</span><span class="tnum">${nbsp(o.when)}</span></li>`; })}</ul>
        </section>`
      : html`<section class="panel-navy on-navy" aria-labelledby="cov-h">
          <span class="card-k">${m.sector} analyst</span>
          <h2 id="cov-h">${m.sectorLine}</h2>
          <p class="cover">${m.coverage}</p>
          <span class="card-k" style="margin-top:10px">Thesis path · ${M.cycle.name}</span>
          <ol class="path">${M.path.map(function (s, i) { return html`<li key=${i} class=${s.state}><span class="pd" aria-hidden="true"></span><span class="pl">${s.label}</span><span class="pw tnum">${s.when}</span></li>`; })}</ol>
        </section>
        <section class="card score" aria-labelledby="sc-h">
          <div class="card-head"><h2 id="sc-h" class="card-title">Analyst scorecard</h2></div>
          <ul>${M.score.map(function (r, i) { return html`<li key=${i}><span>${r.name}</span><span class="tnum">${r.when}</span></li>`; })}</ul>
        </section>`;
    if (p.part === 'panels') return top;
    return html`<div class="side">${top}<${Rules} M=${M} A=${A} st=${st} /></div>`;
  }

  function Rules(p) {
    var M = p.M, A = p.A, st = p.st;
    return html`<section class="card rules" aria-labelledby="ru-h">
        <div class="card-head" style="padding-bottom:8px"><h2 id="ru-h" class="card-title">Rules</h2></div>
        ${M.rules.map(function (r) {
          var open = !!st.open[r.id];
          return html`<div key=${r.id} class="rule"><button class="rule-btn" aria-expanded=${open ? 'true' : 'false'} aria-controls=${'rule-' + r.id} onClick=${function () { A.toggleRule(r.id); }}>
            <span>${r.title}</span>${r.chip ? html`<${Tag} text=${r.chip} tone=${r.tone} />` : html`<span></span>`}<${Chev} open=${open} />
          </button>${open ? html`<p id=${'rule-' + r.id}>${r.body}</p>` : null}</div>`;
        })}
      </section>`;
  }

  function Footer(p) {
    var M = p.M, A = p.A, st = p.st;
    return html`<footer class="foot on-navy"><div class="foot-inner">
      <div class="brand"><${Logo} size=${34} /><span class="brand-word">THE RAND SOCIETY</span></div>
      <div class="foot-meta">
        <b>Members only. Not for external circulation.</b>
        <span>Dates: ${M.term.source}. Times are SAST.</span>
        ${M.updated ? html`<span>Updated ${M.updated}.</span>` : null}
      </div>
      ${st.canInstall ? html`<button class="install" onClick=${A.install}>Install the app</button>` : null}
    </div></footer>`;
  }

  // ---------- persistence and routing ----------
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storedMember(P) {
    var id = read('trs-member'), i = -1;
    P.members.forEach(function (m, j) { if (m.id === id) i = j; });
    if (i >= 0) return i;
    var old = parseInt(read('trs-role'), 10);
    return old >= 0 && old < P.members.length ? old : null;
  }
  function fromHash(P) {
    var hsh = (location.hash || '').replace('#', '').toLowerCase(), parts = hsh.split('-'), out = {};
    P.members.forEach(function (m, i) { if (m.link === parts[0]) out.mi = i; });
    if (out.mi != null && (parts[1] === 'analyst' || parts[1] === 'society')) out.lens = parts[1];
    return out;
  }
  function clearRoleHash(P) {
    if (fromHash(P).mi == null) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* not allowed here */ }
  }
  // What a member could see last time, so moved or new dates can be pointed out on the next visit.
  function snapshotFor(P, m) {
    var map = {};
    ['society', 'analyst'].forEach(function (l) {
      lensItems(P, m, l).forEach(function (it) { if (!map[it.key] && (it.isKey || it.type === 'marker')) map[it.key] = [it.ms, it.endMs, it.timeSet, it.title]; });
    });
    return { t: DEFAULT_TIME, map: map };
  }
  function readSnaps() { try { return JSON.parse(read('trs-snap') || '{}') || {}; } catch (e) { return {}; } }
  function saveSnap(id, snap) { var all = readSnaps(); all[id] = snap; store('trs-snap', JSON.stringify(all)); }
  function diffSnap(prev, cur, asOf) {
    var out = [], a = prev.map || {}, b = cur.map;
    function when(ms, t) { return wk(ms).slice(0, 3) + ' ' + dShort(ms) + (t ? ', ' + t : ''); }
    Object.keys(b).forEach(function (k) {
      var x = a[k], y = b[k];
      if (!x) out.push({ kind: 'new', key: k, title: y[3], ms: y[0], when: when(y[0], y[2]) });
      else if (x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2]) out.push({ kind: 'moved', key: k, title: y[3], ms: y[0], when: 'now ' + when(y[0], y[2]) + ', was ' + dShort(x[0]) + (x[2] && x[2] !== y[2] ? ' ' + x[2] : '') });
    });
    Object.keys(a).forEach(function (k) { if (!b[k]) out.push({ kind: 'removed', key: k, title: a[k][3], ms: a[k][0], when: 'was ' + dShort(a[k][0]) }); });
    out = out.filter(function (c) { return c.ms >= asOf - 7 * DAY; }).sort(function (x, y) { return x.ms - y.ms; });
    if (prev.t !== cur.t && cur.t) out.unshift({ kind: 'rule', key: '', title: 'Deadlines now close at ' + cur.t + ' SAST unless another time is shown', ms: 0, when: '' });
    return out;
  }

  var phoneQuery = window.matchMedia ? window.matchMedia('(max-width: 759px)') : null;
  function isPhone() { return phoneQuery ? phoneQuery.matches : window.innerWidth < 760; }

  var installEvt = null, installListeners = [];
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; installListeners.forEach(function (f) { f(true); }); });
  function standalone() { try { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } }
  function isIOS() { var ua = navigator.userAgent || ''; return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }

  // ---------- app ----------
  function App() {
    var s = useState(function () {
      return { P: null, err: null, mi: 0, lens: read('trs-lens') === 'analyst' ? 'analyst' : 'society', all: false, showPast: false, sheet: null, open: {}, months: {},
        asOf: todaySAST(), phone: isPhone(), canInstall: false, changes: null, showInstall: false };
    });
    var st = s[0], setSt = s[1];
    function set(patch) { setSt(function (prev) { return Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch); }); }
    var loadedAt = useRef(0);

    function load(first) {
      loadData().then(function (raw) {
        var P = prepare(raw);
        loadedAt.current = Date.now();
        set(function (prev) {
          if (!first) return { P: P, mi: clamp(prev.mi, 0, P.members.length - 1) };
          var hsh = fromHash(P), saved = storedMember(P);
          var mi = hsh.mi != null ? hsh.mi : saved != null ? saved : 0;
          if (hsh.mi != null) store('trs-member', P.members[mi].id);
          if (hsh.lens) store('trs-lens', hsh.lens);
          return { P: P, err: null, mi: mi, lens: hsh.lens || prev.lens, sheet: hsh.mi == null && saved == null ? { kind: 'member' } : null };
        });
      }).catch(function (e) {
        if (first) { hideSplash(true); set({ err: e && e.message ? e.message : 'unknown error' }); }
      });
    }

    useEffect(function () {
      load(true);
      // the install card appears from the second visit, for members who haven't installed the app, and can be put off for a month
      if (PWA && !standalone()) {
        var visits = (parseInt(read('trs-visits'), 10) || 0) + 1; store('trs-visits', String(visits));
        var later = parseInt(read('trs-install-later'), 10) || 0;
        if (visits >= 2 && Date.now() - later > 30 * DAY) set({ showInstall: true });
      }
      function tick() { var now = todaySAST(); set(function (prev) { return prev.asOf === now ? {} : { asOf: now }; }); }
      var clock = setInterval(tick, 5 * 60000);
      function onVis() { if (document.visibilityState !== 'visible') return; tick(); if (!window.TRS_DATA && Date.now() - loadedAt.current > 30 * 60000) load(false); }
      document.addEventListener('visibilitychange', onVis);
      function onMq() { set({ phone: isPhone() }); }
      if (phoneQuery) { if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', onMq); else if (phoneQuery.addListener) phoneQuery.addListener(onMq); }
      function onHash() {
        set(function (prev) {
          if (!prev.P) return {};
          var hsh = fromHash(prev.P);
          if (hsh.mi == null) return {};
          store('trs-member', prev.P.members[hsh.mi].id);
          if (hsh.lens) store('trs-lens', hsh.lens);
          return { mi: hsh.mi, lens: hsh.lens || prev.lens, sheet: null, showPast: false };
        });
      }
      window.addEventListener('hashchange', onHash);
      function onKey(ev) { if (ev.key === 'Escape') set({ sheet: null }); }
      window.addEventListener('keydown', onKey);
      function onInstall(v) { set({ canInstall: v }); }
      installListeners.push(onInstall);
      if (installEvt) onInstall(true);
      return function () {
        clearInterval(clock); document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey);
        installListeners = installListeners.filter(function (f) { return f !== onInstall; });
      };
    }, []);

    useEffect(function () { if (st.P) hideSplash(false); }, [!!st.P]);

    // Compare what this member could see last time with now; first visit for a member just records it.
    useEffect(function () {
      if (!st.P) return;
      var m = st.P.members[clamp(st.mi, 0, st.P.members.length - 1)], cur = snapshotFor(st.P, m), prev = readSnaps()[m.id];
      var items = prev ? diffSnap(prev, cur, st.asOf) : [];
      var seenNotice = read('trs-notice') || '', N = st.P.notice;
      var showNotice = N && N.id !== seenNotice;
      if (!items.length) saveSnap(m.id, cur);
      if (!items.length && !showNotice) { if (st.changes) set({ changes: null }); return; }
      set({ changes: { member: m.id, snap: cur, items: items, noticeId: showNotice ? N.id : '',
        title: showNotice ? (N.title || 'Notice') : 'Dates changed since your last visit', text: showNotice ? N.text : '' } });
    }, [st.P, st.mi]);

    if (st.err) return html`<div class="boot">The dates could not load (${st.err}). Check your connection, then reload the page.</div>`;
    if (!st.P) return html`<div class="boot">Loading the members’ dashboard…</div>`;

    var calBase = window.TRS_CAL_BASE || (st.P.siteUrl && !window.TRS_PWA ? st.P.siteUrl.replace(/\/?$/, '/') + 'cal/' : new URL('cal/', location.href).href);

    var P = st.P, M = buildModel(P, st);
    var list = M.groups.reduce(function (a, g) { return a.concat(g.items); }, []);
    var A = {
      openMembers: function () { set({ sheet: { kind: 'member' } }); },
      pick: function (i) { store('trs-member', P.members[i].id); clearRoleHash(P); set({ mi: i, sheet: null, showPast: false }); },
      setLens: function (l) { store('trs-lens', l); clearRoleHash(P); set({ lens: l, sheet: null, showPast: false }); },
      setAll: function (v) { set({ all: v }); },
      togglePast: function () { set(function (prev) { return { showPast: !prev.showPast }; }); },
      toggleMonth: function (k, v) { set(function (prev) { var o = Object.assign({}, prev.months); o[k] = v; return { months: o }; }); },
      toggleRule: function (id) { set(function (prev) { var o = Object.assign({}, prev.open); o[id] = !o[id]; return { open: o }; }); },
      openItem: function (k) { set({ sheet: { kind: 'item', key: k } }); },
      openOther: function (k) { store('trs-lens', M.other.lens); set({ lens: M.other.lens, showPast: false, sheet: { kind: 'item', key: k } }); },
      openAny: function (k) {
        if (M.all.some(function (it) { return it.key === k; })) return set({ sheet: { kind: 'item', key: k } });
        if (M.other.all.some(function (it) { return it.key === k; })) return A.openOther(k);
      },
      openCal: function () { set({ sheet: { kind: 'cal' } }); },
      dismissChanges: function () {
        var C = st.changes; if (!C) return;
        saveSnap(C.member, C.snap);
        if (C.noticeId) store('trs-notice', C.noticeId);
        set({ changes: null });
      },
      dismissInstall: function () { store('trs-install-later', String(Date.now())); set({ showInstall: false }); },
      close: function () { set({ sheet: null }); },
      install: function () {
        if (!installEvt) return;
        installEvt.prompt();
        var done = function () { installEvt = null; set({ canInstall: false, showInstall: false }); };
        if (installEvt.userChoice && installEvt.userChoice.then) installEvt.userChoice.then(done, done); else done();
      }
    };

    var sheet = null;
    if (st.sheet && st.sheet.kind === 'cal') {
      sheet = html`<${CalSheet} key="cal" phone=${st.phone} m=${M.m} calBase=${calBase} android=${/Android/i.test(navigator.userAgent || '')} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'member') {
      sheet = html`<${MemberSheet} key="member" phone=${st.phone} members=${P.members} mi=${M.mi} pick=${A.pick} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'item') {
      var seq = list.some(function (it) { return it.key === st.sheet.key; }) ? list : M.all;
      var idx = -1;
      seq.forEach(function (it, i) { if (it.key === st.sheet.key) idx = i; });
      if (idx >= 0) {
        sheet = html`<${ItemSheet} key="item" phone=${st.phone} it=${seq[idx]} idx=${idx} total=${seq.length} onClose=${A.close}
          prev=${function () { if (idx > 0) A.openItem(seq[idx - 1].key); }} next=${function () { if (idx < seq.length - 1) A.openItem(seq[idx + 1].key); }} />`;
      }
    }

    return html`<div class="app">
      <${Mast} M=${M} A=${A} st=${st} />
      ${st.phone ? html`<div class="lens-dock"><${LensSwitch} M=${M} A=${A} /></div>` : null}
      <main key=${M.m.id + M.lens} class=${'board fade' + (st.phone ? ' stack' : '') + (st.changes && st.changes.member === M.m.id ? ' has-changes' : '')}>
        ${st.changes && st.changes.member === M.m.id ? html`<${Changes} changes=${st.changes} A=${A} />` : null}
        <${NextCard} M=${M} A=${A} />
        ${st.phone ? [
          st.showInstall && (st.canInstall || isIOS()) ? html`<${InstallCard} key="in" A=${A} st=${st} />` : null,
          html`<${Agenda} key="ag" M=${M} A=${A} st=${st} />`,
          html`<${Side} key="sp" part="panels" M=${M} A=${A} st=${st} />`,
          html`<${TermCard} key="tc" M=${M} A=${A} />`,
          html`<${Side} key="ru" part="rules" M=${M} A=${A} st=${st} />`
        ] : [
          html`<${TermCard} key="tc" M=${M} A=${A} />`,
          html`<${Agenda} key="ag" M=${M} A=${A} st=${st} />`,
          html`<${Side} key="sd" M=${M} A=${A} st=${st} />`
        ]}
      </main>
      <${Footer} M=${M} A=${A} st=${st} />
      ${sheet}
    </div>`;
  }

  root.innerHTML = '';
  render(html`<${App} />`, root);
})();
