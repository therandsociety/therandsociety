/* The Rand Society members' app. Reads data.json (or window.TRS_DATA in the preview build) and renders one member's dashboard
   in two lenses: their Society role and their analyst seat. No build step: Preact + htm globals. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  function fail(msg) { root.innerHTML = '<div class="boot">' + msg + '</div>'; }
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
    var T = raw.term || {}, term = { name: T.name || 'H1', source: T.source || '' };
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
        out.push(Object.assign({}, e, { ms: ms, endMs: isNaN(end) ? ms : end, range: !isNaN(end) && end !== ms, roles: e.roles || {} }));
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
      cycles: cycles, updated: parseDay(raw.updated), order: order
    };
  }

  // ---------- model ----------
  function by(map, id, fallback) { return (map && map[id]) || fallback; }
  function fill(s, m) { return nbsp(String(s || '').replace(/\{sector\}/g, m.sector || '')); }
  function item(e, m, title, detail, part, label, tone, isKey) {
    return { key: e.key, ms: e.ms, endMs: e.endMs, range: e.range, type: e.type, time: e.time || '', ic: e.ic || 0,
      title: fill(title, m), detail: fill(detail, m), part: part, label: label, tone: tone, isKey: isKey, people: [] };
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
    it.sub = meet ? '17:00 to 18:30 · Teams' : it.range ? (it.type === 'marker' ? 'Until ' + dShort(it.endMs) : rangeText(it.ms, it.endMs)) : it.time ? 'By ' + it.time : '';
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
    var also = all.filter(function (it) { return !it.past && it.isKey && it !== next; }).slice(0, 3);

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
      var c = { id: r.id, title: r.title, body: nbsp(r.body), chip: r.chip || '', tone: 'quiet' };
      if (r.id === 'ap') { c.chip = phase === 'protected' ? 'In force' : phase === 'pre' ? 'From ' + dShort(T.start) : 'Ended ' + dShort(T.protectedEnd); c.tone = phase === 'protected' ? 'lead' : 'quiet'; }
      return c;
    });
    var rules = lens === 'society'
      ? shared.concat(m.safeguard ? [{ id: 'safe', title: m.safeguard.title, body: nbsp(m.safeguard.body), chip: 'Your role', tone: 'support' }] : [])
      : (P.rules.analyst || []).map(function (r) { return { id: r.id, title: r.title, body: nbsp(r.body), chip: r.chip || '', tone: 'quiet' }; }).concat(shared);

    var t = D(asOf);
    return {
      m: m, mi: mi, lens: lens, phase: phase, hero: hero, phaseTag: phaseTag, all: all, shown: shown, groups: groups, pastCount: pastItems.length,
      nextKey: firstUp ? firstUp.key : null, next: next, also: also, tl: tl, stats: stats, cycle: cycle, path: path, score: score, rules: rules,
      todayLong: wk(asOf) + ' ' + dMonth(asOf) + ' ' + t.getUTCFullYear() + ' · SAST',
      todayShort: wk(asOf).slice(0, 3) + ' ' + dShort(asOf),
      term: T, updated: isNaN(P.updated) ? '' : dMonth(P.updated) + ' ' + D(P.updated).getUTCFullYear()
    };
  }

  // ---------- small pieces ----------
  var PHOTO = {
    hor: { d: 'img/d-research.jpg', dp: '50% 46%', p: 'img/p-research.jpg', pp: '50% 44%', sat: .7 },
    pres: { d: 'img/d-president.jpg', dp: '50% 40%', p: 'img/p-president.jpg', pp: '50% 34%', sat: .6 },
    pm: { d: 'img/d-portfolio.jpg', dp: '50% 53%', p: 'img/p-portfolio.jpg', pp: '50% 40%', sat: .65 },
    coo: { d: 'img/d-coo.jpg', dp: '50% 35%', p: 'img/p-coo.jpg', pp: '62% 30%', sat: .6 }
  };
  function Logo(p) {
    return html`<svg width=${p.size} height=${p.size} viewBox="0 0 100 100" aria-hidden="true" style="display:block;flex:none;color:#FFFFFF"><rect x="3.5" y="3.5" width="93" height="93" fill="none" stroke="currentColor" stroke-width="7"></rect><circle cx="47.15" cy="55.46" r="19" fill="none" stroke="currentColor" stroke-width="8"></circle><path d="M39.28 33.85L74.48 21.04L74.48 29.55L42.02 41.37Z" fill="currentColor"></path></svg>`;
  }
  function Chev(p) { return html`<svg class=${'chev' + (p.open ? ' open' : '')} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`; }
  function Arrow(p) { return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${p.left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}></path></svg>`; }
  function Tag(p) { return p.text ? html`<span class=${'tag ' + (p.tone || 'quiet')}>${p.text}</span>` : null; }

  function Photos(p) {
    var id = p.id;
    return Object.keys(PHOTO).map(function (k) {
      var x = PHOTO[k], on = k === id;
      if (!(on || p.warm)) return null;
      return html`<img key=${k} src=${p.phone ? x.p : x.d} alt="" decoding="async" style=${'object-position:' + (p.phone ? x.pp : x.dp) + ';filter:saturate(' + x.sat + ') contrast(1.04);opacity:' + (on ? 1 : 0)} />`;
    });
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
      <button class="lens-btn" aria-pressed=${right ? 'false' : 'true'} onClick=${function () { A.setLens('society'); }}><span class="lens-k">Society role</span><span class="lens-v">${M.m.roleShort || M.m.role}</span></button>
      <button class="lens-btn" aria-pressed=${right ? 'true' : 'false'} onClick=${function () { A.setLens('analyst'); }}><span class="lens-k">Analyst</span><span class="lens-v">${M.m.sector}</span></button>
    </div>`;
  }

  function Mast(p) {
    var M = p.M, A = p.A, st = p.st, phone = st.phone;
    return html`<header class="mast on-navy">
      <div class="mast-photo" aria-hidden="true"><${Photos} id=${M.m.id} phone=${phone} warm=${st.warm} /></div>
      <div class="mast-inner">
        <div class="topbar">
          <div class="brand"><${Logo} size=${phone ? 30 : 36} /><span class="brand-word">THE RAND SOCIETY</span></div>
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
    var M = p.M, A = p.A, n = M.next;
    return html`<section class="card next" aria-labelledby="next-h">
      <div class="card-head"><h2 id="next-h" class="card-k">Next for you</h2>${n ? html`<${Tag} text=${n.soon} tone=${n.current ? 'now' : 'when'} />` : null}</div>
      ${n ? html`<button class="next-main" onClick=${function () { A.openItem(n.key); }}>
        <span class="datebox tnum" aria-hidden="true"><span class="d">${n.day}</span><span class="m">${n.mon}</span></span>
        <span class="next-text"><span class="next-title">${n.title}</span><span class="next-meta"><${Tag} text=${n.label} tone=${n.tone} /><span class="tnum">${n.whenShort}</span></span></span>
      </button>` : html`<p class="next-empty">Nothing else is dated for you this term.</p>`}
      ${M.also.length ? html`<div class="then-wrap"><div class="then-k">Also coming up</div><ul class="then">${M.also.map(function (it) {
        return html`<li key=${it.key}><button class="then-row" onClick=${function () { A.openItem(it.key); }}><span class="dt tnum">${dShort(it.ms)}</span><span class="tt">${it.title}</span><${Tag} text=${it.label} tone=${it.tone} /></button></li>`;
      })}</ul></div>` : null}
    </section>`;
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
    </section>`;
  }

  function Side(p) {
    var M = p.M, A = p.A, st = p.st, m = M.m;
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
    return html`<div class="side">
      ${top}
      <section class="card rules" aria-labelledby="ru-h">
        <div class="card-head" style="padding-bottom:8px"><h2 id="ru-h" class="card-title">Rules</h2></div>
        ${M.rules.map(function (r) {
          var open = !!st.open[r.id];
          return html`<div key=${r.id} class="rule"><button class="rule-btn" aria-expanded=${open ? 'true' : 'false'} aria-controls=${'rule-' + r.id} onClick=${function () { A.toggleRule(r.id); }}>
            <span>${r.title}</span>${r.chip ? html`<${Tag} text=${r.chip} tone=${r.tone} />` : html`<span></span>`}<${Chev} open=${open} />
          </button>${open ? html`<p id=${'rule-' + r.id}>${r.body}</p>` : null}</div>`;
        })}
      </section>
    </div>`;
  }

  function Footer(p) {
    var M = p.M, A = p.A, st = p.st;
    return html`<footer class="foot on-navy"><div class="foot-inner">
      <div class="brand"><${Logo} size=${28} /><span class="brand-word">THE RAND SOCIETY</span></div>
      <div class="foot-meta">
        <b>Members only. Not for external circulation.</b>
        <span>Dates: ${M.term.source}. Times are SAST.</span>
        ${M.updated ? html`<span>Updated ${M.updated}.</span>` : null}
        ${st.iosTip ? html`<span class="ios-tip">On iPhone: tap Share, then Add to Home Screen.</span>` : null}
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
        asOf: todaySAST(), phone: isPhone(), warm: false, canInstall: false, iosTip: PWA && isIOS() && !standalone() };
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
        if (first) set({ err: e && e.message ? e.message : 'unknown error' });
      });
    }

    useEffect(function () {
      load(true);
      var warmT = setTimeout(function () { set({ warm: true }); }, 1500);
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
        clearTimeout(warmT); clearInterval(clock); document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey);
        installListeners = installListeners.filter(function (f) { return f !== onInstall; });
      };
    }, []);

    if (st.err) return html`<div class="boot">The dates could not load (${st.err}). Check your connection, then reload the page.</div>`;
    if (!st.P) return html`<div class="boot">Loading the members’ dashboard…</div>`;

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
      close: function () { set({ sheet: null }); },
      install: function () {
        if (!installEvt) return;
        installEvt.prompt();
        var done = function () { installEvt = null; set({ canInstall: false }); };
        if (installEvt.userChoice && installEvt.userChoice.then) installEvt.userChoice.then(done, done); else done();
      }
    };

    var sheet = null;
    if (st.sheet && st.sheet.kind === 'member') {
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
      <main key=${M.m.id + M.lens} class="board fade">
        <${NextCard} M=${M} A=${A} />
        <${TermCard} M=${M} A=${A} />
        <${Agenda} M=${M} A=${A} st=${st} />
        <${Side} M=${M} A=${A} st=${st} />
      </main>
      <${Footer} M=${M} A=${A} st=${st} />
      ${sheet}
    </div>`;
  }

  root.innerHTML = '';
  render(html`<${App} />`, root);
})();
