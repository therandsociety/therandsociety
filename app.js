
/* The Rand Society members' app. Reads data.json (or window.TRS_DATA in the preview build) and renders one member's dashboard
   in two lenses: their Society role and their analyst seat. No build step: Preact + htm globals. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  // Launch screen: index.html shows the logo and name until the dashboard is ready. The first open in a session holds it
  // for at least 1.7 s from page start (so the logo, name and loading line finish); later opens that day take about 0.6 s;
  // then it opens into the dashboard, whose own entrance plays as the screen clears.
  function hideSplash(now) {
    var el = document.getElementById('splash');
    if (!el || el.getAttribute('data-out')) return;
    el.setAttribute('data-out', '1');
    var de = document.documentElement, quick = de.classList.contains('splash-quick');  // set by index.html after the first open of the day
    var t = window.performance && performance.now ? performance.now() : 0;
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { de.classList.remove('splashing'); }, now ? 0 : quick ? 120 : 250);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, quick ? 620 : 950);
    }, now ? 0 : Math.max(0, (quick ? 600 : 1700) - t));
  }
  function fail(msg) { document.documentElement.classList.remove('splashing'); hideSplash(true); root.innerHTML = '<div class="boot">' + msg + '</div>'; }
  if (!window.preact || !window.preactHooks || !window.htm) { fail('The dashboard could not load. Check your connection, then reload the page.'); return; }
  var h = preact.h, render = preact.render;
  var useState = preactHooks.useState, useEffect = preactHooks.useEffect, useRef = preactHooks.useRef, useLayoutEffect = preactHooks.useLayoutEffect || preactHooks.useEffect;
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

  // The current moment, for live countdowns on the day. ?now=HH:MM (with ?asof) previews a time of day.
  function nowMs(asOf) {
    var q = null;
    try { q = /[?&]now=([01]\d|2[0-3]):([0-5]\d)/.exec(location.search); } catch (e) { /* no query */ }
    if (!q && window.TRS_NOW) q = /^(\d{2}):(\d{2})$/.exec(String(window.TRS_NOW));
    if (q) return asOf + ((+q[1] - 2) * 60 + +q[2]) * 60000;
    // previewing another day (?asof) without a time: keep today's time of day on that day, so nothing reads as already over
    var t = Date.now(), sod = (t + 2 * 3600000) % DAY;
    return asOf + sod - 2 * 3600000;
  }
  function atSAST(dayMs, hhmm) { var t = String(hhmm || '00:00').split(':'); return dayMs + ((+t[0] - 2) * 60 + +t[1]) * 60000; }
  function span(ms) { var mins = Math.max(1, Math.round(ms / 60000)), h = Math.floor(mins / 60), m = mins % 60; return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min'; }
  // Live state of something happening today: a countdown to a deadline, or where a meeting stands.
  function live(it, now) {
    if (!it || !it.current || it.range) return null;
    if (it.type === 'meeting') {
      var a = atSAST(it.ms, '17:00'), b = atSAST(it.ms, '18:30');
      if (now < a) return { text: 'Starts in ' + span(a - now), tone: a - now <= 3600000 ? 'u-week' : 'when', join: a - now <= 30 * 60000 };
      if (now < b) return { text: 'Live now', tone: 'now', join: true };
      return { text: 'Ended', tone: 'quiet', join: false };
    }
    if (it.type === 'deadline' && it.time) {
      var c = atSAST(it.ms, it.time);
      if (now < c) return { text: span(c - now) + ' left', tone: c - now <= 2 * 3600000 ? 'u-soon' : 'u-week' };
      return { text: 'Closed at ' + it.time, tone: 'quiet' };
    }
    return null;
  }

  function todaySAST() {
    var s = null;
    try { var q = /[?&]asof=(\d{4}-\d{2}-\d{2})/.exec(location.search); if (q) s = q[1]; } catch (e) { /* no query */ }
    if (!s && window.TRS_AS_OF) s = String(window.TRS_AS_OF);
    if (!s) { try { s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { s = null; } }
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) s = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
    return parseDay(s);
  }

  // ---------- data ----------
  // Resolves to { raw, source }: 'network' (fresh), 'cache' (the saved copy, because offline or the server was slow) or 'bundled' (preview).
  function loadData() {
    if (window.TRS_DATA) return Promise.resolve({ raw: window.TRS_DATA, source: 'bundled' });
    function fromCache(err) {
      if (!window.caches) throw err;
      return caches.match('data.json').then(function (r) { if (!r) throw err; return r.json().then(function (raw) { return { raw: raw, source: 'cache' }; }); });
    }
    return fetch('data.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var src = r.headers.get('x-trs-source') === 'cache' ? 'cache' : 'network';
        return r.json().then(function (raw) { return { raw: raw, source: src }; });
      })
      .catch(fromCache);
  }
  function clockSAST(ms) {
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); }
    catch (e) { var d = new Date(ms + 2 * 3600000); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  }

  // Optional background photos for the Plan, Meetings, Learn and You headers (data.json "photos"; "role" or "guide" also
  // work for You). Only files in img/ are
  // used, so they stay on the Society's site and are saved for offline use the first time they are shown.
  function sectionPhotos(src) {
    var out = {}, ok = /^img\/[\w.\-\/]+\.(webp|jpe?g|png|avif)$/i;
    Object.keys(src || {}).forEach(function (k) {
      var v = src[k], id = k === 'meetings' ? 'meet' : k === 'role' || k === 'guide' ? 'you' : k;
      if (typeof v === 'string') v = { src: v };
      if (!v || !ok.test(v.src || '') || ['plan', 'meet', 'learn', 'you'].indexOf(id) < 0 || (out[id] && k !== 'you')) return;
      out[id] = { d: v.src, p: ok.test(v.phone || '') ? v.phone : v.src, dp: v.position || '50% 50%', pp: v.phonePosition || v.position || '50% 50%' };
    });
    return out;
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
      cycles: cycles, updated: parseDay(raw.updated), order: order, reviewQueues: raw.reviewQueues || {}, photos: sectionPhotos(raw.photos),
      checklists: (Array.isArray(raw.checklists) ? raw.checklists : []).filter(function (c) { return c && c.id && Array.isArray(c.for) && Array.isArray(c.items) && c.items.length; }),
      library: (Array.isArray(raw.library) ? raw.library : []).filter(function (l) { return l && l.title && /^https:\/\/\S+$/.test(l.url || ''); }),
      // a notice shows once per device: as a note on Today, or with "popup": true as a message that opens over the app;
      // "until" (YYYY-MM-DD) stops it showing to anyone who first opens the app after that day
      notice: raw.notice && raw.notice.id && raw.notice.text ? Object.assign({}, raw.notice, { untilMs: parseDay(raw.notice.until),
        points: (Array.isArray(raw.notice.points) ? raw.notice.points : []).filter(function (t) { return typeof t === 'string' && t.trim(); }) }) : null,
      teams: (raw.site && /^https:\/\//.test(raw.site.teams || '') && raw.site.teams) || '',
      siteUrl: (raw.site && raw.site.url) || ''
    };
  }

  var DEFAULT_TIME = '';
  // ---------- model ----------
  // Links to templates, folders or pre-reads ([{ "label", "url" }]); only full https:// addresses are shown.
  function links(arr) { return (Array.isArray(arr) ? arr : []).filter(function (l) { return l && l.label && /^https:\/\/\S+$/.test(l.url || ''); }).slice(0, 4); }
  function by(map, id, fallback) { return (map && map[id]) || fallback; }
  function fill(s, m) { return nbsp(String(s || '').replace(/\{sector\}/g, m.sector || '')); }
  function item(e, m, title, detail, part, label, tone, isKey) {
    return { key: e.key, ms: e.ms, endMs: e.endMs, range: e.range, type: e.type, time: e.time || '', ic: e.ic || 0,
      title: fill(title, m), detail: fill(detail, m), part: part, label: label, tone: tone, isKey: isKey, people: [],
      timeSet: e.timeSet || '', status: (e.status && e.status[m.id]) || '', link: /^https:\/\//.test(e.link || '') ? e.link : '', links: links(e.links), preread: e.preread || '' };
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

  // Option B, "calm until it matters": only your own deadlines get colour, and only when they are close.
  //   far  (8+ days)  navy as usual        week (3-7 days) soft orange      soon (0-2 days) solid orange
  //   sub  you marked it submitted (this phone)    ok  the Society recorded it accepted    rev  revision needed
  //   gap  the date passed and it wasn't marked
  function bandOf(it, since) {
    if (it.part !== 'lead' || it.type !== 'deadline') return '';
    // The Society's recorded result outranks a member's own "submitted" mark: work returned for revision shows as
    // such even if it was marked submitted earlier.
    if (it.status === 'accepted') return 'ok';
    if (it.status === 'minor') return 'min';
    if (it.status === 'revise') return 'rev';
    if (it.status === 'incomplete') return 'nc';
    if (it.submitted) return 'sub';
    if (it.past) return since && it.ms >= since ? 'gap' : 'past';
    return it.n <= 2 ? 'soon' : it.n <= 7 ? 'week' : 'far';
  }
  function isDone(it) { return it.band === 'ok' || it.band === 'sub' || it.band === 'min'; }
  function stateTag(it) {
    switch (it.band) {
      case 'ok': return { text: 'Accepted', tone: 'ok' };
      case 'sub': return { text: 'Submitted', tone: 'sub' };
      case 'rev': return { text: 'Revision needed', tone: 'u-week' };
      case 'min': return { text: 'Minor corrections', tone: 'okm' };
      case 'nc': return { text: 'Not completed', tone: 'u-soon' };
      case 'soon': return { text: it.current ? 'Due today' : it.n === 1 ? 'Due tomorrow' : 'Due in ' + it.n + ' days', tone: 'u-soon' };
      case 'week': return { text: 'Due in ' + it.n + ' days', tone: 'u-week' };
      case 'gap': return { text: it.closed ? it.soon : 'Not marked', tone: 'quiet' };
      case 'past': return { text: it.closed ? it.soon : 'Passed', tone: 'quiet' };
      default: return { text: it.label, tone: it.tone };
    }
  }
  // Bug fix: after 17:00 on its day a deadline is closed, and after 18:30 a meeting has ended, so neither stays "today".
  function closeOut(items, now) {
    items.forEach(function (it) {
      if (!it.current || it.range) return;
      var end = it.type === 'meeting' ? atSAST(it.ms, '18:30') : (it.type === 'deadline' && it.time ? atSAST(it.ms, it.time) : 0);
      if (end && now >= end) { it.past = true; it.current = false; it.closed = true; it.soon = it.type === 'meeting' ? 'Ended' : 'Closed at ' + it.time; }
    });
    return items;
  }
  // "since": the day this member first marked something on this phone. Unmarked past deadlines only count from then,
  // so members who never use ticks aren't nagged.
  function mark(P, m, items, done, since) {
    items.forEach(function (it) { it.submitted = !!done[m.id + ':' + it.key]; it.band = bandOf(it, since); it.tag = stateTag(it); });
    return items;
  }

  // What reviewers owe other Members, from data.reviewQueues: shown from a fortnight before work arrives until it is due.
  function reviewQueue(P, m, asOf) {
    var cfg = (P.reviewQueues || {})[m.id];
    if (!cfg || !cfg.length) return null;
    var byKey = {};
    P.analyst.forEach(function (e) { byKey[e.key] = e; });
    var rows = [];
    P.members.forEach(function (x) {
      if (x.id === m.id) return;
      cfg.forEach(function (q) {
        var c = x.cycle || 'A', a = byKey[String(q.arrives).replace('{cycle}', c)], d = byKey[String(q.due).replace('{cycle}', c)];
        if (!a || !d) return;
        var dn = byKey[String(q.doneOn || q.arrives).replace('{cycle}', c)], accepted = !!(dn && dn.status && dn.status[x.id] === 'accepted');
        if (d.ms < asOf || a.ms - asOf > 14 * DAY) return;
        var n = Math.round((d.ms - asOf) / DAY), open = a.ms <= asOf;
        rows.push({ id: x.id + q.arrives, who: x.roleShort || x.role, what: x.sector + ' ' + q.what, due: d.ms, accepted: !!accepted,
          when: open ? (q.dueLabel || 'Due') + ' ' + wk(d.ms).slice(0, 3) + ' ' + dShort(d.ms) : 'From ' + wk(a.ms).slice(0, 3) + ' ' + dShort(a.ms) + ' · ' + (q.dueLabel || 'Due').replace(/^./, function (c) { return c.toLowerCase(); }) + ' ' + dShort(d.ms),
          tag: accepted ? { text: 'Accepted', tone: 'ok' } : !open ? { text: 'Coming', tone: 'quiet' } : n <= 2 ? { text: n <= 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : 'Due in ' + n + ' days', tone: 'u-soon' } : n <= 7 ? { text: 'Due in ' + n + ' days', tone: 'u-week' } : { text: 'Open', tone: 'when' } });
      });
    });
    rows.sort(function (a, b) { return a.due - b.due; });
    return rows.length ? { rows: rows, open: rows.filter(function (r) { return !r.accepted && r.tag.text !== 'Coming'; }).length } : null;
  }
  // Every rule, from both views, for search.
  function allRules(P, m, phase) {
    var out = [];
    (P.rules.shared || []).forEach(function (r) { out.push({ id: r.id, title: r.title, body: String(r.body || '').replace(/\{time\}/g, DEFAULT_TIME || '17:00'), lens: '' }); });
    (P.rules.analyst || []).forEach(function (r) { out.push({ id: r.id, title: r.title, body: r.body, lens: 'analyst' }); });
    if (m.safeguard) out.push({ id: 'safe', title: m.safeguard.title, body: m.safeguard.body, lens: 'society' });
    return out;
  }

  function buildModel(P, st) {
    var asOf = st.asOf, T = P.term;
    var mi = clamp(st.mi || 0, 0, P.members.length - 1), m = P.members[mi], lens = st.lens === 'analyst' ? 'analyst' : 'society';
    var phase = asOf < T.start ? 'pre' : asOf <= T.protectedEnd ? 'protected' : (asOf >= T.recessStart && asOf <= T.recessEnd) ? 'recess' : asOf > T.close ? 'closed' : 'open';
    var done = st.done || {}, since = (st.since || {})[m.id] || 0, now = st.now || Date.now();
    var all = mark(P, m, closeOut(lensItems(P, m, lens).map(function (it) { return decorate(it, asOf); }), now), done, since);
    var shown = st.all ? all : all.filter(function (it) { return it.isKey; });
    // Something that closed earlier today stays in the list (dimmed, "Closed at 17:00") until midnight.
    var pastItems = shown.filter(function (it) { return it.past && !it.closed; });
    var listed = st.showPast ? shown : shown.filter(function (it) { return !it.past || it.closed; });
    var groups = [];
    listed.forEach(function (it) {
      var g = groups[groups.length - 1];
      if (!g || g.k !== it.monthKey) { g = { k: it.monthKey, name: it.monthName, items: [] }; groups.push(g); }
      g.items.push(it);
    });
    var upIdx = 0, months = st.months || {};
    groups.forEach(function (g) {
      var up = g.items.some(function (it) { return !it.past || it.closed; });
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
    var mine = all.filter(function (it) { return it.part === 'lead' && !it.past && !isDone(it); });
    // Meetings have their own card, so the top card is about work: the next deadline you lead.
    var next = mine.filter(function (it) { return it.type !== 'meeting'; })[0] || all.filter(function (it) { return !it.past && it.isKey && it.type !== 'meeting'; })[0] || null;
    var nextLabel = !next ? '' : next.type === 'meeting' ? 'Your next meeting' : (next.part === 'lead' && next.type === 'deadline') ? 'Your next deadline' : 'Next for you';
    // seven days from today: what lands on each day in this view
    var week = [], wDue = 0, wMeet = 0, seen = {};
    for (var wi = 0; wi < 7; wi++) {
      var dayMs = asOf + wi * DAY;
      var on = all.filter(function (it) { return it.isKey && !(it.type === 'marker' && !it.part) && (it.ms === dayMs || (it.range && it.endMs === dayMs)); });
      on.forEach(function (it) { if (seen[it.key]) return; seen[it.key] = 1; if (it.type === 'meeting') wMeet++; else if (it.part === 'lead' && !isDone(it)) wDue++; });
      week.push({ ms: dayMs, wk: wk(dayMs).slice(0, 3), d: D(dayMs).getUTCDate(), today: wi === 0, items: on,
        marks: on.slice(0, 3).map(function (it) { return it.type === 'meeting' ? 'meet' : it.part === 'lead' ? (isDone(it) ? 'due done' : 'due ' + (it.band || '')) : 'other'; }),
        label: wk(dayMs) + ' ' + dMonth(dayMs) + (on.length ? ': ' + on.map(function (it) { return it.title; }).join('; ') : ': nothing scheduled') });
    }
    var weekBits = [];
    if (wDue) weekBits.push(wDue + ' ' + plural(wDue, 'deadline'));
    if (wMeet) weekBits.push(wMeet + ' ' + plural(wMeet, 'meeting'));
    var weekSummary = weekBits.length ? weekBits.join(' · ') : 'Nothing scheduled';
    // the other role: its next deadline, and how many fall within a week
    var otherLens = lens === 'society' ? 'analyst' : 'society';
    var oAll = mark(P, m, closeOut(lensItems(P, m, otherLens).map(function (it) { return decorate(it, asOf); }), now), done, since);
    var oDue = oAll.filter(function (it) { return it.part === 'lead' && it.type === 'deadline' && !it.past && !isDone(it); });
    var oWeek = oDue.filter(function (it) { return it.n <= 7; });
    var other = { lens: otherLens, label: otherLens === 'analyst' ? 'As a ' + m.sector + ' analyst' : 'As ' + (m.roleShort || m.role),
      next: oDue[0] || null, week: oWeek.length, urgent: oWeek.some(function (it) { return it.n <= 2; }), all: oAll };
    // progress across this view's own deadlines
    var own = all.filter(function (it) { return it.part === 'lead' && it.type === 'deadline'; });
    var segOf = { ok: 'ok', min: 'min', sub: 'sub', rev: 'rev', nc: 'nc', gap: 'gap', past: 'past', soon: 'soon', week: 'week', far: 'todo' };
    var nDone = own.filter(isDone).length, nWeek = own.filter(function (it) { return it.band === 'soon' || it.band === 'week'; }).length;
    var nRev = own.filter(function (it) { return it.band === 'rev'; }).length, nGap = own.filter(function (it) { return it.band === 'gap'; }).length;
    var capBits = [nDone + ' of ' + own.length + ' submitted'];
    if (nWeek) capBits.push(nWeek + ' due within a week');
    if (nRev) capBits.push(nRev + ' ' + plural(nRev, 'needs', 'need') + ' revision');
    if (nGap) capBits.push(nGap + ' past ' + plural(nGap, 'date') + ' not marked');
    var nNc = own.filter(function (it) { return it.band === 'nc'; }).length;
    if (nNc) capBits.push(nNc + ' not completed');
    var progress = own.length ? { segs: own.map(function (it) { return { key: it.key, s: segOf[it.band] || 'todo', title: it.title + ': ' + it.tag.text }; }), cap: capBits.join(' · ') } : null;

    var ics = P.society.filter(function (e) { return e.ic; });
    // the next formal IC that hasn't finished (one that ended at 18:30 today no longer counts as next)
    var nextIC = ics.filter(function (e) { return atSAST(e.endMs, '18:30') > now; })[0] || null;
    var hero = {};
    if (phase === 'pre' || phase === 'protected') { hero.h = 'Studies first.'; hero.p = 'Academic Priority runs to ' + dMonth(T.protectedEnd) + '. Society work resumes on ' + dMonth(T.resume) + '.'; }
    else if (phase === 'recess') { hero.h = 'Year-end recess.'; hero.p = 'Urgent matters only until ' + dMonth(T.recessEnd) + '. Full production resumes on ' + dMonth(T.fullProduction) + '.'; }
    else if (phase === 'closed') { hero.h = 'H1 is closed.'; hero.p = 'The term closed on ' + dMonth(T.close) + ' ' + D(T.close).getUTCFullYear() + '.'; }
    else { hero.h = 'The programme is open.'; hero.p = nextIC ? (nextIC.ms === asOf ? 'Formal IC ' + nextIC.ic + (now >= atSAST(asOf, '17:00') ? ' is on now, until 18:30.' : ' is today at 17:00.') : 'Next formal IC: ' + wk(nextIC.ms) + ' ' + dMonth(nextIC.ms) + ', 17:00.') : asOf < T.close ? 'The controlled close is ' + dMonth(T.close) + '.' : 'The term closes today.'; }
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
      dots: all.filter(function (it) { return it.part === 'lead' && it.type !== 'meeting'; }).map(function (it) { return { key: it.key, left: pct(pos(it.ms)), past: it.past, band: it.band || '', title: it.title + ', ' + dShort(it.ms) }; }),
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
    var rulesAll = [
      { id: 'society', title: 'Every Member', items: shared.concat(m.safeguard ? [{ id: 'safe', title: m.safeguard.title, body: nbsp(m.safeguard.body), chip: 'Your role', tone: 'support' }] : []) },
      { id: 'analyst', title: 'Analysts', items: (P.rules.analyst || []).map(function (r) { return { id: r.id, title: r.title, body: nbsp(r.body), chip: r.chip || '', tone: 'quiet' }; }) }
    ];

    // Meetings: each Society meeting with this member's part in both roles, and the run-up and follow-up the rules set
    // (agenda by Friday 17:00, minutes by Tuesday 17:00, and pre-reads only where the meeting names a date: the Master
    // Calendar sets them for IC 1 and, on the Saturday, for the two Pitch ICs).
    var socAll = lens === 'society' ? all : oAll, anaBy = {};
    (lens === 'analyst' ? all : oAll).forEach(function (it) { if (it.type === 'meeting') anaBy[it.key] = it; });
    var meetings = socAll.filter(function (it) { return it.type === 'meeting'; }).map(function (it) {
      var a = anaBy[it.key], start = atSAST(it.ms, '17:00'), end = atSAST(it.ms, '18:30'), parts = [];
      if (it.part) parts.push({ text: it.label, tone: it.tone });
      if (a && a.part) parts.push({ text: a.label, tone: a.tone });
      var minutesMine = parts.some(function (x) { return /minute/i.test(x.text); });
      var pr = parseDay(it.preread);
      var chain = D(it.ms).getUTCDay() !== 0 ? [] : [{ k: 'Agenda', day: it.ms - 2 * DAY, at: atSAST(it.ms - 2 * DAY, '17:00') }]
        .concat(isNaN(pr) || pr >= it.ms ? [] : [{ k: 'Pre-reads', day: pr, at: atSAST(pr, '17:00') }])
        .concat([{ k: 'Meeting', day: it.ms, at: end, meet: true }, { k: 'Minutes', day: it.ms + 2 * DAY, at: atSAST(it.ms + 2 * DAY, '17:00'), mine: minutesMine }]);
      var nextSet = false;
      chain.forEach(function (c) {
        c.short = wk(c.day).slice(0, 3) + ' ' + D(c.day).getUTCDate();
        c.when = wk(c.day).slice(0, 3) + ' ' + dShort(c.day) + (c.meet ? ', 17:00 to 18:30' : ', 17:00');
        c.state = now >= c.at ? 'done' : c.meet && now >= start ? 'live' : nextSet ? 'todo' : 'next';
        if (c.state !== 'done') nextSet = true;
      });
      return { key: it.key, it: it, ms: it.ms, title: it.title, kind: it.ic ? 'Investment Committee' : /^learning/i.test(it.title) ? 'Learning session' : 'Meeting',
        parts: parts, detail: it.detail, aDetail: a && a.detail && a.detail !== it.detail ? a.detail : '', live: live(it, now),
        ended: now >= end, chain: chain, minutesAt: chain.length ? chain[chain.length - 1].at : 0, link: it.link || P.teams };
    });
    var nextMeet = meetings.filter(function (x) { return !x.ended; })[0] || null;
    var minutesDue = meetings.filter(function (x) { return x.ended && x.minutesAt && now < x.minutesAt; }).pop() || null;
    var badges = {
      today: all.concat(oAll).some(function (it) { return it.band === 'soon'; }) ? 'due' : '',
      meet: nextMeet && nextMeet.live && nextMeet.live.text === 'Live now' ? 'live' : nextMeet && nextMeet.it.current ? 'today' : ''
    };
    var phaseName = { pre: 'Before the term', protected: 'Academic Priority', open: asOf < T.recessStart ? 'Foundation' : 'Research and pitches', recess: 'Year-end recess', closed: 'H1 closed' }[phase];

    var t = D(asOf);
    return {
      m: m, mi: mi, lens: lens, phase: phase, hero: hero, phaseTag: phaseTag, all: all, shown: shown, groups: groups, pastCount: pastItems.length,
      queue: lens === 'society' ? reviewQueue(P, m, asOf) : null, searchRules: allRules(P, m, phase),
      progress: progress, nextKey: firstUp ? firstUp.key : null, next: next,
      meetings: meetings, nextMeet: nextMeet, photos: P.photos || {},
      checkFor: function (key) {
        var c = (P.checklists || []).filter(function (x) { return x.for.indexOf(key) >= 0; })[0];
        if (!c) return null;
        var stt = ((st.checks || {})[m.id] || {})[c.id] || {};
        return { c: c, state: stt, done: c.items.filter(function (x, i) { return stt[i]; }).length, total: c.items.length };
      }, minutesDue: minutesDue, badges: badges, rulesAll: rulesAll,
      planLine: phase === 'closed' ? 'The term closed on ' + dMonth(T.close) + '.' : phaseName + ' · ' + stat3.v + ' ' + stat3.l,
      nextLive: live(next, st.now), teams: P.teams,
      today: all.filter(function (it) { return it.current && it !== next && !it.range && it.part === 'lead' && it.type === 'deadline' && !isDone(it); })
        .map(function (it) { return { it: it, live: live(it, st.now) }; }).filter(function (x) { return x.live; }), nextLabel: nextLabel, week: week, weekSummary: weekSummary, other: other, tl: tl, stats: stats, cycle: cycle, path: path, score: score,
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
    return html`<svg width=${Math.round(p.size * 516 / 580)} height=${p.size} viewBox="10 10 516 580" aria-hidden="true" style=${'display:block;flex:none;color:' + (p.color || '#FFFFFF')}><path fill="currentColor" fill-rule="evenodd" d=${TRS_D}></path></svg>`;
  }
  function Chev(p) { return html`<svg class=${'chev' + (p.open ? ' open' : '')} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`; }
  function Arrow(p) { return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${p.left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'}></path></svg>`; }
  function TeamsIcon() { return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"></rect><path d="m16 10 5-3v10l-5-3"></path></svg>`; }
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
      var f = ref.current.querySelectorAll('input, button:not([disabled]), a[href]');
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
      <div ref=${ref} class=${'sheet ' + (p.phone ? 'bottom-sheet' : 'side-sheet') + (p.skin && SKIN ? ' ' + SKIN : '')} role="dialog" aria-modal="true" aria-label=${p.label} tabindex="-1" onKeyDown=${onKey}>
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
        <div class="sheet-tags"><${Tag} text=${it.tag.text} tone=${it.tag.tone} />${it.band && it.band !== 'far' ? null : html`<${Tag} text=${it.soon} tone=${it.current ? 'now' : it.past ? 'quiet' : 'when'} />`}</div>
        <p class="sheet-detail">${it.detail}</p>
        ${it.band === 'ok' ? html`<div class="mark"><span class="tag ok">Accepted</span><span>Recorded by the Society after quality review.</span></div>`
          : it.band === 'min' ? html`<div class="mark"><span class="tag okm">Minor corrections</span><span>Accepted subject to minor corrections. Correct and file by the stated date.</span></div>`
          : it.part === 'lead' && it.type === 'deadline' ? html`<div class="mark">
            <button class=${'mark-btn' + (it.submitted ? ' on' : '')} aria-pressed=${it.submitted ? 'true' : 'false'} onClick=${function () { p.toggleDone(it.key, it.title); }}>${it.submitted ? html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>Submitted` : 'Mark as submitted'}</button>
            <span>${it.band === 'rev' ? (it.submitted ? 'You marked the revised version as submitted. It stays here until the Society records the outcome.' : 'The reviewer asked for changes. Mark it once you resubmit.')
              : it.band === 'nc' ? 'Recorded as not completed. It goes to the traffic-light review with a revised date.'
              : it.submitted ? 'Saved on this device. Tap again to undo.' : 'Only you see this. It turns green once the Society records it as accepted.'}</span>
          </div>` : null}
        ${p.check ? html`<${Checklist} c=${p.check} state=${p.checkState} toggle=${p.toggleCheck} />` : null}
        <${LinkRow} links=${it.links} />
        ${it.type === 'meeting' && !it.past ? html`<${MeetActions} it=${it} A=${p.A} />` : null}
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
      <button class="lens-btn" aria-pressed=${right ? 'false' : 'true'} aria-label=${'Society role, ' + (M.m.roleShort || M.m.role) + (right && M.other.week ? ', ' + M.other.week + ' due within a week' : '')} onClick=${function () { A.setLens('society'); }}><span class="lens-k">Society role${right && M.other.week ? html`<span class=${'lens-due' + (M.other.urgent ? ' urgent' : '')}>${M.other.week} due</span>` : null}</span><span class="lens-v">${M.m.roleShort || M.m.role}</span></button>
      <button class="lens-btn" aria-pressed=${right ? 'true' : 'false'} aria-label=${'Analyst, ' + M.m.sector + (!right && M.other.week ? ', ' + M.other.week + ' due within a week' : '')} onClick=${function () { A.setLens('analyst'); }}><span class="lens-k">Analyst${!right && M.other.week ? html`<span class=${'lens-due' + (M.other.urgent ? ' urgent' : '')}>${M.other.week} due</span>` : null}</span><span class="lens-v">${M.m.sector}</span></button>
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
          ${phone ? html`<span class="eyebrow">${M.todayShort}</span>` : null}
          <h1>${M.hero.h}</h1>
          <p>${M.hero.p}</p>
          ${phone ? null : html`<div style="margin-top:14px"><${LensSwitch} M=${M} A=${A} /></div>`}
        </div>
      </div>
    </header>`;
  }

  function NextCard(p) {
    var M = p.M, A = p.A, n = M.next, o = M.other;
    var chip = !n ? null : n.band === 'soon' ? 'u-soon' : n.band === 'week' || n.band === 'rev' ? 'u-week' : n.current ? 'now' : 'when';
    var L = M.nextLive, chipText = L ? L.text : n && n.soon;
    if (L) chip = L.tone;
    function joinLink(it) { return it.link || M.teams; }
    var canMark = n && n.part === 'lead' && n.type === 'deadline' && n.band !== 'ok' && n.band !== 'min', ck = n && M.checkFor(n.key);
    return html`<section class=${'card next' + (n && n.band ? ' b-' + n.band : '')} aria-labelledby="next-h">
      <div class="card-head"><h2 id="next-h" class="card-k">${M.nextLabel || 'Next for you'}</h2>${n ? html`<span class="live-chip" aria-live="polite"><${Tag} text=${chipText} tone=${chip} /></span>` : null}</div>
      ${n ? html`<button key=${n.key} class="next-main" onClick=${function () { A.openItem(n.key); }}>
        <span class="datebox tnum" aria-hidden="true"><span class="d">${n.day}</span><span class="m">${n.mon}</span></span>
        <span class="next-text"><span class="next-title">${n.title}</span><span class="next-meta"><${Tag} text=${n.tag.text} tone=${n.tag.tone} /><span class="tnum">${n.whenShort}</span></span></span>
      </button>` : html`<p class="next-empty">Nothing else is dated for you in this view.</p>`}
      ${n && L && L.join && joinLink(n) ? html`<div class="next-act"><a class="join" href=${joinLink(n)} target="_blank" rel="noopener"><${TeamsIcon} />Join on Teams</a><span>${L.text === 'Live now' ? 'The meeting is on' : 'Opens 30 minutes before'}</span></div>` : null}
      ${canMark ? html`<div class="next-act"><button class="mark-btn" onClick=${function () { A.toggleDone(n.key, n.title); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>Mark as submitted</button>${ck ? html`<button class="ck-chip" onClick=${function () { A.openItem(n.key); }} aria-label=${'Readiness checklist, ' + ck.done + ' of ' + ck.total + ' ticked'}><span class="ck-ring" style=${'--p:' + Math.round(100 * ck.done / ck.total)} aria-hidden="true"></span>Checklist ${ck.done}/${ck.total}</button>` : html`<span>Only you see this</span>`}</div>` : null}
      ${M.today.length ? html`<ul class="today" aria-label="Also today">${M.today.map(function (x) {
        var it = x.it, link = joinLink(it);
        return html`<li key=${it.key}>
          <button class="today-row" onClick=${function () { A.openItem(it.key); }}><span class="today-k">Today</span><span class="today-t">${it.title}</span><${Tag} text=${x.live.text} tone=${x.live.tone} /></button>
          ${x.live.join && link ? html`<a class="join small" href=${link} target="_blank" rel="noopener" aria-label=${'Join ' + it.title + ' on Teams'}><${TeamsIcon} />Join</a>` : null}
        </li>`;
      })}</ul>` : null}
      <div class="wkstrip" role="group" aria-labelledby="wk-h">
        <div class="week-head"><span id="wk-h" class="then-k">This week</span><span class="week-sum tnum">${M.weekSummary}</span></div>
        <div class="week-days">${M.week.map(function (d, di) {
          var inner = html`<span class="wd">${d.today ? 'Today' : d.wk}</span><span class="wn tnum">${d.d}</span><span class="wm">${d.marks.map(function (k, i) { return html`<i key=${i} class=${k}></i>`; })}</span>`;
          return d.items.length
            ? html`<button key=${d.ms} class=${'wday has' + (d.today ? ' today' : '')} style=${'--i:' + di} aria-label=${d.label} onClick=${function () { A.openItem(d.items[0].key); }}>${inner}</button>`
            : html`<div key=${d.ms} class=${'wday' + (d.today ? ' today' : '')} style=${'--i:' + di} aria-label=${d.label} role="img">${inner}</div>`;
        })}</div>
      </div>
      ${o.next ? html`<button class=${'other' + (o.next.band ? ' b-' + o.next.band : '')} onClick=${function () { A.openOther(o.next.key); }}>
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

  // A message to every Member, shown once over the app (data.json "notice" with "popup": true)
  function NoticeSheet(p) {
    var N = p.N, paras = function (t) { return String(t || '').split(/\n\s*\n/).map(function (x) { return nbsp(x.trim()); }).filter(Boolean); };
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label=${N.title || 'Notice'}>
      <div class="sheet-head"><span class="when">${N.from || 'From the Society'}</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body nt">
        <div class="nt-mark" aria-hidden="true"><${Logo} size=${30} /></div>
        ${N.title ? html`<h2 class="sheet-title">${N.title}</h2>` : null}
        ${paras(N.text).map(function (t, i) { return html`<p key=${'a' + i} class="nt-p">${t}</p>`; })}
        ${N.points.length ? html`<ul class="nt-list">${N.points.map(function (t, i) { return html`<li key=${i}>${nbsp(t)}</li>`; })}</ul>` : null}
        ${paras(N.close).map(function (t, i) { return html`<p key=${'c' + i} class="nt-p">${t}</p>`; })}
        ${N.sign ? html`<p class="nt-sign">${N.sign}</p>` : null}
        <button class="pill wide nt-go" onClick=${p.onClose}>${N.button || 'Got it'}</button>
      </div>
    </${Sheet}>`;
  }

  function InstallCard(p) {
    var A = p.A, st = p.st, way = installWay(st);
    return html`<section class="card install-card" aria-labelledby="in-h">
      <div class="in-mark" aria-hidden="true"><${Logo} size=${30} /></div>
      <div class="in-text">
        <h2 id="in-h">Keep the app on your home screen</h2>
        <p>${way === 'prompt' ? 'One tap opens it full screen, even offline.' : html`<${InstallSteps} way=${way} />`}</p>
      </div>
      <div class="in-actions">
        ${way === 'prompt' ? html`<button class="install" onClick=${A.install}>Install</button>` : null}
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
        ${tl.dots.map(function (d) { return html`<button key=${d.key} tabindex="-1" class=${'tl-tick' + (d.past ? ' past' : '') + (d.band ? ' b-' + d.band : '')} style=${'left:' + d.left} title=${d.title} onClick=${function () { A.openItem(d.key); }}><i></i></button>`; })}
        ${tl.showToday ? html`<div class=${'tl-today' + (tl.flip ? ' flip' : '')} style=${'left:' + tl.today}><span>Today</span><b></b></div>` : null}
        ${tl.months.map(function (mo) { return html`<div key=${mo.label} class="tl-mo" style=${'left:' + mo.left}>${mo.label}</div>`; })}
        ${tl.phases.map(function (ph) { return html`<div key=${ph.label} class=${'tl-ph' + (ph.now ? ' now' : '') + (ph.rec ? ' rec' : '')} style=${'left:' + ph.left + ';width:' + ph.width} title=${ph.label}>${ph.label}</div>`; })}
      </div>
      <div class="legend"><span><i class="lg-ic"></i>Formal IC</span><span><i class="lg-tick"></i>Your deadline</span><span><i class="lg-rec"></i>Recess</span></div>
      <div class="stats">${M.stats.map(function (s, i) { return html`<div key=${i} class="stat" style=${'--i:' + i}><span class="v tnum">${s.v}</span><span class="l">${s.l}</span></div>`; })}</div>
    </section>`;
  }

  function Agenda(p) {
    var M = p.M, A = p.A, st = p.st;
    function row(it, ri) {
      var cls = 'row' + (it.past ? ' past' : '') + (it.key === M.nextKey ? ' is-next' : '') + (it.type === 'marker' && !it.part ? ' marker' : '') + (it.band ? ' b-' + it.band : '');
      var showSoon = !it.past && (!it.band || it.band === 'far');
      return html`<li key=${it.key} style=${'--i:' + Math.min(ri || 0, 8)}><button class=${cls} onClick=${function () { A.openItem(it.key); }}>
        <span class="dd tnum"><b>${it.day}</b><small>${it.wk}</small></span>
        <span class="tx"><span class="tt">${it.title}</span>${it.sub ? html`<span class="sub tnum">${it.sub}</span>` : null}</span>
        <span class="tags"><${Tag} text=${it.tag.text} tone=${it.tag.tone} />${showSoon ? html`<span class="soon tnum">${it.soon}</span>` : null}</span>
      </button></li>`;
    }
    return html`<section class="card agenda" aria-labelledby="ag-h">
      <div class="card-head">
        <h2 id="ag-h" class="card-title">${M.lens === 'analyst' ? M.m.sector + ' analyst' : M.m.roleShort || M.m.role}</h2>
        <button class="icon-btn search-btn" onClick=${A.openSearch} aria-label="Search dates, meetings and rules" title="Search (/)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg></button>
        <div class="seg" role="group" aria-label="Dates to show">
          <button aria-pressed=${st.all ? 'false' : 'true'} onClick=${function () { A.setAll(false); }}>Key dates</button>
          <button aria-pressed=${st.all ? 'true' : 'false'} onClick=${function () { A.setAll(true); }}>Everything</button>
        </div>
      </div>
      ${M.progress ? html`<div class="prog" role="img" aria-label=${M.progress.cap}>
        <div class="prog-bar">${M.progress.segs.map(function (g, gi) { return html`<i key=${g.key} class=${'ps ' + g.s} title=${g.title} style=${'--i:' + gi}></i>`; })}</div>
        <div class="prog-cap tnum" aria-hidden="true">${M.progress.cap}</div>
      </div>` : null}
      ${M.pastCount ? html`<button class="past-btn" onClick=${A.togglePast} aria-expanded=${st.showPast ? 'true' : 'false'}><${Chev} open=${st.showPast} />${st.showPast ? 'Hide earlier dates' : 'Show ' + M.pastCount + ' earlier ' + plural(M.pastCount, 'date')}</button>` : null}
      ${M.groups.length ? M.groups.map(function (g) {
        var id = 'm-' + g.k;
        return html`<div key=${g.k} class=${g.open ? '' : 'closed-m'}>
          <h3 class="month"><button class="month-btn" aria-expanded=${g.open ? 'true' : 'false'} aria-controls=${id} onClick=${function () { A.toggleMonth(g.k, !g.open); }}>
            <span class="mn">${g.name}</span><span class="mc tnum">${g.summary}</span><${Chev} open=${g.open} />
          </button></h3>
          ${g.open ? html`<ol id=${id} class="rows">${g.items.map(function (it, ri) { return row(it, ri); })}</ol>` : null}
        </div>`;
      }) : html`<p class="empty">Every H1 date in this view has passed.</p>`}
      <button class="cal-row" onClick=${A.openCal}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>
        <span>Get reminders in your calendar</span><${Arrow} />
      </button>
      ${p.sync ? html`<div class=${'sync ' + p.sync.state} aria-live="polite"><i aria-hidden="true"></i><span>${p.sync.text}</span><button onClick=${A.refresh} disabled=${p.sync.busy}>${p.sync.busy ? 'Checking…' : 'Refresh'}</button></div>` : null}
    </section>`;
  }

  function Queue(p) {
    var Q = p.M.queue;
    if (!Q) return null;
    return html`<section class="card queue" aria-labelledby="q-h">
      <div class="card-head"><h2 id="q-h" class="card-k">Waiting on you</h2><span class="count tnum">${Q.open ? Q.open + ' open' : 'Coming up'}</span></div>
      <ul class="q-list">${Q.rows.slice(0, 5).map(function (r) {
        return html`<li key=${r.id} class=${r.accepted ? 'done' : ''}><span class="q-t"><b>${r.who}</b><span>${r.what}</span><small class="tnum">${r.when}</small></span><${Tag} text=${r.tag.text} tone=${r.tag.tone} /></li>`;
      })}</ul>
      ${Q.rows.length > 5 ? html`<p class="q-more">and ${Q.rows.length - 5} more</p>` : null}
    </section>`;
  }

  function SearchSheet(p) {
    var s = useState(''), q = s[0], setQ = s[1], M = p.M;
    var seen = {}, pool = [];
    M.all.concat(M.other.all).forEach(function (it) {
      if (seen[it.key]) return; seen[it.key] = 1;
      var lens = M.all.indexOf(it) >= 0 ? M.lens : M.other.lens;
      pool.push({ kind: 'item', it: it, lens: it.type === 'meeting' ? '' : lens, hay: (it.title + ' ' + it.detail + ' ' + it.whenLong + ' ' + (it.label || '') + ' ' + (lens === 'analyst' ? 'analyst ' + M.m.sector : 'society ' + M.m.role)).toLowerCase() });
    });
    M.searchRules.forEach(function (r) { pool.push({ kind: 'rule', r: r, lens: r.lens, hay: ('rule ' + r.title + ' ' + r.body).toLowerCase() }); });
    // Each word must start a word ("IC" finds "Formal IC 3", not "Academic"). Title matches first; within them, what's coming
    // (soonest first), then what has passed (latest first).
    var words = q.toLowerCase().split(/\s+/).filter(Boolean).map(function (w) { return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); });
    function title(x) { return (x.kind === 'rule' ? x.r.title : x.it.title).toLowerCase(); }
    var hits = words.length ? pool.filter(function (x) { return words.every(function (w) { return w.test(x.hay); }); })
      .map(function (x) { x.th = words.every(function (w) { return w.test(title(x)); }) ? 0 : 1; x.gone = x.kind === 'item' && x.it.past && !x.it.closed ? 1 : 0; x.ms = x.kind === 'rule' ? 9e15 : x.it.ms; return x; })
      .sort(function (a, b) { return a.th - b.th || a.gone - b.gone || (a.gone ? b.ms - a.ms : a.ms - b.ms); }).slice(0, 25) : [];
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label="Search">
      <div class="search-head">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        <input id="search-q" data-autofocus type="search" placeholder="Search dates, meetings and rules" value=${q} onInput=${function (e) { setQ(e.currentTarget.value); }} autocomplete="off" enterkeyhint="search" aria-label="Search" />
        <${CloseBtn} onClose=${p.onClose} />
      </div>
      <div class="sheet-body search-body">
        ${!words.length ? html`<p class="search-hint">Try <button onClick=${function () { setQ('pitch'); }}>pitch</button>, <button onClick=${function () { setQ('minutes'); }}>minutes</button>, <button onClick=${function () { setQ('IC 3'); }}>IC 3</button> or <button onClick=${function () { setQ('February'); }}>February</button>.</p>`
          : !hits.length ? html`<p class="search-hint">Nothing matches “${q}”.</p>`
          : html`<ul class="results">${hits.map(function (x, i) {
            if (x.kind === 'rule') return html`<li key=${'r' + i}><button class="res" onClick=${function () { p.openRule(x.r); }}><span class="res-d">Rule</span><span class="res-t"><b>${x.r.title}</b><small>${x.r.body}</small></span></button></li>`;
            var it = x.it, when = it.past && !it.closed ? 'Passed' : it.soon, tg = it.tag || { text: it.label, tone: it.tone };
            var where = x.lens && x.lens !== M.lens ? (x.lens === 'analyst' ? 'Analyst' : M.m.roleShort || 'Society role') + ' · ' : '';
            return html`<li key=${it.key}><button class="res" onClick=${function () { p.openAny(it.key); }}><span class="res-d tnum">${dShort(it.ms)}</span><span class="res-t"><b>${it.title}</b><small>${where}${when}</small></span>${tg.text && tg.text !== when ? html`<${Tag} text=${tg.text} tone=${tg.tone} />` : html`<span></span>`}</button></li>`;
          })}</ul>`}
      </div>
    </${Sheet}>`;
  }

  // ---------- navigation: bottom bar on phones, sidebar on computers ----------
  var TABS = [
    { id: 'today', label: 'Today', hash: 'today' },
    { id: 'plan', label: 'Plan', hash: 'plan' },
    { id: 'meet', label: 'Meetings', hash: 'meetings' },
    { id: 'learn', label: 'Learn', hash: 'learn' },
    { id: 'you', label: 'You', hash: 'you', alias: ['role', 'guide'] }
  ];
  var BADGE_TEXT = { due: ' (due within two days)', live: ' (meeting on now)', today: ' (meeting today)', news: ' (dates changed)', q: ' (question of the day waiting)' };
  function tabFromHash() {
    var h = (location.hash || '').replace('#', '').toLowerCase(), t = null;
    TABS.forEach(function (x) { if (x.hash === h || x.id === h || (x.alias && x.alias.indexOf(h) >= 0)) t = x.id; });
    return t;
  }
  // Section icons: drawn on one 24px grid with a 1.6 line. Inactive is outline only; the active section adds a soft fill.
  var F = { fill: 'currentColor', 'fill-opacity': '.2', stroke: 'none' };
  var ICONS = {
    today: {
      f: html`<path ...${F} d="M4.5 10.4 11.2 4.8a1.25 1.25 0 0 1 1.6 0l6.7 5.6v8.4a1.7 1.7 0 0 1-1.7 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7z"></path>`,
      o: html`<path d="M4.5 10.4 11.2 4.8a1.25 1.25 0 0 1 1.6 0l6.7 5.6v8.4a1.7 1.7 0 0 1-1.7 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7z"></path><path d="M10 20.5v-4.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4.6"></path>`
    },
    plan: {
      f: html`<path ...${F} d="M3.5 8a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v2h-17z"></path>`,
      o: html`<rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 10h17M8 3.5v3M16 3.5v3"></path><g fill="currentColor" stroke="none"><circle cx="8" cy="13.6" r=".95"></circle><circle cx="12" cy="13.6" r=".95"></circle><circle cx="16" cy="13.6" r=".95"></circle><circle cx="8" cy="17" r=".95"></circle><circle cx="12" cy="17" r=".95"></circle></g>`
    },
    meet: {
      f: html`<circle ...${F} cx="9" cy="8.6" r="3.1"></circle><path ...${F} d="M3.6 19.5c.4-3.2 2.6-5.2 5.4-5.2s5 2 5.4 5.2z"></path>`,
      o: html`<circle cx="9" cy="8.6" r="3.1"></circle><path d="M3.6 19.5c.4-3.2 2.6-5.2 5.4-5.2s5 2 5.4 5.2"></path><path d="M15.3 5.7a3 3 0 0 1 0 5.8M17.3 14.6c1.8.6 2.9 2.2 3.2 4.9"></path>`
    },
    role: {
      f: html`<rect ...${F} x="3.5" y="7.5" width="17" height="12.5" rx="2.5"></rect>`,
      o: html`<rect x="3.5" y="7.5" width="17" height="12.5" rx="2.5"></rect><path d="M9 7.5V6.2a1.7 1.7 0 0 1 1.7-1.7h2.6A1.7 1.7 0 0 1 15 6.2v1.3"></path><path d="M3.5 12.3c5.6 2.1 11.4 2.1 17 0M12 12.9v1.8"></path>`
    },
    guide: {
      f: html`<circle ...${F} cx="12" cy="12" r="8.5"></circle><path fill="currentColor" stroke="none" d="M15.2 8.8 13.4 13.4 8.8 15.2 10.6 10.6z"></path>`,
      o: html`<circle cx="12" cy="12" r="8.5"></circle><path d="M15.2 8.8 13.4 13.4 8.8 15.2 10.6 10.6z"></path>`
    },
    learn: {
      f: html`<path ...${F} d="M12 6.6C10.2 5.2 7.7 4.6 4 4.6v13.9c3.7 0 6.2.6 8 2 1.8-1.4 4.3-2 8-2V4.6c-3.7 0-6.2.6-8 2z"></path>`,
      o: html`<path d="M12 6.6C10.2 5.2 7.7 4.6 4 4.6v13.9c3.7 0 6.2.6 8 2 1.8-1.4 4.3-2 8-2V4.6c-3.7 0-6.2.6-8 2z"></path><path d="M12 6.6v13.9"></path>`
    },
    you: {
      f: html`<circle ...${F} cx="12" cy="8.4" r="3.6"></circle><path ...${F} d="M5 20c.6-3.6 3.3-5.8 7-5.8s6.4 2.2 7 5.8z"></path>`,
      o: html`<circle cx="12" cy="8.4" r="3.6"></circle><path d="M5 20c.6-3.6 3.3-5.8 7-5.8s6.4 2.2 7 5.8"></path>`
    }
  };
  var GLYPHS = {
    search: html`<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>`,
    bell: html`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>`,
    phone: html`<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"></rect><path d="M10.5 18.5h3"></path>`,
    person: html`<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.8-3.6 3.5-5.6 7-5.6s6.2 2 7 5.6"></path>`,
    file: html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h4"></path>`,
    sound: html`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"></path><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"></path>`,
    buzz: html`<rect x="8" y="3.5" width="8" height="17" rx="2"></rect><path d="M4.5 8.5v7M19.5 8.5v7M2 10.5v3M22 10.5v3"></path>`,
    send: html`<path d="M21 3 10.5 13.5"></path><path d="M21 3l-6.5 18-4-7.5L3 9.5z"></path>`
  };
  function Ico(p) {
    var I = ICONS[p.n];
    return html`<svg class="ico" width=${p.s || 22} height=${p.s || 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${p.w || 1.6} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I ? [p.on ? I.f : null, I.o] : GLYPHS[p.n]}</svg>`;
  }
  function Badge(p) { return p.b ? html`<i class=${'badge ' + p.b} aria-hidden="true"></i>` : null; }

  function Rail(p) {
    var M = p.M, A = p.A;
    return html`<nav class="rail on-navy" aria-label="Sections">
      <div class="rail-brand"><${Logo} size=${40} /><span class="brand-word">THE RAND SOCIETY</span></div>
      <button class="rail-search" onClick=${A.openSearch} aria-label="Search dates, meetings and rules" title="Search (/)"><${Ico} n="search" s=${18} w=${2} /><span>Search</span><kbd>/</kbd></button>
      <ul class="rail-nav">${TABS.map(function (t) {
        var b = M.badges[t.id];
        return html`<li key=${t.id}><button class=${'rail-item' + (t.id === 'learn' && SKIN ? ' ' + SKIN + '-tab' : '')} aria-current=${p.tab === t.id ? 'page' : null} onClick=${function () { A.goTab(t.id); }}>
          <span class="rail-ic"><${Ico} n=${t.id} on=${p.tab === t.id} /><${Badge} b=${b} /></span><span class="rail-l">${t.label}${b ? html`<span class="vh">${BADGE_TEXT[b]}</span>` : null}</span>
        </button></li>`;
      })}</ul>
      <div class="rail-foot">
        <button class="rail-me" onClick=${A.openMembers} aria-haspopup="dialog" aria-label=${'Change role. Showing ' + M.m.role}>
          <span class="me-ic" aria-hidden="true"><${Ico} n="person" s=${18} /></span>
          <span class="me-txt"><b>${M.m.roleShort || M.m.role}</b><small>${M.m.sector} analyst</small></span>
          <span class="me-short">${M.m.pick || M.m.roleShort}</span>
          <${Chev} />
        </button>
      </div>
    </nav>`;
  }
  function TabBar(p) {
    var M = p.M, A = p.A;
    return html`<nav class="tabbar" aria-label="Sections">${TABS.map(function (t) {
      var b = M.badges[t.id];
      return html`<button key=${t.id} class=${'tab' + (t.id === 'learn' && SKIN ? ' ' + SKIN + '-tab' : '')} aria-current=${p.tab === t.id ? 'page' : null} onClick=${function () { A.goTab(t.id); }}>
        <span class="tab-ic"><${Ico} n=${t.id} s=${24} on=${p.tab === t.id} /><${Badge} b=${b} /></span><span class="tab-l">${t.label}${b ? html`<span class="vh">${BADGE_TEXT[b]}</span>` : null}</span>
      </button>`;
    })}</nav>`;
  }
  // The navy band at the top of Plan, Meetings, Learn and You (Today keeps the photo masthead).
  function SectionPhoto(p) {
    var x = p.x, ref = useRef(null), src = p.phone ? x.p : x.d;
    useEffect(function () { var el = ref.current; if (el && el.complete && el.naturalWidth) el.classList.add('in'); });
    return html`<div class="mast-photo" aria-hidden="true"><img key=${src} ref=${ref} src=${src} alt="" decoding="async"
      onLoad=${function (ev) { ev.currentTarget.classList.add('in'); }} onError=${function (ev) { var w = ev.currentTarget.parentNode; if (w) w.style.display = 'none'; }}
      style=${'object-position:' + (p.phone ? x.pp : x.dp) + ';filter:saturate(.65) contrast(1.04)'} /></div>`;
  }
  function PageHead(p) {
    var M = p.M, A = p.A, st = p.st, skin = p.tab === 'learn' && SK, ph = skin ? null : M.photos[p.tab];
    return html`<header class=${'mast page-head on-navy' + (p.lens ? '' : ' no-dock') + (ph ? ' has-photo' : '') + (skin ? ' ' + SKIN : '')}>
      ${ph ? html`<${SectionPhoto} key=${p.tab} x=${ph} phone=${st.phone} />` : null}
      ${skin ? SK.head({ n: p.lvl || 1, bloom: p.bloom }) : null}
      <div class="mast-inner">
        ${st.phone ? null : html`<div class="topbar"><span class="today tnum">${M.todayLong}</span></div>`}
        <div class="hero">
          <span class="eyebrow">${p.eyebrow}</span>
          <h1>${p.title}</h1>
          ${p.text ? html`<p>${p.text}</p>` : null}
          ${p.lens && !st.phone ? html`<div style="margin-top:14px"><${LensSwitch} M=${M} A=${A} /></div>` : null}
        </div>
      </div>
    </header>`;
  }

  // ---------- meetings ----------
  // Agenda → pre-reads → meeting → minutes, as a tracker: across the card on Today, down the page on Meetings.
  function Chain(p) {
    var said = { done: ', done', next: ', next', live: ', on now', todo: '' };
    return html`<ol class=${'chain' + (p.full ? ' full' : '')} aria-label="Before and after the meeting">${p.chain.map(function (c) {
      return html`<li key=${c.k} class=${'c-' + c.state + (c.mine ? ' c-mine' : '')}>
        <span class="c-dot" aria-hidden="true"></span>
        <span class="c-k">${c.k}${c.mine ? html`<em> · you</em>` : null}<span class="vh">${said[c.state]}</span></span>
        <span class="c-w tnum">${p.full ? c.when : c.short}</span>
      </li>`;
    })}</ol>`;
  }
  function chipFor(x) { return x.live || { text: x.it.soon, tone: x.it.current ? 'now' : 'when' }; }
  function Parts(p) { return p.parts.length ? html`<span class="nm-tags">${p.parts.map(function (x, i) { return html`<${Tag} key=${i} text=${x.text} tone=${x.tone} />`; })}</span>` : null; }
  function JoinRow(p) {
    var x = p.x, L = x.live;
    if (!x.link || !L || !L.join) return null;
    return html`<div class="mh-join"><a class="join" href=${x.link} target="_blank" rel="noopener"><${TeamsIcon} />Join on Teams</a><span>${L.text === 'Live now' ? 'The meeting is on' : 'Opens 30 minutes before'}</span></div>`;
  }
  function NextMeet(p) {
    var M = p.M, A = p.A, x = M.nextMeet;
    if (!x) return null;
    var it = x.it, chip = chipFor(x), on = x.live && x.live.join;
    return html`<section class=${'card nmeet' + (on ? ' on' : '')} aria-labelledby="nm-h">
      <div class="card-head"><h2 id="nm-h" class="card-k">${on ? (x.live.text === 'Live now' ? 'Meeting now' : 'Starting soon') : 'Next meeting'}</h2><span class="live-chip" aria-live="polite"><${Tag} text=${chip.text} tone=${chip.tone} /></span></div>
      <button class="nm-main" onClick=${function () { A.openAny(it.key); }}>
        <span class="datebox slate tnum" aria-hidden="true"><span class="d">${it.day}</span><span class="m">${it.mon}</span></span>
        <span class="nm-text"><span class="nm-kind">${x.kind}</span><span class="nm-title">${x.title}</span><span class="nm-meta tnum">${it.wk} ${dShort(it.ms)} · 17:00 to 18:30 · Teams</span><${Parts} parts=${x.parts} /></span>
      </button>
      <${JoinRow} x=${x} />
      ${x.chain.length ? html`<${Chain} chain=${x.chain} />` : null}
      <button class="nm-all" onClick=${function () { A.goTab('meet'); }}><span>All meetings</span><${Arrow} /></button>
    </section>`;
  }
  function MeetHero(p) {
    var M = p.M, x = M.nextMeet;
    if (!x) return html`<section class="card mhero"><div class="card-head"><h2 class="card-k">Next meeting</h2></div><p class="next-empty">No meetings are left this term.</p></section>`;
    var it = x.it, chip = chipFor(x);
    return html`<section class="card mhero" aria-labelledby="mh-h">
      <div class="card-head"><span class="card-k">Next meeting</span><span class="live-chip" aria-live="polite"><${Tag} text=${chip.text} tone=${chip.tone} /></span></div>
      <div class="mh-body">
        <span class="nm-kind">${x.kind}</span>
        <h2 id="mh-h" class="mh-title">${x.title}</h2>
        <p class="mh-when tnum">${wk(it.ms)} ${dMonth(it.ms)} · 17:00 to 18:30 · Teams</p>
        <${Parts} parts=${x.parts} />
      </div>
      <${JoinRow} x=${x} />
      <div class="mh-actions"><${MeetActions} it=${it} A=${p.A} /></div>
      ${x.chain.length ? html`<${Chain} chain=${x.chain} full=${true} />` : null}
      <div class="mh-sec"><h3>The meeting</h3><p>${x.detail}</p></div>
      ${x.aDetail ? html`<div class="mh-sec"><h3>As an analyst</h3><p>${x.aDetail}</p></div>` : null}
      ${it.people.length ? html`<dl class="who mh-who">${it.people.map(function (w) { return html`<div key=${w.k}><dt>${w.k}</dt><dd>${w.v}</dd></div>`; })}</dl>` : null}
    </section>`;
  }
  function MeetList(p) {
    var M = p.M, A = p.A, st = p.st;
    // a meeting whose minutes are still due stays in view until they are
    var due = M.minutesDue ? M.minutesDue.key : '';
    var up = M.meetings.filter(function (x) { return !x.ended || x.key === due; }), past = M.meetings.filter(function (x) { return x.ended && x.key !== due; });
    var rows = (st.showPastMeet ? past : []).concat(up);
    return html`<section class="card mlist" aria-labelledby="ml-h">
      <div class="card-head"><h2 id="ml-h" class="card-title">This term</h2><span class="count tnum">${M.meetings.filter(function (x) { return !x.ended; }).length ? M.meetings.filter(function (x) { return !x.ended; }).length + ' to go' : 'All held'}</span></div>
      ${past.length ? html`<button class="past-btn" onClick=${A.togglePastMeet} aria-expanded=${st.showPastMeet ? 'true' : 'false'}><${Chev} open=${st.showPastMeet} />${st.showPastMeet ? 'Hide earlier meetings' : 'Show ' + past.length + ' earlier ' + plural(past.length, 'meeting')}</button>` : null}
      <ol class="rows">${rows.map(function (x, ri) {
        var it = x.it, isNext = M.nextMeet && x.key === M.nextMeet.key, mins = M.minutesDue && M.minutesDue.key === x.key;
        var line = mins ? 'Minutes due ' + x.chain[x.chain.length - 1].when : x.kind;
        return html`<li key=${x.key} style=${'--i:' + Math.min(ri, 8)}><button class=${'row' + (x.ended ? ' past' : '') + (isNext ? ' is-next' : '')} onClick=${function () { A.openAny(x.key); }}>
          <span class="dd tnum"><b>${it.day}</b><small>${it.mon}</small></span>
          <span class="tx"><span class="tt">${x.title}</span><span class="sub tnum">${line}${st.phone && x.parts.length ? html` · <b class=${'part ' + x.parts[0].tone}>${x.parts.map(function (q) { return q.text; }).join(', ')}</b>` : null}</span></span>
          <span class="tags">${st.phone ? null : x.parts.map(function (q, qi) { return html`<${Tag} key=${qi} text=${q.text} tone=${q.tone} />`; })}</span>
        </button></li>`;
      })}</ol>
    </section>`;
  }
  function MeetHow(p) {
    var r = p.M.rulesAll[0].items.filter(function (x) { return x.id === 'meet'; })[0];
    return r ? html`<section class="card rcard" aria-labelledby="mw-h"><span class="card-k">How meetings run</span><h2 id="mw-h">${r.title}</h2><p>${r.body}</p></section>` : null;
  }

  // ---------- role ----------
  function TermProgress(p) {
    var M = p.M, A = p.A;
    if (!M.progress) return null;
    return html`<section class="card rcard" aria-labelledby="tp-h">
      <span class="card-k" id="tp-h">Your deadlines this term</span>
      <div class="prog" role="img" aria-label=${M.progress.cap} style="padding:4px 0 0">
        <div class="prog-bar">${M.progress.segs.map(function (g, gi) { return html`<i key=${g.key} class=${'ps ' + g.s} title=${g.title} style=${'--i:' + gi}></i>`; })}</div>
        <div class="prog-cap tnum" aria-hidden="true">${M.progress.cap}</div>
      </div>
      <button class="r-link" onClick=${function () { A.goTab('plan'); }}><span>Open the plan</span><${Arrow} /></button>
      <button class="r-link" onClick=${A.openUpdate}><span>Send my update</span><${Arrow} /></button>
    </section>`;
  }
  function roleCards(M, A) {
    var m = M.m;
    if (M.lens === 'society') return {
      a: [html`<section key="own" class="panel-navy on-navy" aria-label="What you own">
        <span class="card-k">What you own</span>
        <ul class="own">${(m.owns || []).map(function (o, i) { return html`<li key=${i}><span>${o.name}</span><span class="tnum">${nbsp(o.when)}</span></li>`; })}</ul>
      </section>`],
      b: [m.safeguard ? html`<section key="sg" class="card rcard" aria-labelledby="sg-h"><span class="card-k">Safeguard</span><h2 id="sg-h">${m.safeguard.title}</h2><p>${nbsp(m.safeguard.body)}</p></section>` : null,
        html`<${TermProgress} key="tp" M=${M} A=${A} />`]
    };
    return {
      a: [html`<section key="path" class="panel-navy on-navy" aria-label=${'Thesis path, ' + M.cycle.name}>
        <span class="card-k">Thesis path · ${M.cycle.name}</span>
        <ol class="path">${M.path.map(function (x, i) { return html`<li key=${i} class=${x.state}><span class="pd" aria-hidden="true"></span><span class="pl">${x.label}</span><span class="pw tnum">${x.when}</span></li>`; })}</ol>
      </section>`],
      b: [m.coverage ? html`<section key="cov" class="card rcard" aria-labelledby="cv-h"><h2 id="cv-h" class="card-k">Coverage</h2><p>${m.coverage}</p></section>` : null,
        html`<section key="sc" class="card score" aria-labelledby="sc-h">
          <div class="card-head"><h2 id="sc-h" class="card-title">Analyst scorecard</h2></div>
          <ul>${M.score.map(function (r, i) { return html`<li key=${i}><span>${r.name}</span><span class="tnum">${r.when}</span></li>`; })}</ul>
        </section>`,
        html`<${TermProgress} key="tp" M=${M} A=${A} />`]
    };
  }

  // ---------- readiness checklists, links, sharing ----------
  function Checklist(p) {
    var c = p.c, st = p.state || {}, n = c.items.filter(function (x, i) { return st[i]; }).length;
    return html`<section class="ck" aria-label=${'Readiness checklist: ' + c.title}>
      <div class="ck-head"><span class="card-k">Readiness checklist</span><span class="ck-n tnum">${n} of ${c.items.length}</span></div>
      <div class="ck-bar" aria-hidden="true"><i style=${'width:' + Math.round(100 * n / c.items.length) + '%'}></i></div>
      <ul class="ck-list">${c.items.map(function (t, i) {
        var on = !!st[i];
        return html`<li key=${i}><label class=${'ck-item' + (on ? ' on' : '')}>
          <input type="checkbox" checked=${on} onChange=${function () { p.toggle(c.id, i); }} />
          <span class="ck-box" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span>
          <span class="ck-t">${t}</span></label></li>`;
      })}</ul>
      <p class="ck-src">From ${c.source}. Your ticks stay on this device.</p>
    </section>`;
  }
  function LinkRow(p) {
    if (!p.links || !p.links.length) return null;
    return html`<div class="links">${p.links.map(function (l, i) {
      return html`<a key=${i} class="link-btn" href=${l.url} target="_blank" rel="noopener">${l.label}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"></path></svg></a>`;
    })}</div>`;
  }
  function Library(p) {
    if (!p.items || !p.items.length) return null;
    return html`<section class="card glist-card" aria-labelledby="lb-h">
      <div class="card-head"><h2 id="lb-h" class="card-k">Library</h2></div>
      <ul class="glist">${p.items.map(function (l, i) {
        return html`<li key=${i}><a class="grow" href=${l.url} target="_blank" rel="noopener"><span class="g-ic" aria-hidden="true"><${Ico} n="file" s=${20} /></span><span class="g-t"><b>${l.title}</b>${l.note ? html`<small>${l.note}</small>` : null}</span><${Arrow} /></a></li>`;
      })}</ul>
    </section>`;
  }
  // Add to calendar links to cal/m/<key>.ics, which the site builds with the members' feeds.
  function MeetActions(p) {
    var it = p.it, A = p.A;
    function addCal(ev) {
      if (!window.TRS_DATA) return; // the site serves a real calendar file at the link
      ev.preventDefault(); A.say('Add to calendar works in the members’ app; this preview can’t save files.');
    }
    return html`<div class="m-acts">
      <a class="m-act" href=${A.calBase + 'm/' + it.key + '.ics'} onClick=${addCal}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"></rect><path d="M3.5 10h17M8 3.5v3M16 3.5v3M12 13v5M9.5 15.5h5"></path></svg>Add to calendar</a>
      <button class="m-act" onClick=${function () { A.openApology(it); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3.5 21l1.4-4.8A8.5 8.5 0 1 1 21 12z"></path><path d="M9 9.5l6 5M15 9.5l-6 5"></path></svg>Can’t attend</button>
    </div>`;
  }
  // A message ready to send: edit it, then share it, open WhatsApp or email, or copy it.
  function ShareSheet(p) {
    var s = useState(p.text), t = s[0], setT = s[1], c = useState(false), copied = c[0], setCopied = c[1], ref = useRef(null);
    var canShare = typeof navigator.share === 'function';
    function share() { try { navigator.share({ title: p.subject, text: t }).catch(function () {}); } catch (e) { /* cancelled */ } }
    function copy() {
      function pick() { var el = ref.current; if (el) { el.focus(); el.select(); } }
      try { navigator.clipboard.writeText(t).then(function () { setCopied(true); }, pick); } catch (e) { pick(); }
    }
    return html`<${Sheet} phone=${p.phone} onClose=${p.onClose} label=${p.title}>
      <div class="sheet-head"><span class="when">${p.kicker}</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <h2 class="sheet-title">${p.title}</h2>
        ${p.note ? html`<p class="share-note">${p.note}</p>` : null}
        <textarea ref=${ref} class="share-text" rows=${p.rows || 6} value=${t} onInput=${function (e) { setT(e.currentTarget.value); setCopied(false); }} aria-label="Message"></textarea>
        <div class="share-btns">
          ${canShare ? html`<button class="share-btn primary" onClick=${share}>Share…</button>` : null}
          <a class=${'share-btn' + (canShare ? '' : ' primary')} href=${'https://wa.me/?text=' + encodeURIComponent(t)} target="_blank" rel="noopener">WhatsApp</a>
          <a class="share-btn" href=${'mailto:?subject=' + encodeURIComponent(p.subject) + '&body=' + encodeURIComponent(t)}>Email</a>
          <button class="share-btn" onClick=${copy}>${copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
    </${Sheet}>`;
  }
  function apologyText(it, m) {
    return plain('Apologies: I can’t attend ' + it.title + ' on ' + wk(it.ms) + ' ' + dMonth(it.ms) + ' ' + D(it.ms).getUTCFullYear() + ' (17:00 to 18:30 on Teams).\n\n' + m.role);
  }
  // Your week in one message: what is accepted, submitted or being revised, and what is next in each role.
  function updateText(M) {
    var m = M.m, soc = M.lens === 'society' ? M.all : M.other.all, ana = M.lens === 'analyst' ? M.all : M.other.all;
    var own = soc.concat(ana).filter(function (it) { return it.part === 'lead' && it.type === 'deadline'; });
    function names(b) { return own.filter(function (it) { return it.band === b; }).map(function (it) { return it.title; }); }
    function next(list) { return list.filter(function (it) { return it.part === 'lead' && it.type === 'deadline' && !it.past && !isDone(it); })[0]; }
    var lines = ['The Rand Society · update from the ' + m.role + ' (' + m.sector + ' analyst) · ' + M.todayShort, ''];
    var acc = names('ok').concat(names('min')), sub = names('sub'), rev = names('rev'), nc = names('nc');
    if (acc.length) lines.push('Accepted: ' + acc.slice(-3).join('; '));
    if (sub.length) lines.push('Submitted, awaiting review: ' + sub.join('; '));
    if (rev.length) lines.push('Revising: ' + rev.join('; '));
    if (nc.length) lines.push('Not completed, revised date needed: ' + nc.join('; '));
    var ns = next(soc), na = next(ana);
    if (ns) lines.push('Next as ' + (m.roleShort || m.role) + ': ' + ns.title + ' · ' + ns.whenShort);
    if (na) lines.push('Next as analyst: ' + na.title + ' · ' + na.whenShort);
    if (lines.length === 2) lines.push('Nothing due or under review.');
    return plain(lines.join('\n'));
  }
  // messages leave the app as plain text: ordinary spaces instead of the app's non-breaking ones
  function plain(t) { return String(t).replace(/\u00a0/g, ' '); }

  // ---------- Society board: each Member's recorded quality-gate result on shared deliverables ----------
  function boardModel(P, asOf, me) {
    var byKey = {}, seen = {}, rows = { analyst: [], society: [] }, tally = { ok: 0, rev: 0, nc: 0, wait: 0 };
    P.analyst.forEach(function (e) { byKey[e.key] = e; });
    function cell(e, m) {
      if (!e) return { s: 'na' };
      var st = e.status && e.status[m.id];
      var s = st === 'accepted' ? 'ok' : st === 'minor' ? 'min' : st === 'revise' ? 'rev' : st === 'incomplete' ? 'nc' : e.endMs < asOf ? 'wait' : 'up';
      if (s === 'ok' || s === 'min') tally.ok++; else if (s === 'rev') tally.rev++; else if (s === 'nc') tally.nc++; else if (s === 'wait') tally.wait++;
      return { s: s, when: dShort(e.ms) };
    }
    P.analyst.forEach(function (e) {
      if (e.who !== 'all' || e.type !== 'deadline' || /^a-fb/.test(e.key)) return;
      var base = e.cycle ? e.key.replace(/[A-Z]$/, '') : e.key;
      if (seen[base]) return; seen[base] = 1;
      var cells = P.members.map(function (m) { return cell(e.cycle ? byKey[base + (m.cycle || 'A')] : e, m); });
      var dates = {}; cells.forEach(function (c) { if (c.when) dates[c.when] = 1; });
      rows.analyst.push({ key: base, title: e.title, when: Object.keys(dates).join(' / '), ms: e.ms, cells: cells });
    });
    P.society.forEach(function (e) {
      if (e.type !== 'deadline') return;
      var leads = P.members.filter(function (m) { return e.roles[m.id] === 'lead'; }).length;
      if (leads < 2) return;
      rows.society.push({ key: e.key, title: e.title, when: dShort(e.ms), ms: e.ms, cells: P.members.map(function (m) { return e.roles[m.id] === 'lead' ? cell(e, m) : { s: 'na' }; }) });
    });
    rows.analyst.sort(function (a, b) { return a.ms - b.ms; });
    return { cols: P.members.map(function (m) { return { id: m.id, label: m.pick || m.roleShort || m.role, abbr: m.abbr || m.pick || m.roleShort, me: m.id === me }; }), groups: [{ id: 'society', title: 'Society work', rows: rows.society }, { id: 'analyst', title: 'Analyst work', rows: rows.analyst }], tally: tally };
  }
  var CELL = { ok: 'Accepted', min: 'Accepted, minor corrections', rev: 'Revision required', nc: 'Not completed', wait: 'Awaiting record', up: 'Due', na: 'Not theirs' };
  function Board(p) {
    var B = p.B, T = B.tally, bits = [];
    if (T.ok) bits.push(T.ok + ' accepted');
    if (T.rev) bits.push(T.rev + ' in revision');
    if (T.nc) bits.push(T.nc + ' not completed');
    if (T.wait) bits.push(T.wait + ' awaiting record');
    function mark(c) {
      if (c.s === 'ok' || c.s === 'min') return html`<span class=${'bd-m ' + c.s}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span>`;
      if (c.s === 'rev') return html`<span class="bd-m rev">R</span>`;
      if (c.s === 'nc') return html`<span class="bd-m nc">!</span>`;
      if (c.s === 'wait') return html`<span class="bd-m wait"></span>`;
      if (c.s === 'up') return html`<span class="bd-m up"></span>`;
      return null;
    }
    return html`<section class="card board-card" aria-labelledby="bd-h">
      <button class="bd-head" onClick=${p.toggle} aria-expanded=${p.open ? 'true' : 'false'}>
        <span class="bd-ht"><h2 id="bd-h" class="card-title">Society board</h2><span class="bd-sum tnum">${bits.length ? bits.join(' · ') : 'Nothing recorded yet'}</span></span><${Chev} open=${p.open} />
      </button>
      ${p.open ? html`<div class="bd-body">
        <p class="bd-note">Quality-gate results the Society has recorded, for the deliverables Members share.</p>
        <table class="bd">
          <thead><tr><th scope="col"><span class="vh">Deliverable</span></th>${B.cols.map(function (c) { return html`<th key=${c.id} scope="col" class=${c.me ? 'me' : ''} title=${c.label}><span class="bd-full">${c.label}</span><span class="bd-abbr" aria-hidden="true">${c.abbr}</span></th>`; })}</tr></thead>
          ${B.groups.map(function (g) {
            return g.rows.length ? html`<tbody key=${g.id}><tr class="bd-g"><th colspan=${B.cols.length + 1} scope="colgroup">${g.title}</th></tr>${g.rows.map(function (r) {
              return html`<tr key=${r.key}><th scope="row"><span class="bd-t">${r.title}</span><small class="tnum">${r.when}</small></th>${r.cells.map(function (c, i) {
                return html`<td key=${i} class=${B.cols[i].me ? 'me' : ''} title=${CELL[c.s]}>${mark(c)}<span class="vh">${B.cols[i].label}: ${CELL[c.s]}${c.s === 'up' ? ' ' + c.when : ''}</span></td>`;
              })}</tr>`;
            })}</tbody>` : null;
          })}
        </table>
        <div class="bd-legend" aria-hidden="true"><span><i class="bd-m ok"></i>Accepted</span><span><i class="bd-m min"></i>Minor corrections</span><span><i class="bd-m rev">R</i>Revision</span><span><i class="bd-m nc">!</i>Not completed</span><span><i class="bd-m wait"></i>Awaiting record</span><span><i class="bd-m up"></i>Due</span></div>
      </div>` : null}
    </section>`;
  }

  // ---------- guide ----------
  function GuideRules(p) {
    var M = p.M, A = p.A, st = p.st;
    return html`<section class="card rules" aria-labelledby="ru-h">
      <div class="card-head" style="padding-bottom:2px"><h2 id="ru-h" class="card-title">Rules</h2></div>
      ${M.rulesAll.map(function (g) {
        return g.items.length ? html`<div key=${g.id} class="rule-g"><h3 class="rule-group">${g.title}</h3>${g.items.map(function (r) {
          var open = !!st.open[r.id];
          return html`<div key=${r.id} class="rule"><button class="rule-btn" aria-expanded=${open ? 'true' : 'false'} aria-controls=${'rule-' + r.id} onClick=${function () { A.toggleRule(r.id); }}>
            <span>${r.title}</span>${r.chip ? html`<${Tag} text=${r.chip} tone=${r.tone} />` : html`<span></span>`}<${Chev} open=${open} />
          </button>${open ? html`<p id=${'rule-' + r.id}>${r.body}</p>` : null}</div>`;
        })}</div>` : null;
      })}
    </section>`;
  }
  function GuideList(p) {
    var M = p.M, A = p.A, st = p.st, sync = p.sync;
    var way = installWay(st), inst = way === 'prompt' ? { v: 'One tap opens it full screen, even offline', go: A.install } : way === 'ios' ? { v: 'Tap Share, then Add to Home Screen' } : way === 'android' ? { v: 'Browser menu ⋮, then Install app' } : null;
    function row(k, ic, label, value, go) {
      var inner = [html`<span key="i" class="g-ic" aria-hidden="true"><${Ico} n=${ic} s=${20} /></span>`, html`<span key="t" class="g-t"><b>${label}</b><small>${value}</small></span>`, go ? html`<${Arrow} key="a" />` : html`<span key="a"></span>`];
      return html`<li key=${k}>${go ? html`<button class="grow" onClick=${go}>${inner}</button>` : html`<div class="grow">${inner}</div>`}</li>`;
    }
    return html`<section class="card glist-card" aria-labelledby="gl-h">
      <div class="card-head"><h2 id="gl-h" class="card-k">Your app</h2></div>
      <ul class="glist">
        ${row('me', 'person', 'Your role', M.m.role + ' · ' + M.m.sector + ' analyst', A.openMembers)}
        ${row('cal', 'bell', 'Calendar reminders', 'Apple, Google, Outlook or Huawei', A.openCal)}
        ${row('sr', 'search', 'Search', 'Any date, meeting or rule', A.openSearch)}
        ${inst ? row('in', 'phone', 'Install the app', inst.v, inst.go) : null}
        ${row('up', 'send', 'Send my update', 'Your week in one message, ready for WhatsApp, Teams or email', A.openUpdate)}
        ${row('src', 'file', 'Where the dates come from', M.term.source + (M.updated ? '. Updated ' + M.updated + '.' : '.'), null)}
      </ul>
      ${sync ? html`<div class=${'sync ' + sync.state} aria-live="polite"><i aria-hidden="true"></i><span>${sync.text}</span><button onClick=${A.refresh} disabled=${sync.busy}>${sync.busy ? 'Checking…' : 'Refresh'}</button></div>` : null}
    </section>`;
  }

  // ---------- learn: required reading ----------
  // learn.json (window.TRS_LEARN in the preview) holds the books, levels, badges, rules, skills, deal files and question bank.
  // Progress is personal: one record per role, kept on the device behind LearnStore. A shared store can replace LearnStore
  // later (same load and save calls) without touching the screens; learnSummary() is what it would share.
  function loadLearn() {
    if (window.TRS_LEARN) return Promise.resolve(window.TRS_LEARN);
    function fromCache(err) {
      if (!window.caches) throw err;
      return caches.match('learn.json').then(function (r) { if (!r) throw err; return r.json(); });
    }
    return fetch('learn.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(fromCache);
  }
  var LearnStore = {
    kind: 'device',
    all: function () { try { return JSON.parse(read('trs-learn') || '{}') || {}; } catch (e) { return {}; } },
    load: function (id) { var s = LearnStore.all()[id]; return s && s.v === 1 ? fillLearn(s) : null; },
    save: function (id, s) { var all = LearnStore.all(); all[id] = s; store('trs-learn', JSON.stringify(all)); }
  };

  function freshLearn() {
    return { v: 1, xp: 0, level: 1, units: {}, paid: {}, review: {}, daily: null, streak: { n: 0, last: 0, best: 0 }, badges: {}, promos: {}, finals: {}, flags: {},
      skills: {}, cases: {}, cal: { n: 0, s: 0, sr: 0 }, notes: {}, weekly: { wk: -1, run: 0 }, seen: {}, ret: { n: 0, r: 0 }, sprint: { n: 0, best: 0 } };
  }
  // records saved before skills, deal files and confidence existed pick up the new fields as they load
  function fillLearn(S) { var f = freshLearn(); Object.keys(f).forEach(function (k) { if (S[k] == null) S[k] = f[k]; }); return S; }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ---------- learn: numbers in questions ----------
  // A calculation question carries ranges for its inputs ("vars") and the steps that turn them into the answer ("let"), so
  // each member, day and try gets fresh figures: a review tests the method, not a remembered number. Formulas take numbers,
  // names, + - * / ^ and brackets, and min, max, abs, round(x, dp), floor, ceil, sqrt, ln, exp and pow. Nothing is eval'd.
  var TPL = (function () {
    var FN = { min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, ln: Math.log, exp: Math.exp, pow: Math.pow,
      round: function (x, d) { var k = Math.pow(10, d || 0); return Math.round(x * k) / k; } };
    var cache = {};
    function parse(src) {
      src = String(src);
      if (cache[src]) return cache[src];
      var s = src, i = 0;
      function peek() { while (i < s.length && /\s/.test(s.charAt(i))) i++; return i < s.length ? s.charAt(i) : ''; }
      function fail(m) { throw new Error('Formula "' + s + '": ' + m); }
      function expr() { var n = term(), c; while ((c = peek()) === '+' || c === '-') { i++; n = [c, n, term()]; } return n; }
      function term() { var n = unary(), c; while ((c = peek()) === '*' || c === '/') { i++; n = [c, n, unary()]; } return n; }
      function unary() { var c = peek(); if (c === '-') { i++; return ['neg', unary()]; } if (c === '+') { i++; return unary(); } return power(); }
      function power() { var b = atom(); if (peek() === '^') { i++; return ['^', b, unary()]; } return b; }
      function atom() {
        var c = peek(), m, rest = s.slice(i);
        if (c === '(') { i++; var e = expr(); if (peek() !== ')') fail('missing )'); i++; return e; }
        m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
        if (m) { i += m[0].length; return ['n', parseFloat(m[0])]; }
        m = /^[A-Za-z_]\w*/.exec(rest);
        if (!m) fail(c ? 'unexpected ' + c : 'unexpected end');
        i += m[0].length;
        if (peek() !== '(') return ['v', m[0]];
        i++;
        var args = [];
        if (peek() !== ')') { for (;;) { args.push(expr()); if (peek() !== ',') break; i++; } }
        if (peek() !== ')') fail('missing )');
        i++;
        if (!FN.hasOwnProperty(m[0])) fail('unknown function ' + m[0]);
        return ['f', m[0], args];
      }
      var tree = expr();
      if (peek()) fail('unexpected ' + peek());
      return (cache[src] = tree);
    }
    function run(t, env) {
      switch (t[0]) {
        case 'n': return t[1];
        case 'v': if (!Object.prototype.hasOwnProperty.call(env, t[1])) throw new Error('No value for ' + t[1]); return env[t[1]];
        case 'neg': return -run(t[1], env);
        case 'f': return FN[t[1]].apply(null, t[2].map(function (a) { return run(a, env); }));
        case '+': return run(t[1], env) + run(t[2], env);
        case '-': return run(t[1], env) - run(t[2], env);
        case '*': return run(t[1], env) * run(t[2], env);
        case '/': return run(t[1], env) / run(t[2], env);
        case '^': return Math.pow(run(t[1], env), run(t[2], env));
      }
      throw new Error('Bad formula');
    }
    function val(src, env) { return typeof src === 'number' ? src : run(parse(src), env || {}); }
    // [min, max, step, example], [constant], or {pick: [...], base}
    function pick(spec, r) {
      if (!Array.isArray(spec)) {
        if (spec && Array.isArray(spec.pick)) return r ? spec.pick[Math.floor(r() * spec.pick.length)] : spec.base != null ? spec.base : spec.pick[0];
        return +spec;
      }
      if (spec.length < 3) return +spec[0];
      var lo = +spec[0], hi = +spec[1], st = +spec[2] || 1, n = Math.floor((hi - lo) / st + 1e-9) + 1;
      if (!r) return spec.length > 3 ? +spec[3] : lo;
      return +(lo + st * Math.floor(r() * n)).toFixed(10);
    }
    function once(def, r, base) {
      var e = Object.assign({}, base || {});
      Object.keys(def.vars || {}).forEach(function (k) { e[k] = pick(def.vars[k], r); });
      Object.keys(def.let || {}).forEach(function (k) { e[k] = val(def.let[k], e); if (!isFinite(e[k])) throw new Error(k + ' is not a number'); });
      return e;
    }
    function fits(def, e) { return (def.when || []).every(function (w) { return val(w, e) > 0; }); }
    // the written example when r is null; otherwise fresh draws until every "when" holds, falling back to the example
    function build(def, r, base) {
      if (!def) return Object.assign({}, base || {});
      if (r) {
        for (var k = 0; k < 40; k++) {
          try { var e = once(def, r, base); if (fits(def, e)) return e; } catch (x) { /* draw again */ }
        }
      }
      return once(def, null, base);
    }
    function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    // [R][decimals][% x m bn]: R1bn turns R8,426m into R8.4bn; 1% turns 0.129 into 12.9%; 1x turns 8.87 into 8.9×
    function fmt(v, spec) {
      var m = /^(R?)(\d?)(%|x|m|bn)?$/.exec(spec || '') || ['', '', '', ''];
      var x = +v, suf = m[3] || '', dp = m[2] === '' ? null : +m[2];
      if (suf === '%') x *= 100;
      if (suf === 'bn') x /= 1000;
      if (dp == null) dp = Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 2;
      var k = Math.pow(10, dp), str = (Math.round(Math.abs(x) * k + 1e-7) / k).toFixed(dp), neg = x < 0 && +str !== 0, parts = str.split('.');
      str = group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
      return (neg ? '−' : '') + m[1] + str + (suf === 'x' ? '×' : suf);
    }
    function fill(text, env) {
      return String(text == null ? '' : text).replace(/\{([^{}|]+)(?:\|([^{}]*))?\}/g, function (all, ex, spec) { return fmt(val(ex, env), spec); });
    }
    // what a member types: "R8 426m", "8,426", "8,9" (a decimal comma), "12.9%", "(50)" or "−1.5"
    function parseNum(t) {
      var s = String(t == null ? '' : t).replace(/[\s  ']/g, '').replace(/[−–—]/g, '-');
      var neg = false;
      if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
      s = s.replace(/^(-?)R/i, '$1');
      for (var k = 0; k < 3; k++) s = s.replace(/(×|x|%|bn|m|times|days|years|yrs)$/i, '');
      if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/,/g, '');
      else if (/^-?0,\d+$/.test(s) || /,\d{1,2}$/.test(s) || /,\d{4,}$/.test(s)) s = s.replace(',', '.');
      else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
      var n = parseFloat(s);
      return neg ? -n : n;
    }
    // close enough: within the stated rounding, or half a percent of the answer
    function near(a, b, dp, tol) { return isFinite(a) && Math.abs(a - b) <= Math.max((tol == null ? 0.005 : tol) * Math.abs(b), 0.5 * Math.pow(10, -(dp || 0)) + 1e-9); }
    return { parse: parse, val: val, build: build, fmt: fmt, fill: fill, parseNum: parseNum, near: near, pick: pick };
  })();
  // How an answer's unit reads and is typed: Rm (rand millions), R, m (millions), x (a multiple), % (stored as a fraction)
  var UNITS = { Rm: { pre: 'R', suf: 'm', word: 'R million' }, Rbn: { pre: 'R', suf: 'bn', word: 'R billion' }, R: { pre: 'R', suf: '', word: 'rand' },
    m: { pre: '', suf: 'm', word: 'million' }, x: { pre: '', suf: '×', box: 'times', word: 'times' }, '%': { pre: '', suf: '%', word: 'per cent' }, '': { pre: '', suf: '', word: '' } };
  function unitOf(u) { return UNITS[u] || UNITS['']; }
  function unitSpec(u, dp) { return u === 'Rm' ? 'R' + dp + 'm' : u === 'Rbn' ? 'R' + dp + 'bn' : u === 'R' ? 'R' + dp : u === 'm' ? dp + 'm' : u === 'x' ? dp + 'x' : u === '%' ? dp + '%' : String(dp); }
  function showNum(v, u, dp) { return TPL.fmt(v, unitSpec(u || '', dp || 0)); }
  // the typed number in the answer's own terms (per cent answers are typed as 12.9, kept as 0.129)
  function typedValue(text, u) {
    var n = TPL.parseNum(text), t = String(text || '').replace(/\s+$/, ''), bn = /bn$/i.test(t), mil = !bn && /\d\s*m$/i.test(t);
    if (u === '%') return n / 100;
    if (u === 'Rbn') return mil ? n : n * 1000;          // "8,426m" typed for an answer in R billion
    if ((u === 'Rm' || u === 'm') && bn) return n * 1000;  // "R1.2bn" typed for an answer in R million
    return n;
  }
  // A comma before exactly three digits ("0,875", "1,125") could be a decimal comma or a thousands separator: both readings
  // are offered, and the one nearer the answer is marked.
  function typedValues(text, u) {
    var a = typedValue(text, u), t = String(text || '').trim();
    if (/^[^\d,.]*\d{1,3},\d{3}(?!\d)[^\d,.]*$/.test(t)) { var b = typedValue(t.replace(',', '.'), u); if (b !== a) return [a, b]; }
    return [a];
  }
  function nearIn(v, truth, u, dp, tol) { var k = u === '%' ? 100 : u === 'Rbn' ? 0.001 : 1; return TPL.near(v * k, truth * k, dp, tol); }

  var QTYPES = { tf: 1, mcq: 1, num: 3, est: 3, err: 3, order: 2, dir: 2, two: 2, sort: 2 };
  function learnPrep(raw) {
    if (!raw || !Array.isArray(raw.books) || !raw.books.length || !Array.isArray(raw.levels) || !raw.levels.length) throw new Error('learn.json needs books and levels.');
    var R = Object.assign({ checkSize: 8, checkPass: 6, reviewSize: 10, reviewPass: 8, finalSize: 20, finalPass: 16, finalMix: [2, 8, 10], retry: 'nextDay', inOrder: true, promotions: true, samples: false, confidence: true }, raw.rules || {});
    var X = Object.assign({ t1: 10, t2: 20, t3: 40, calc: 40, err: 40, 'case': 40, deal: 100, pass: 100, perfect: 50, daily: 15, streak7: 100, reviewClear: 30, weekly: 30, warm: 30, pret: 30, sprint: 30, sure: 0.5 }, raw.xp || {});
    var SC = Object.assign({ skill: [2, 7, 16, 35], miss: [1, 3, 7, 16], after: 14, weekly: 6, reviewMax: 12, preThesis: null, sprint: null }, raw.schedule || {});
    var levels = raw.levels.map(function (l, i) {
      return { n: i + 1, name: l.name || 'Level ' + (i + 1), xp: +l.xp || 0, mix: Array.isArray(l.mix) && l.mix.length === 3 ? l.mix.map(Number) : [R.checkSize, 0, 0] };
    });
    var units = {}, bookCfg = {};
    var books = raw.books.map(function (b) {
      var mods = {};
      (b.modules || []).forEach(function (md) { (md.units || []).forEach(function (u) { mods[u] = md.title; }); });
      var list = (b.units || []).filter(function (u) { return u && u.id; }).map(function (u, i) {
        return (units[u.id] = { id: u.id, book: b.id, i: i, label: u.label || 'Chapter ' + (i + 1), title: u.title || '', short: u.short || '', sections: u.sections || b.sections || [], module: mods[u.id] || '',
          pages: u.pages ? String(u.pages) : '', mins: Math.max(0, Math.round(+u.mins) || 0),
          ideas: Array.isArray(u.ideas) ? u.ideas.filter(function (t) { return typeof t === 'string' && t.trim(); }) : [] });
      });
      var modules = (b.modules || []).map(function (md) { return { title: md.title || '', units: (md.units || []).filter(function (u) { return units[u]; }) }; }).filter(function (md) { return md.units.length; });
      if (!modules.length) modules = [{ title: '', units: list.map(function (u) { return u.id; }) }];
      var ck = b.check || null;
      // a book can set its own check: how many calculations a pass needs, how much help each level starts with, and the
      // question plan per level ({r: recall, c: concept, a: applied slots such as "num", "err", "est" or "case3"})
      if (ck) bookCfg[b.id] = { pass: +ck.pass || R.checkPass, passCalc: +ck.passCalc || 0, support: Array.isArray(ck.support) ? ck.support : [], plans: Array.isArray(ck.plans) ? ck.plans : [],
        final: ck.final || null, promoCase: ck.promoCase !== false, label: ck.label || b.short || b.title };
      return { id: b.id, title: b.title || b.id, short: b.short || b.title || b.id, by: b.by || '', units: list, modules: modules };
    });
    var skills = {}, unitSkills = {};
    (raw.skills || []).forEach(function (s) {
      if (!s || !s.id || !units[s.unit] || skills[s.id]) return;
      skills[s.id] = { id: s.id, unit: s.unit, name: s.name || s.id, typed: s.typed !== false };
      (unitSkills[s.unit] = unitSkills[s.unit] || []).push(s.id);
    });
    var qs = {}, samples = {}, byId = {}, pres = {}, cases = {}, caseOf = {}, bad = [];
    function norm(q, c) {
      if (!q || !q.id || !q.q || byId[q.id]) return null;
      var type = QTYPES[q.type] ? q.type : '', u = units[c ? c.unit : q.unit], book = u ? u.book : q.book, tf = type === 'tf';
      function no(why) { bad.push(q.id + ': ' + why); return null; }
      if (!type) return no('type');
      if (!u && !(q.sample && book)) return no('unit');
      if (tf && typeof q.answer !== 'boolean') return no('answer');
      if ((type === 'mcq' || type === 'two') && !(Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)) return no('options');
      if (type === 'two' && !(q.reason && Array.isArray(q.reason.options) && q.reason.answer >= 0 && q.reason.answer < q.reason.options.length)) return no('reason');
      if (type === 'order' && !(Array.isArray(q.items) && q.items.length >= 3)) return no('items');
      if (type === 'err' && !(Array.isArray(q.lines) && q.lines[q.bad] != null && q.fix && Array.isArray(q.fix.options) && q.fix.options[q.fix.answer] != null)) return no('lines');
      if (type === 'dir' && !(Array.isArray(q.measures) && q.measures.length && q.measures.every(function (m) { return m && m.name && /^(up|down|same)$/.test(m.dir); }))) return no('measures');
      if (type === 'sort' && !(Array.isArray(q.cats) && q.cats.length === 2 && Array.isArray(q.items) && q.items.length >= 2 && q.items.every(function (x) { return x && x.t && (x.c === 0 || x.c === 1); }))) return no('sort');
      if (type === 'est' && !(Array.isArray(q.band) && q.band.length === 2)) return no('band');
      // anything with numbers has to work out with its written example
      try {
        var env = TPL.build(q, null, c ? TPL.build(c.def, null) : null);
        if (type === 'num' || type === 'est') { if (!isFinite(TPL.val(q.ans, env))) return no('answer'); }
        if (type === 'est') { var lo = TPL.val(q.band[0], env), hi = TPL.val(q.band[1], env); if (!(lo <= hi)) return no('band'); }
        if (type === 'dir' && q.mag && !isFinite(TPL.val(q.mag.ans, env))) return no('mag');
        TPL.fill(q.q, env); TPL.fill(q.why, env);
        (q.steps || []).forEach(function (st) { TPL.fill(st.t, env); TPL.val(st.v, env); });
      } catch (e) { return no(e.message); }
      var tier = clamp(Math.round(+q.tier) || QTYPES[type], 1, 3), calc = type === 'num' || type === 'est';
      var x = { id: q.id, unit: u ? u.id : '', book: book, tier: tier, type: type, tf: tf, q: q.q, why: q.why || '', src: q.src || '', skill: skills[q.skill] ? q.skill : '',
        pre: !!q.pre, sample: !u, calc: calc, xpk: c ? 'case' : calc ? 'calc' : type === 'err' ? 'err' : 't' + tier, caseId: c ? c.id : '', raw: q,
        options: tf ? ['True', 'False'] : q.options || null, answer: tf ? (q.answer ? 0 : 1) : q.answer };
      byId[x.id] = x;
      return x;
    }
    (raw.cases || []).forEach(function (c) {
      if (!c || !c.id || !units[c.unit] || cases[c.id]) return;
      var cc = { id: c.id, unit: c.unit, book: units[c.unit].book, title: c.title || c.id, deal: c.deal || 'Deal file', lead: c.lead || '', def: { vars: c.vars, let: c.let, when: c.when },
        facts: (c.facts || []).filter(function (f) { return Array.isArray(f) && f.length === 2; }), tomb: c.tomb || {}, pass: +c.pass || 0, items: [] };
      try { var env = TPL.build(cc.def, null); cc.facts.forEach(function (f) { TPL.fill(f[1], env); }); if (cc.tomb.value) TPL.fill(cc.tomb.value, env); } catch (e) { bad.push(c.id + ': ' + e.message); return; }
      cases[c.id] = cc;
      (c.items || []).forEach(function (q) { var x = norm(q, cc); if (x) { x.seq = cc.items.length; cc.items.push(x); } });
      if (!cc.items.length) { delete cases[c.id]; return; }
      cc.pass = Math.min(cc.items.length, cc.pass || Math.max(1, cc.items.length - 1));
      (caseOf[c.unit] = caseOf[c.unit] || []).push(c.id);
    });
    (raw.questions || []).forEach(function (q) {
      var x = norm(q, null);
      if (!x) return;
      if (x.pre && x.unit) (pres[x.unit] = pres[x.unit] || []).push(x);
      else if (x.unit) (qs[x.unit] = qs[x.unit] || []).push(x);
      else (samples[x.book] = samples[x.book] || []).push(x);
    });
    if (bad.length && window.TRS_LEARN) { try { console.warn('Learn questions left out: ' + bad.join('; ')); } catch (e) { /* no console */ } }
    var facts = {};
    (raw.facts || []).forEach(function (f) { var k = f && f.text && (f.unit || f.book); if (k) (facts[k] = facts[k] || []).push(f.text); });
    var pg = raw.programme || {};
    return { R: R, X: X, SC: SC, levels: levels, books: books, units: units, qs: qs, samples: samples, byId: byId, facts: facts, pres: pres, cases: cases, caseOf: caseOf,
      skills: skills, unitSkills: unitSkills, bookCfg: bookCfg, left: bad,
      tiers: Array.isArray(raw.tiers) && raw.tiers.length === 3 ? raw.tiers : [{ name: 'Recall' }, { name: 'Concept' }, { name: 'Applied' }],
      badges: (raw.badges || []).filter(function (b) { return b && b.id && b.name; }), groups: raw.badgeGroups || [],
      title: pg.title || 'Required reading', term: pg.term || '', start: parseDay(pg.start), due: parseDay(pg.due),
      pauses: (Array.isArray(pg.pauses) ? pg.pauses : []).map(function (x) { return { a: parseDay(x && x.from), b: parseDay(x && x.to), label: (x && x.label) || 'Break' }; })
        .filter(function (x) { return !isNaN(x.a) && !isNaN(x.b) && x.b >= x.a; }) };
  }
  function bookOf(LP, id) { return LP.books.filter(function (b) { return b.id === id; })[0]; }
  // Days from a to b (both included) that count towards the reading pace: breaks such as the year-end recess don't.
  function activeDays(LP, a, b) {
    if (b < a) return 0;
    var n = Math.round((b - a) / DAY) + 1;
    LP.pauses.forEach(function (x) { var lo = Math.max(a, x.a), hi = Math.min(b, x.b); if (hi >= lo) n -= Math.round((hi - lo) / DAY) + 1; });
    return Math.max(0, n);
  }
  function pauseOn(LP, day) { return LP.pauses.filter(function (x) { return day >= x.a && day <= x.b; })[0] || null; }
  // weeks run Monday to Sunday
  function weekOf(day) { return Math.floor((day / DAY + 3) / 7); }

  // Small seeded random numbers: the same member, day and attempt always get the same questions, order and figures.
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = h + 0x6D2B79F5 | 0; var t = Math.imul(h ^ h >>> 15, 1 | h); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffled(a, r) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function unitPool(LP, uid) { var own = LP.qs[uid]; if (own && own.length) return own; var u = LP.units[uid]; return LP.R.samples && u ? LP.samples[u.book] || [] : []; }
  function isSample(LP, uid) { return !(LP.qs[uid] && LP.qs[uid].length); }
  function scaleMix(mix, n) {
    if (!(mix[0] + mix[1] + mix[2] > 0)) return [n, 0, 0];
    var s = mix[0] + mix[1] + mix[2], out = mix.map(function (m) { return Math.floor(m * n / s); }), rem = n - out[0] - out[1] - out[2];
    for (var t = 2; rem > 0; t = (t + 2) % 3) { if (mix[t] > 0) { out[t]++; rem--; } }
    return out;
  }
  // n questions to a tier mix [recall, concept, applied], easiest first. Shortfalls come from the hardest tier the mix
  // allows, then any. Questions from the last attempt go to the back, so a retry gets a fresh mix where the bank allows.
  function pickQs(pool, mix, n, r, avoid) {
    avoid = avoid || {};
    var by = [[], [], []];
    shuffled(pool, r).forEach(function (q) { by[q.tier - 1].push(q); });
    by = by.map(function (l) { return l.filter(function (q) { return !avoid[q.id]; }).concat(l.filter(function (q) { return avoid[q.id]; })); });
    var want = scaleMix(mix, n), top = want[2] ? 2 : want[1] ? 1 : 0, out = [];
    [0, 1, 2].forEach(function (t) { out = out.concat(by[t].splice(0, want[t])); });
    for (var t = top; out.length < n && t >= 0; t--) out = out.concat(by[t].splice(0, n - out.length));
    for (t = top + 1; out.length < n && t <= 2; t++) out = out.concat(by[t].splice(0, n - out.length));
    return out.sort(function (a, b) { return a.tier - b.tier; });
  }
  // three (or n) linked questions from a deal file: the window with the most calculations in it, chosen at random among ties
  function caseSlice(LP, cid, k, r) {
    var c = LP.cases[cid];
    if (!c) return [];
    if (c.items.length <= k) return c.items.slice();
    var best = -1, starts = [];
    for (var i = 0; i + k <= c.items.length; i++) {
      var n = c.items.slice(i, i + k).filter(function (q) { return q.calc; }).length;
      if (n > best) { best = n; starts = [i]; } else if (n === best) starts.push(i);
    }
    var at = starts[Math.floor(r() * starts.length)];
    return c.items.slice(at, at + k);
  }
  // Books with a question plan (Investment Banking): recall, then concept, then the applied slots in order, with a
  // three-question slice of the chapter's deal file where the plan asks for "case3". Calculations spread across skills.
  function planPick(LP, pool, plan, n, r, avoid, caseIds) {
    avoid = avoid || {};
    var groups = { r: [], c: [], num: [], err: [], est: [], mcq3: [] };
    shuffled(pool, r).forEach(function (q) {
      groups[q.tier === 1 ? 'r' : q.tier === 2 ? 'c' : q.type === 'num' ? 'num' : q.type === 'err' ? 'err' : q.type === 'est' ? 'est' : 'mcq3'].push(q);
    });
    Object.keys(groups).forEach(function (k) { var l = groups[k]; groups[k] = l.filter(function (q) { return !avoid[q.id]; }).concat(l.filter(function (q) { return avoid[q.id]; })); });
    var used = {};
    function take(g) {
      var l = groups[g], k = 0;
      if (!l.length) return null;
      for (var j = 0; j < l.length; j++) if (!l[j].skill || !used[l[j].skill]) { k = j; break; }
      var q = l.splice(k, 1)[0];
      if (q.skill) used[q.skill] = 1;
      return q;
    }
    var FALL = { num: ['num', 'est', 'err', 'mcq3', 'c'], err: ['err', 'num', 'mcq3', 'c'], est: ['est', 'num', 'mcq3', 'c'], mcq3: ['mcq3', 'num', 'err', 'c'], c: ['c', 'mcq3', 'r'], r: ['r', 'c'] };
    function slot(g) { var f = FALL[g] || [g, 'c']; for (var i = 0; i < f.length; i++) { var q = take(f[i]); if (q) return q; } return null; }
    var head = [], app = [], cs = [], k;
    for (k = 0; k < (plan.r || 0); k++) head.push(slot('r'));
    for (k = 0; k < (plan.c || 0); k++) head.push(slot('c'));
    (plan.a || []).forEach(function (g) {
      var m = /^case(\d)$/.exec(g);
      if (m) {
        var ids = (caseIds || []).filter(function (id) { return LP.cases[id]; }), got = ids.length ? caseSlice(LP, ids[Math.floor(r() * ids.length)], +m[1], r) : [];
        if (got.length) { cs = cs.concat(got); return; }
        for (k = 0; k < +m[1]; k++) app.push(slot('num'));
        return;
      }
      app.push(slot(g));
    });
    var out = head.concat(app).filter(Boolean);
    ['num', 'c', 'r', 'err', 'mcq3', 'est'].forEach(function (g) { while (out.length + cs.length < n && groups[g].length) out.push(take(g)); });
    return out.slice(0, Math.max(0, n - cs.length)).concat(cs);
  }
  function levelInfo(LP, S) {
    var L = LP.levels, cur = L[clamp(S.level || 1, 1, L.length) - 1], nxt = L[cur.n] || null;
    var pct = nxt ? clamp((S.xp - cur.xp) / Math.max(1, nxt.xp - cur.xp), 0, 1) : 1;
    return { cur: cur, next: nxt, pct: pct, toNext: nxt ? Math.max(0, nxt.xp - S.xp) : 0, maxTier: cur.mix[2] ? 3 : cur.mix[1] ? 2 : 1 };
  }
  function tierOpensAt(LP, t) { for (var i = 0; i < LP.levels.length; i++) if (LP.levels[i].mix[t] > 0) return LP.levels[i]; return null; }
  function planFor(LP, bookId, lvN) { var c = LP.bookCfg[bookId]; return c && c.plans.length ? c.plans[Math.min(lvN, c.plans.length) - 1] : null; }

  // How much help a calculation gets: a worked example first ("walk"), then one step left blank ("fade"), then none
  // ("solo"). Each book sets where a level starts; each skill then moves on with the member: a right answer takes a step
  // of help away, two misses in a row give one back, and two solo passes switch the help off for that skill.
  function supportFor(LP, S, q, lvN) {
    if (q.type !== 'num' || q.caseId || !(q.raw.steps && q.raw.steps.length)) return 'solo';
    var c = LP.bookCfg[q.book], base = c && c.support.length ? c.support[Math.min(lvN, c.support.length) - 1] : 'solo';
    var sk = q.skill && S.skills && S.skills[q.skill];
    var m = sk && sk.sup ? (sk.sup === 'off' ? 'solo' : sk.sup) : base;
    return m === 'walk' || m === 'fade' ? m : 'solo';
  }

  // One question, ready to show: figures drawn, options shuffled, working filled in. o.mode is the help it gets, o.env a
  // deal file's figures (shared across its questions), o.r the seeded random numbers for this member, day and try.
  function instItem(LP, q, o) {
    var raw = q.raw || {}, r = o.r, c = q.caseId ? LP.cases[q.caseId] : null, env;
    try { env = TPL.build(raw, r, c ? o.env || TPL.build(c.def, r) : null); } catch (e) { env = TPL.build(raw, null, c ? TPL.build(c.def, null) : null); }
    function f(t) { try { return TPL.fill(t, env); } catch (e) { return String(t || ''); } }
    function v(x) { return TPL.val(x, env); }
    var it = { id: q.id, tier: q.tier, type: q.type, tf: q.tf, q: f(q.q), why: f(q.why), src: q.src, skill: q.skill, sample: q.sample, calc: q.calc, xpk: q.xpk, caseId: q.caseId, unit: q.unit, book: q.book, mode: 'solo' };
    if (q.type === 'tf' || q.type === 'mcq' || q.type === 'two') {
      var idx = q.options.map(function (x, i) { return i; }), ord = q.tf || raw.keep ? idx : shuffled(idx, r);
      it.keep = !!raw.keep;
      it.opts = ord.map(function (i) { return { t: f(q.options[i]), right: i === q.answer, miss: raw.miss && raw.miss[i] ? f(raw.miss[i]) : '' }; });
      if (q.type === 'two') {
        var rs = raw.reason, ri = shuffled(rs.options.map(function (x, i) { return i; }), r);
        it.rq = f(rs.q || 'Why?');
        it.ropts = ri.map(function (i) { return { t: f(rs.options[i]), right: i === rs.answer }; });
        it.aq = f(raw.aq || 'Your call');
      }
    } else if (q.type === 'num' || q.type === 'est') {
      it.ans = v(raw.ans); it.unit = raw['in'] || ''; it.dp = raw.dp != null ? +raw.dp : 0; it.tol = raw.tol; it.signed = !!raw.signed || it.ans < 0;
      it.work = (raw.work || []).map(f);
      it.errs = (raw.errs || []).map(function (e) { var x = NaN; try { x = v(e.v); } catch (er) { /* skip */ } return { v: x, why: f(e.why) }; }).filter(function (e) { return isFinite(e.v); });
      it.hint = raw.hint ? f(raw.hint) : '';
      if (q.type === 'est') { it.band = [v(raw.band[0]), v(raw.band[1])]; it.secs = +raw.secs || 90; }
      var mode = o.mode || 'solo';
      if (q.type === 'num' && raw.steps && raw.steps.length && mode !== 'solo') {
        it.mode = mode;
        it.steps = raw.steps.map(function (st) { return { t: f(st.t), v: v(st.v), unit: st['in'] != null ? st['in'] : it.unit, dp: st.dp != null ? +st.dp : it.dp }; });
        if (mode === 'fade') {
          var key = -1;
          raw.steps.forEach(function (st, i) { if (st.key) key = i; });
          it.blank = key >= 0 ? key : Math.max(0, it.steps.length - 2);
          var b = it.steps[it.blank];
          it.target = { v: b.v, unit: b.unit, dp: b.dp };
        } else {
          var ex = TPL.build(raw, o.rx || r, null);
          it.example = { q: TPL.fill(raw.q, ex), steps: raw.steps.map(function (st) { return { t: TPL.fill(st.t, ex), v: TPL.val(st.v, ex), unit: st['in'] != null ? st['in'] : it.unit, dp: st.dp != null ? +st.dp : it.dp }; }),
            ans: TPL.val(raw.ans, ex) };
          if (raw.ask) it.ask = { q: raw.ask.q, why: raw.ask.why || '', opts: shuffled(raw.ask.options.map(function (t, i) { return { t: t, right: i === raw.ask.answer }; }), r) };
        }
      }
    } else if (q.type === 'order') {
      it.items = raw.items.map(f);
      var sh = shuffled(it.items.map(function (x, i) { return i; }), r);
      if (sh.every(function (x, i) { return x === i; })) sh.push(sh.shift());
      it.start = sh;
    } else if (q.type === 'err') {
      it.lines = raw.lines.map(f); it.bad = raw.bad;
      it.fq = f(raw.fix.q || 'What should that line say?');
      it.fix = shuffled(raw.fix.options.map(function (t, i) { return { t: f(t), right: i === raw.fix.answer }; }), r);
    } else if (q.type === 'dir') {
      it.measures = raw.measures.map(function (m) { return { name: f(m.name), dir: m.dir }; });
      if (raw.mag) it.mag = { q: f(raw.mag.q), ans: v(raw.mag.ans), unit: raw.mag['in'] || '', dp: raw.mag.dp != null ? +raw.mag.dp : 0, tol: raw.mag.tol };
      it.work = (raw.work || []).map(f);
    } else if (q.type === 'sort') {
      it.cats = raw.cats.map(f);
      it.items = shuffled(raw.items.map(function (x) { return { t: f(x.t), c: x.c }; }), r);
    }
    if (c) { it.caseTitle = c.title; it.facts = c.facts.map(function (x) { return [f(x[0]), f(x[1])]; }); it.lead = f(c.lead); }
    return it;
  }

  // Marking one answer. d is the member's draft: pick, v (typed), order, line + fix, dirs + v, a + b, sort.
  function gradeItem(it, d) {
    var out = { right: false, typed: false, val: NaN, diag: '' };
    function numeric(text, truth, u, dp, tol) {
      var xs = typedValues(text, u), ok = xs.filter(function (x) { return nearIn(x, truth, u, dp, tol); });
      out.val = ok.length ? ok[0] : xs[xs.length > 1 && Math.abs(xs[1] - truth) < Math.abs(xs[0] - truth) ? 1 : 0]; out.typed = true;
      return ok.length > 0;
    }
    switch (it.type) {
      case 'tf': case 'mcq': out.right = !!(it.opts[d.pick] && it.opts[d.pick].right); break;
      case 'two': out.right = !!(it.opts[d.a] && it.opts[d.a].right && it.ropts[d.b] && it.ropts[d.b].right); break;
      case 'num':
        if (it.mode === 'fade') out.right = numeric(d.v, it.target.v, it.target.unit, it.target.dp, it.tol);
        else out.right = numeric(d.v, it.ans, it.unit, it.dp, it.tol);
        if (!out.right && it.mode !== 'fade') it.errs.some(function (e) { if (nearIn(out.val, e.v, it.unit, it.dp, it.tol)) { out.diag = e.why; return true; } return false; });
        break;
      case 'est':
        var ev = typedValues(d.v, it.unit), inBand = ev.filter(function (x) { return isFinite(x) && x >= it.band[0] - 1e-9 && x <= it.band[1] + 1e-9; });
        out.val = inBand.length ? inBand[0] : ev[0]; out.typed = true; out.right = inBand.length > 0;
        out.slow = d.secs > it.secs;
        break;
      case 'order': out.right = (d.order || []).every(function (x, i) { return x === i; }); break;
      case 'err': out.right = d.line === it.bad && !!(it.fix[d.fix] && it.fix[d.fix].right); break;
      case 'dir':
        out.right = it.measures.every(function (m, i) { return (d.dirs || [])[i] === m.dir; });
        if (it.mag) { var mr = numeric(d.v, it.mag.ans, it.mag.unit, it.mag.dp, it.mag.tol); out.right = out.right && mr; out.magRight = mr; }
        break;
      case 'sort': out.right = it.items.every(function (x, i) { return (d.sort || [])[i] === x.c; }); break;
    }
    return out;
  }
  // Has the member given a whole answer (so the Sure and Not sure buttons can wake up)?
  function draftDone(it, d) {
    function okNum(t) { return isFinite(TPL.parseNum(t)); }
    if (it.ask && d.ask < 0) return false;
    switch (it.type) {
      case 'tf': case 'mcq': return d.pick >= 0;
      case 'two': return d.a >= 0 && d.b >= 0;
      case 'num': case 'est': return okNum(d.v);
      case 'order': return true;
      case 'err': return d.line >= 0 && d.fix >= 0;
      case 'dir': return it.measures.every(function (m, i) { return !!(d.dirs || [])[i]; }) && (!it.mag || okNum(d.v));
      case 'sort': return it.items.every(function (x, i) { return (d.sort || [])[i] === 0 || (d.sort || [])[i] === 1; });
    }
    return false;
  }
  // XP for a set of answers: first-time right answers pay their type's points; with confidence on, "Sure" and right adds
  // half again and "Sure" but wrong costs the question's points. A session never goes below zero.
  function xpOf(LP, spec, answers) {
    var X = LP.X, base = 0, bonus = 0, pen = 0, nb = 0, np = 0, seen = {};
    answers.forEach(function (a) {
      var pts = X[a.xpk] || 0;
      var fresh = !spec.paid[a.id] && !seen[a.id];
      if (a.right && fresh) { base += pts; seen[a.id] = 1; }
      // Sure changes the XP of questions not yet got right; on the rest it only feeds the calibration measure
      if (spec.conf && a.sure === true && fresh) { if (a.right) { bonus += Math.round(pts * X.sure); nb++; } else { pen += pts; np++; } }
    });
    pen = Math.min(pen, base + bonus);
    return { base: base, bonus: bonus, pen: pen, nb: nb, np: np, net: base + bonus - pen };
  }

  // A skill is secure once it has been right on three separate days at least a week apart (one of them a typed answer,
  // where the skill has calculations).
  function isSecure(sk, typedNeeded) {
    var days = (sk.days || []).slice().sort(function (a, b) { return a - b; }), n = 0, last = -1e15;
    days.forEach(function (d) { if (d - last >= 7 * DAY) { n++; last = d; } });
    return n >= 3 && (!typedNeeded || !!sk.typed);
  }
  function skillState(LP, S, id) {
    var sk = S.skills[id];
    if (!sk || !sk.n) return 'new';
    if (sk.sec) return 'secure';
    return sk.days && sk.days.length ? 'practised' : 'learning';
  }
  function unitDesk(LP, S, uid) {
    var list = LP.unitSkills[uid] || [];
    if (!list.length) return false;
    var cs = LP.caseOf[uid] || [];
    return list.every(function (id) { return S.skills[id] && S.skills[id].sec; }) && cs.every(function (c) { return S.cases[c] && S.cases[c].closed; });
  }
  function calibration(S) { var c = S.cal || {}; return c.s ? { n: c.s, right: c.sr, pct: c.sr / c.s } : null; }
  function preThesis(LP, ctx) {
    var pt = LP.SC.preThesis;
    if (!pt || !ctx || !ctx.dates) return null;
    var by = ctx.dates[String(pt.dateKey || '').replace('{cycle}', ctx.cycle || '')];
    if (!by) return null;
    var end = by - (by % DAY), start = end - (pt.days || 7) * DAY;
    return { start: start, end: end, units: pt.units || [], at: by };
  }

  // Everything the Learn screens show, worked out from the questions file, a member's record and the day.
  // Every skill of a passed chapter is on the review schedule, including ones the check didn't draw or that were missed
  // (back the day after the pass) and ones from chapters passed before skills existed. Anchored to the pass day, so it
  // works out the same on every load.
  function planSkills(LP, S) {
    Object.keys(LP.unitSkills).forEach(function (uid) {
      var u = S.units[uid];
      if (!u || !u.passed) return;
      LP.unitSkills[uid].forEach(function (id) {
        var sk = S.skills[id] || (S.skills[id] = { n: 0, days: [] });
        if (!sk.start) { sk.start = u.passed; sk.box = 0; sk.due = u.passed + (sk.days && sk.days.length ? LP.SC.skill[0] : 1) * DAY; }
      });
    });
    return S;
  }
  function learnModel(LP, S, day, ctx) {
    planSkills(LP, S);
    var R = LP.R, lv = levelInfo(LP, S), passedAll = 0, totalAll = 0;
    var books = LP.books.map(function (b) {
      var prev = true, next = null, passed = 0;
      var us = b.units.map(function (u) {
        var r = S.units[u.id] || {}, ok = !!r.passed, open = ok || !R.inOrder || prev;
        prev = ok; if (ok) passed++;
        var cs = (LP.caseOf[u.id] || []).map(function (cid) {
          var c = LP.cases[cid], rc = S.cases[cid] || {};
          return { c: c, r: rc, closed: !!rc.closed, open: ok, wait: !!(!rc.closed && rc.lastDay >= day) };
        });
        var sks = (LP.unitSkills[u.id] || []).map(function (id) { return { id: id, name: LP.skills[id].name, state: skillState(LP, S, id) }; });
        var desk = sks.length > 0 && unitDesk(LP, S, u.id);
        if (desk) sks.forEach(function (s) { s.state = 'desk'; });
        var pre = (LP.pres[u.id] || []).length ? { n: LP.pres[u.id].length, done: r.pre || 0, score: r.preScore || 0 } : null;
        var x = Object.assign({}, u, { r: r, passed: ok, perfect: !!r.perfect, open: open, state: ok ? (r.perfect ? 'perfect' : 'passed') : open ? 'open' : 'locked',
          read: (r.read || []).length, ready: unitPool(LP, u.id).length > 0, sample: isSample(LP, u.id), wait: R.retry === 'nextDay' && r.lastDay >= day && !r.perfect,
          pre: pre, cases: cs, skills: sks, desk: desk, cfg: LP.bookCfg[u.book] || null });
        if (!ok && open && !next) next = x;
        return x;
      });
      passedAll += passed; totalAll += us.length;
      var f = S.finals[b.id] || {};
      return { b: b, units: us, passed: passed, total: us.length, next: next, done: us.length > 0 && passed === us.length,
        final: { passed: !!f.passed, best: f.best || 0, size: f.size || 0, at: f.passed || 0, wait: !f.passed && f.lastDay >= day } };
    });
    var promo = null, L = LP.levels;
    if (R.promotions && lv.next && S.xp >= lv.next.xp) {
      var p = S.promos[lv.next.n] || {};
      promo = lv.next.n === L.length
        ? { to: lv.next, final: true, need: books.filter(function (x) { return !x.final.passed; }).map(function (x) { return x.b.title; }) }
        : { to: lv.next, final: false, wait: p.lastDay >= day, best: p.best || 0, tries: p.tries || 0 };
    }
    var pace = null;
    if (!isNaN(LP.start) && !isNaN(LP.due) && totalAll) {
      // Pace runs on working days only: the line pauses over breaks (the year-end recess) and picks up after them.
      var span = Math.max(1, activeDays(LP, LP.start, LP.due)), gone = day < LP.start ? 0 : activeDays(LP, LP.start, Math.min(day, LP.due));
      var frac = clamp(gone / span, 0, 1), expect = totalAll * frac, left = totalAll - passedAll;
      var weeks = Math.max(1, activeDays(LP, Math.max(day, LP.start), LP.due) / 7);
      var brk = pauseOn(LP, day);
      pace = { state: !left ? 'done' : day < LP.start ? 'before' : brk ? 'paused' : passedAll >= Math.floor(expect) - 1 ? 'on' : 'behind', behind: Math.max(1, Math.round(expect - passedAll)),
        frac: day < LP.start ? 0 : frac, done: passedAll / totalAll, per: left ? Math.max(1, Math.round(left / weeks)) : 0, left: left, pause: brk,
        gaps: LP.pauses.filter(function (x) { return x.a > LP.start && x.a <= LP.due; }).map(function (x) { return { at: activeDays(LP, LP.start, x.a - DAY) / span, label: x.label }; }) };
    }
    // question of the day: from chapters already passed, at the tiers open to you; before the first pass, from the chapters
    // up next. One tap only, so it draws true/false and multiple-choice questions.
    var dPool = [], seen = {};
    function add(uid) { unitPool(LP, uid).forEach(function (q) { if (!seen[q.id] && q.tier <= lv.maxTier && (q.type === 'tf' || q.type === 'mcq')) { seen[q.id] = 1; dPool.push(q); } }); }
    books.forEach(function (x) { x.units.forEach(function (u) { if (u.passed) add(u.id); }); });
    if (!dPool.length) books.forEach(function (x) { if (x.next) add(x.next.id); });
    var dd = S.daily && S.daily.day === day ? S.daily : null, dq = dd ? LP.byId[dd.q] : null;
    if (!dq && dPool.length) dq = dPool[Math.floor(seeded(ctx.id + ':' + day)() * dPool.length)];
    var daily = dq ? { item: instItem(LP, dq, { r: seeded(ctx.id + ':o:' + day) }), done: !!dd, right: !!(dd && dd.right), pick: dd ? dd.pick : -1,
      unit: dq.unit ? LP.units[dq.unit] : null, book: bookOf(LP, dq.book) } : null;
    // practice: missed questions and skills that are due, the weekly mix, the warm-up after a break, the pre-thesis review
    var pz = pauseOn(LP, day);
    var deck = Object.keys(S.review).filter(function (k) { return LP.byId[k]; });
    var due = pz ? [] : deck.filter(function (k) { return S.review[k].due <= day; }).sort(function (a, b) { return (S.review[b].sure ? 1 : 0) - (S.review[a].sure ? 1 : 0) || S.review[a].due - S.review[b].due; });
    var sched = Object.keys(S.skills).filter(function (k) { return LP.skills[k] && S.skills[k].due; });
    var skDue = pz ? [] : sched.filter(function (k) { return S.skills[k].due <= day; }).sort(function (a, b) { return (S.skills[b].cm ? 1 : 0) - (S.skills[a].cm ? 1 : 0) || S.skills[a].due - S.skills[b].due; });
    var upcoming = sched.map(function (k) { return S.skills[k].due; }).concat(deck.map(function (k) { return S.review[k].due; })).filter(function (d) { return d > day; }).sort(function (a, b) { return a - b; })[0] || 0;
    var passedUnits = [];
    books.forEach(function (x) { x.units.forEach(function (u) { if (u.passed) passedUnits.push(u.id); }); });
    var wk = weekOf(day), weekly = passedUnits.length >= 2 ? { open: !pz && S.weekly.wk !== wk, done: S.weekly.wk === wk, run: S.weekly.wk >= wk - 1 ? S.weekly.run || 0 : 0 } : null;
    var after = LP.pauses.filter(function (x) { return day > x.b && day <= x.b + 3 * DAY; })[0] || null;
    var warm = after && passedUnits.length && !((S.flags.warm || 0) > after.b) ? { label: after.label, from: after.b + DAY } : null;
    var pt = preThesis(LP, ctx), pret = null;
    if (pt && day >= pt.start && day <= pt.end && pt.units.some(function (u) { return S.units[u] && S.units[u].passed; })) pret = { done: S.flags.pret === pt.at, at: pt.at, units: pt.units };
    var spc = LP.SC.sprint, sprint = spc && !pz && S.units[spc.opens] && S.units[spc.opens].passed ? { best: (S.sprint || {}).best || 0, n: (S.sprint || {}).n || 0, size: spc.n || 3 } : null;
    var practice = { paused: pz, due: due, skills: skDue, n: due.length + skDue.length, deck: deck.length, sched: sched.length, next: upcoming, weekly: weekly, warm: warm, pret: pret, sprint: sprint };
    // the banker's desk: skills by chapter, deal files, and how well "Sure" matches being right
    var desk = { units: [], total: 0, secure: 0, desks: 0 }, deals = [];
    books.forEach(function (x) {
      x.units.forEach(function (u) {
        if (u.skills.length) {
          desk.units.push(u); desk.total += u.skills.length;
          desk.secure += u.skills.filter(function (s) { return s.state === 'secure' || s.state === 'desk'; }).length;
          if (u.desk) desk.desks++;
        }
        u.cases.forEach(function (c) { deals.push(Object.assign({ u: u }, c)); });
      });
    });
    var badges = LP.badges.map(function (b) { var g = S.badges[b.id]; return Object.assign({}, b, { state: g ? (g.m ? 'mastered' : 'earned') : 'locked', at: g ? g.at : 0 }); });
    // the next badge to aim for: the locked chapter badge closest to where the member is reading
    var nb = null, need = 1e9;
    badges.forEach(function (b) {
      if (b.state !== 'locked' || (b.kind !== 'units' && b.kind !== 'desk')) return;
      var steps = 0;
      (b.units || []).forEach(function (uid) {
        var u = LP.units[uid], bk = u && books.filter(function (x) { return x.b.id === u.book; })[0];
        if (u && bk && !(S.units[uid] && S.units[uid].passed)) steps += bk.next ? u.i - bk.next.i + 1 : 1;
        else if (b.kind === 'desk' && !unitDesk(LP, S, uid)) steps += 1;
      });
      if (steps && steps < need) { need = steps; nb = b; }
    });
    return { lv: lv, books: books, passed: passedAll, total: totalAll, promo: promo, pace: pace, daily: daily,
      streak: S.streak && S.streak.last >= day - DAY ? S.streak.n : 0, deck: deck.length, due: due, practice: practice, desk: desk, deals: deals,
      closed: deals.filter(function (d) { return d.closed; }).length, cal: calibration(S), ret: S.ret && S.ret.n ? { n: S.ret.n, pct: S.ret.r / S.ret.n } : null, notes: Object.keys(S.notes || {}).filter(function (k) { return NOTES[k]; }).map(function (k) { return Object.assign({ id: k, at: S.notes[k] }, NOTES[k]); }),
      badges: badges, earned: badges.filter(function (b) { return b.state !== 'locked'; }).length, nextBadge: nb, xp: S.xp };
  }

  // Commendations arrive unannounced: they are never listed as targets, only noted when they happen.
  var NOTES = {
    desk1: { t: 'First desk-ready chapter', s: 'Every skill in a chapter secure and its deal file closed: the standard a desk works to.' },
    clean: { t: 'A clean deal file', s: 'Six of six on a deal file, with no slip anywhere in the chain.' },
    month: { t: 'A month of practice kept', s: 'Four weekly mixes in a row. Spaced practice is what makes learning last.' },
    judge: { t: 'Sound judgement', s: 'Right at least 85% of the time when you said Sure, over 30 answers.' }
  };

  // Badges are never taken away. Unit badges become "mastered" with full marks on every chapter they cover; desk badges
  // need every skill in their chapters secure and the deal files closed; a book badge becomes mastered when its final is passed.
  function learnBadges(LP, S, day, ctx) {
    var out = [];
    function passed(u) { return !!(S.units[u] && S.units[u].passed); }
    function perfect(u) { return !!(S.units[u] && S.units[u].perfect); }
    LP.badges.forEach(function (b) {
      var have = S.badges[b.id], earn = false, master = false, bk;
      if (b.kind === 'units') { earn = (b.units || []).length > 0 && b.units.every(passed); master = earn && b.units.every(perfect); }
      else if (b.kind === 'desk') { earn = (b.units || []).length > 0 && b.units.every(function (u) { return passed(u) && unitDesk(LP, S, u); }); master = earn && b.units.every(perfect); }
      else if (b.kind === 'book') { bk = bookOf(LP, b.book); earn = !!bk && bk.units.every(function (u) { return passed(u.id); }); master = earn && !!(S.finals[b.book] && S.finals[b.book].passed); }
      else if (b.kind === 'perfect') earn = Object.keys(S.units).some(function (k) { return S.units[k].perfect; });
      else if (b.kind === 'tier3') earn = !!S.flags.t3;
      else if (b.kind === 'streak') earn = (S.streak.best || 0) >= (b.n || 7);
      else if (b.kind === 'review') earn = !!S.flags.cleared;
      else if (b.kind === 'deals') earn = Object.keys(S.cases || {}).filter(function (k) { return S.cases[k].closed; }).length >= (b.n || 1);
      else if (b.kind === 'before') {
        var by = ctx.dates[String(b.dateKey || '').replace('{cycle}', ctx.cycle || '')];
        earn = !!by && (b.units || []).length > 0 && b.units.every(function (u) { return passed(u) && S.units[u].passed <= by; });
      }
      if (earn && !have) { S.badges[b.id] = { at: day, m: master ? day : 0 }; out.push({ b: b, m: master }); }
      else if (have && master && !have.m) { have.m = day; out.push({ b: b, m: true, up: true }); }
    });
    return out;
  }

  // One step of progress: answering the question of the day, finishing a check, review, deal file, promotion or final, or
  // ticking a section as read. Returns the new record and what to celebrate.
  function learnApply(LP, S0, act, day, ctx) {
    var S = planSkills(LP, fillLearn(JSON.parse(JSON.stringify(S0)))), X = LP.X, R = LP.R, SC = LP.SC, L = LP.levels, before = levelInfo(LP, S0);
    var ev = { lines: [], xp: 0, badges: [], level: null, promo: null, cert: null, notes: [], secure: [], desks: [], tomb: null };
    S.flags = S.flags || {}; S.streak = S.streak || { n: 0, last: 0, best: 0 };
    function gain(what, n) { if (!n) return; S.xp += n; ev.xp += n; ev.lines.push({ what: what, xp: n }); }
    function lose(what, n) { if (!n) return; S.xp = Math.max(0, S.xp - n); ev.xp -= n; ev.lines.push({ what: what, xp: -n }); }
    function toDeck(id, sure) { S.review[id] = { box: 0, due: day + SC.miss[0] * DAY, sure: !!sure }; }
    function note(id) { if (!S.notes[id] && NOTES[id]) { S.notes[id] = day; ev.notes.push(Object.assign({ id: id }, NOTES[id])); } }
    var desksBefore = {};
    Object.keys(LP.unitSkills).forEach(function (u) { desksBefore[u] = unitDesk(LP, S, u); });
    if (act.kind === 'read') {
      var ru = S.units[act.unit] = S.units[act.unit] || {}, rd = ru.read || [], at = rd.indexOf(act.i);
      if (at >= 0) rd.splice(at, 1); else rd.push(act.i);
      ru.read = rd;
      return { S: S, ev: ev };
    }
    if (act.kind === 'daily') {
      if (S.daily && S.daily.day === day) return { S: S0, ev: ev };
      S.daily = { day: day, q: act.q, pick: act.pick, right: act.right };
      var k = S.streak;
      k.n = k.last === day - DAY ? k.n + 1 : k.last === day ? k.n : 1; k.last = day; k.best = Math.max(k.best || 0, k.n);
      if (act.right) { gain('Question of the day', X.daily); if (act.tier === 3) S.flags.t3 = S.flags.t3 || day; } else toDeck(act.q, false);
      if (k.n % 7 === 0) gain(k.n + ' days running', X.streak7);
    } else if (act.kind === 'quiz') {
      var sp = act.spec, ans = act.answers || [], right = 0, calcN = 0, calcR = 0, sureN = 0, sureR = 0;
      ev.kind = sp.kind; ev.size = sp.size; ev.abandoned = !!act.abandoned;
      if (sp.grade === false) {
        // a cold open before reading: nothing is scored, it only points the reading at what matters
        var pu = S.units[sp.ref] = S.units[sp.ref] || {};
        ans.forEach(function (a) { if (a.right) right++; });
        if (ans.length) { pu.pre = day; pu.preScore = right; }
        ev.score = right; ev.pass = 0; ev.passed = false;
        return { S: S, ev: ev };
      }
      var xp = xpOf(LP, sp, ans), unitOfSkill = function (id) { return LP.skills[id] ? LP.skills[id].unit : ''; };
      function advance(sk) {
        sk.box = (sk.box || 0) + 1; sk.cm = false;
        if (sk.box < SC.skill.length) sk.due = Math.max(day + DAY, sk.start + SC.skill[sk.box] * DAY);
        else if (sk.sec) { sk.due = 0; sk.done = day; }
        else sk.due = day + SC.after * DAY;
      }
      ans.forEach(function (a) {
        if (a.right) right++;
        if (a.calc) { calcN++; if (a.right) calcR++; }
        if (a.right && !S.paid[a.id]) S.paid[a.id] = 1;
        if (a.right && a.tier === 3) S.flags.t3 = S.flags.t3 || day;
        if (sp.conf && (a.sure === true || a.sure === false)) { S.cal.n++; if (a.sure) { S.cal.s++; sureN++; if (a.right) { S.cal.sr++; sureR++; } } }
        // long-term recall: answers on a skill (or a question) first met three weeks or more before
        var seenKey = a.skill || a.id, dn = Math.round(day / DAY), first = S.seen[seenKey];
        if (first == null) S.seen[seenKey] = dn; else if (dn - first >= 21) { S.ret.n++; if (a.right) S.ret.r++; }
        var meta = a.skill && LP.skills[a.skill], sk = meta ? (S.skills[a.skill] = S.skills[a.skill] || { n: 0, days: [] }) : null;
        if (sk) {
          sk.n = (sk.n || 0) + 1; sk.last = day; sk.days = sk.days || [];
          if (a.right) {
            if (sk.days.indexOf(day) < 0) { sk.days.push(day); if (sk.days.length > 12) sk.days.shift(); }
            if (a.typed) sk.typed = day;
            sk.miss = 0;
            if (a.mode === 'walk') sk.sup = 'fade';
            else if (a.mode === 'fade') sk.sup = 'solo';
            else if (a.calc) { sk.run = (sk.run || 0) + 1; if (sk.run >= 2) sk.sup = 'off'; }
            if (!sk.sec && isSecure(sk, meta.typed)) { sk.sec = day; ev.secure.push(meta.name); }
            if (sk.start && sk.due && sk.due <= day) advance(sk);
          } else {
            sk.run = 0; sk.miss = (sk.miss || 0) + 1;
            if (sk.miss >= 2) { sk.sup = a.mode === 'solo' ? 'fade' : 'walk'; sk.miss = 0; }
            if (sk.start && sk.due !== 0) { sk.due = day + DAY; sk.cm = a.sure === true; }
            else if (sk.start && sk.due === 0) { sk.due = day + DAY; sk.cm = a.sure === true; sk.box = Math.max(0, (sk.box || 1) - 1); }
          }
        }
        // misses go to the review deck, unless the skill's own schedule will bring them back
        if (!a.right && !(sk && sk.start)) toDeck(a.id, a.sure === true);
        if (a.right && S.review[a.id] && S.review[a.id].due <= day) {
          var bx = S.review[a.id].box + 1;
          if (bx >= SC.miss.length) delete S.review[a.id]; else S.review[a.id] = { box: bx, due: day + SC.miss[bx] * DAY, sure: false };
        }
      });
      var need = Math.min(sp.passCalc || 0, calcN);
      var scored = sp.kind === 'check' || sp.kind === 'promo' || sp.kind === 'final' || sp.kind === 'deal';
      var passed = scored && right >= sp.pass && calcR >= need;
      ev.score = right; ev.pass = sp.pass; ev.passed = passed; ev.calc = { r: calcR, n: calcN, need: need }; ev.sure = { n: sureN, r: sureR };
      if (xp.base) gain(right + ' right ' + plural(right, 'answer'), xp.base);
      if (xp.bonus) gain('Sure and right, ' + xp.nb + ' ' + plural(xp.nb, 'time'), xp.bonus);
      if (xp.pen) lose('Sure but wrong, ' + xp.np + ' ' + plural(xp.np, 'time'), xp.pen);
      if (sp.kind === 'check') {
        var u = S.units[sp.ref] = S.units[sp.ref] || {};
        u.tries = (u.tries || 0) + 1; u.lastDay = day; u.best = Math.max(u.best || 0, right);
        u.last = sp.items.map(function (x) { return x.id; });
        if (passed && !u.passed) { u.passed = day; gain('Chapter passed', X.pass); }
        if (right === sp.size && sp.size > 0 && !u.perfect) { u.perfect = day; gain('Full marks', X.perfect); }
      } else if (sp.kind === 'deal') {
        var dc = S.cases[sp.caseId] = S.cases[sp.caseId] || {};
        dc.tries = (dc.tries || 0) + 1; dc.lastDay = day; dc.best = Math.max(dc.best || 0, right);
        if (passed && !dc.closed) { dc.closed = day; dc.score = right; dc.seed = sp.seed; gain('Deal closed', X.deal); ev.tomb = sp.caseId; }
        if (right === sp.size && sp.size > 0) note('clean');
      } else if (sp.kind === 'promo') {
        var pr = S.promos[sp.ref] = S.promos[sp.ref] || {};
        pr.tries = (pr.tries || 0) + 1; pr.lastDay = day; pr.best = Math.max(pr.best || 0, right);
        if (passed && S.level < sp.ref) { pr.passed = day; S.level = sp.ref; }
      } else if (sp.kind === 'final') {
        var f = S.finals[sp.ref] = S.finals[sp.ref] || {};
        f.tries = (f.tries || 0) + 1; f.lastDay = day; f.best = Math.max(f.best || 0, right); f.size = sp.size;
        if (passed && !f.passed) { f.passed = day; ev.cert = sp.ref; }
      } else if (sp.kind === 'review' && ans.length) {
        var leftM = Object.keys(S.review).filter(function (id) { return LP.byId[id] && S.review[id].due <= day; }).length;
        var leftS = Object.keys(S.skills).filter(function (id) { return LP.skills[id] && S.skills[id].due && S.skills[id].due <= day; }).length;
        if (!leftM && !leftS) { S.flags.cleared = S.flags.cleared || day; if (S.flags.clearDay !== day) { S.flags.clearDay = day; gain('Review cleared', X.reviewClear); } }
      } else if (sp.kind === 'weekly' && ans.length) {
        var wk = weekOf(day);
        if (S.weekly.wk !== wk) { S.weekly.run = S.weekly.wk === wk - 1 ? (S.weekly.run || 0) + 1 : 1; S.weekly.wk = wk; gain('Weekly mix done', X.weekly); }
        if (S.weekly.run >= 4) note('month');
      } else if (sp.kind === 'warm' && ans.length) {
        if (!(S.flags.warm >= day - 3 * DAY)) gain('Warm-up done', X.warm);
        S.flags.warm = day;
      } else if (sp.kind === 'sprint' && ans.length) {
        var spr = S.sprint = S.sprint || { n: 0, best: 0 }, secsAll = 0;
        ans.forEach(function (a) { secsAll += a.secs || 0; });
        var allIn = ans.length === sp.size && right === sp.size;
        ev.sprint = { secs: secsAll, right: right, size: sp.size, best: spr.best || 0, newBest: false, first: false };
        spr.n = (spr.n || 0) + 1; spr.last = day;
        if (allIn && !act.abandoned && (!spr.best || secsAll < spr.best)) { ev.sprint.newBest = !!spr.best; ev.sprint.first = !spr.best; spr.best = secsAll; ev.sprint.best = secsAll; }
        if (!act.abandoned && S.flags.sprintDay !== day) { S.flags.sprintDay = day; gain('Paper LBO sprint', X.sprint); }
      } else if (sp.kind === 'pret' && ans.length) {
        if (S.flags.pret !== sp.at) { S.flags.pret = sp.at; gain('Pre-thesis review done', X.pret); }
      }
      // a skill's schedule starts once its chapter is passed: back in 2, 7, 16 and 35 days, with new figures each time
      ans.forEach(function (a) {
        var sk = a.skill && S.skills[a.skill], uid = unitOfSkill(a.skill);
        if (sk && !sk.start && sk.days && sk.days.length && S.units[uid] && S.units[uid].passed) { sk.start = day; sk.box = 0; sk.due = day + SC.skill[0] * DAY; }
      });
      if (sp.kind === 'check' && passed) {
        (LP.unitSkills[sp.ref] || []).forEach(function (id) { var sk = S.skills[id]; if (sk && !sk.start && sk.days && sk.days.length) { sk.start = day; sk.box = 0; sk.due = day + SC.skill[0] * DAY; } });
      }
      Object.keys(LP.unitSkills).forEach(function (uid) { if (!desksBefore[uid] && unitDesk(LP, S, uid)) { ev.desks.push(uid); note('desk1'); } });
      if (S.cal.s >= 30 && S.cal.sr / S.cal.s >= 0.85) note('judge');
    }
    planSkills(LP, S);
    var top = L[L.length - 1];
    if (!R.promotions) { L.forEach(function (l) { if (S.xp >= l.xp && S.level < l.n) S.level = l.n; }); }
    else if (S.level === top.n - 1 && S.xp >= top.xp && LP.books.every(function (b) { return S.finals[b.id] && S.finals[b.id].passed; })) S.level = top.n;
    if (S.level > before.cur.n) ev.level = S.level;
    var after = levelInfo(LP, S);
    if (R.promotions && after.next && S.xp >= after.next.xp && (S0.xp < after.next.xp || ev.level)) ev.promo = after.next;
    ev.badges = learnBadges(LP, S, day, ctx);
    return { S: S, ev: ev };
  }

  // The questions for any session, drawn for this member, day and try: a chapter check, a cold open before reading, a deal
  // file, the review (missed questions and skills that are due), the weekly mix, the warm-up after a break, the pre-thesis
  // review, a promotion review or a book final.
  function learnSpec(LP, S, LM, kind, ref, day, ctx) {
    var R = LP.R, SC = LP.SC, lvI = levelInfo(LP, S), lvN = lvI.cur.n, tries = 0, picked = [], size = 0, pass = 0, passCalc = 0;
    var kicker = '', title = '', factKey = '', avoid = {}, book = '', caseId = '', at = 0, rv = {}, mix = null;
    function passedUnits() { var out = []; LP.books.forEach(function (b) { b.units.forEach(function (u) { if (S.units[u.id] && S.units[u.id].passed) out.push(u.id); }); }); return out; }
    function poolOf(ids) { var seen = {}, out = []; ids.forEach(function (uid) { unitPool(LP, uid).forEach(function (q) { if (!seen[q.id]) { seen[q.id] = 1; out.push(q); } }); }); return out; }
    function rnd(extra) { return seeded([ctx.id, kind, ref, day, tries, extra || ''].join(':')); }
    // one question from each chapter in turn, favouring what makes members work (calculations, errors, directions)
    function spread(ids, n, r) {
      var units = shuffled(ids, r), out = [], used = {}, guard = 0;
      while (out.length < n && guard++ < n * 6 && units.length) {
        var uid = units[out.length % units.length], qs = shuffled(unitPool(LP, uid).filter(function (q) { return !used[q.id]; }), r);
        var best = qs.filter(function (q) { return q.type !== 'tf'; })[0] || qs[0];
        if (best) { used[best.id] = 1; out.push(best); }
      }
      return out;
    }
    var r;
    if (kind === 'check') {
      var u = LP.units[ref], r0 = S.units[ref] || {};
      if (!u) return null;
      book = u.book; tries = r0.tries || 0; r = rnd();
      (r0.last || []).forEach(function (id) { avoid[id] = 1; });
      var plan = planFor(LP, book, lvN), cfg = LP.bookCfg[book];
      picked = plan ? planPick(LP, unitPool(LP, ref), plan, R.checkSize, r, avoid, LP.caseOf[ref]) : pickQs(unitPool(LP, ref), lvI.cur.mix, R.checkSize, r, avoid);
      size = R.checkSize; pass = cfg ? cfg.pass : R.checkPass; passCalc = cfg ? cfg.passCalc : 0;
      kicker = bookOf(LP, book).title + ' · ' + u.label; title = u.title; factKey = LP.facts[ref] ? ref : book;
    } else if (kind === 'pre') {
      var up = LP.units[ref];
      if (!up) return null;
      book = up.book; r = rnd(); picked = (LP.pres[ref] || []).slice(0, 3); size = picked.length;
      kicker = 'Before you read · ' + up.label; title = up.title;
    } else if (kind === 'deal') {
      var c = LP.cases[ref];
      if (!c) return null;
      var rc = S.cases[ref] || {};
      book = c.book; caseId = ref; tries = rc.tries || 0; r = rnd();
      picked = c.items.slice(); size = picked.length; pass = c.pass;
      kicker = 'Deal file · ' + LP.units[c.unit].label; title = c.title;
    } else if (kind === 'promo') {
      var to = LP.levels[ref - 1];
      if (!to) return null;
      var pu = passedUnits(), pool = poolOf(pu);
      if (!pool.length && LM) LM.books.forEach(function (x) { if (x.next) pool = pool.concat(unitPool(LP, x.next.id)); });
      tries = (S.promos[ref] || {}).tries || 0; r = rnd();
      picked = pickQs(pool, to.mix, R.reviewSize, r, {});
      // books that use deal files put one linked question from a passed chapter's deal file into every promotion review
      var dealIds = [];
      pu.forEach(function (uid) { var bc = LP.bookCfg[LP.units[uid].book]; if (bc && bc.promoCase) dealIds = dealIds.concat(LP.caseOf[uid] || []); });
      if (dealIds.length && picked.length) {
        var dc = LP.cases[dealIds[Math.floor(r() * dealIds.length)]], dq = dc.items[Math.floor(r() * dc.items.length)], cut = picked.length - 1;
        for (var j = picked.length - 1; j >= 0; j--) if (picked[j].tier === 3) { cut = j; break; }
        picked[cut] = dq;
      }
      size = R.reviewSize; pass = R.reviewPass;
      kicker = 'Promotion review'; title = to.name;
    } else if (kind === 'final') {
      var bk = bookOf(LP, ref), fcfg = LP.bookCfg[ref];
      if (!bk) return null;
      book = ref; tries = (S.finals[ref] || {}).tries || 0; r = rnd();
      var fpool = poolOf(bk.units.map(function (x) { return x.id; })), fcases = [];
      bk.units.forEach(function (x) { fcases = fcases.concat(LP.caseOf[x.id] || []); });
      picked = fcfg && fcfg.final ? planPick(LP, fpool, fcfg.final, R.finalSize, r, {}, fcases) : pickQs(fpool, R.finalMix, R.finalSize, r, {});
      size = R.finalSize; pass = R.finalPass;
      kicker = 'Book final'; title = bk.title; factKey = ref;
    } else if (kind === 'review') {
      r = rnd();
      var P = LM ? LM.practice : { due: [], skills: [] }, sure = [], misses = [], skl = [];
      P.due.forEach(function (id) { (S.review[id].sure ? sure : misses).push(id); });
      P.skills.forEach(function (sid) {
        var opts = shuffled(unitPool(LP, LP.skills[sid].unit).filter(function (q) { return q.skill === sid; }), r);
        var q = opts.filter(function (x) { return x.type === 'num'; })[0] || opts[0];
        if (q) { skl.push(q.id); rv[q.id] = 'skill'; }
      });
      var ids = [], seenR = {};
      sure.concat(skl, misses).forEach(function (id) { if (!seenR[id] && LP.byId[id]) { seenR[id] = 1; ids.push(id); } });
      picked = ids.slice(0, SC.reviewMax).map(function (id) { if (!rv[id]) rv[id] = 'miss'; return LP.byId[id]; });
      size = picked.length;
      kicker = 'Review'; title = P.n + ' due today';
    } else if (kind === 'weekly' || kind === 'warm') {
      r = rnd();
      picked = spread(passedUnits(), SC.weekly, r); size = picked.length;
      kicker = kind === 'warm' ? 'Warm-up' : 'Weekly mix'; title = kind === 'warm' ? 'Back after the break' : 'From the chapters you’ve passed';
    } else if (kind === 'sprint') {
      // the paper LBO sprint: estimates from the LBO chapters, back to back, against one clock
      var spc = LP.SC.sprint;
      if (!spc) return null;
      tries = (S.sprint || {}).n || 0; r = rnd();
      picked = shuffled(poolOf(spc.units || []).filter(function (q) { return q.type === 'est'; }), r).slice(0, spc.n || 3); size = picked.length;
      kicker = 'Paper LBO sprint'; title = 'Three estimates against the clock';
    } else if (kind === 'pret') {
      var pt = preThesis(LP, ctx);
      if (!pt) return null;
      at = pt.at; r = rnd();
      var tu = pt.units.filter(function (x) { return S.units[x] && S.units[x].passed; });
      picked = planPick(LP, poolOf(tu.length ? tu : pt.units), { r: 0, c: 2, a: ['num', 'num', 'err', 'num', 'num', 'err'] }, 8, r, {}, []);
      size = picked.length;
      kicker = 'Pre-thesis review'; title = 'Comps and DCF, a week out';
    } else return null;
    var base = [ctx.id, kind, ref, day, tries].join(':'), envs = {};
    var helped = kind === 'check' || kind === 'review' || kind === 'weekly' || kind === 'warm' || kind === 'pret';
    var items = picked.filter(Boolean).map(function (q) {
      if (q.caseId && !envs[q.caseId]) envs[q.caseId] = TPL.build(LP.cases[q.caseId].def, seeded(base + ':case:' + q.caseId));
      var it = instItem(LP, q, { r: seeded(base + ':' + q.id), rx: seeded(base + ':ex:' + q.id), mode: helped ? supportFor(LP, S, q, lvN) : 'solo', env: q.caseId ? envs[q.caseId] : null });
      it.rv = rv[q.id] || '';
      return it;
    });
    var facts = factKey ? LP.facts[factKey] || [] : [];
    var scored = kind === 'check' || kind === 'promo' || kind === 'final' || kind === 'deal';
    return { kind: kind, ref: ref, book: book, items: items, size: items.length, pass: scored ? Math.ceil(items.length * pass / Math.max(1, size)) : 0, passCalc: passCalc,
      conf: R.confidence !== false && kind !== 'pre' && kind !== 'sprint', grade: kind !== 'pre', kicker: kicker, title: title, caseId: caseId, at: at, seed: base,
      fact: facts.length && r ? facts[Math.floor(r() * facts.length)] : '', paid: Object.assign({}, S.paid) };
  }

  // A sample record for the preview: halfway through, with skills, a closed deal and a confidence record.
  function learnDemo(LP, kind, day, ctx) {
    var S = freshLearn();
    if (kind === 'fresh') return S;
    var ii = bookOf(LP, 'ii'), ib = bookOf(LP, 'ib');
    function pass(uid, ago, perfect) { S.units[uid] = { passed: day - ago * DAY, best: perfect ? LP.R.checkSize : LP.R.checkSize - 1, tries: 1, lastDay: day - ago * DAY, perfect: perfect ? day - ago * DAY : 0 }; }
    if (ii) ii.units.slice(0, 12).forEach(function (u, i) { pass(u.id, 40 - i * 3, u.id === 'ii-8'); });
    if (ib) { ib.units.slice(0, 2).forEach(function (u, i) { pass(u.id, 30 - i * 12, i === 0); }); if (ib.units[2]) S.units[ib.units[2].id] = { read: [0, 1] }; }
    S.xp = kind === 'promo' ? 3010 : 2140; S.level = 4; S.promos = { 2: { passed: day - 36 * DAY, best: 9, tries: 1 }, 3: { passed: day - 24 * DAY, best: 8, tries: 1 }, 4: { passed: day - 9 * DAY, best: 9, tries: 1 } };
    S.streak = { n: 6, last: day - DAY, best: 7 }; S.flags = { t3: day - 8 * DAY };
    // skills: Comps mostly secure, Precedents practised, one Comps skill due for review today
    (LP.unitSkills['ib-1'] || []).forEach(function (id, i) {
      var start = day - 30 * DAY;
      S.skills[id] = i < 3 ? { n: 6, days: [start, start + 9 * DAY, start + 18 * DAY], typed: start + 18 * DAY, sec: start + 18 * DAY, sup: 'off', start: start, box: 3, due: start + 35 * DAY }
        : { n: 3, days: [start, start + 9 * DAY], typed: start, sup: 'solo', start: start, box: 2, due: i === 3 ? day : day + 4 * DAY };
    });
    (LP.unitSkills['ib-2'] || []).forEach(function (id) { var start = day - 18 * DAY; S.skills[id] = { n: 2, days: [start], typed: start, sup: 'fade', start: start, box: 1, due: day + 2 * DAY }; });
    (LP.caseOf['ib-1'] || []).forEach(function (cid) { S.cases[cid] = { closed: day - 22 * DAY, score: 6, best: 6, tries: 1, lastDay: day - 22 * DAY }; });
    S.notes = { clean: day - 22 * DAY };
    S.cal = { n: 64, s: 28, sr: 24 }; S.ret = { n: 41, r: 34 };
    S.weekly = { wk: weekOf(day) - 1, run: 2 };
    var some = Object.keys(LP.byId).filter(function (id) { var q = LP.byId[id]; return q.tier <= 2 && q.book === 'ii' && !q.pre; }).slice(2, 5);
    some.forEach(function (id, i) { S.review[id] = { box: 0, due: day, sure: i === 0 }; });
    learnBadges(LP, S, day - 2 * DAY, ctx);
    return S;
  }

  function progressText(LP, LM, m) {
    var lines = ['The Rand Society · ' + LP.title + (LP.term ? ', ' + LP.term : ''), m.role + ' · Level ' + LM.lv.cur.n + ', ' + LM.lv.cur.name + ' · ' + num(LM.xp) + ' XP'];
    LM.books.forEach(function (x) { lines.push(x.b.title + ': ' + x.passed + ' of ' + x.total + ' passed' + (x.final.passed ? ', final passed' : '')); });
    if (LM.desk.total) lines.push('Banking skills: ' + LM.desk.secure + ' of ' + LM.desk.total + ' secure' + (LM.desk.desks ? ' · ' + LM.desk.desks + ' ' + plural(LM.desk.desks, 'chapter') + ' desk-ready' : '') + ' · ' + LM.closed + ' of ' + LM.deals.length + ' deal files closed');
    if (LM.cal && LM.cal.n >= 5) lines.push('When sure: right ' + Math.round(LM.cal.pct * 100) + '% of the time (' + LM.cal.n + ' answers)');
    if (LM.ret && LM.ret.n >= 5) lines.push('Long-term recall: right ' + Math.round(LM.ret.pct * 100) + '% on what was first met three weeks or more ago (' + LM.ret.n + ' answers)');
    lines.push('Badges: ' + LM.earned + ' of ' + LM.badges.length + (LM.streak ? ' · ' + LM.streak + ' ' + plural(LM.streak, 'day') + ' running' : ''));
    return plain(lines.join('\n'));
  }
  // What a shared store would hold for the President's view (shared progress is still to come): no answers, just states.
  function learnSummary(LP, LM) {
    return { level: LM.lv.cur.n, xp: LM.xp, passed: LM.passed, total: LM.total, secure: LM.desk.secure, skills: LM.desk.total, desks: LM.desk.desks, deals: LM.closed,
      sure: LM.cal ? Math.round(LM.cal.pct * 100) : null, held: LM.ret ? Math.round(LM.ret.pct * 100) : null,
      units: LM.desk.units.map(function (u) { return { id: u.id, desk: u.desk, skills: u.skills.map(function (s) { return [s.id, s.state]; }) }; }) };
  }
  function backupCode(id, S) {
    try { return 'TRS1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ id: id, s: S })))); } catch (e) { return ''; }
  }
  // Backup codes. TRS2 is the record compressed (about a fifth of the length of TRS1); TRS1, plain, is still read, and is
  // what a browser without compression gets.
  function b64u(bytes) { var t = ''; for (var i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(t) { t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var x = atob(t), b = new Uint8Array(x.length); for (var i = 0; i < x.length; i++) b[i] = x.charCodeAt(i); return b; }
  function pipeBytes(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  function packCode(id, S) {
    if (typeof CompressionStream === 'undefined' || typeof TextEncoder === 'undefined') return Promise.resolve(backupCode(id, S));
    try { return pipeBytes(new TextEncoder().encode(JSON.stringify({ id: id, s: S })), new CompressionStream('deflate')).then(function (b) { return 'TRS2.' + b64u(b); }, function () { return backupCode(id, S); }); }
    catch (e) { return Promise.resolve(backupCode(id, S)); }
  }
  function okRecord(o) { return o && o.id && o.s && o.s.v === 1 && typeof o.s.xp === 'number' ? (fillLearn(o.s), o) : null; }
  function unpackCode(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (t.indexOf('TRS2.') !== 0) return Promise.resolve(readBackup(t));
    if (typeof DecompressionStream === 'undefined') return Promise.resolve({ old: true });
    try { return pipeBytes(unb64u(t.slice(5)), new DecompressionStream('deflate')).then(function (b) { return okRecord(JSON.parse(new TextDecoder().decode(b))); }).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }
  function readBackup(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (t.indexOf('TRS1.') !== 0) return null;
    try { return okRecord(JSON.parse(decodeURIComponent(escape(atob(t.slice(5)))))); } catch (e) { return null; }
  }

  // check.html loads this file to test learn.json with the app's own engine; it stops here, before anything is drawn
  if (window.TRS_CHECK) { window.TRS_ENGINE = { TPL: TPL, learnPrep: learnPrep, instItem: instItem, gradeItem: gradeItem, draftDone: draftDone, showNum: showNum, nearIn: nearIn, seeded: seeded, QTYPES: QTYPES, UNITS: UNITS }; return; }

  // ---------- learn: pieces ----------
  // ---------- Learn looks ----------
  // Learn has two looks. "stripes" (the default): 1970s racing stripes on cream, where the stripes carry meaning (a climb with
  // one step per level, a colour per question type, a breakout on a pass) and Pretoria's jacarandas in flower. "society":
  // the app's own navy and silver. Each member chooses with the switch at the bottom of the Learn page;
  // the choice stays on their device. Everything a look changes hangs off SK and its block in app.css, so another look slots
  // in without touching the rest. The certificate keeps the Society look either way.
  var SKIN_DEFAULT = 'stripes';
  var SKIN = read('trs-skin') === 'society' ? '' : SKIN_DEFAULT;
  // gradients and artwork shared by every scene, medal and ring (kept out of view, never display:none, so references resolve)
  function SkinDefs() {
    return SK ? html`<svg class="skin-defs" width="0" height="0" aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: SK.defs }}></svg>` : null;
  }

  var ST = {
    defs: "<defs><linearGradient id=\"st-face-e\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#FFF6E6\"/><stop offset=\".13\" stop-color=\"#FFF6E6\"/><stop offset=\".13\" stop-color=\"#007078\"/><stop offset=\".2\" stop-color=\"#007078\"/><stop offset=\".2\" stop-color=\"#FCB632\"/><stop offset=\".27\" stop-color=\"#FCB632\"/><stop offset=\".27\" stop-color=\"#F27238\"/><stop offset=\".34\" stop-color=\"#F27238\"/><stop offset=\".34\" stop-color=\"#FFF6E6\"/><stop offset=\"1\" stop-color=\"#FFF6E6\"/></linearGradient><linearGradient id=\"st-face-m\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#811638\"/><stop offset=\".13\" stop-color=\"#811638\"/><stop offset=\".13\" stop-color=\"#007078\"/><stop offset=\".2\" stop-color=\"#007078\"/><stop offset=\".2\" stop-color=\"#FCB632\"/><stop offset=\".27\" stop-color=\"#FCB632\"/><stop offset=\".27\" stop-color=\"#F27238\"/><stop offset=\".34\" stop-color=\"#F27238\"/><stop offset=\".34\" stop-color=\"#811638\"/><stop offset=\"1\" stop-color=\"#6A112D\"/></linearGradient><linearGradient id=\"st-rim-m\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#FCB632\"/><stop offset=\"1\" stop-color=\"#F27238\"/></linearGradient><symbol id=\"st-bloom\" viewBox=\"0 0 20 20\"><g style=\"fill:var(--c,#9273D6)\"><circle cx=\"10\" cy=\"5.7\" r=\"4.6\"/><circle cx=\"14.1\" cy=\"8.7\" r=\"4.6\"/><circle cx=\"12.5\" cy=\"13.5\" r=\"4.6\"/><circle cx=\"7.5\" cy=\"13.5\" r=\"4.6\"/><circle cx=\"5.9\" cy=\"8.7\" r=\"4.6\"/></g><circle cx=\"10\" cy=\"10\" r=\"3.4\" fill=\"#C9B6F2\"/><circle cx=\"10\" cy=\"10\" r=\"1.3\" fill=\"#F3E9FF\"/></symbol></defs>",
    branch: "<path transform=\"translate(206 30) rotate(200)\" d=\"M0 0C8-3 16-3 24 0C16 3 8 3 0 0Z\" fill=\"#5E7D45\"/><path transform=\"translate(170 58) rotate(160)\" d=\"M0 0C8-3 16-3 24 0C16 3 8 3 0 0Z\" fill=\"#5E7D45\"/><path transform=\"translate(250 70) rotate(100)\" d=\"M0 0C8-3 16-3 24 0C16 3 8 3 0 0Z\" fill=\"#5E7D45\"/><path transform=\"translate(130 46) rotate(190)\" d=\"M0 0C8-3 16-3 24 0C16 3 8 3 0 0Z\" fill=\"#5E7D45\"/><g fill=\"#4A2C2A\"><path d=\"M316.8 1.7L307.1 4.5L297.4 7.5L287.7 10.6L278.1 13.8L268.6 17L259.1 20.4L249.6 23.9L240.2 27.4L230.9 31.1L221.6 34.8L212.4 38.7L203.2 42.7L194.1 46.7L185 50.9L176 55.1L167 59.5L158.1 63.9L149.2 68.4L150.8 71.6L159.7 67.3L168.8 63.2L177.8 59.1L186.9 55.2L196.1 51.3L205.3 47.6L214.5 43.9L223.8 40.4L233.1 36.9L242.5 33.6L251.9 30.3L261.4 27.2L270.9 24.1L280.5 21.2L290.1 18.3L299.7 15.6L309.4 12.9L319.2 10.3Z\"/><path d=\"M234.2 31.2L232.4 35.5L230.6 39.7L228.8 44L226.9 48.4L225 52.7L223 57.1L221 61.5L218.9 65.9L216.7 70.4L214.6 74.9L212.3 79.4L210 83.9L207.7 88.4L205.3 93L202.9 97.6L200.4 102.3L197.9 106.9L195.3 111.6L196.7 112.4L199.4 107.8L202.1 103.2L204.7 98.6L207.2 94L209.7 89.5L212.2 85L214.6 80.5L216.9 76.1L219.3 71.6L221.5 67.2L223.7 62.8L225.9 58.5L228 54.1L230.1 49.8L232.1 45.5L234.1 41.2L236 37L237.8 32.8Z\"/><path d=\"M190.2 54.4L185.8 53.8L181.3 53.1L176.9 52.5L172.5 51.8L168 51L163.6 50.3L159.1 49.5L154.7 48.7L150.2 47.9L145.8 47L141.3 46.1L136.9 45.2L132.4 44.3L128 43.4L123.5 42.4L119.1 41.4L114.6 40.4L110.2 39.3L109.8 40.7L114.3 41.8L118.7 43L123.1 44L127.6 45.1L132 46.2L136.5 47.2L140.9 48.2L145.3 49.2L149.8 50.1L154.2 51.1L158.7 52L163.1 52.8L167.5 53.7L172 54.5L176.4 55.3L180.9 56.1L185.3 56.9L189.8 57.6Z\"/><path d=\"M260.3 22.4L261.2 26.5L262 30.8L262.7 35L263.3 39.4L263.8 43.7L264.2 48.1L264.5 52.5L264.7 57L264.8 61.5L264.8 66L264.7 70.6L264.5 75.3L264.2 79.9L263.8 84.6L263.4 89.4L262.8 94.2L262.1 99L261.3 103.9L262.7 104.1L263.6 99.3L264.4 94.4L265.1 89.6L265.7 84.8L266.2 80.1L266.6 75.4L266.9 70.7L267.1 66.1L267.2 61.5L267.2 56.9L267.1 52.4L266.9 47.9L266.6 43.4L266.2 39L265.7 34.6L265.1 30.3L264.5 25.9L263.7 21.6Z\"/></g><use href=\"#st-bloom\" x=\"109.5\" y=\"21.6\" width=\"10.8\" height=\"10.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"228.8\" y=\"24.8\" width=\"10\" height=\"10\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"107.6\" y=\"26.1\" width=\"8.4\" height=\"8.4\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"222.8\" y=\"26\" width=\"9.9\" height=\"9.9\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"91.2\" y=\"26.1\" width=\"11\" height=\"11\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"103.4\" y=\"27.2\" width=\"10.4\" height=\"10.4\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"99.7\" y=\"28.9\" width=\"9.2\" height=\"9.2\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"242.8\" y=\"29.4\" width=\"8.4\" height=\"8.4\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"231\" y=\"33.5\" width=\"8.4\" height=\"8.4\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"119.2\" y=\"34\" width=\"8.2\" height=\"8.2\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"218.1\" y=\"34.7\" width=\"9.9\" height=\"9.9\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"231.3\" y=\"39.1\" width=\"9.5\" height=\"9.5\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"84.8\" y=\"38.3\" width=\"11.1\" height=\"11.1\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"213.9\" y=\"39\" width=\"9.8\" height=\"9.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"85\" y=\"39\" width=\"9.8\" height=\"9.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"109.3\" y=\"39.9\" width=\"9.6\" height=\"9.6\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"81.9\" y=\"41.6\" width=\"11.9\" height=\"11.9\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"99.4\" y=\"42.7\" width=\"10.9\" height=\"10.9\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"96.6\" y=\"43.6\" width=\"9.9\" height=\"9.9\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"232.4\" y=\"43.4\" width=\"10.8\" height=\"10.8\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"221\" y=\"44.2\" width=\"10\" height=\"10\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"107.4\" y=\"48.4\" width=\"10.8\" height=\"10.8\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"152.6\" y=\"50.4\" width=\"8.6\" height=\"8.6\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"107.1\" y=\"49.6\" width=\"11.6\" height=\"11.6\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"130.5\" y=\"56.7\" width=\"7.8\" height=\"7.8\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"129.6\" y=\"57.6\" width=\"9.9\" height=\"9.9\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"145.7\" y=\"59.8\" width=\"9.7\" height=\"9.7\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"123\" y=\"62.7\" width=\"8\" height=\"8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"148.9\" y=\"62.3\" width=\"10.1\" height=\"10.1\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"161.5\" y=\"63.7\" width=\"10.2\" height=\"10.2\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"138.8\" y=\"65\" width=\"9.8\" height=\"9.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"116.9\" y=\"65.1\" width=\"10.8\" height=\"10.8\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"138.1\" y=\"67.1\" width=\"10\" height=\"10\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"153.1\" y=\"67.4\" width=\"10\" height=\"10\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"154\" y=\"72.7\" width=\"8.7\" height=\"8.7\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"158.4\" y=\"72.5\" width=\"10\" height=\"10\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"165.3\" y=\"73.8\" width=\"7.8\" height=\"7.8\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"117.3\" y=\"74.4\" width=\"9.1\" height=\"9.1\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"168.1\" y=\"76.3\" width=\"10.4\" height=\"10.4\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"170.5\" y=\"77.6\" width=\"8.1\" height=\"8.1\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"139.6\" y=\"77.1\" width=\"10.4\" height=\"10.4\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"143.2\" y=\"78.8\" width=\"8\" height=\"8\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"135.6\" y=\"81.1\" width=\"9.7\" height=\"9.7\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"130.7\" y=\"82.9\" width=\"7.8\" height=\"7.8\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"140.7\" y=\"83.3\" width=\"10.5\" height=\"10.5\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"245.8\" y=\"88.3\" width=\"9.8\" height=\"9.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"259.6\" y=\"87.7\" width=\"11\" height=\"11\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"249.2\" y=\"93.5\" width=\"10\" height=\"10\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"262.8\" y=\"95.9\" width=\"8.6\" height=\"8.6\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"205.1\" y=\"95.6\" width=\"9.6\" height=\"9.6\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"259.6\" y=\"95.5\" width=\"11.2\" height=\"11.2\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"261.6\" y=\"97.6\" width=\"9.2\" height=\"9.2\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"184.6\" y=\"98\" width=\"10.3\" height=\"10.3\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"259.6\" y=\"98.5\" width=\"10.8\" height=\"10.8\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"234.4\" y=\"100.2\" width=\"9.5\" height=\"9.5\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"185.7\" y=\"100.9\" width=\"8.5\" height=\"8.5\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"241.2\" y=\"101.4\" width=\"7.6\" height=\"7.6\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"205.2\" y=\"101.2\" width=\"8.2\" height=\"8.2\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"260.9\" y=\"102.8\" width=\"10.2\" height=\"10.2\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"236.5\" y=\"103.4\" width=\"9\" height=\"9\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"199.6\" y=\"103.7\" width=\"9.4\" height=\"9.4\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"196.6\" y=\"104.5\" width=\"8.8\" height=\"8.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"246.4\" y=\"103.6\" width=\"11.1\" height=\"11.1\" style=\"--c:#A98BE3\"/><use href=\"#st-bloom\" x=\"277.9\" y=\"104.9\" width=\"10.8\" height=\"10.8\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"168.1\" y=\"106.6\" width=\"10.3\" height=\"10.3\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"209.1\" y=\"107.1\" width=\"9.6\" height=\"9.6\" style=\"--c:#7E5CC8\"/><use href=\"#st-bloom\" x=\"276.6\" y=\"112.3\" width=\"10.7\" height=\"10.7\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"197.5\" y=\"113.7\" width=\"8.4\" height=\"8.4\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"237.6\" y=\"113.5\" width=\"10.8\" height=\"10.8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"173.4\" y=\"114.7\" width=\"11.5\" height=\"11.5\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"168.5\" y=\"114.9\" width=\"11.8\" height=\"11.8\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"178.2\" y=\"116.7\" width=\"10\" height=\"10\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"179.1\" y=\"118.4\" width=\"9.7\" height=\"9.7\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"196.9\" y=\"120\" width=\"8.6\" height=\"8.6\" style=\"--c:#6A48B3\"/><use href=\"#st-bloom\" x=\"206.4\" y=\"121.5\" width=\"8\" height=\"8\" style=\"--c:#9273D6\"/><use href=\"#st-bloom\" x=\"172.7\" y=\"122.1\" width=\"9.7\" height=\"9.7\" style=\"--c:#9273D6\"/>",
    confetti: "<i style=\"--x:50%;--d:340ms;--c:#C32327;--r:-95deg;--dx:-1px;--k:1.01\"></i><i style=\"--x:90%;--d:290ms;--c:#007078;--r:-39deg;--dx:-1px;--k:1.13\"></i><i style=\"--x:75%;--d:9ms;--c:#C32327;--r:158deg;--dx:-48px;--k:0.95\"></i><i style=\"--x:21%;--d:153ms;--c:#FFF6E6;--r:-17deg;--dx:-29px;--k:0.87\"></i><i style=\"--x:90%;--d:597ms;--c:#811638;--r:-119deg;--dx:50px;--k:1.01\"></i><i style=\"--x:57%;--d:288ms;--c:#FFF6E6;--r:-70deg;--dx:-41px;--k:1.08\"></i><i style=\"--x:95%;--d:486ms;--c:#C32327;--r:104deg;--dx:35px;--k:0.76\"></i><i style=\"--x:14%;--d:147ms;--c:#FFF6E6;--r:-89deg;--dx:-44px;--k:0.87\"></i><i style=\"--x:30%;--d:26ms;--c:#007078;--r:115deg;--dx:-27px;--k:0.95\"></i><i style=\"--x:9%;--d:308ms;--c:#FCB632;--r:-106deg;--dx:-37px;--k:1.05\"></i><i style=\"--x:54%;--d:22ms;--c:#FFF6E6;--r:156deg;--dx:13px;--k:1.14\"></i><i style=\"--x:31%;--d:22ms;--c:#811638;--r:-111deg;--dx:-41px;--k:0.96\"></i><i style=\"--x:95%;--d:411ms;--c:#FCB632;--r:92deg;--dx:45px;--k:0.88\"></i><i style=\"--x:5%;--d:14ms;--c:#FFF6E6;--r:57deg;--dx:-9px;--k:0.83\"></i><i style=\"--x:10%;--d:40ms;--c:#FFF6E6;--r:169deg;--dx:46px;--k:1.13\"></i><i style=\"--x:86%;--d:130ms;--c:#FCB632;--r:155deg;--dx:40px;--k:1.09\"></i><i style=\"--x:79%;--d:541ms;--c:#FCB632;--r:127deg;--dx:-38px;--k:1.18\"></i><i style=\"--x:32%;--d:225ms;--c:#FCB632;--r:5deg;--dx:43px;--k:0.96\"></i><i style=\"--x:94%;--d:420ms;--c:#FCB632;--r:-138deg;--dx:35px;--k:0.87\"></i><i style=\"--x:29%;--d:254ms;--c:#F27238;--r:13deg;--dx:40px;--k:0.90\"></i><i style=\"--x:81%;--d:388ms;--c:#F27238;--r:45deg;--dx:43px;--k:0.79\"></i><i style=\"--x:72%;--d:168ms;--c:#C32327;--r:-165deg;--dx:-22px;--k:0.83\"></i><i style=\"--x:87%;--d:246ms;--c:#811638;--r:-59deg;--dx:20px;--k:1.01\"></i><i style=\"--x:21%;--d:504ms;--c:#F27238;--r:-118deg;--dx:-21px;--k:0.92\"></i><i style=\"--x:94%;--d:121ms;--c:#FCB632;--r:126deg;--dx:44px;--k:1.07\"></i><i style=\"--x:72%;--d:509ms;--c:#FCB632;--r:2deg;--dx:-16px;--k:1.12\"></i>",
    blooms: "<svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:5%;--d:182ms;--dx:-31px;--k:1.18;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:54%;--d:745ms;--dx:-52px;--k:0.83;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:29%;--d:698ms;--dx:32px;--k:1.35;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:38%;--d:155ms;--dx:-4px;--k:1.31;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:17%;--d:889ms;--dx:1px;--k:1.17;--c:#6A48B3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:40%;--d:412ms;--dx:55px;--k:1.21;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:14%;--d:512ms;--dx:50px;--k:1.16;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:63%;--d:186ms;--dx:51px;--k:0.97;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:65%;--d:482ms;--dx:26px;--k:0.83;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:82%;--d:200ms;--dx:35px;--k:1.28;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:48%;--d:593ms;--dx:-26px;--k:1.06;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:30%;--d:169ms;--dx:61px;--k:1.04;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:85%;--d:604ms;--dx:65px;--k:1.03;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:36%;--d:636ms;--dx:-64px;--k:1.13;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:51%;--d:743ms;--dx:-23px;--k:0.83;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:77%;--d:522ms;--dx:-23px;--k:1.09;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:26%;--d:378ms;--dx:-24px;--k:0.97;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:86%;--d:822ms;--dx:42px;--k:0.81;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:15%;--d:311ms;--dx:29px;--k:1.28;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal\" viewBox=\"0 0 20 20\" style=\"--x:87%;--d:449ms;--dx:25px;--k:1.11;--c:#9273D6\"><use href=\"#st-bloom\"/></svg>",
    drift: "<svg class=\"st-petal drift\" viewBox=\"0 0 20 20\" style=\"--x:62%;--d:-1200ms;--t:11000ms;--dx:-40px;--k:0.90;--c:#9273D6\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal drift\" viewBox=\"0 0 20 20\" style=\"--x:78%;--d:-5200ms;--t:13000ms;--dx:-60px;--k:0.75;--c:#A98BE3\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal drift\" viewBox=\"0 0 20 20\" style=\"--x:90%;--d:-8400ms;--t:12000ms;--dx:-30px;--k:1.00;--c:#7E5CC8\"><use href=\"#st-bloom\"/></svg><svg class=\"st-petal drift\" viewBox=\"0 0 20 20\" style=\"--x:70%;--d:-9800ms;--t:15000ms;--dx:-50px;--k:0.70;--c:#6A48B3\"><use href=\"#st-bloom\"/></svg>",
    cols: ['#811638', '#C32327', '#F27238', '#FCB632', '#007078']
  };
  // Stripes geometry: a bundle of five parallel stripes along a centreline with rounded bends (each stripe keeps the same
  // centre at every bend, so the bundle turns like a 1970s racing stripe). Points are corners; R is the bend radius.
  function stf(x) { return (Math.round(x * 10) / 10).toString(); }
  function stOffset(pts, R, d) {
    function unit(a, b) { var x = b[0] - a[0], y = b[1] - a[1], l = Math.sqrt(x * x + y * y); return [x / l, y / l]; }
    var u = unit(pts[0], pts[1]), out = 'M' + stf(pts[0][0] + u[1] * d) + ' ' + stf(pts[0][1] - u[0] * d);
    for (var i = 1; i < pts.length - 1; i++) {
      var a = unit(pts[i - 1], pts[i]), b = unit(pts[i], pts[i + 1]);
      var th = Math.acos(clamp(a[0] * b[0] + a[1] * b[1], -1, 1)), t = R * Math.tan(th / 2), left = a[0] * b[1] - a[1] * b[0] < 0;
      var s0 = pts[i][0] - a[0] * t + a[1] * d, s1 = pts[i][1] - a[1] * t - a[0] * d;
      var e0 = pts[i][0] + b[0] * t + b[1] * d, e1 = pts[i][1] + b[1] * t - b[0] * d, r = left ? R - d : R + d;
      out += 'L' + stf(s0) + ' ' + stf(s1) + 'A' + stf(r) + ' ' + stf(r) + ' 0 0 ' + (left ? 0 : 1) + ' ' + stf(e0) + ' ' + stf(e1);
    }
    var z = unit(pts[pts.length - 2], pts[pts.length - 1]), l = pts[pts.length - 1];
    return out + 'L' + stf(l[0] + z[1] * d) + ' ' + stf(l[1] - z[0] * d);
  }
  function stBundle(pts, R, w, gap, cols) {
    var pitch = w + gap, n = cols.length;
    return cols.map(function (c, i) {
      return '<path d="' + stOffset(pts, R, ((n - 1) / 2 - i) * pitch) + '" stroke="' + c + '" stroke-width="' + w + '" fill="none" pathLength="1" style="--i:' + i + '"/>';
    }).join('');
  }
  // The climb: a flat run, then one 45-degree step for every level reached, ending on a run off the right edge.
  function stClimb(n, W, H) {
    var y0 = H - 80, yT = 30, s = (y0 - yT) / n, p = 56, span = n * s + (n - 1) * p + p + 80, x = W + 80 - span, y = y0;
    var pts = [[-1000, y0], [x, y0]];
    for (var k = 1; k <= n; k++) { x += s; y -= s; pts.push([x, y]); if (k < n) { x += p; pts.push([x, y]); } }
    pts.push([W + 80, y]);
    return pts;
  }
  var stCache = {};
  function stClimbSvg(n) {
    n = clamp(n || 1, 1, 7);
    return stCache['c' + n] || (stCache['c' + n] = stBundle(stClimb(n, 720, 260), 36, 10, 2, ST.cols));
  }
  // a short climb across the top of the question card, the doorway into Learn
  function stBandSvg() { return stCache.band || (stCache.band = stBundle([[-600, 30], [318, 30], [372, -24]], 26, 5, 1.6, ST.cols)); }
  // a pass: the stripes break out of their range and run up off the screen
  function stBreakSvg() { return stCache.brk || (stCache.brk = stBundle([[-500, 450], [120, 450], [520, 50]], 70, 16, 4, ST.cols)); }
  // a level-up: one step per level, climbing to the ring that shows the new level
  function stSummitSvg(n) {
    n = clamp(n || 1, 1, 7);
    if (stCache['s' + n]) return stCache['s' + n];
    var X1 = 184, top = 62, base = 150, s = (base - top) / n, p = n > 1 ? Math.max(14, (X1 - 24 - n * s) / (n - 1)) : 0;
    var x = X1 - n * s - (n - 1) * p, y = base, pts = [[-400, base], [x, base]];
    for (var k = 1; k <= n; k++) { x += s; y -= s; pts.push([x, y]); if (k < n) { x += p; pts.push([x, y]); } }
    pts.push([600, y]);
    return (stCache['s' + n] = stBundle(pts, 16, 6, 1.5, ST.cols));
  }
  var MEDAL_STRIPES = {
    mastered: { rim: 'url(#st-rim-m)', edge: '#B9821A', tick: 'rgba(255,255,255,.7)', face: 'url(#st-face-m)', ring: '#FCB632', glyph: '#FCB632', dash: 'none' },
    earned: { rim: '#007078', edge: '#005A60', tick: 'rgba(255,246,230,.6)', face: 'url(#st-face-e)', ring: '#007078', glyph: '#811638', dash: 'none' },
    locked: { rim: '#FFFAF1', edge: '#E2D5BF', tick: '#EFE5D4', face: '#F8EFE0', ring: '#CDBFA6', glyph: '#A8968D', dash: '3 3' }
  };
  function svgHtml(cls, vb, inner, par) { return html`<svg class=${cls} viewBox=${vb} preserveAspectRatio=${par || null} aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: inner }}></svg>`; }
  // Everything a look changes. Rings take colours, a track, a fill and an ink; the rest returns markup. null is the Society look.
  function makeSkin(name) { return name === 'stripes' ? {
    defs: ST.defs, medal: MEDAL_STRIPES, theme: { page: '#811638', quiz: '#F6EFE2' },
    ring: { track: '#EFE5D4', colors: ['#007078', '#FCB632', '#F27238'], ink: '#2A1A1F', font: "Fraunces, Georgia, serif", soft: true, weight: '700', size: 0.34, dy: 0.12 },
    head: function (o) {
      return html`<div class="st-head" aria-hidden="true">
        ${svgHtml('st-climb st-draw', '0 0 720 260', stClimbSvg(o.n), 'xMaxYMax meet')}
        ${o.bloom ? html`<div class="st-bloom-wrap">${svgHtml('st-branch', '0 0 300 190', ST.branch)}<div class="st-drift" dangerouslySetInnerHTML=${{ __html: ST.drift }}></div></div>` : null}
      </div>`;
    },
    daily: function () { return html`<div class="st-band" aria-hidden="true">${svgHtml('st-draw', '0 0 400 46', stBandSvg(), 'xMaxYMid slice')}</div>`; },
    deco: function (kind, o) {
      if (kind === 'night') return '';
      var fall = o.bloom ? ST.blooms : '<div class="qz-confetti st">' + ST.confetti + '</div>';
      if (kind === 'level') return fall;
      return '<svg class="qz-break st-draw" viewBox="0 0 400 500" preserveAspectRatio="xMidYMax slice">' + stBreakSvg() + '</svg>' + fall;
    },
    result: function (kind, passed) { return { colors: kind === 'review' ? ['#007078'] : passed ? null : ['#C32327'], fill: passed && kind !== 'review' ? '#FFFAF1' : null }; },
    levelRing: { track: 'rgba(255,246,230,.16)', fill: '#2A1A1F', ink: '#FFF6E6' },
    emblem: function (ring, n) { return html`<div class="ql-emblem st">${svgHtml('ql-summit st-draw', '0 0 340 170', stSummitSvg(n))}<div class="ql-ring">${ring}</div></div>`; }
  } : null; }
  var SK = makeSkin(SKIN);
  function setSkin(name) { SKIN = name; SK = makeSkin(name); store('trs-skin', name || 'society'); }

  // Sound and vibration for Learn: a warm chime when a member passes and an opening bell when they level up (built with Web
  // Audio, so it works offline and adds no files), and a short buzz on phones that allow it. Sound starts off; both settings
  // stay on the device.
  var Fx = (function () {
    var ctx = null;
    function prefs() { var o = null; try { o = JSON.parse(read('trs-fx') || 'null'); } catch (e) { o = null; } o = o || {}; return { sound: o.sound === true, buzz: o.buzz !== false }; }
    function save(p) { store('trs-fx', JSON.stringify({ sound: !!p.sound, buzz: !!p.buzz })); }
    function canBuzz() { return typeof navigator.vibrate === 'function' && ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window); }
    function audio() {
      try {
        if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        return ctx;
      } catch (e) { return null; }
    }
    function voice(c, out, at, hz, len, type, vol) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(hz, at);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g); g.connect(out); o.start(at); o.stop(at + len + 0.05);
    }
    function sting(kind) {
      var c = audio(); if (!c) return;
      try {
        var lv = kind === 'level', t = c.currentTime + 0.03, out = c.createGain(), lp = c.createBiquadFilter(), echo = c.createDelay(), fb = c.createGain();
        out.gain.value = 0.8; lp.type = 'lowpass'; lp.frequency.value = 2600; echo.delayTime.value = 0.17; fb.gain.value = 0.18;
        out.connect(lp); lp.connect(c.destination); lp.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(c.destination);
        if (lv) [0, 0.42, 0.84].forEach(function (dt) { [1, 2, 2.76, 5.4].forEach(function (m, j) { voice(c, out, t + dt, 784 * m, [2.2, 1.4, 1, 0.5][j], 'sine', [0.16, 0.08, 0.055, 0.03][j]); }); });
        else {
          [440, 554.37, 659.25, 880].forEach(function (hz, i) { var len = i === 3 ? 1 : 0.32; voice(c, out, t + i * 0.08, hz, len, 'sine', 0.14); voice(c, out, t + i * 0.08, hz * 2, len * 0.5, 'triangle', 0.025); });
          voice(c, out, t, 110, 0.9, 'sine', 0.12);
        }
        setTimeout(function () { try { out.disconnect(); echo.disconnect(); fb.disconnect(); } catch (e) { /* already gone */ } }, 4000);
      } catch (e) { /* no audio here */ }
    }
    function buzz(kind) { try { if (canBuzz()) navigator.vibrate(kind === 'level' ? [24, 60, 24, 60, 90] : [22, 50, 40]); } catch (e) { /* not allowed */ } }
    return { prefs: prefs, save: save, canBuzz: canBuzz, sting: sting, buzz: buzz,
      play: function (kind) { var p = prefs(); if (p.sound) sting(kind); if (p.buzz) buzz(kind); } };
  })();

  function FxCard() {
    var s = useState(Fx.prefs), fx = s[0], setFx = s[1], buzz = Fx.canBuzz();
    function flip(k) {
      var n = { sound: fx.sound, buzz: fx.buzz }; n[k] = !fx[k];
      Fx.save(n); setFx(n);
      if (n[k]) { if (k === 'sound') Fx.sting('pass'); else Fx.buzz('pass'); }
    }
    function row(k, ic, label, note) {
      return html`<li key=${k}><button class="grow fx-row" role="switch" aria-checked=${fx[k] ? 'true' : 'false'} aria-labelledby=${'fx-' + k} aria-describedby=${'fx-' + k + 'd'} onClick=${function () { flip(k); }}>
        <span class="g-ic" aria-hidden="true"><${Ico} n=${ic} s=${20} /></span>
        <span class="g-t"><b id=${'fx-' + k}>${label}</b><small id=${'fx-' + k + 'd'}>${note}</small></span>
        <span class="sw" aria-hidden="true"></span>
      </button></li>`;
    }
    return html`<section class="card glist-card fx-card" aria-labelledby="fx-h">
      <div class="card-head"><h2 id="fx-h" class="card-k">Effects</h2></div>
      <ul class="glist">${row('sound', 'sound', 'Sound effects', 'A short chime when you pass, and a bell when you level up')}${buzz ? row('buzz', 'buzz', 'Vibration', 'A short buzz when you pass') : null}</ul>
    </section>`;
  }

  function LookBar(p) {
    var on = !SKIN;
    return html`<section class="look-bar" aria-label="Look">
      <button class="look-row" role="switch" aria-checked=${on ? 'true' : 'false'} aria-labelledby="look-l" aria-describedby="look-d" onClick=${function () { p.A.setLook(on ? 'stripes' : ''); }}>
        <span class="look-t"><b id="look-l">Society look</b><small id="look-d">Show Learn in the Society’s navy and silver</small></span>
        <span class="sw" aria-hidden="true"></span>
      </button>
    </section>`;
  }

  var MEDAL_G = {
    market: 'M3 16l4-5 3 3 4-7 3 4 4-5', shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', arrow: 'M5 19L19 5M10 5h9v9',
    margin: 'M4 6h16M4 18h16M12 9v6M9.5 11.5L12 9l2.5 2.5', book: 'M12 6.5C10.2 5.1 7.7 4.5 4 4.5v14c3.7 0 6.2.6 8 2 1.8-1.4 4.3-2 8-2v-14c-3.7 0-6.2.6-8 2zM12 6.5v14',
    comps: 'M5 19v-6M10 19V7M15 19v-9M20 19v-4M3 19h18', prec: 'M12 7v5l3 2M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4 4v4h4', dcf: 'M4 5h3v14H4zM10.5 9h3v10h-3zM17 13h3v6h-3z',
    lbo: 'M3 19h18M6 19l11-11M17 8h-4.5M17 8v4.5', sell: 'M14 4h6v6M20 4l-9 9M18 14v5H4V6h6', buy: 'M20 4l-9 9M11 13V8M11 13h5M7 6H4v13h13v-3', kit: 'M4 8h16v11H4zM9 8V6h6v2M4 13h16',
    target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.3v1.4', peak: 'M3 19l6-10 4 6 2-3 6 7z',
    week: 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4M9 15h6', flame: 'M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 0-5 1-7.5z',
    slate: 'M20 11a8 8 0 1 0-2.3 5.6M20 4v7h-7', thesis: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14l2 2 4-4'
  };
  var MEDAL = {
    mastered: { rim: '#0F2340', edge: '#0F2340', tick: '#C9D1DC', face: '#0F2340', ring: '#C9D1DC', glyph: '#FFFFFF', dash: 'none' },
    earned: { rim: '#3E5A82', edge: '#3E5A82', tick: 'rgba(255,255,255,.35)', face: '#3E5A82', ring: '#9DB0C9', glyph: '#FFFFFF', dash: 'none' },
    locked: { rim: '#FFFFFF', edge: '#DCE2E9', tick: '#E3E8EF', face: '#F4F6F9', ring: '#B4BFCD', glyph: '#9AA8BB', dash: '3 3' }
  };
  function Medal(p) {
    var set = SK ? SK.medal : MEDAL, c = set[p.state] || set.locked, s = p.size || 64;
    if (p.onNavy && p.state === 'mastered' && !SK) c = Object.assign({}, c, { rim: '#0B1A30', edge: '#C9D1DC' });
    return html`<svg class="medal" width=${s} height=${s} viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="44" cy="44" r="42" fill=${c.rim} stroke=${c.edge} stroke-width="1.5"></circle>
      <circle cx="44" cy="44" r="38" fill="none" stroke=${c.tick} stroke-width="3" stroke-dasharray="1.2 2.6"></circle>
      <circle cx="44" cy="44" r="32" fill=${c.face} stroke=${c.ring} stroke-width="1.5" stroke-dasharray=${c.dash}></circle>
      <g transform="translate(26 26) scale(1.5)" fill="none" stroke=${c.glyph} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d=${MEDAL_G[p.glyph] || MEDAL_G.book}></path></g>
    </svg>`;
  }
  // Rings take one colour (a single arc) or several (concentric stripes); the skin sets the defaults and the numerals.
  function Ring(p) {
    var s = p.size || 58, w = p.w || 4, mid = s / 2, R = SK ? SK.ring : null;
    var cols = p.colors || (p.color ? [p.color] : R ? R.colors : ['#0F2340']), track = p.track || (R ? R.track : '#E3E8EF');
    var multi = cols.length > 1, sw = multi ? w * 0.72 : w, step = multi ? w * 0.95 : 0, r0 = s / 2 - w;
    var two = String(p.n).length > 1;
    return html`<svg class="ring" width=${s} height=${s} viewBox=${'0 0 ' + s + ' ' + s} aria-hidden="true">
      ${p.fill ? html`<circle cx=${mid} cy=${mid} r=${r0 + sw / 2} fill=${p.fill}></circle>` : null}
      ${cols.map(function (col, i) {
        var r = r0 - i * step, c = 2 * Math.PI * r;
        return html`<g key=${i}><circle cx=${mid} cy=${mid} r=${r} fill="none" stroke=${track} stroke-width=${sw}></circle>
          <circle class="ring-arc" cx=${mid} cy=${mid} r=${r} fill="none" stroke=${col} stroke-width=${sw} stroke-linecap="round"
            stroke-dasharray=${(c * clamp(p.pct, 0.012, 1)).toFixed(1) + ' ' + c.toFixed(1)} transform=${'rotate(-90 ' + mid + ' ' + mid + ')'}></circle></g>`;
      })}
      ${R ? html`<text x=${mid} y=${mid + s * R.dy} text-anchor="middle" font-family=${R.font} font-style=${R.italic ? 'italic' : null} font-weight=${R.weight}
          style=${R.soft ? "font-variation-settings:'SOFT' 100" : null} font-size=${Math.round(s * R.size * (multi && two ? 0.84 : 1))} fill=${p.ink || R.ink}>${p.n}</text>`
        : html`<text x=${mid} y=${mid + s * 0.125} text-anchor="middle" font-family="Newsreader, Georgia, serif" font-size=${Math.round(s * 0.36)} fill=${p.ink || '#0F2340'}>${p.n}</text>`}
    </svg>`;
  }
  var TICK = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>`;
  var LOCK = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;
  var FLAME = html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${MEDAL_G.flame}></path></svg>`;
  function gRow(k, ic, label, value, go) {
    var inner = [html`<span key="i" class="g-ic" aria-hidden="true"><${Ico} n=${ic} s=${20} /></span>`, html`<span key="t" class="g-t"><b>${label}</b><small>${value}</small></span>`, go ? html`<${Arrow} key="a" />` : html`<span key="a"></span>`];
    return html`<li key=${k}>${go ? html`<button class="grow" onClick=${go}>${inner}</button>` : html`<div class="grow">${inner}</div>`}</li>`;
  }

  function LevelCard(p) {
    var LM = p.LM, LP = p.LP, A = p.A, lv = LM.lv, pr = LM.promo;
    var sub = !lv.next ? num(LM.xp) + ' XP · top level' : pr ? num(LM.xp) + ' XP · promotion ready' : num(LM.xp) + ' XP · ' + num(lv.toNext) + ' to ' + lv.next.name;
    return html`<section class="card lv-card" aria-labelledby="lv-h">
      <div class="lv-top">
        <${Ring} pct=${lv.pct} n=${lv.cur.n} />
        <div class="lv-txt"><span class="card-k">${p.role}</span><h2 id="lv-h" class="lv-name">Level ${lv.cur.n} · ${lv.cur.name}</h2><span class="lv-sub tnum">${sub}</span></div>
      </div>
      <ul class="lv-tiers" aria-label="Question types">${LP.tiers.map(function (t, i) {
        var on = i < lv.maxTier, at = on ? null : tierOpensAt(LP, i);
        var early = !on && Object.keys(LP.bookCfg).filter(function (bid) { var pl = planFor(LP, bid, lv.cur.n); return pl && (i === 2 ? (pl.a || []).length : i === 1 ? pl.c : pl.r); }).map(function (bid) { return bookOf(LP, bid).short; })[0];
        return html`<li key=${i} class=${on || early ? 'on' : ''}>${on || early ? TICK : LOCK}<span>${t.name}${early ? html`<small> · ${early} now${at ? ', all books at Level ' + at.n : ''}</small>` : at ? html`<small> · Level ${at.n}</small>` : null}</span></li>`;
      })}</ul>
      ${pr ? html`<div class="lv-promo">
        <div class="lv-pt"><span class="card-k">${pr.final ? 'Last step' : 'Promotion review'}</span>
          <b>${pr.final ? pr.to.name + ' opens with both book finals' : 'Ready for ' + pr.to.name}</b>
          <small>${pr.final ? 'Still to pass: ' + pr.need.join(' and ') + '.' : LP.R.reviewSize + ' questions from every chapter you’ve passed. Pass with ' + LP.R.reviewPass + '.' + (pr.best ? ' Best so far: ' + pr.best + '.' : '')}</small></div>
        ${pr.final ? null : html`<button class="pill" disabled=${pr.wait} onClick=${function () { A.startQuiz('promo', pr.to.n); }}>${pr.wait ? 'Again tomorrow' : 'Take the review'}</button>`}
      </div>` : null}
    </section>`;
  }

  function DailyCard(p) {
    var LM = p.LM, LP = p.LP, A = p.A, d = LM.daily;
    if (!d) return null;
    var it = d.item, done = d.done, X = LP.X;
    var src = d.unit ? d.book.short + ' · ' + d.unit.label : d.book ? d.book.short + ' · sample question' : 'Sample question';
    return html`<section class=${'panel-navy on-navy daily' + (SKIN ? ' ' + SKIN : '') + (p.compact ? ' compact' : '')} aria-labelledby=${'dq-h' + (p.compact ? 'c' : '')}>
      ${SK ? SK.daily({ compact: p.compact }) : null}
      <div class="dq-head"><h2 id=${'dq-h' + (p.compact ? 'c' : '')} class="card-k">Question of the day</h2>${LM.streak ? html`<span class="dq-streak">${FLAME}${LM.streak} ${plural(LM.streak, 'day')} running</span>` : null}</div>
      <span class=${'dq-type t' + it.tier}>${it.tf ? 'True or false' : LP.tiers[it.tier - 1].name}</span>
      <p class="dq-q">${it.q}</p>
      <div class=${'dq-opts' + (it.tf ? ' tf' : '')} role="group" aria-label="Answers">${it.opts.map(function (o, i) {
        var cls = 'dq-opt' + (done ? (o.right ? ' right' : i === d.pick ? ' wrong' : ' dim') : '');
        return html`<button key=${i} class=${cls} disabled=${done} onClick=${function () { A.answerDaily(d, i); }}>${o.t}${done && o.right ? html`<span class="vh"> (correct answer)</span>` : done && i === d.pick ? html`<span class="vh"> (your answer)</span>` : null}</button>`;
      })}</div>
      ${done ? html`<div class=${'dq-res ' + (d.right ? 'right' : 'wrong')} role="status"><b>${d.right ? 'Right · +' + X.daily + ' XP' : 'Not quite'}</b><span>${it.why}</span>${d.right ? null : html`<small>It’s in your review deck for tomorrow.</small>`}</div>` : null}
      <div class="dq-foot"><span class="dq-src">${src}${done ? ' · a new question tomorrow' : ' · ' + X.daily + ' XP'}</span>
        ${p.compact ? html`<button class="dq-more" onClick=${function () { A.goTab('learn'); }}>Learn<${Arrow} /></button>` : null}</div>
    </section>`;
  }

  function BookCard(p) {
    var bk = p.bk, LP = p.LP, A = p.A, R = LP.R, n = bk.next, open = p.open, b = bk.b;
    var segs = bk.units.map(function (u) {
      var cur = n && n.id === u.id, part = cur && u.sections.length ? u.read / u.sections.length : 0;
      return html`<i key=${u.id} class=${'bseg s-' + u.state + (cur ? ' s-next' : '')} style=${part ? '--part:' + (part * 100).toFixed(0) + '%' : null}></i>`;
    });
    var row;
    if (bk.done) {
      var f = bk.final;
      row = f.passed
        ? html`<div class="bk-next"><div class="bk-nm"><span class="card-k">Completed</span><b>Book final passed, ${f.best} of ${f.size}</b></div><button class="pill ghost" onClick=${function () { A.openCert(b.id); }}>Certificate</button></div>`
        : html`<div class="bk-next"><div class="bk-nm"><span class="card-k">Book final</span><b>${R.finalSize} questions across the book</b><small>Pass with ${R.finalPass} to earn the certificate.${f.best ? ' Best so far: ' + f.best + '.' : ''}</small></div>
            <button class="pill" disabled=${f.wait} onClick=${function () { A.startQuiz('final', b.id); }}>${f.wait ? 'Again tomorrow' : 'Take the final'}</button></div>`;
    } else if (n) {
      var reading = n.read > 0 && n.sections.length && n.read < n.sections.length;
      var nextSec = reading ? n.sections.filter(function (s, i) { return (n.r.read || []).indexOf(i) < 0; })[0] : '';
      row = html`<div class="bk-next">
        <button class="bk-nm" onClick=${function () { A.openUnit(n.id); }}>
          <span class="card-k">${reading ? 'Reading · ' + n.label : 'Up next · ' + n.label}</span>
          <b>${reading ? nextSec : n.title}</b>
          ${reading ? html`<span class="bk-steps" aria-label=${n.read + ' of ' + n.sections.length + ' sections read'}>${n.sections.map(function (s, i) { var on = (n.r.read || []).indexOf(i) >= 0; return html`<i key=${i} class=${on ? 'on' : ''}></i>`; })}<small>${n.read} of ${n.sections.length} read</small></span>` : null}
        </button>
        ${!n.ready ? html`<span class="pill off">Questions soon</span>`
          : n.wait ? html`<span class="pill off">Again tomorrow</span>`
          : html`<button class="pill" onClick=${function () { A.startQuiz('check', n.id); }}>Take check</button>`}
      </div>`;
    }
    return html`<section class="card bk-card" aria-labelledby=${'bk-' + b.id}>
      <div class="bk-main">
        <div class="bk-head"><div class="bk-t"><h2 id=${'bk-' + b.id} class="bk-title">${b.title}</h2><span class="bk-by">${b.by}</span></div><span class="bk-n tnum">${bk.passed} of ${bk.total}</span></div>
        <div class=${'segs' + (bk.total > 12 ? ' many' : '')} role="img" aria-label=${bk.passed + ' of ' + bk.total + ' passed'}>${segs}</div>
      </div>
      ${row}
      <button class="bk-all" aria-expanded=${open ? 'true' : 'false'} onClick=${function () { A.toggleBook(b.id); }}><span>${open ? 'Hide chapters' : 'All chapters'}</span><${Chev} open=${open} /></button>
      ${open ? html`<div class="bk-list">${b.modules.map(function (md, mi) {
        return html`<div key=${mi} class="bk-mod">${md.title ? html`<h3>${md.title}</h3>` : null}<ul>${md.units.map(function (uid) {
          var u = bk.units.filter(function (x) { return x.id === uid; })[0];
          var said = { perfect: 'full marks', passed: 'passed', open: 'open', locked: 'locked' }[u.state];
          return html`<li key=${uid}><button class=${'u-row u-' + u.state} onClick=${function () { A.openUnit(uid); }}>
            <span class="u-ic" aria-hidden="true">${u.state === 'perfect' || u.state === 'passed' ? TICK : u.state === 'locked' ? LOCK : html`<i></i>`}</span>
            <span class="u-t"><b>${u.label}</b><small>${u.title}</small></span>
            <span class="u-s tnum">${u.r.best ? u.r.best + '/' + R.checkSize : ''}<span class="vh">, ${said}</span></span>
          </button></li>`;
        })}</ul></div>`;
      })}</div>` : null}
    </section>`;
  }

  function PaceCard(p) {
    var LM = p.LM, LP = p.LP, pc = LM.pace;
    if (!pc) return null;
    var yr = D(LP.due).getUTCFullYear();
    var head = pc.state === 'done' ? 'Both books done' : pc.state === 'before' ? 'Starts ' + dMonth(LP.start) : pc.state === 'paused' ? pc.pause.label + ': pace paused' : pc.state === 'on' ? 'On pace' : pc.behind + ' ' + plural(pc.behind, 'chapter') + ' behind pace';
    var tone = pc.state === 'behind' ? 'due' : pc.state === 'before' || pc.state === 'paused' ? 'calm' : 'ok';
    var note = !pc.left ? 'Every chapter passed. The book finals are next.'
      : pc.left + ' to go: about ' + pc.per + ' a week' + (pc.pause ? ' from ' + dMonth(pc.pause.b + DAY) : '') + ' to finish by ' + dMonth(LP.due) + NB + yr + '.'
        + (pc.gaps.length && !pc.pause ? ' The ' + pc.gaps[0].label.charAt(0).toLowerCase() + pc.gaps[0].label.slice(1) + ' isn’t counted.' : '');
    return html`<section class="card pace-card" aria-label="Reading pace">
      <div class="pc-head"><span class=${'pc-st ' + tone}><i aria-hidden="true"></i>${head}</span><span class="pc-n tnum">${LM.passed} of ${LM.total} passed</span></div>
      <div class="pc-bar" aria-hidden="true"><i class="pc-fill" style=${'width:' + (pc.done * 100).toFixed(1) + '%'}></i>${pc.gaps.map(function (g, i) { return html`<i key=${'g' + i} class="pc-gap" style=${'left:' + (g.at * 100).toFixed(1) + '%'}></i>`; })}${pc.state !== 'before' && pc.state !== 'done' ? html`<i class="pc-mark" style=${'left:' + (pc.frac * 100).toFixed(1) + '%'}></i>` : null}</div>
      <div class="pc-foot" aria-hidden="true"><span>${dShort(LP.start)}</span><span>${dShort(LP.due)}</span></div>
      <p class="pc-note">${note}</p>
    </section>`;
  }

  // Practice: what is due today, the weekly mix, the warm-up after a break and the pre-thesis review, in one place.
  function PracticeCard(p) {
    var LM = p.LM, A = p.A, P = LM.practice, rows = [];
    if (P.paused) {
      return html`<section class="card pr-card" aria-labelledby="pr-h"><div class="card-head"><h2 id="pr-h" class="card-k">Practice</h2></div>
        <p class="pr-pause">Paused for the ${P.paused.label.toLowerCase()}. Reviews pick up on ${dMonth(P.paused.b + DAY)}, with a short warm-up.</p></section>`;
    }
    function row(k, t, sub, btn, go, quiet) {
      return html`<li key=${k} class=${'pr-row' + (quiet ? ' quiet' : '')}><div class="pr-t"><b>${t}</b><small>${sub}</small></div>${btn ? html`<button class="pill" onClick=${go}>${btn}</button>` : null}</li>`;
    }
    if (P.warm) rows.push(row('wm', 'Warm-up', 'Six questions from the chapters you’ve passed, to get going after the ' + P.warm.label.toLowerCase() + '.', 'Start', function () { A.startQuiz('warm', ''); }));
    if (P.n) {
      var bits = [];
      if (P.skills.length) bits.push(P.skills.length + ' banking ' + plural(P.skills.length, 'skill') + ', with new figures');
      if (P.due.length) bits.push(P.due.length + ' missed ' + plural(P.due.length, 'question'));
      rows.push(row('rv', P.n + ' due today', bits.join(' and ') + '. Confident misses come first.', 'Review', function () { A.startQuiz('review', ''); }));
    } else if (P.deck || P.sched) rows.push(row('rv', 'Nothing due today', P.next ? 'Next due ' + dMonth(P.next) + '.' : 'Everything is on schedule.', null, null, true));
    if (P.sprint) rows.push(row('sp', 'Paper LBO sprint', P.sprint.size + ' LBO estimates in your head, against one clock.' + (P.sprint.best ? ' Your best: ' + secsText(P.sprint.best) + '.' : ' Get all ' + P.sprint.size + ' in range to set a time.'), 'Start', function () { A.startQuiz('sprint', ''); }));
    if (P.pret) rows.push(row('pt', 'Pre-thesis review', 'Comps and DCF, mixed, in the week before your thesis is due.' + (P.pret.done ? ' Done; again any day this week.' : ''), P.pret.done ? 'Again' : 'Start', function () { A.startQuiz('pret', ''); }));
    if (P.weekly) rows.push(P.weekly.open
      ? row('wk', 'Weekly mix', 'Six questions across the chapters you’ve passed' + (P.weekly.run ? ' · ' + P.weekly.run + ' ' + plural(P.weekly.run, 'week') + ' running' : '') + '.', 'Start', function () { A.startQuiz('weekly', ''); })
      : row('wk', 'Weekly mix done', 'A new mix opens on Monday' + (P.weekly.run > 1 ? ' · ' + P.weekly.run + ' weeks running' : '') + '.', null, null, true));
    if (!rows.length) return null;
    return html`<section class="card pr-card" aria-labelledby="pr-h">
      <div class="card-head"><h2 id="pr-h" class="card-k">Practice</h2></div>
      <ul class="pr-list">${rows}</ul>
      <p class="pr-foot">Missed questions return after 1, 3, 7 and 16 days. Banking skills return 2, 7, 16 and 35 days after their chapter is passed, until they’re secure.</p>
    </section>`;
  }

  var SKILL_WORD = { 'new': 'Not started', learning: 'Learning', practised: 'Practised', secure: 'Secure', desk: 'Desk-ready' };
  // The banker's desk: every Investment Banking skill by chapter, and how well "Sure" matches being right.
  function DeskCard(p) {
    var LM = p.LM, A = p.A, D = LM.desk;
    if (!D.units.length) return null;
    var cal = LM.cal;
    return html`<section class="card dk-card" aria-labelledby="dk-h">
      <div class="card-head"><h2 id="dk-h" class="card-k">Banking skills</h2><button class="txt-btn" onClick=${A.openSkills}>See all</button></div>
      <div class="dk-sum"><b class="tnum">${D.secure} of ${D.total}</b><span>skills secure${D.desks ? ' · ' + D.desks + ' ' + plural(D.desks, 'chapter') + ' desk-ready' : ''}</span></div>
      <ul class="dk-rows">${D.units.map(function (u) {
        return html`<li key=${u.id}><button class="dk-row" onClick=${function () { A.openUnit(u.id); }}>
          <span class="dk-ch">${u.short || u.title}</span>
          <span class="dk-bar" aria-hidden="true">${u.skills.map(function (s) { return html`<i key=${s.id} class=${'dk-s s-' + s.state}></i>`; })}</span>
          <span class="vh">: ${u.skills.map(function (s) { return s.name + ', ' + SKILL_WORD[s.state].toLowerCase(); }).join('; ')}</span>
        </button></li>`;
      })}</ul>
      <p class="dk-key" aria-hidden="true"><span><i class="dk-s s-practised"></i>Practised</span><span><i class="dk-s s-secure"></i>Secure</span><span><i class="dk-s s-desk"></i>Desk-ready</span></p>
      <p class="dk-cal">${cal && cal.n >= 5 ? html`When you say <b>Sure</b>, you’re right <b class="tnum">${Math.round(cal.pct * 100)}%</b> of the time (${cal.n} answers).` : 'Say Sure or Not sure on every question. After five Sure answers, this shows how often your Sure is right.'}</p>
    </section>`;
  }

  // A tombstone: the banker's keepsake for a closed deal, here for a closed deal file. The figure is the one the member
  // worked out (the session's seed redraws the same numbers).
  function Tombstone(p) {
    var c = p.c, rc = p.r || {}, env = null, LP = p.LP;
    try { env = TPL.build(c.def, rc.seed ? seeded(rc.seed + ':case:' + c.id) : null); } catch (e) { env = null; }
    var value = env && c.tomb.value ? TPL.fill(c.tomb.value, env) : '';
    return html`<div class=${'tomb' + (p.small ? ' sm' : '')}>
      ${SKIN ? html`<i class="tb-band" aria-hidden="true"></i>` : html`<span class="tb-mark" aria-hidden="true"><${Logo} size=${p.small ? 18 : 26} color="#FFFFFF" /></span>`}
      <span class="tb-k">${c.deal}</span>
      <b class="tb-co">${c.title}</b>
      ${value ? html`<span class="tb-v tnum">${value}</span>` : null}
      ${c.tomb.line && !p.small ? html`<span class="tb-l">${c.tomb.line}</span>` : null}
      <i class="tb-rule" aria-hidden="true"></i>
      ${p.small ? null : html`<span class="tb-by">${p.role} · analyst</span>`}
      <span class="tb-at">${rc.closed ? 'Closed ' + dShort(rc.closed) : ''}</span>
      ${p.small ? null : html`<span class="tb-soc">The Rand Society${LP && LP.term ? ' · ' + LP.term : ''}</span>`}
    </div>`;
  }

  function DealsCard(p) {
    var LM = p.LM, A = p.A, LP = p.LP;
    if (!LM.deals.length) return null;
    var shut = LM.deals.filter(function (x) { return x.closed; }), nx = LM.deals.filter(function (x) { return x.open && !x.closed; })[0];
    return html`<section class="card dl-card" aria-labelledby="dl-h">
      <div class="card-head"><h2 id="dl-h" class="card-k">Deal book · ${shut.length} of ${LM.deals.length}</h2><button class="txt-btn" onClick=${A.openDeals}>Open</button></div>
      ${shut.length ? html`<ul class="dl-shelf">${shut.slice(-3).reverse().map(function (x) { return html`<li key=${x.c.id}><${Tombstone} c=${x.c} r=${x.r} small=${true} LP=${LP} role=${p.role} /></li>`; })}
          ${LM.deals.filter(function (x) { return !x.closed; }).slice(0, Math.max(0, 3 - shut.length)).map(function (x) { return html`<li key=${x.c.id} class="dl-slot" aria-hidden="true"><span>${x.u.label}</span><b>${x.c.title}</b></li>`; })}</ul>`
        : html`<p class="dl-empty">Each Investment Banking chapter has a deal file: one company, six linked questions. Close it to add its tombstone here.</p>`}
      ${nx ? html`<div class="dl-next"><div><span class="card-k">${nx.u.label} · ${nx.c.deal}</span><b>${nx.c.title}</b><small>${nx.c.items.length} linked questions. Close it with ${nx.c.pass}.</small></div>
        ${nx.wait ? html`<span class="pill off">Again tomorrow</span>` : html`<button class="pill" onClick=${function () { A.startQuiz('deal', nx.c.id); }}>Open the file</button>`}</div>` : null}
    </section>`;
  }

  function SkillsSheet(p) {
    var LM = p.LM, D = LM.desk, cal = LM.cal, ret = LM.ret;
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label="Banking skills">
      <div class="sheet-head"><span class="when">${D.secure} of ${D.total} secure</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body" tabindex="0" aria-label="Banking skills">
        <h2 class="sheet-title">Banking skills</h2>
        <p class="sk-intro">Each skill moves on as you practise: <b>practised</b> once you get it right, <b>secure</b> when it’s right on three separate days a week or more apart (one of them typed), and <b>desk-ready</b> when a whole chapter is secure and its deal file is closed.</p>
        ${D.units.map(function (u) {
          return html`<section key=${u.id} class="sk-unit" aria-label=${u.label + ': ' + u.title}>
            <div class="sk-uh"><span class="card-k">${u.label}</span><b>${u.title}</b>${u.desk ? html`<${Tag} text="Desk-ready" tone="ok" />` : null}</div>
            <ul class="sk-list">${u.skills.map(function (s) { return html`<li key=${s.id} class=${'s-' + s.state}><i class=${'dk-s s-' + s.state} aria-hidden="true"></i><span>${s.name}</span><small>${SKILL_WORD[s.state]}</small></li>`; })}</ul>
          </section>`;
        })}
        <section class="sk-cal" aria-label="How well it holds">
          <span class="card-k">How well it holds</span>
          <p>${cal && cal.n >= 5 ? html`When you said Sure, you were right <b class="tnum">${Math.round(cal.pct * 100)}%</b> of the time, over ${cal.n} answers. Aim for 80% or better: it means your Sure can be trusted.` : 'Answer Sure only when you’d stake points on it. After five Sure answers, your hit rate shows here.'}</p>
          <p>${ret && ret.n >= 5 ? html`On skills and questions you first met three weeks or more ago, you’re right <b class="tnum">${Math.round(ret.pct * 100)}%</b> of the time (${ret.n} answers). Aim for 80%: that is learning that lasts.` : 'Three weeks after you first meet a skill, this shows how much of it has stayed with you.'}</p>
        </section>
      </div>
    </${Sheet}>`;
  }

  function DealsSheet(p) {
    var LM = p.LM, A = p.A, LP = p.LP;
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label="Deal book">
      <div class="sheet-head"><span class="when">${LM.closed} of ${LM.deals.length} closed</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body" tabindex="0" aria-label="Deal book">
        <h2 class="sheet-title">Deal book</h2>
        <p class="sk-intro">One deal file per Investment Banking chapter: a fictional company, a page of facts in rands, and six linked questions that build on each other, as a live deal does. Each question gives the result it needs, so one slip doesn’t sink the rest. New figures every try.</p>
        <ul class="db-grid">${LM.deals.map(function (x) {
          if (x.closed) return html`<li key=${x.c.id}><${Tombstone} c=${x.c} r=${x.r} LP=${LP} role=${p.role} /></li>`;
          return html`<li key=${x.c.id}><div class=${'db-file' + (x.open ? '' : ' locked')}>
            <span class="card-k">${x.u.label} · ${x.c.deal}</span><b>${x.c.title}</b>
            <small>${x.open ? x.c.items.length + ' linked questions. Close it with ' + x.c.pass + '.' + (x.r.best ? ' Best so far: ' + x.r.best + '.' : '') : 'Opens when you pass ' + x.u.label + '.'}</small>
            ${!x.open ? html`<span class="pill off">${LOCK} Locked</span>` : x.wait ? html`<span class="pill off">Again tomorrow</span>` : html`<button class="pill" onClick=${function () { A.startQuiz('deal', x.c.id); }}>Open the file</button>`}
          </div></li>`;
        })}</ul>
        ${LM.notes.length ? html`<section class="db-notes" aria-label="Commendations"><span class="card-k">Commendations</span><ul>${LM.notes.map(function (n) { return html`<li key=${n.id}><b>${n.t}</b><small>${n.s} ${dShort(n.at)}.</small></li>`; })}</ul></section>` : null}
      </div>
    </${Sheet}>`;
  }

  function BadgesCard(p) {
    var LM = p.LM, A = p.A;
    var shelf = LM.badges.filter(function (b) { return b.state !== 'locked'; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 6), nb = LM.nextBadge;
    return html`<section class="card bdg-card" aria-labelledby="bdg-h">
      <div class="card-head"><h2 id="bdg-h" class="card-k">Badges · ${LM.earned} of ${LM.badges.length}</h2><button class="txt-btn" onClick=${A.openBadges}>See all</button></div>
      ${shelf.length ? html`<ul class="shelf">${shelf.map(function (b) { return html`<li key=${b.id} title=${b.name}><${Medal} state=${b.state} glyph=${b.glyph} size=${46} /><span class="vh">${b.name}${b.state === 'mastered' ? ', mastered' : ''}</span></li>`; })}</ul>`
        : html`<p class="bdg-empty">Pass your first chapter to earn your first badge.</p>`}
      ${nb ? html`<div class="bdg-next"><${Medal} state="locked" glyph=${nb.glyph} size=${30} /><span><b>Next: ${nb.name}.</b> ${/ passed$/.test(nb.rule) ? 'Pass ' + nb.rule.replace(/ passed$/, '') : nb.rule}.</span></div>` : null}
    </section>`;
  }

  function ProgressCard(p) {
    var A = p.A;
    return html`<section class="card glist-card" aria-labelledby="lp-h">
      <div class="card-head"><h2 id="lp-h" class="card-k">Your progress</h2></div>
      <ul class="glist">
        ${gRow('sh', 'send', 'Share my progress', 'Your level, chapters and badges in one message', A.shareProgress)}
        ${gRow('bk', 'phone', 'Moving to a new phone', 'Copy a backup code, then paste it on the new phone', A.openBackup)}
        ${gRow('sv', 'file', 'Saved on this device', 'Only you see your progress. Nothing is sent anywhere.', null)}
      </ul>
    </section>`;
  }

  function LearnTools(p) {
    var A = p.A;
    return html`<section class="card lt-card" aria-labelledby="lt-h">
      <div class="lt-t"><h2 id="lt-h" class="card-k">Preview only</h2><p>Try Learn at different stages. Members won’t see this. Preview date: ${p.dayText}.</p></div>
      <div class="lt-btns">
        <button onClick=${function () { A.learnDemo('fresh'); }}>Start fresh</button>
        <button onClick=${function () { A.learnDemo('mid'); }}>Halfway</button>
        <button onClick=${function () { A.learnDemo('promo'); }}>Promotion due</button>
        <button onClick=${function () { A.learnDemo('day'); }}>Next day</button>
      </div>
    </section>`;
  }

  function readTime(m) { var h = Math.floor(m / 60), r = m % 60; return h ? h + ' h' + (r ? ' ' + r + ' min' : '') : r + ' min'; }
  function UnitSheet(p) {
    var io = useState(false), ideasOpen = io[0], setIdeas = io[1];
    var u = p.u, LP = p.LP, R = LP.R, A = p.A, bk = bookOf(LP, u.book), cfg = u.cfg;
    var prev = bk.units[u.i - 1];
    var btn = !u.open ? html`<span class="pill off wide">Pass ${prev ? prev.label : 'the previous chapter'} first</span>`
      : !u.ready ? html`<span class="pill off wide">Questions coming soon</span>`
      : u.perfect ? html`<span class="pill off wide">Full marks</span>`
      : u.wait ? html`<span class="pill off wide">Next try tomorrow</span>`
      : html`<button class="pill wide" data-autofocus onClick=${function () { A.startQuiz('check', u.id); }}>${u.passed ? 'Retake for full marks' : 'Take the check'}</button>`;
    var tag = u.desk ? html`<${Tag} text="Desk-ready" tone="ok" />` : u.state === 'perfect' ? html`<${Tag} text="Full marks" tone="ok" />` : u.state === 'passed' ? html`<${Tag} text="Passed" tone="ok" />` : u.state === 'locked' ? html`<${Tag} text="Locked" tone="quiet" />` : html`<${Tag} text="Open" tone="when" />`;
    var pool = (LP.qs[u.id] || []).length;
    var checkText = cfg && cfg.passCalc
      ? R.checkSize + ' questions at your level, drawn from this chapter’s ' + pool + ', with calculations you type in. Pass with ' + cfg.pass + ', including at least ' + cfg.passCalc + ' calculations right. New levels bring harder questions and less help: worked examples first, then one step to fill, then none.'
      : R.checkSize + ' questions at your level' + (pool > R.checkSize ? ', drawn from this chapter’s ' + pool : '') + ', easiest first. Pass with ' + R.checkPass + '; all ' + R.checkSize + ' is full marks.';
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label=${u.label + ': ' + u.title}>
      <div class="sheet-head"><span class="when">${bk.title}${u.module ? ' · ' + u.module : ''}</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <span class="card-k">${u.label}</span>
        <h2 class="sheet-title">${u.title}</h2>
        ${u.pages || u.mins ? html`<p class="u-meta tnum">${u.pages ? 'Pages ' + u.pages : ''}${u.pages && u.mins ? ' · ' : ''}${u.mins ? 'about ' + readTime(u.mins) + ' of reading' : ''}</p>` : null}
        <div class="sheet-tags">${tag}${u.r.best ? html`<${Tag} text=${'Best ' + u.r.best + ' of ' + R.checkSize} tone="quiet" />` : null}</div>
        ${u.pre && !u.passed && u.open ? html`<section class="u-pre" aria-label="Before you read">
          <span class="card-k">Before you read</span>
          <p>${u.pre.done ? 'Done: ' + u.pre.score + ' of ' + u.pre.n + ' right. Keep those ideas in mind as you read.' : u.pre.n + ' quick questions on what this chapter covers, before you read it. Not marked: guessing first makes the reading stick.'}</p>
          <button class=${'pill' + (u.pre.done ? ' ghost' : '')} onClick=${function () { A.startQuiz('pre', u.id); }}>${u.pre.done ? 'Try them again' : 'Try them first'}</button>
        </section>` : null}
        ${u.sections.length ? html`<section class="ck" aria-label="Reading">
          <div class="ck-head"><span class="card-k">Reading</span><span class="ck-n tnum">${u.read} of ${u.sections.length}</span></div>
          <div class="ck-bar" aria-hidden="true"><i style=${'width:' + Math.round(100 * u.read / u.sections.length) + '%'}></i></div>
          <ul class="ck-list">${u.sections.map(function (t, i) {
            var on = (u.r.read || []).indexOf(i) >= 0;
            return html`<li key=${i}><label class=${'ck-item' + (on ? ' on' : '')}>
              <input type="checkbox" checked=${on} onChange=${function () { A.toggleRead(u.id, i); }} />
              <span class="ck-box" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></span>
              <span class="ck-t">${t}</span></label></li>`;
          })}</ul>
          <p class="ck-src">Tick sections as you read. Your ticks stay on this device.</p>
        </section>` : null}
        ${u.ideas.length ? html`<section class="u-ideas" aria-label="Key ideas">
          <button class="u-ideas-btn" aria-expanded=${ideasOpen ? 'true' : 'false'} aria-controls=${'ideas-' + u.id} onClick=${function () { setIdeas(!ideasOpen); }}>
            <span class="card-k">Key ideas</span><span class="u-ideas-n">${ideasOpen ? 'Hide' : u.ideas.length + ' to take from it'}</span><${Chev} open=${ideasOpen} /></button>
          ${ideasOpen ? html`<ol id=${'ideas-' + u.id} class="u-ideas-list">${u.ideas.map(function (t, i) { return html`<li key=${i}>${t}</li>`; })}</ol>` : null}
        </section>` : null}
        ${u.skills.length ? html`<section class="u-skills" aria-label="Skills in this chapter">
          <span class="card-k">Skills in this chapter</span>
          <ul class="sk-list">${u.skills.map(function (s) { return html`<li key=${s.id} class=${'s-' + s.state}><i class=${'dk-s s-' + s.state} aria-hidden="true"></i><span>${s.name}</span><small>${SKILL_WORD[s.state]}</small></li>`; })}</ul>
        </section>` : null}
        ${u.cases.map(function (x) {
          return html`<section key=${x.c.id} class="u-deal" aria-label="Deal file">
            <span class="card-k">Deal file · ${x.c.deal}</span>
            <p><b>${x.c.title}.</b> ${x.closed ? 'Closed ' + dShort(x.r.closed) + '; its tombstone is in your Deal book.' : x.open ? x.c.items.length + ' linked questions on one company. Close it with ' + x.c.pass + ' to add its tombstone to your Deal book.' : 'Opens when you pass this chapter.'}</p>
            ${x.closed ? html`<button class="pill ghost" onClick=${A.openDeals}>See the Deal book</button>` : !x.open ? null : x.wait ? html`<span class="pill off">Again tomorrow</span>` : html`<button class="pill" onClick=${function () { A.startQuiz('deal', x.c.id); }}>Open the file</button>`}
          </section>`;
        })}
        <section class="u-check" aria-label="Chapter check">
          <span class="card-k">Chapter check</span>
          <p>${checkText}${R.retry === 'nextDay' ? ' Each new try opens the next day, with a fresh mix.' : ''}</p>
          ${u.sample && u.ready ? html`<p class="u-note">Sample questions for now. This chapter’s own set is written from the book.</p>` : null}
          ${btn}
        </section>
      </div>
    </${Sheet}>`;
  }

  function BadgesSheet(p) {
    var LM = p.LM, LP = p.LP;
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label="Badges">
      <div class="sheet-head"><span class="when">${LM.earned} of ${LM.badges.length} earned</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body" tabindex="0" aria-label="All badges">
        <h2 class="sheet-title">Badges</h2>
        <p class="bs-legend"><span><${Medal} state="earned" glyph="target" size=${18} />Earned</span><span><${Medal} state="mastered" glyph="target" size=${18} />Mastered with full marks</span></p>
        ${LP.groups.map(function (g) {
          var list = LM.badges.filter(function (b) { return b.group === g.id; });
          return list.length ? html`<section key=${g.id} class="bs-g" aria-label=${g.title}><h3>${g.title}</h3><ul class="bs-grid">${list.map(function (b) {
            return html`<li key=${b.id} class=${'bs-' + b.state}><${Medal} state=${b.state} glyph=${b.glyph} size=${56} /><b>${b.name}</b><small>${b.rule}</small>
              ${b.at ? html`<small class="bs-at">${b.state === 'mastered' ? 'Mastered' : 'Earned'} ${dShort(b.at)}</small>` : html`<span class="vh">Not yet earned</span>`}</li>`;
          })}</ul></section>` : null;
        })}
      </div>
    </${Sheet}>`;
  }

  function Certificate(p) {
    return html`<div class="cert"><div class="cert-in">
      <${Logo} size=${48} color="#0F2340" />
      <span class="cert-word">THE RAND SOCIETY</span>
      <span class="cert-k">${p.LP.title}${p.LP.term ? ' · ' + p.LP.term : ''}</span>
      <i class="cert-rule" aria-hidden="true"></i>
      <h3 class="cert-title">${p.book.title}</h3>
      <p class="cert-by">Every chapter and the book final passed by the ${p.role}</p>
      <div class="cert-stats"><div><b class="tnum">${p.best} of ${p.size}</b><small>Final score</small></div><div><b class="tnum">${dShort(p.at)}</b><small>Completed</small></div></div>
      <small class="cert-foot">Members only. Not for external circulation.</small>
    </div></div>`;
  }
  function CertSheet(p) {
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label=${'Certificate: ' + p.book.title}>
      <div class="sheet-head"><span class="when">Certificate</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body"><${Certificate} LP=${p.LP} book=${p.book} role=${p.role} best=${p.f.best} size=${p.f.size} at=${p.f.passed} />
        <button class="pill wide" onClick=${p.share}>Share my progress</button></div>
    </${Sheet}>`;
  }

  function BackupSheet(p) {
    var s = useState(''), txt = s[0], setTxt = s[1], m = useState(null), msg = m[0], setMsg = m[1], c = useState(false), copied = c[0], setCopied = c[1], ref = useRef(null);
    var k = useState(''), code = k[0], setCode = k[1], b = useState(false), busy = b[0], setBusy = b[1];
    useEffect(function () { var live = true; p.make().then(function (v) { if (live) setCode(v); }); return function () { live = false; }; }, []);
    function copy() {
      function pick() { var el = ref.current; if (el) { el.focus(); el.select(); } }
      try { navigator.clipboard.writeText(code).then(function () { setCopied(true); }, pick); } catch (e) { pick(); }
    }
    function restore() { setBusy(true); Promise.resolve(p.restore(txt)).then(function (r) { setBusy(false); setMsg(r); }); }
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label="Move your progress">
      <div class="sheet-head"><span class="when">Backup code</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <h2 class="sheet-title">Move your progress</h2>
        <p class="share-note">Your progress is saved on this device only. Copy this code and paste it into the app on your new phone or computer.</p>
        <textarea ref=${ref} class="share-text bk-code" rows="3" readonly value=${code || 'Preparing your code…'} aria-label="Your backup code"></textarea>
        <div class="share-btns"><button class="share-btn primary" disabled=${!code} onClick=${copy}>${copied ? 'Copied' : 'Copy code'}</button></div>
        <div class="bk-restore">
          <span class="card-k">Restore from a code</span>
          <textarea class="share-text" rows="3" value=${txt} placeholder="Paste a code that starts with TRS" onInput=${function (e) { setTxt(e.currentTarget.value); setMsg(null); }} aria-label="Paste a backup code"></textarea>
          <div class="share-btns"><button class="share-btn" disabled=${!txt.trim() || busy} onClick=${restore}>${busy ? 'Restoring…' : 'Restore'}</button></div>
          ${msg ? html`<p class=${'bk-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">${msg.text}</p>` : null}
        </div>
      </div>
    </${Sheet}>`;
  }

  // ---------- learn: every session (check, deal file, review, mixes, promotion review, final) ----------
  // Full screen on phones, a centred panel on computers. One question at a time: the member answers, then says how sure
  // they are (that tap submits), then sees the full working before moving on.
  var UP = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"></path></svg>`;
  var DOWN = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"></path></svg>`;
  var DIRS = [['up', 'Up', 'M12 19V5M6 11l6-6 6 6'], ['down', 'Down', 'M12 5v14M6 13l6 6 6-6'], ['same', 'No change', 'M5 12h14']];
  var KIND_LABEL = { check: 'Chapter check', promo: 'Promotion review', final: 'Book final', review: 'Review', deal: 'Deal file', weekly: 'Weekly mix', warm: 'Warm-up', pret: 'Pre-thesis review', pre: 'Before you read', sprint: 'Paper LBO sprint' };
  function blankDraft(it) { return { pick: -1, v: '', neg: false, order: it && it.start ? it.start.slice() : [], line: -1, fix: -1, dirs: [], a: -1, b: -1, sort: [], ask: -1, t0: Date.now() }; }
  function hintFor(unit, dp) {
    var U = unitOf(unit), d = dp ? 'to ' + dp + ' decimal ' + (dp > 1 ? 'places' : 'place') : 'a whole number';
    return unit === '%' ? 'As a percentage, ' + d + '.' : U.word ? 'In ' + U.word + ', ' + d + '.' : 'As ' + d + '.';
  }
  function secsText(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function Quiz(p) {
    var spec = p.spec, A = p.A, LP = p.LP, items = spec.items, X = LP.X;
    var s = useState(function () { return { i: 0, d: blankDraft(items[0]), res: null, answers: [], phase: 'q', ev: null, leave: false, report: false, facts: true }; }), q = s[0], setQ = s[1];
    var tk = useState(0), setTick = tk[1];
    var live = useRef({ started: false, done: false, answers: [] }), body = useRef(null), head = useRef(null), box = useRef(null);
    useEffect(function () {
      var prev = document.activeElement, de = document.documentElement, ov = de.style.overflow; de.style.overflow = 'hidden';
      return function () {
        de.style.overflow = ov;
        if (p.guard) p.guard.current = null;
        var L = live.current; if (L.started && !L.done) A.learnAbandon(spec, L.answers);
        if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
      };
    }, []);
    useEffect(function () {
      if (body.current) body.current.scrollTop = 0;
      var el = head.current; if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }, [q.i, q.phase]);
    // after an answer, the Next button takes focus (the Sure buttons it replaces are gone)
    useEffect(function () {
      if (!q.res || !box.current) return;
      var el = box.current.querySelector('.qz-go'); if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
      // bring the feedback up if it landed below the fold, leaving the answer in view above it
      var sc = body.current, fb = box.current.querySelector('.qz-fb');
      if (sc && fb) {
        var over = fb.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight * 0.5;
        if (over > 0) { try { sc.scrollBy({ top: over, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) { sc.scrollTop += over; } }
      }
    }, [q.res]);
    var it = items[q.i];
    if (window.TRS_LEARN || window.TRS_TEST) window.__trsQ = it; // a hook for the preview and the browser tests only
    // the estimate's clock: counts up to the target time; nothing is cut off at the end of it
    useEffect(function () {
      if (q.phase !== 'q' || q.res || !it || it.type !== 'est') return;
      var t = setInterval(function () { setTick(function (n) { return n + 1; }); }, 1000);
      return function () { clearInterval(t); };
    }, [q.i, !!q.res, q.phase]);
    // Escape asks before leaving a session that counts as a try (and cancels that question if it is showing)
    var escRef = useRef(null);
    escRef.current = function () { if (q.leave) set2({ leave: false }); else close(); };
    useEffect(function () {
      function esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); if (escRef.current) escRef.current(); } }
      window.addEventListener('keydown', esc, true);
      return function () { window.removeEventListener('keydown', esc, true); };
    }, []);
    useEffect(function () {
      var el = box.current && box.current.querySelector(q.leave ? '.qz-leave .pill' : '.qz-go');
      if (el && q.phase === 'q' && live.current.started) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }, [q.leave]);
    function onKey(ev) {
      if (!box.current) return;
      // arrow keys: within a which-way or sort row they move and choose (radio buttons); in a list of answers or lines they
      // move between them, and Space or Enter chooses
      var k = ev.key, step = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 0, t = ev.target;
      if (step && t && t.closest) {
        var grp = t.closest('[role="radiogroup"]'), list = grp ? null : t.closest('.qz-opts, .qz-lines');
        var items = grp ? grp.querySelectorAll('[role="radio"]:not([disabled])') : list ? list.querySelectorAll('.qz-opt:not([disabled]), .qz-line:not([disabled])') : null;
        if (items && items.length) {
          var arr = Array.prototype.slice.call(items), at = arr.indexOf(t), nx = arr[(at + step + arr.length) % arr.length];
          if (at >= 0 && nx) { ev.preventDefault(); nx.focus(); if (grp) nx.click(); return; }
        }
      }
      if (ev.key !== 'Tab') return;
      var f = box.current.querySelectorAll('button:not([disabled]), a[href], textarea, input:not([disabled])');
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
      else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
    function set2(patch) { setQ(function (prev) { return Object.assign({}, prev, patch); }); }
    // patch may be a function of the latest draft, so quick taps on several rows never overwrite each other
    function draft(patch) { setQ(function (prev) { return prev.res ? prev : Object.assign({}, prev, { d: Object.assign({}, prev.d, typeof patch === 'function' ? patch(prev.d) : patch) }); }); }
    var counts = spec.kind === 'check' || spec.kind === 'deal' || spec.kind === 'promo' || spec.kind === 'final';
    var answered = !!q.res, d = q.d, xpNow = spec.grade ? xpOf(LP, spec, q.answers) : { net: 0 };
    function submit(sure) {
      if (answered || !draftDone(it, d)) return;
      var dd = Object.assign({}, d, { secs: Math.round((Date.now() - d.t0) / 1000) });
      if (dd.neg && dd.v !== '') dd.v = '-' + String(dd.v).replace(/^[-−]/, '');
      var g = gradeItem(it, dd);
      var a = { id: it.id, tier: it.tier, right: g.right, sure: spec.conf ? sure : null, calc: it.calc, skill: it.skill, typed: g.typed, xpk: it.xpk, mode: it.mode, type: it.type, secs: dd.secs };
      var answers = q.answers.concat([a]);
      live.current.started = true; live.current.answers = answers;
      set2({ res: Object.assign(g, { sure: a.sure, secs: dd.secs }), answers: answers, report: false });
    }
    function next() {
      // deal facts stay open on tall screens; elsewhere they fold after the first question so the next question shows first
      if (q.i < items.length - 1) return set2({ i: q.i + 1, d: blankDraft(items[q.i + 1]), res: null, report: false, facts: q.facts && !(window.matchMedia && window.matchMedia('(max-width: 759px), (max-height: 900px)').matches) });
      live.current.done = true;
      var ev = A.learnFinish(spec, q.answers);
      if (ev && (ev.level || (ev.passed && counts))) Fx.play(ev.level ? 'level' : 'pass');
      set2({ phase: ev && ev.level ? 'level' : 'done', ev: ev });
    }
    function close() {
      if (live.current.started && !live.current.done && counts && !q.leave) return set2({ leave: true });
      p.onClose();
    }
    // the phone's Back gesture: true means the session asked first instead of closing
    if (p.guard) p.guard.current = function () {
      if (q.phase === 'q' && live.current.started && !live.current.done && counts) { if (!q.leave) set2({ leave: true }); return true; }
      return false;
    };
    var label = KIND_LABEL[spec.kind] || 'Check';
    var top = html`<div class="qz-top">
      <button class="x" onClick=${close} aria-label=${q.phase === 'q' ? 'Leave' : 'Close'}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>
      <span class="qz-pos tnum">${q.phase === 'q' ? 'Question ' + (q.i + 1) + ' of ' + items.length : label}</span>
      <span class=${'qz-xp tnum' + ((q.ev ? q.ev.xp : xpNow.net) ? ' on' : '')}>${q.ev ? (q.ev.xp > 0 ? '+' + num(q.ev.xp) + ' XP' : '') : xpNow.net ? '+' + xpNow.net + ' XP' : ''}</span>
    </div>`;

    // ---- pieces of a question ----
    function optList(opts, sel, onPick, groupLabel, tf) {
      return html`<div class="qz-opts" role="group" aria-label=${groupLabel || 'Answers'}>${opts.map(function (o, i) {
        var st = !answered ? (sel === i ? ' sel' : '') : o.right ? ' right' : i === sel ? ' wrong' : ' dim';
        return html`<button key=${i} class=${'qz-opt' + st} aria-pressed=${answered ? null : sel === i ? 'true' : 'false'} disabled=${answered} onClick=${function () { onPick(i); }}>
          <span class="qz-k" aria-hidden="true">${tf ? (i ? 'F' : 'T') : 'ABCDEF'.charAt(i)}</span><span class="qz-t">${o.t}</span>
          ${answered && o.right ? html`<span class="qz-mark" aria-hidden="true">${TICK}</span>` : null}
          ${answered && o.right ? html`<span class="vh"> (correct answer)</span>` : answered && i === sel ? html`<span class="vh"> (your answer)</span>` : null}
        </button>`;
      })}</div>`;
    }
    function numBox(id, labelText, unit, dp, state, hint, signed) {
      var U = unitOf(unit);
      return html`<div class="qz-num">
        <label class="qz-num-l" for=${id}>${labelText}</label>
        <div class=${'qz-in' + (state ? ' ' + state : '')}>
          ${signed ? html`<button type="button" class=${'qz-neg' + (d.neg ? ' on' : '')} aria-pressed=${d.neg ? 'true' : 'false'} aria-label="Make it negative" disabled=${answered} onClick=${function () { draft({ neg: !d.neg }); }}>−</button>` : null}
          ${U.pre ? html`<span class="qz-ad" aria-hidden="true">${U.pre}</span>` : null}
          <input id=${id} type="text" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"
            value=${d.v} disabled=${answered} aria-describedby=${id + '-h'} aria-invalid=${state === 'bad' ? 'true' : null}
            onInput=${function (e) { draft({ v: e.currentTarget.value }); }} onKeyDown=${function (e) { if (e.key === 'Enter') { e.preventDefault(); var nx = box.current && box.current.querySelector('.qz-conf-b .qz-go:not([disabled]), .qz-foot > .qz-go:not([disabled])'); if (nx) nx.focus(); else e.currentTarget.blur(); } }} />
          ${U.suf ? html`<span class=${'qz-ad' + (U.box ? ' w' : '')} aria-hidden="true">${U.box || U.suf}</span>` : null}
        </div>
        <small id=${id + '-h'} class="qz-hint">${hint}</small>
      </div>`;
    }
    function stepList(steps, blank) {
      return html`<ol class="qz-steps">${steps.map(function (st, i) {
        var hide = i === blank && !answered;
        return html`<li key=${i} class=${i === blank ? 'blank' + (answered ? (q.res.right ? ' ok' : ' bad') : '') : ''}>
          <span class="qz-st-t">${st.t}</span><span class="qz-st-v tnum">${hide ? html`<i aria-label="your answer below">?</i>` : showNum(st.v, st.unit, st.dp)}</span></li>`;
      })}</ol>`;
    }
    function move(pos, dir) {
      var j = pos + dir, idx = d.order[pos];
      if (j < 0 || j >= d.order.length) return;
      draft(function (dd) { var o = dd.order.slice(), at = o.indexOf(idx), to = at + dir; if (to < 0 || to >= o.length) return {}; o[at] = o[to]; o[to] = idx; return { order: o }; });
      setTimeout(function () {
        var el = box.current && (box.current.querySelector('[data-mv="' + idx + (dir < 0 ? 'u' : 'd') + '"]:not([disabled])') || box.current.querySelector('[data-mv="' + idx + (dir < 0 ? 'd' : 'u') + '"]'));
        if (el) el.focus();
      }, 30);
    }
    function questionBody() {
      var g = q.res, state = answered ? (g.right ? 'ok' : 'bad') : '';
      switch (it.type) {
        case 'tf': case 'mcq': return optList(it.opts, d.pick, function (i) { draft({ pick: i }); }, 'Answers', it.tf);
        case 'two': return html`<div class="qz-two"><p class="qz-sub">${it.aq}</p>${optList(it.opts, d.a, function (i) { draft({ a: i }); }, it.aq, it.keep && it.opts.length === 2)}
          <p class="qz-sub">${it.rq}</p>${optList(it.ropts, d.b, function (i) { draft({ b: i }); }, it.rq)}</div>`;
        case 'num':
          if (it.mode === 'fade') return html`<div class="qz-fade"><span class="card-k">The working, with one step for you</span>${stepList(it.steps, it.blank)}
            ${numBox('qz-in', 'Fill in: ' + it.steps[it.blank].t, it.target.unit, it.target.dp, state, hintFor(it.target.unit, it.target.dp), it.target.v < 0)}</div>`;
          return numBox('qz-in', 'Your answer', it.unit, it.dp, state, it.hint || hintFor(it.unit, it.dp), it.signed);
        case 'est':
          var secs = answered ? g.secs : Math.round((Date.now() - d.t0) / 1000);
          return html`<div class="qz-est">${numBox('qz-in', 'Your estimate', it.unit, it.dp, state, it.hint || 'A rough answer is fine: anything in the accepted range counts.', it.signed)}
            ${spec.kind === 'sprint' ? html`<p class="qz-clock tnum sprint" role="timer" aria-live="off"><b>${secsText(q.answers.reduce(function (t, a) { return t + (a.secs || 0); }, 0) + secs)}</b> on the sprint clock · question ${q.i + 1} of ${items.length}${p.best ? ' · best ' + secsText(p.best) : ''}</p>`
              : html`<p class=${'qz-clock tnum' + (secs > it.secs ? ' over' : '')} role="timer" aria-live="off"><b>${secsText(secs)}</b> · aim for ${secsText(it.secs)} or less, in your head</p>`}</div>`;
        case 'order': return html`<ol class="qz-order" aria-label="Put these in order, first at the top">${d.order.map(function (idx, pos) {
          var mark = answered ? (idx === pos ? ' ok' : ' bad') : '';
          return html`<li key=${idx} class=${mark}><span class="qz-ord-n tnum" aria-hidden="true">${pos + 1}</span><span class="qz-ord-t">${it.items[idx]}</span>
            ${answered ? html`<span class="vh">${idx === pos ? ' (in the right place)' : ' (should be number ' + (idx + 1) + ')'}</span>` : html`<span class="qz-ord-b">
              <button class="qz-mv" data-mv=${idx + 'u'} aria-label=${'Move up: ' + it.items[idx]} disabled=${pos === 0} onClick=${function () { move(pos, -1); }}>${UP}</button>
              <button class="qz-mv" data-mv=${idx + 'd'} aria-label=${'Move down: ' + it.items[idx]} disabled=${pos === d.order.length - 1} onClick=${function () { move(pos, 1); }}>${DOWN}</button></span>`}
          </li>`;
        })}</ol>`;
        case 'err': return html`<div class="qz-err">
          <ol class="qz-lines" aria-label="The working: tap the line with the mistake">${it.lines.map(function (t, i) {
            var st = !answered ? (d.line === i ? ' sel' : '') : i === it.bad ? ' bad-line' : i === d.line ? ' wrong' : ' dim';
            return html`<li key=${i}><button class=${'qz-line' + st} aria-pressed=${answered ? null : d.line === i ? 'true' : 'false'} disabled=${answered} onClick=${function () { draft({ line: i }); }}>
              <span class="qz-ln tnum" aria-hidden="true">${i + 1}</span><span class="qz-lt">${t}</span>${answered && i === it.bad ? html`<span class="qz-flag">The mistake</span>` : null}</button></li>`;
          })}</ol>
          <p class="qz-sub">${it.fq}</p>${optList(it.fix, d.fix, function (i) { draft({ fix: i }); }, it.fq)}</div>`;
        case 'dir': return html`<div class="qz-dirs">${it.measures.map(function (m, k) {
            return html`<div key=${k} class="qz-dir-row"><span class="qz-dir-n" id=${'qd-' + k}>${m.name}</span>
              <div class="qz-seg" role="radiogroup" aria-labelledby=${'qd-' + k}>${DIRS.map(function (x) {
                var on = (d.dirs || [])[k] === x[0], st = !answered ? (on ? ' sel' : '') : m.dir === x[0] ? ' right' : on ? ' wrong' : ' dim';
                var tab = on || (!(d.dirs || [])[k] && x[0] === 'up') ? 0 : -1;
                return html`<button key=${x[0]} role="radio" aria-checked=${on ? 'true' : 'false'} tabindex=${tab} class=${'qz-sg' + st} disabled=${answered}
                  onClick=${function () { draft(function (dd) { var o = (dd.dirs || []).slice(); o[k] = x[0]; return { dirs: o }; }); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${x[2]}></path></svg><span>${x[1]}</span></button>`;
              })}</div></div>`;
          })}${it.mag ? numBox('qz-in', it.mag.q, it.mag.unit, it.mag.dp, answered ? (g.magRight ? 'ok' : 'bad') : '', hintFor(it.mag.unit, it.mag.dp), it.mag.ans < 0) : null}</div>`;
        case 'sort': return html`<ul class="qz-sort">${it.items.map(function (x, i) {
            return html`<li key=${i}><span class="qz-sort-t" id=${'qs-' + i}>${x.t}</span>
              <div class="qz-seg two" role="radiogroup" aria-labelledby=${'qs-' + i}>${it.cats.map(function (c, k) {
                var on = (d.sort || [])[i] === k, st = !answered ? (on ? ' sel' : '') : x.c === k ? ' right' : on ? ' wrong' : ' dim';
                var tab = on || ((d.sort || [])[i] == null && k === 0) ? 0 : -1;
                return html`<button key=${k} role="radio" aria-checked=${on ? 'true' : 'false'} tabindex=${tab} class=${'qz-sg' + st} disabled=${answered}
                  onClick=${function () { draft(function (dd) { var o = (dd.sort || []).slice(); o[i] = k; return { sort: o }; }); }}><span>${c}</span></button>`;
              })}</div></li>`;
          })}</ul>`;
      }
      return null;
    }
    function feedback() {
      var g = q.res, ok = g.right, pts = X[it.xpk] || 0, extra = [];
      var first = ok && !spec.paid[it.id] && !q.answers.slice(0, -1).some(function (a) { return a.id === it.id && a.right; });
      if (spec.grade && first) extra.push('+' + pts + ' XP');
      var unpaid = !spec.paid[it.id] && !q.answers.slice(0, -1).some(function (a) { return a.id === it.id && a.right; });
      if (spec.conf && g.sure === true && unpaid) extra.push(ok ? '+' + Math.round(pts * X.sure) + ' for being sure' : '−' + pts + ' XP for being sure');
      var answerLine = null, work = [];
      if (it.type === 'num' || it.type === 'est') {
        var tgt = it.mode === 'fade' ? it.target : { v: it.ans, unit: it.unit, dp: it.dp };
        answerLine = html`<p class="qz-ans">${it.type === 'est' ? html`Accepted range <b class="tnum">${showNum(it.band[0], it.unit, it.dp)} to ${showNum(it.band[1], it.unit, it.dp)}</b>; worked out exactly, <b class="tnum">${showNum(it.ans, it.unit, Math.max(it.dp, 1))}</b>.`
          : html`${it.mode === 'fade' ? 'That step' : 'The answer'}: <b class="tnum">${showNum(tgt.v, tgt.unit, tgt.dp)}</b>.`}
          ${isFinite(g.val) && !ok ? html` You put <span class="tnum">${showNum(g.val, tgt.unit, tgt.dp)}</span>.` : null}</p>`;
        work = it.mode === 'fade' ? it.steps.map(function (st) { return st.t + ' = ' + showNum(st.v, st.unit, st.dp); }) : it.work.length ? it.work : (it.steps || []).map(function (st) { return st.t + ' = ' + showNum(st.v, st.unit, st.dp); });
      } else if (it.type === 'dir') {
        answerLine = html`<p class="qz-ans">${it.measures.map(function (m, i) { return html`<span key=${i}>${i ? ' · ' : ''}${m.name}: <b>${{ up: 'up', down: 'down', same: 'no change' }[m.dir]}</b></span>`; })}${it.mag ? html`. ${it.mag.q.replace(/\?$/, '')}: <b class="tnum">${showNum(it.mag.ans, it.mag.unit, it.mag.dp)}</b>` : null}.</p>`;
        work = it.work || [];
      } else if (it.type === 'order' && !ok) {
        answerLine = html`<div class="qz-work"><span class="card-k">The right order</span><ol>${it.items.map(function (t, i) { return html`<li key=${i}>${t}</li>`; })}</ol></div>`;
      } else if (it.type === 'err' && !ok) {
        answerLine = html`<p class="qz-ans">The mistake is in line ${it.bad + 1}. It should read: <b>${(it.fix.filter(function (o) { return o.right; })[0] || {}).t}</b></p>`;
      }
      var missed = (it.type === 'mcq' || it.type === 'two') && !ok && it.opts[it.type === 'two' ? d.a : d.pick] ? it.opts[it.type === 'two' ? d.a : d.pick].miss : '';
      var after = !spec.grade ? 'Look out for this as you read.' : ok ? (it.type === 'est' && g.slow ? 'In range, but over ' + secsText(it.secs) + ': on the desk, speed matters too.' : '')
        : g.sure === true ? 'You were sure, so this comes back first in your review.' : 'It comes back in your review.';
      return html`<div class=${'qz-fb ' + (ok ? 'right' : 'wrong')} role="status">
        <div class="qz-fbh"><b>${ok ? 'Right' : 'Not quite'}</b>${extra.length ? html`<b class="tnum">${extra.join(' · ')}</b>` : null}</div>
        ${answerLine}
        ${g.diag ? html`<p class="qz-diag">${g.diag}</p>` : null}
        ${missed ? html`<p class="qz-diag">${missed}</p>` : null}
        ${it.why ? html`<p>${it.why}</p>` : null}
        ${work.length ? html`<div class="qz-work"><span class="card-k">Working</span><ol>${work.map(function (w, i) { return html`<li key=${i} class="tnum">${w}</li>`; })}</ol></div>` : null}
        ${it.src ? html`<small class="qz-reread">Reread: ${it.src}</small>` : null}
        ${after ? html`<small>${after}</small>` : null}
      </div>`;
    }
    var content;
    if (q.phase === 'q') {
      var factAt = Math.max(0, Math.floor(items.length / 2) - 1);
      var typeName = it.type === 'num' ? 'Calculate' : it.type === 'est' ? 'Estimate' : it.type === 'err' ? 'Find the mistake' : it.type === 'order' ? 'Put in order' : it.type === 'dir' ? 'Which way' : it.type === 'two' ? 'Answer and reason' : it.type === 'sort' ? 'Sort' : it.tf ? 'True or false' : LP.tiers[it.tier - 1].name;
      var pts = X[it.xpk] || 0, done = draftDone(it, d);
      var mail = 'Question ' + it.id + ' (' + spec.kicker + '): "' + it.q + '"\n\nWhat looks wrong: ';
      content = html`
        <div class="qz-bar" aria-hidden="true">${items.map(function (x, i) { return html`<i key=${i} class=${i < q.i || (i === q.i && answered) ? 'done' : i === q.i ? 'cur' : ''}></i>`; })}</div>
        <div class="qz-body" ref=${body} tabindex="0" aria-label=${label}>
          ${it.facts ? html`<section class="qz-facts" aria-label=${'Deal facts: ' + it.caseTitle}>
            <button class="qz-facts-h" aria-expanded=${q.facts ? 'true' : 'false'} onClick=${function () { set2({ facts: !q.facts }); }}><span class="card-k">Deal facts</span><b>${it.caseTitle}</b><${Chev} open=${q.facts} /></button>
            ${q.facts ? html`<div class="qz-facts-b">${it.lead ? html`<p>${it.lead}</p>` : null}<table><tbody>${it.facts.map(function (f, i) { return html`<tr key=${i}><th scope="row">${f[0]}</th><td class="tnum">${f[1]}</td></tr>`; })}</tbody></table></div>` : null}
          </section>` : null}
          <div class="qz-src"><span class="card-k">${spec.kicker}</span><span>${spec.title}</span></div>
          <span class=${'qz-tier t' + it.tier}>${typeName}${spec.grade ? ' · ' + (spec.paid[it.id] ? 'already counted' : pts + ' XP') : ' · not marked'}${it.mode === 'walk' ? ' · worked example first' : it.mode === 'fade' ? ' · one step to fill' : ''}${it.sample ? ' · sample' : ''}</span>
          <h2 class="qz-q" ref=${head} tabindex="-1">${it.q}</h2>
          ${it.mode === 'walk' && it.example ? html`<section class="qz-ex" aria-label="A worked example">
            <span class="card-k">Worked example: the same method, other figures</span>
            <p class="qz-ex-q">${it.example.q}</p>
            ${stepList(it.example.steps, -1)}
            <p class="qz-ex-a">Answer: <b class="tnum">${showNum(it.example.ans, it.unit, it.dp)}</b></p>
            ${it.ask ? html`<div class="qz-ask"><p class="qz-sub"><b>Check the method.</b> ${it.ask.q}</p>
              <div class="qz-opts" role="group" aria-label="Check the method">${it.ask.opts.map(function (o, i) {
                var on = d.ask === i, st = d.ask < 0 ? '' : o.right ? ' right' : on ? ' wrong' : ' dim';
                return html`<button key=${i} class=${'qz-opt sm' + st} disabled=${d.ask >= 0 || answered} onClick=${function () { draft({ ask: i }); }}><span class="qz-t">${o.t}</span></button>`;
              })}</div>
              ${d.ask >= 0 ? html`<p class=${'qz-ask-why ' + (it.ask.opts[d.ask].right ? 'ok' : 'bad')} role="status"><b>${it.ask.opts[d.ask].right ? 'Yes.' : 'Not quite.'}</b> ${it.ask.why}</p>` : null}</div>` : null}
          </section>
          <span class="card-k qz-your">Your turn</span>` : null}
          ${questionBody()}
          ${answered ? feedback() : null}
          ${answered && spec.fact && q.i === factAt ? html`<div class="qz-fact"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"></path></svg><div><span class="card-k">Fun fact</span><p>${spec.fact}</p></div></div>` : null}
          ${q.report ? html`<div class="qz-rep"><p>Tell the Head of Research what looks wrong. The question’s reference goes with it.</p><div class="share-btns">
            <a class="share-btn" href=${'https://wa.me/?text=' + encodeURIComponent(plain(mail))} target="_blank" rel="noopener">WhatsApp</a>
            <a class="share-btn" href=${'mailto:?subject=' + encodeURIComponent('Learn: question ' + it.id) + '&body=' + encodeURIComponent(plain(mail))}>Email</a></div></div>` : null}
        </div>
        <div class="qz-foot">
          ${q.leave ? html`<div class="qz-leave" role="alert"><p>Leave now and this counts as a try. ${LP.R.retry === 'nextDay' ? 'You can try again tomorrow.' : ''}</p><div><button class="pill ghost" onClick=${function () { set2({ leave: false }); }}>Stay</button><button class="pill" onClick=${p.onClose}>Leave</button></div></div>`
            : answered ? html`<button class="qz-go" onClick=${next}>${q.i < items.length - 1 ? 'Next question' : 'See results'}</button>
              <button class="qz-report" onClick=${function () { set2({ report: !q.report }); }}>${q.report ? 'Hide' : 'Report this question'}</button>`
            : spec.conf ? html`<div class="qz-conf"><span class="qz-conf-k" id="qz-conf-k">How sure are you?<small>${spec.paid[it.id] ? ' Counts towards how often your Sure is right' : ' Sure: +' + Math.round(pts * X.sure) + ' if right, −' + pts + ' if wrong'}</small></span>
                <div class="qz-conf-b" role="group" aria-labelledby="qz-conf-k"><button class="qz-go ghost" disabled=${!done} onClick=${function () { submit(false); }}>Not sure</button><button class="qz-go" disabled=${!done} onClick=${function () { submit(true); }}>Sure</button></div></div>`
            : html`<button class="qz-go" disabled=${!done} onClick=${function () { submit(null); }}>Check my answer</button>`}
        </div>`;
    } else if (q.phase === 'level') {
      var ev = q.ev, lvl = LP.levels[ev.level - 1], prevL = LP.levels[ev.level - 2] || lvl;
      var opened = [0, 1, 2].filter(function (t) { return lvl.mix[t] > 0 && !(prevL.mix[t] > 0); })[0];
      var bplans = Object.keys(LP.bookCfg).map(function (bid) {
        var pl = planFor(LP, bid, lvl.n), bk = bookOf(LP, bid);
        if (!pl || !bk) return null;
        var a = (pl.a || []).reduce(function (t, x) { var m = /^case(\d)$/.exec(x); return t + (m ? +m[1] : 1); }, 0), cs = (pl.a || []).some(function (x) { return /^case/.test(x); });
        return bk.short + ' checks: ' + (pl.r ? pl.r + ' recall, ' : '') + pl.c + ' concept, ' + a + ' applied' + (cs ? ', with a mini deal file' : '') + '.';
      }).filter(Boolean);
      content = html`<div class="qz-level on-navy">
        <div class="ql-in">
          <span class="ql-k">${spec.kind === 'promo' ? 'Promotion review passed · ' + ev.score + ' of ' + ev.size : 'Both book finals passed'}</span>
          ${SK ? SK.emblem(html`<${Ring} size=${124} w=${6} pct=${1} n=${lvl.n} ...${SK.levelRing} />`, lvl.n)
            : html`<${Ring} size=${124} w=${6} pct=${1} n=${lvl.n} color="#FFFFFF" track="rgba(255,255,255,.14)" fill="rgba(255,255,255,.06)" ink="#FFFFFF" />`}
          <span class="ql-eyebrow">Level up</span>
          <h2 class="ql-name" ref=${head} tabindex="-1">${lvl.name}</h2>
          <p class="ql-note">${opened != null ? LP.tiers[opened].name + ' questions are now open' + (LP.tiers[opened].note ? ': ' + LP.tiers[opened].note.charAt(0).toLowerCase() + LP.tiers[opened].note.slice(1) : '') + '.' : 'Checks now mix in harder questions.'}</p>
        </div>
        ${lvl.n < LP.levels.length ? html`<div class="ql-mix"><span class="card-k">Each chapter check from now on</span><ul>${scaleMix(lvl.mix, LP.R.checkSize).map(function (c, t) {
          var was = scaleMix(prevL.mix, LP.R.checkSize)[t];
          return html`<li key=${t} class=${c ? '' : 'off'}><b class="tnum">${c}</b><small>${LP.tiers[t].name}</small>${c !== was ? html`<em class="tnum">${c > was ? '+' : '−'}${Math.abs(c - was)}</em>` : null}</li>`;
        })}</ul>${bplans.map(function (t, i) { return html`<p key=${i} class="ql-plan">${t}</p>`; })}</div>` : null}
        ${ev.badges.map(function (x) { return html`<div key=${x.b.id} class="ql-badge"><${Medal} state=${x.m ? 'mastered' : 'earned'} glyph=${x.b.glyph} size=${68} onNavy=${true} /><div><span class="card-k">New badge${x.m ? ' · Mastered' : ''}</span><b>${x.b.name}</b><small>${x.b.rule}</small></div></div>`; })}
        <div class="ql-btns"><button class="pill ghost-navy" onClick=${A.shareProgress}>Share my progress</button><button class="pill white" onClick=${function () { set2({ phase: 'done' }); }}>Continue</button></div>
      </div>`;
    } else if (q.phase === 'cert') {
      var bk = bookOf(LP, spec.ref);
      content = html`<div class="qz-body" ref=${body} tabindex="0" aria-label=${label}>
        <h2 class="qz-q" ref=${head} tabindex="-1">Book final passed</h2>
        <${Certificate} LP=${LP} book=${bk} role=${p.role} best=${q.ev.score} size=${q.ev.size} at=${p.day} />
      </div>
      <div class="qz-foot"><button class="qz-go" onClick=${p.onClose}>Done</button><button class="qz-report" onClick=${A.shareProgress}>Share my progress</button></div>`;
    } else {
      var e = q.ev || { lines: [], badges: [], notes: [], secure: [], score: 0, size: items.length };
      var title = !counts ? { review: 'Review done', weekly: 'Weekly mix done', warm: 'Warm-up done', pret: 'Pre-thesis review done', pre: 'Ready to read', sprint: 'Sprint done' }[spec.kind]
        : e.passed ? { check: 'Chapter passed', promo: 'Promoted', final: 'Book final passed', deal: 'Deal closed' }[spec.kind] : 'Not yet';
      var calcBit = e.calc && e.calc.need ? ' · calculations ' + e.calc.r + ' of ' + e.calc.n : '';
      var spx = e.sprint;
      var note = spec.kind === 'sprint' && spx ? spx.right + ' of ' + spx.size + ' in range in ' + secsText(spx.secs) + '. ' + (spx.newBest ? 'A new best.' : spx.first ? 'Your first time on the board.' : spx.best ? 'Your best: ' + secsText(spx.best) + '.' : 'Get all ' + spx.size + ' in range to set a time.')
        : spec.kind === 'pre' ? 'These come from the chapter you’re about to read. Look out for them, and for anything that surprised you.'
        : spec.kind === 'review' ? (p.dueLeft ? p.dueLeft + ' still due today.' : 'Nothing else is due today.')
        : !counts ? 'Spacing practice like this is what makes it stick.'
        : e.passed ? (spec.kind === 'check' && e.score < e.size ? 'A retake with full marks makes this chapter’s badge mastered.' : spec.kind === 'deal' ? 'Its tombstone is in your Deal book.' : '')
        : spec.kind === 'deal' ? 'You need ' + e.pass + ' of ' + e.size + ' to close it. Your next try opens tomorrow, with new figures.'
        : 'You need ' + e.pass + ' of ' + e.size + (e.calc && e.calc.need ? ', including ' + e.calc.need + ' calculations' : '') + '. Missed questions come back in your review' + (LP.R.retry === 'nextDay' ? '; your next try opens tomorrow.' : '.');
      var c0 = spec.caseId && LP.cases[spec.caseId];
      content = html`<div class="qz-body" ref=${body} tabindex="0" aria-label=${label}>
        <div class="qr-score">
          ${SK ? html`<${Ring} size=${96} w=${6} pct=${e.size ? e.score / e.size : 0} n=${e.score} ...${SK.result(counts ? spec.kind : 'review', e.passed)} />`
            : html`<${Ring} size=${96} w=${6} pct=${e.size ? e.score / e.size : 0} n=${e.score} color=${e.passed || !counts ? '#0F2340' : '#3E5A82'} />`}
          <div><h2 class="qr-title" ref=${head} tabindex="-1">${title}</h2><span class="qr-of tnum">${e.score} of ${e.size} right${counts ? ' · pass with ' + e.pass : ''}${calcBit}</span></div>
        </div>
        ${note ? html`<p class="qr-note">${note}</p>` : null}
        ${e.tomb && c0 ? html`<div class="qr-tomb"><${Tombstone} c=${c0} r=${{ closed: p.day, seed: spec.seed }} role=${p.role} LP=${LP} /></div>` : null}
        ${spec.grade ? (e.lines.length ? html`<ul class="qr-xp">${e.lines.map(function (l, i) { return html`<li key=${i} class=${l.xp < 0 ? 'neg' : ''}><span>${l.what}</span><b class="tnum">${l.xp < 0 ? '−' + Math.abs(l.xp) : '+' + l.xp} XP</b></li>`; })}${e.lines.length > 1 ? html`<li class="tot"><span>This ${label.charAt(0).toLowerCase() + label.slice(1)}</span><b class="tnum">${e.xp < 0 ? '−' : '+'}${Math.abs(e.xp)} XP</b></li>` : null}</ul>`
          : html`<p class="qr-note muted">No new XP this time: questions only pay the first time you get them right.</p>`) : null}
        ${e.sure && e.sure.n ? html`<p class="qr-note muted">You said Sure ${e.sure.n} ${plural(e.sure.n, 'time')} and were right on ${e.sure.r}.</p>` : null}
        ${e.secure && e.secure.length ? html`<div class="qr-promo"><span class="card-k">Now secure</span><b>${e.secure.join(', ')}</b><small>Right on three separate days, a week or more apart.</small></div>` : null}
        ${(e.notes || []).map(function (n) { return html`<div key=${n.id} class="qr-note-c"><span class="card-k">Commendation</span><b>${n.t}</b><small>${n.s}</small></div>`; })}
        ${e.badges.map(function (x) { return html`<div key=${x.b.id} class="qr-badge"><${Medal} state=${x.m ? 'mastered' : 'earned'} glyph=${x.b.glyph} size=${60} /><div><span class="card-k">${x.up ? 'Badge mastered' : 'New badge'}</span><b>${x.b.name}</b><small>${x.b.rule}</small></div></div>`; })}
        ${e.promo ? html`<div class="qr-promo"><span class="card-k">Unlocked</span><b>${e.promo.n === LP.levels.length ? e.promo.name + ' opens once both book finals are passed' : 'Promotion review for ' + e.promo.name}</b><small>${e.promo.n === LP.levels.length ? '' : 'Find it on your level card.'}</small></div>` : null}
      </div>
      <div class="qz-foot">${e.cert ? html`<button class="qz-go" onClick=${function () { set2({ phase: 'cert' }); }}>See your certificate</button>` : html`<button class="qz-go" onClick=${p.onClose}>Done</button>`}</div>`;
    }
    var won = q.phase === 'done' && q.ev && q.ev.passed && counts;
    var deco = !SK ? '' : q.phase === 'level' ? 'level' : won ? 'sunrise' : 'night', decoHtml = deco ? SK.deco(deco, { n: q.ev && q.ev.level, bloom: p.bloom }) : '';
    return html`<div class=${'qz-wrap' + (SKIN ? ' ' + SKIN : '')}>
      <div class="scrim" onClick=${q.phase === 'q' ? null : p.onClose}></div>
      <div ref=${box} class=${'quiz' + (SKIN ? ' ' + SKIN : '') + (q.phase === 'level' ? ' navy' : '') + (won && SKIN ? ' sunrise' : '')} role="dialog" aria-modal="true" aria-label=${label + ': ' + spec.title} onKeyDown=${onKey}>
        ${decoHtml ? html`<div key=${deco} class=${'qz-deco ' + deco} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: decoHtml }}></div>` : null}
        ${q.phase === 'level' ? null : top}
        ${content}
      </div>
    </div>`;
  }

  // How this visitor can install the app: the browser's own prompt where there is one, otherwise the steps for their phone.
  function installWay(st) {
    if (!PWA || standalone()) return null;
    if (st.canInstall) return 'prompt';
    if (isIOS()) return 'ios';
    if (/Android/i.test(navigator.userAgent || '')) return 'android';
    return null;
  }
  var SHARE_IC = html`<svg class="share-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"></path><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"></path></svg>`;
  function InstallSteps(p) {
    return p.way === 'ios' ? html`<span>On iPhone: tap <b>Share</b>${SHARE_IC}, then <b>Add to Home Screen</b>.</span>`
      : p.way === 'android' ? html`<span>Open your browser’s <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.</span>` : null;
  }
  function Footer(p) {
    var way = p.st ? installWay(p.st) : null;
    return html`<footer class="foot-slim">
      ${way === 'prompt' ? html`<button class="foot-install" onClick=${p.A.install}><${Logo} size=${16} color="currentColor" />Install the app</button>`
        : way ? html`<p class="foot-how">${html`<${InstallSteps} way=${way} />`}</p>` : null}
      <span>Members only. Not for external circulation.</span>
    </footer>`;
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

  function revealBoard() {
    setTimeout(function () {
      var b = document.querySelector('.board'); if (!b) return;
      var dock = document.querySelector('.lens-dock'), off = (dock ? dock.getBoundingClientRect().height + 16 : 16) + 8;
      var top = b.getBoundingClientRect().top + window.scrollY - off;
      if (window.scrollY > top + 4) { try { window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { window.scrollTo(0, Math.max(0, top)); } }
    }, 40);
  }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // Your own "submitted" ticks: saved on this phone only, keyed by member and date.
  function readChecks() { try { return JSON.parse(read('trs-check') || '{}') || {}; } catch (e) { return {}; } }
  function readSince() { try { return JSON.parse(read('trs-mark-since') || '{}') || {}; } catch (e) { return {}; } }
  function readDone() { try { return JSON.parse(read('trs-done') || '{}') || {}; } catch (e) { return {}; } }

  var phoneQuery = window.matchMedia ? window.matchMedia('(max-width: 759px)') : null;
  function isPhone() { return phoneQuery ? phoneQuery.matches : window.innerWidth < 760; }

  var installEvt = null, installListeners = [];
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; installListeners.forEach(function (f) { f(true); }); });
  function standalone() { try { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } }
  // Phones stay upright. The installed app asks for portrait where the platform allows it (Android); a phone turned on its
  // side anyway (an iPhone, or any phone in the browser) gets a turn-upright screen, and nothing behind it is lost. Read from
  // the screen, not the window, so an on-screen keyboard never trips it.
  function phoneSideways() {
    try {
      var sc = window.screen || {}, small = Math.min(sc.width || 1e4, sc.height || 1e4) <= 500;
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var t = sc.orientation && sc.orientation.type, land = t ? t.indexOf('landscape') === 0 : Math.abs(+window.orientation || 0) === 90;
      // the window must agree: wider than tall. The keyboard only ever shortens a portrait window, so it never trips this.
      return !!(small && coarse && land && window.innerWidth > window.innerHeight);
    } catch (e) { return false; }
  }
  function lockPortrait() { try { if (standalone() && screen.orientation && screen.orientation.lock) screen.orientation.lock('portrait').catch(function () { /* not allowed here */ }); } catch (e) { /* no API */ } }
  function TurnScreen() {
    return html`<div class="turn" role="alertdialog" aria-modal="true" aria-labelledby="turn-h" aria-describedby="turn-p">
      <div class="turn-in">
        <svg class="turn-ic" width="56" height="56" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="15" y="6" width="18" height="34" rx="3.5"></rect><path d="M22 35h4"></path><path d="M38 14a14 14 0 0 1 2 8M40 22l2.5-3M40 22l-3.2-1.6"></path></svg>
        <h2 id="turn-h">Turn your phone upright</h2>
        <p id="turn-p">The app is made for portrait. Everything stays where you left it.</p>
        <span class="turn-mark" aria-hidden="true"><${Logo} size=${22} /><span>THE RAND SOCIETY</span></span>
      </div>
    </div>`;
  }
  function isIOS() { var ua = navigator.userAgent || ''; return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }

  // ---------- app ----------
  function App() {
    var s = useState(function () {
      return { P: null, err: null, mi: 0, lens: read('trs-lens') === 'analyst' ? 'analyst' : 'society', all: false, showPast: false, sheet: null, open: {}, months: {},
        tab: tabFromHash() || 'today', showPastMeet: false, boardOpen: null, checks: readChecks(), asOf: todaySAST(), now: nowMs(todaySAST()), since: readSince(), source: '', syncBusy: false, updateReady: false, phone: isPhone(), canInstall: false, changes: null, showInstall: false, done: readDone(), toast: null,
        LP: null, learnErr: '', learnTick: 0, learnShift: 0, bookOpen: {} };
    });
    var st = s[0], setSt = s[1];
    function set(patch) { setSt(function (prev) { return Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch); }); }
    var loadedAt = useRef(0), toastT = useRef(0), loadRef = useRef(null), sheetRef = useRef(null), ignorePop = useRef(false);
    var tabRef = useRef(st.tab), scrolls = useRef({}), animRef = useRef('from-l'), aRef = useRef(null), learnRef = useRef({}), quizGuard = useRef(null);

    function load(first) {
      return loadData().then(function (res) {
        var P = prepare(res.raw);
        loadedAt.current = Date.now();
        if (res.source === 'network') store('trs-checked', String(Date.now()));
        set(function (prev) {
          if (!first) return { P: P, mi: clamp(prev.mi, 0, P.members.length - 1), source: res.source, syncBusy: false };
          var hsh = fromHash(P), saved = storedMember(P);
          var mi = hsh.mi != null ? hsh.mi : saved != null ? saved : 0;
          if (hsh.mi != null) store('trs-member', P.members[mi].id);
          if (hsh.lens) store('trs-lens', hsh.lens);
          return { P: P, err: null, mi: mi, lens: hsh.lens || prev.lens, source: res.source, sheet: hsh.mi == null && saved == null ? { kind: 'member' } : null };
        });
      }).catch(function (e) {
        if (first) { hideSplash(true); set({ err: e && e.message ? e.message : 'unknown error' }); }
        else set({ syncBusy: false, source: 'cache' });
      });
    }
    loadRef.current = load;

    useEffect(function () {
      load(true);
      // the reading programme loads alongside the dates; Learn and the question of the day wait for it, nothing else does
      loadLearn().then(function (raw) { set({ LP: learnPrep(raw), learnErr: '' }); }).catch(function (e) { set({ learnErr: e && e.message ? e.message : 'unknown error' }); });
      // Opened on a tab link (#plan, #meetings, #role, #guide): Today sits underneath, so Back still lands there.
      if (tabRef.current !== 'today') { try { history.replaceState(null, '', location.pathname + location.search); history.pushState({ trsTab: tabRef.current }, ''); } catch (e) { /* not allowed here */ } }
      // the install card appears from the first visit (after the role is chosen) for members who haven't installed the app, and
      // can be put off for a month; the footer keeps the option on every page
      if (PWA && !standalone()) {
        var visits = (parseInt(read('trs-visits'), 10) || 0) + 1; store('trs-visits', String(visits));
        var later = parseInt(read('trs-install-later'), 10) || 0;
        if (visits >= 1 && Date.now() - later > 30 * DAY) set({ showInstall: true });
      }
      function tick() { var day = todaySAST(); set(function (prev) { return { asOf: day, now: nowMs(day) }; }); }
      var clock = setInterval(tick, 30000);
      function onVis() { if (document.visibilityState !== 'visible') return; tick(); if (!window.TRS_DATA && Date.now() - loadedAt.current > 30 * 60000) load(false); }
      document.addEventListener('visibilitychange', onVis);
      function onMq() { set({ phone: isPhone() }); }
      if (phoneQuery) { if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', onMq); else if (phoneQuery.addListener) phoneQuery.addListener(onMq); }
      function onHash() {
        var t = tabFromHash();
        if (t) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* not allowed here */ } if (aRef.current) aRef.current.goTab(t); return; }
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
      function onKey(ev) {
        if (ev.key === 'Escape') set({ sheet: null });  // an open check handles Escape itself (it asks before leaving)
        var tag = (ev.target && ev.target.tagName) || '';
        if (ev.key === '/' && !sheetRef.current && !/INPUT|TEXTAREA|SELECT/.test(tag)) { ev.preventDefault(); set({ sheet: { kind: 'search' } }); }
      }
      // Bug fix: the phone's back gesture closes an open panel instead of leaving the app.
      // Back closes an open panel first; otherwise it returns from another tab to Today, then leaves the app.
      function onPop(ev) {
        if (ignorePop.current) { ignorePop.current = false; return; }
        if (sheetRef.current) {
          // a check that has started asks before Back leaves it (leaving counts as a try)
          if (quizGuard.current && quizGuard.current()) { try { history.pushState(tabRef.current === 'today' ? { trsSheet: 1 } : { trsSheet: 1, trsTab: tabRef.current }, ''); } catch (e) { /* not allowed here */ } return; }
          set({ sheet: null }); return;
        }
        var t = (ev && ev.state && ev.state.trsTab) || 'today';
        if (t !== tabRef.current) { scrolls.current[tabRef.current] = window.scrollY; animRef.current = 'tab-in'; tabRef.current = t; set({ tab: t }); }
      }
      window.addEventListener('popstate', onPop);
      function onOnline() { if (loadRef.current) loadRef.current(false); else set({}); }
      window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline);
      function onUpdate() { set({ updateReady: true }); }
      window.addEventListener('trs-update', onUpdate);
      window.addEventListener('keydown', onKey);
      function onInstall(v) { set({ canInstall: v }); }
      installListeners.push(onInstall);
      if (installEvt) onInstall(true);
      var lastSide = null;
      function onTurn() { var sw = phoneSideways(); if (sw === lastSide) return; lastSide = sw; document.documentElement.classList.toggle('sideways', sw); set({ side: sw }); if (!sw) lockPortrait(); }
      onTurn(); lockPortrait();
      var so = window.screen && screen.orientation;
      if (so && so.addEventListener) so.addEventListener('change', onTurn);
      window.addEventListener('orientationchange', onTurn); window.addEventListener('resize', onTurn);
      return function () {
        if (so && so.removeEventListener) so.removeEventListener('change', onTurn);
        window.removeEventListener('orientationchange', onTurn); window.removeEventListener('resize', onTurn);
        clearInterval(clock); document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPop);
        window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline); window.removeEventListener('trs-update', onUpdate);
        installListeners = installListeners.filter(function (f) { return f !== onInstall; });
      };
    }, []);

    useEffect(function () { if (st.P) hideSplash(false); }, [!!st.P]);

    // Each open panel gets one history entry, so Back closes it; closing it any other way removes that entry again.
    useEffect(function () {
      var was = sheetRef.current; sheetRef.current = st.sheet;
      if (!was && st.sheet) { try { history.pushState(tabRef.current === 'today' ? { trsSheet: 1 } : { trsSheet: 1, trsTab: tabRef.current }, ''); } catch (e) { /* not allowed here */ } }
      else if (was && !st.sheet) { try { if (history.state && history.state.trsSheet) { ignorePop.current = true; history.back(); } } catch (e) { /* not allowed here */ } }
    }, [!!st.sheet]);

    // The installed app's icon shows how many of your deadlines are due within two days (where the platform allows it without asking).
    useEffect(function () {
      try {
        if (!st.P || !navigator.setAppBadge || window.TRS_DATA) return;
        if (isIOS() && !(window.Notification && Notification.permission === 'granted')) return;
        var Mx = buildModel(st.P, st), n = Mx.all.concat(Mx.other.all).filter(function (it) { return it.band === 'soon'; }).length;
        if (n) navigator.setAppBadge(n).catch(function () {}); else navigator.clearAppBadge().catch(function () {});
      } catch (e) { /* not supported */ }
    }, [st.P, st.asOf, st.mi, st.done]);

    // Each tab keeps its own scroll position, as in a banking app.
    useLayoutEffect(function () { tabRef.current = st.tab; window.scrollTo(0, scrolls.current[st.tab] || 0); }, [st.tab]);

    // Compare what this member could see last time with now; first visit for a member just records it.
    useEffect(function () {
      if (!st.P) return;
      var m = st.P.members[clamp(st.mi, 0, st.P.members.length - 1)], cur = snapshotFor(st.P, m), prev = readSnaps()[m.id];
      var items = prev ? diffSnap(prev, cur, st.asOf) : [];
      var seenNotice = read('trs-notice') || '', N = st.P.notice;
      var showNotice = N && !N.popup && N.id !== seenNotice && !(N.untilMs < st.asOf);
      if (!items.length) saveSnap(m.id, cur);
      if (!items.length && !showNotice) { if (st.changes) set({ changes: null }); return; }
      set({ changes: { member: m.id, snap: cur, items: items, noticeId: showNotice ? N.id : '',
        title: showNotice ? (N.title || 'Notice') : 'Dates changed since your last visit', text: showNotice ? N.text : '' } });
    }, [st.P, st.mi]);

    // A pop-up notice opens once nothing else is open (after the role picker on a first visit) and counts as seen once shown.
    useEffect(function () {
      if (!st.P || st.sheet) return;
      var N = st.P.notice;
      if (!N || !N.popup || N.id === (read('trs-notice') || '') || N.untilMs < st.asOf) return;
      set({ sheet: { kind: 'notice' } });
    }, [st.P, !!st.sheet]);
    useEffect(function () { if (st.sheet && st.sheet.kind === 'notice' && st.P && st.P.notice) store('trs-notice', st.P.notice.id); }, [st.sheet && st.sheet.kind]);

    // Learn's skin reaches the edges of the screen too: the page behind the bounce, the status bar and the browser bar
    var skinKey = !SK ? '' : st.sheet && st.sheet.kind === 'quiz' ? 'quiz' : st.tab === 'learn' && st.P ? 'learn' : '';
    useEffect(function () {
      var de = document.documentElement, mt = document.querySelector('meta[name="theme-color"]');
      de.classList.toggle('stripes-on', SKIN === 'stripes' && !!skinKey);
      if (mt) mt.setAttribute('content', skinKey === 'quiz' ? SK.theme.quiz : skinKey ? SK.theme.page : '#0F2340');
    }, [skinKey]);

    if (st.err) return html`<div class="boot">The dates could not load (${st.err}). Check your connection, then reload the page.</div>`;
    if (!st.P) return html`<div class="boot">Loading the members’ dashboard…</div>`;

    var checked = parseInt(read('trs-checked'), 10) || 0, offline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
    var sync = !st.source || st.source === 'bundled' ? null : st.source === 'network' && !offline
      ? { state: 'ok', text: 'Dates up to date · checked ' + clockSAST(checked || Date.now()), busy: st.syncBusy }
      : { state: 'stale', text: (offline ? 'Offline' : 'Couldn’t reach the server') + ' · showing dates saved ' + (checked ? (Math.round((st.asOf - parseDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(checked)))) / DAY) ? dShort(checked + 2 * 3600000 - (checked + 2 * 3600000) % DAY) + ' ' : '') + clockSAST(checked) : 'earlier'), busy: st.syncBusy };
    var calBase = window.TRS_CAL_BASE || (st.P.siteUrl && !window.TRS_PWA ? st.P.siteUrl.replace(/\/?$/, '/') + 'cal/' : new URL('cal/', location.href).href);

    var P = st.P, M = buildModel(P, st);
    var list = M.groups.reduce(function (a, g) { return a.concat(g.items); }, []);
    // Learn: this role's record on this device, and what the screens show for it today
    var LP = st.LP, learnDay = st.asOf + (st.learnShift || 0) * DAY, lctx = { id: M.m.id, cycle: M.m.cycle, dates: {} };
    var bloom = SKIN === 'stripes'; // the jacarandas come with the stripes look
    P.analyst.forEach(function (e) { lctx.dates[e.key] = e.ms; });
    function getLS(id) { if (!learnRef.current[id]) learnRef.current[id] = LearnStore.load(id) || freshLearn(); return fillLearn(learnRef.current[id]); }
    var LM = null;
    if (LP) { try { LM = learnModel(LP, getLS(M.m.id), learnDay, lctx); } catch (e) { try { console.warn('Learn:', e); } catch (x) { /* no console */ } } }
    if (LM && LM.daily && !LM.daily.done) M.badges.learn = 'q';
    // The questions for any session, drawn to the member's level (see learnSpec)
    function quizSpec(kind, ref) { return LP ? learnSpec(LP, getLS(M.m.id), LM, kind, ref, learnDay, lctx) : null; }
    if (window.TRS_TEST) window.TRS_TEST.learn = { LP: LP, spec: quizSpec, S: function () { return LM ? getLS(M.m.id) : null; }, openUnit: function (u) { A.openUnit(u); } };
    var A = {
      openMembers: function () { set({ sheet: { kind: 'member' } }); },
      pick: function (i) { store('trs-member', P.members[i].id); clearRoleHash(P); animRef.current = 'from-l'; scrolls.current = {}; set({ mi: i, sheet: null, showPast: false }); revealBoard(); },
      setLens: function (l) { store('trs-lens', l); clearRoleHash(P); animRef.current = l === 'analyst' ? 'from-r' : 'from-l'; scrolls.current = {}; set({ lens: l, sheet: null, showPast: false }); revealBoard(); },
      goTab: function (t) {
        // wait for a closing panel's history step to finish first
        (function settle(n) {
          if (ignorePop.current && n < 12) return setTimeout(function () { settle(n + 1); }, 30);
          ignorePop.current = false;
          var cur = tabRef.current;
          if (t === cur) { try { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { window.scrollTo(0, 0); } return; }
          scrolls.current[cur] = window.scrollY;
          try {
            var hs = history.state || {};
            if (t === 'today') { if (hs.trsTab) { ignorePop.current = true; history.back(); } }
            else if (hs.trsTab) history.replaceState({ trsTab: t }, '');
            else history.pushState({ trsTab: t }, '');
          } catch (e) { /* not allowed here */ }
          animRef.current = 'tab-in'; tabRef.current = t;
          set({ tab: t });
        })(0);
      },
      calBase: calBase,
      toggleBoard: function () { set(function (prev) { return { boardOpen: !(prev.boardOpen == null ? !prev.phone : prev.boardOpen) }; }); },
      toggleCheck: function (cid, i) {
        set(function (prev) {
          var all = JSON.parse(JSON.stringify(prev.checks || {})), mine = all[M.m.id] = all[M.m.id] || {}, c = mine[cid] = mine[cid] || {};
          if (c[i]) delete c[i]; else c[i] = 1;
          store('trs-check', JSON.stringify(all));
          return { checks: all };
        });
      },
      openApology: function (it) {
        set({ sheet: { kind: 'share', title: 'Send your apologies', kicker: it.title, subject: 'Apologies: ' + it.title, text: apologyText(it, M.m), rows: 4,
          note: 'Send it on an official Society channel. Three of the four Members make quorum, so early notice lets the chair plan.' } });
      },
      openUpdate: function () {
        set({ sheet: { kind: 'share', title: 'Send my update', kicker: M.m.role + ' · ' + M.m.sector + ' analyst', subject: 'Rand Society update · ' + (M.m.roleShort || M.m.role), text: updateText(M), rows: 8,
          note: 'Built from your dates, the Society’s recorded results and what you marked as submitted. Edit it before sending.' } });
      },
      togglePastMeet: function () { set(function (prev) { return { showPastMeet: !prev.showPastMeet }; }); },
      openSearch: function () { set({ sheet: { kind: 'search' } }); },
      openRule: function (r) {
        var o = Object.assign({}, st.open); o[r.id] = true;
        set({ sheet: null, open: o });
        setTimeout(function () {
          A.goTab('you');
          setTimeout(function () { var el = document.getElementById('rule-' + r.id) || document.querySelector('.rules'); if (el) el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); }, 260);
        }, 60);
      },
      refresh: function () { if (!loadRef.current || window.TRS_DATA) return; set({ syncBusy: true }); loadRef.current(false); },
      setAll: function (v) { set({ all: v }); },
      togglePast: function () { set(function (prev) { return { showPast: !prev.showPast }; }); },
      toggleMonth: function (k, v) { set(function (prev) { var o = Object.assign({}, prev.months); o[k] = v; return { months: o }; }); },
      toggleRule: function (id) { set(function (prev) { var o = Object.assign({}, prev.open); o[id] = !o[id]; return { open: o }; }); },
      openItem: function (k) { set({ sheet: { kind: 'item', key: k } }); },
      toggleDone: function (k, title) {
        var id = M.m.id + ':' + k, on = !st.done[id];
        if (on && !st.since[M.m.id]) { var sn = Object.assign({}, st.since); sn[M.m.id] = st.asOf; store('trs-mark-since', JSON.stringify(sn)); set({ since: sn }); }
        var o = Object.assign({}, st.done);
        if (on) o[id] = Date.now(); else delete o[id];
        store('trs-done', JSON.stringify(o));
        clearTimeout(toastT.current);
        toastT.current = setTimeout(function () { set({ toast: null }); }, 5000);
        set({ done: o, toast: { text: on ? 'Marked as submitted' : 'No longer marked as submitted', title: title, key: k } });
      },
      say: function (text) { clearTimeout(toastT.current); toastT.current = setTimeout(function () { set({ toast: null }); }, 4000); set({ toast: { text: text, title: '', key: '', info: true } }); },
      undo: function () { var t = st.toast; if (t) A.toggleDone(t.key, t.title); set({ toast: null }); },
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
      // ---- learn ----
      learnDo: function (act) {
        var id = M.m.id, res = learnApply(LP, getLS(id), act, learnDay, lctx);
        learnRef.current[id] = res.S; LearnStore.save(id, res.S);
        set(function (prev) { return { learnTick: prev.learnTick + 1 }; });
        return res.ev;
      },
      answerDaily: function (d, i) {
        var o = d.item.opts[i], ev = A.learnDo({ kind: 'daily', q: d.item.id, pick: i, right: o.right, tier: d.item.tier });
        if (ev.badges.length) A.say('New badge: ' + ev.badges[0].b.name);
        else if (ev.promo) A.say('Promotion review unlocked: ' + ev.promo.name);
      },
      toggleRead: function (uid, i) { A.learnDo({ kind: 'read', unit: uid, i: i }); },
      toggleBook: function (id) { set(function (prev) { var o = Object.assign({}, prev.bookOpen); o[id] = !o[id]; return { bookOpen: o }; }); },
      openUnit: function (uid) { set({ sheet: { kind: 'unit', unit: uid } }); },
      openBadges: function () { set({ sheet: { kind: 'badges' } }); },
      openSkills: function () { set({ sheet: { kind: 'skills' } }); },
      openDeals: function () { set({ sheet: { kind: 'deals' } }); },
      openCert: function (bid) { set({ sheet: { kind: 'cert', book: bid } }); },
      openBackup: function () { set({ sheet: { kind: 'backup' } }); },
      shareProgress: function () {
        if (!LM) return;
        set({ sheet: { kind: 'share', title: 'Share my progress', kicker: LP.title, subject: 'Rand Society reading · ' + (M.m.roleShort || M.m.role), text: progressText(LP, LM, M.m), rows: 6,
          note: 'For a Society channel. Edit it before sending.' } });
      },
      startQuiz: function (kind, ref) {
        var spec = quizSpec(kind, ref);
        if (!spec || !spec.items.length) { A.say('No questions are ready for this yet.'); return; }
        set({ sheet: { kind: 'quiz', spec: spec, id: Date.now() } });
      },
      learnFinish: function (spec, answers) { return A.learnDo({ kind: 'quiz', spec: spec, answers: answers }); },
      learnAbandon: function (spec, answers) { A.learnDo({ kind: 'quiz', spec: spec, answers: answers, abandoned: true }); },
      restoreLearn: function (text) { return unpackCode(text).then(function (o) { return A.restoreRecord(o); }); },
      restoreRecord: function (o) {
        var mi = -1;
        if (o && o.old) return { ok: false, text: 'This browser can’t open that code. Update it, or make a new code on the other device in Safari or Chrome.' };
        if (!o) return { ok: false, text: 'That code isn’t valid. Copy the whole code, starting with TRS.' };
        P.members.forEach(function (x, j) { if (x.id === o.id) mi = j; });
        if (mi < 0) return { ok: false, text: 'That code is for a role this app doesn’t have.' };
        learnRef.current[o.id] = o.s; LearnStore.save(o.id, o.s);
        if (mi !== M.mi) store('trs-member', o.id);
        set(function (prev) { return { learnTick: prev.learnTick + 1, mi: mi }; });
        return { ok: true, text: 'Restored: Level ' + o.s.level + ', ' + num(o.s.xp) + ' XP' + (mi !== M.mi ? ', for the ' + P.members[mi].role : '') + '.' };
      },
      setLook: function (v) { setSkin(v); set(function (prev) { return { learnTick: prev.learnTick + 1 }; }); },
      learnDemo: function (kind) {
        if (kind === 'day') { set(function (prev) { return { learnShift: (prev.learnShift || 0) + 1 }; }); return; }
        var S = learnDemo(LP, kind, learnDay, lctx), id = M.m.id;
        learnRef.current[id] = S; LearnStore.save(id, S);
        set(function (prev) { return { learnTick: prev.learnTick + 1, bookOpen: {} }; });
      },
      close: function () { set({ sheet: null }); },
      install: function () {
        if (!installEvt) return;
        installEvt.prompt();
        var done = function () { installEvt = null; set({ canInstall: false, showInstall: false }); };
        if (installEvt.userChoice && installEvt.userChoice.then) installEvt.userChoice.then(done, done); else done();
      }
    };

    aRef.current = A;
    if (window.TRS_TEST) window.TRS_TEST.A = A; // browser tests only
    var sheet = null;
    if (st.sheet && st.sheet.kind === 'share') {
      sheet = html`<${ShareSheet} key=${'share' + st.sheet.subject} phone=${st.phone} onClose=${A.close} title=${st.sheet.title} kicker=${st.sheet.kicker} subject=${st.sheet.subject} text=${st.sheet.text} note=${st.sheet.note} rows=${st.sheet.rows} />`;
    } else if (st.sheet && st.sheet.kind === 'search') {
      sheet = html`<${SearchSheet} key="search" phone=${st.phone} M=${M} onClose=${A.close} openAny=${A.openAny} openRule=${A.openRule} />`;
    } else if (st.sheet && st.sheet.kind === 'notice' && P.notice) {
      sheet = html`<${NoticeSheet} key="notice" phone=${st.phone} N=${P.notice} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'cal') {
      sheet = html`<${CalSheet} key="cal" phone=${st.phone} m=${M.m} calBase=${calBase} android=${/Android/i.test(navigator.userAgent || '')} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'member') {
      sheet = html`<${MemberSheet} key="member" phone=${st.phone} members=${P.members} mi=${M.mi} pick=${A.pick} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'quiz' && LP) {
      sheet = html`<${Quiz} key=${'quiz' + st.sheet.id} spec=${st.sheet.spec} LP=${LP} A=${A} onClose=${A.close} role=${M.m.role} day=${learnDay} dueLeft=${LM ? LM.practice.n : 0} best=${LM && LM.practice.sprint ? LM.practice.sprint.best : 0} guard=${quizGuard} bloom=${bloom} />`;
    } else if (st.sheet && st.sheet.kind === 'unit' && LM) {
      var uu = null;
      LM.books.forEach(function (x) { x.units.forEach(function (u) { if (u.id === st.sheet.unit) uu = u; }); });
      if (uu) sheet = html`<${UnitSheet} key="unit" phone=${st.phone} u=${uu} LP=${LP} A=${A} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'skills' && LM) {
      sheet = html`<${SkillsSheet} key="skills" phone=${st.phone} LM=${LM} LP=${LP} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'deals' && LM) {
      sheet = html`<${DealsSheet} key="deals" phone=${st.phone} LM=${LM} LP=${LP} A=${A} role=${M.m.role} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'badges' && LM) {
      sheet = html`<${BadgesSheet} key="badges" phone=${st.phone} LM=${LM} LP=${LP} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'cert' && LM) {
      var fb = getLS(M.m.id).finals[st.sheet.book];
      if (fb && fb.passed) sheet = html`<${CertSheet} key="cert" phone=${st.phone} LP=${LP} book=${bookOf(LP, st.sheet.book)} role=${M.m.role} f=${fb} share=${A.shareProgress} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'backup' && LP) {
      sheet = html`<${BackupSheet} key="backup" phone=${st.phone} make=${function () { return packCode(M.m.id, getLS(M.m.id)); }} restore=${A.restoreLearn} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'item') {
      var seq = list.some(function (it) { return it.key === st.sheet.key; }) ? list : M.all;
      var idx = -1;
      seq.forEach(function (it, i) { if (it.key === st.sheet.key) idx = i; });
      if (idx >= 0) {
        var ck = M.checkFor(seq[idx].key);
        sheet = html`<${ItemSheet} key="item" phone=${st.phone} it=${seq[idx]} idx=${idx} total=${seq.length} onClose=${A.close} toggleDone=${A.toggleDone} A=${A}
          check=${ck && seq[idx].part === 'lead' ? ck.c : null} checkState=${ck ? ck.state : null} toggleCheck=${A.toggleCheck}
          prev=${function () { if (idx > 0) A.openItem(seq[idx - 1].key); }} next=${function () { if (idx < seq.length - 1) A.openItem(seq[idx + 1].key); }} />`;
      }
    }

    var tab = st.tab, phone = st.phone, m = M.m;
    var hasChanges = st.changes && st.changes.member === m.id;
    if (hasChanges && !M.badges.today) M.badges.today = 'news';
    function cols(a, b, extra) {
      a = a.filter(Boolean); b = b.filter(Boolean);
      if (phone) return (extra || []).concat(a, b);
      return (extra || []).concat([html`<div key="ca" class="col">${a}</div>`, b.length ? html`<div key="cb" class=${'col' + (tab === 'plan' ? ' sticky' : '')}>${b}</div>` : null]);
    }
    var head, content, lensTab = tab === 'today' || tab === 'plan' || tab === 'you';
    if (tab === 'plan') {
      head = html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow=${'Term ' + M.term.name} title="Term plan" text=${M.planLine} lens=${true} />`;
      var board = html`<${Board} key="bd" B=${boardModel(P, st.asOf, M.m.id)} open=${st.boardOpen == null ? !phone : st.boardOpen} toggle=${A.toggleBoard} />`;
      content = phone ? [html`<${TermCard} key="tc" M=${M} A=${A} />`, board, html`<${Agenda} key="ag" M=${M} A=${A} st=${st} sync=${sync} />`]
        : cols([board, html`<${Agenda} key="ag" M=${M} A=${A} st=${st} sync=${sync} />`], [html`<${TermCard} key="tc" M=${M} A=${A} />`]);
    } else if (tab === 'meet') {
      head = html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow="Sundays · 17:00 to 18:30 · Teams" title="Meetings" text="Three of the four Members make quorum." />`;
      content = cols([html`<${MeetHero} key="mh" M=${M} A=${A} />`], [html`<${MeetList} key="ml" M=${M} A=${A} st=${st} />`, html`<${MeetHow} key="mw" M=${M} />`]);
    } else if (tab === 'learn') {
      head = html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow=${LP ? LP.title : 'Required reading'} title="Learn" lvl=${LM ? LM.lv.cur.n : 1} bloom=${bloom} text=${LP && !isNaN(LP.due) ? 'Two books by ' + dMonth(LP.due) + NB + D(LP.due).getUTCFullYear() + '.' : 'The Society’s required reading.'} />`;
      if (!LM) content = [html`<section key="ll" class="card rcard"><span class="card-k">Learn</span><p>${st.learnErr ? 'The reading programme couldn’t load (' + st.learnErr + '). Check your connection, then reopen the app.' : 'Loading the reading programme…'}</p></section>`];
      else {
        var lvc = html`<${LevelCard} key="lv" LM=${LM} LP=${LP} A=${A} role=${m.role} />`, dqc = html`<${DailyCard} key="dq" LM=${LM} LP=${LP} A=${A} />`;
        var bks = LM.books.map(function (x) { return html`<${BookCard} key=${'bk' + x.b.id} bk=${x} LP=${LP} A=${A} open=${!!st.bookOpen[x.b.id]} />`; });
        var prc = html`<${PracticeCard} key="pr" LM=${LM} A=${A} />`, dkc = html`<${DeskCard} key="dk" LM=${LM} A=${A} />`, dlc = html`<${DealsCard} key="dl" LM=${LM} LP=${LP} A=${A} role=${m.role} />`;
        var pcc = html`<${PaceCard} key="pc" LM=${LM} LP=${LP} />`, bdc = html`<${BadgesCard} key="bd" LM=${LM} A=${A} />`, pgc = html`<${ProgressCard} key="pg" A=${A} />`, fxc = html`<${FxCard} key="fx" />`;
        var ltc = window.TRS_LEARN ? html`<${LearnTools} key="lt" A=${A} dayText=${wk(learnDay) + ' ' + dMonth(learnDay)} />` : null;
        content = phone ? [lvc, dqc, prc].concat(bks, [dkc, dlc, pcc, bdc, pgc, fxc, ltc]) : cols([lvc].concat(bks, [dkc, pcc, bdc]), [dqc, prc, dlc, pgc, fxc, ltc]);
        content = content.concat([html`<div key="lk" class="wide"><${LookBar} A=${A} /></div>`]);
      }
    } else if (tab === 'you') {
      var rc = roleCards(M, A);
      head = M.lens === 'society'
        ? html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow=${m.role} title=${m.focus} text=${m.focusLine} lens=${true} />`
        : html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow=${'Analyst · ' + M.cycle.name} title=${m.sector} text=${m.sectorLine} lens=${true} />`;
      var gl = html`<${GuideList} key="gl" M=${M} A=${A} st=${st} sync=${sync} />`, lb = html`<${Library} key="lb" items=${P.library} />`, gr = html`<${GuideRules} key="gr" M=${M} A=${A} st=${st} />`;
      content = phone ? rc.a.concat(rc.b, [gl, lb, gr]) : cols(rc.a.concat([gr]), rc.b.concat([gl, lb]));
    } else {
      head = html`<${Mast} M=${M} A=${A} st=${st} />`;
      var changes = hasChanges ? html`<${Changes} key="ch" changes=${st.changes} A=${A} />` : null;
      var dailyToday = LM && LM.daily ? html`<${DailyCard} key="dqt" LM=${LM} LP=${LP} A=${A} compact=${true} />` : null;
      // meeting time: from 30 minutes before until it ends, the meeting (with Join on Teams) leads Today
      var meetNow = !!(M.nextMeet && M.nextMeet.live && M.nextMeet.live.join);
      var nxc = html`<${NextCard} key="nx" M=${M} A=${A} />`, nmc = html`<${NextMeet} key="nm" M=${M} A=${A} />`;
      content = phone
        ? [changes].concat(meetNow ? [nmc, nxc] : [nxc], [st.showInstall && installWay(st) ? html`<${InstallCard} key="in" A=${A} st=${st} />` : null,
          html`<${Queue} key="q" M=${M} />`], meetNow ? [] : [nmc], [dailyToday])
        : cols(meetNow ? [nmc, nxc] : [nxc], meetNow ? [html`<${Queue} key="q" M=${M} />`, dailyToday] : [nmc, html`<${Queue} key="q" M=${M} />`, dailyToday], changes ? [html`<div key="chw" class="wide">${changes}</div>`] : []);
    }

    var skinPage = tab === 'learn' && SKIN;
    // messages wait while a check is open: they would cover its buttons, and a refresh mid-check would count as a try
    var inCheck = !!(st.sheet && st.sheet.kind === 'quiz');
    return html`<div class=${'app ' + (phone ? 'has-tabbar' : 'has-rail') + (skinPage ? ' ' + SKIN + '-page' : '')}>
      <${SkinDefs} />
      ${phone ? null : html`<${Rail} M=${M} A=${A} tab=${tab} />`}
      ${head}
      ${phone && lensTab ? html`<div class="lens-dock" role="region" aria-label="View"><${LensSwitch} M=${M} A=${A} /></div>` : null}
      <main key=${tab + M.m.id + M.lens} class=${'board tabbed fade ' + animRef.current + ' t-' + tab + (phone ? ' stack' : '') + (skinPage ? ' ' + SKIN : '')}>
        ${content}
      </main>
      <${Footer} M=${M} A=${A} st=${st} />
      ${phone ? html`<${TabBar} M=${M} A=${A} tab=${tab} />` : null}
      ${st.updateReady && !st.toast && !inCheck ? html`<div class="toast" role="status"><span><b>A new version is ready</b></span><button onClick=${function () { location.reload(); }}>Refresh</button></div>` : null}
      ${st.toast && !inCheck ? html`<div class="toast" role="status"><span><b>${st.toast.text}</b> ${st.toast.title}</span>${st.toast.info ? null : html`<button onClick=${A.undo}>Undo</button>`}</div>` : null}
      ${sheet}
      ${st.side ? html`<${TurnScreen} />` : null}
    </div>`;
  }

  root.innerHTML = '';
  render(html`<${App} />`, root);
})();
