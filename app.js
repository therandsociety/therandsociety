
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
      notice: raw.notice && raw.notice.id && raw.notice.text ? raw.notice : null,
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
    var M = p.M, A = p.A, st = p.st, skin = p.tab === 'learn' && SKIN, ph = skin ? null : M.photos[p.tab];
    return html`<header class=${'mast page-head on-navy' + (p.lens ? '' : ' no-dock') + (ph ? ' has-photo' : '') + (skin ? ' ' + SKIN : '')}>
      ${ph ? html`<${SectionPhoto} key=${p.tab} x=${ph} phone=${st.phone} />` : null}
      ${skin ? html`<${Scene} />` : null}
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
    var it = x.it, chip = chipFor(x);
    return html`<section class="card nmeet" aria-labelledby="nm-h">
      <div class="card-head"><h2 id="nm-h" class="card-k">Next meeting</h2><span class="live-chip" aria-live="polite"><${Tag} text=${chip.text} tone=${chip.tone} /></span></div>
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
    var inst = standalone() ? null : st.canInstall ? { v: 'One tap opens it full screen, even offline', go: A.install } : isIOS() ? { v: 'Tap Share, then Add to Home Screen' } : null;
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
  // learn.json (window.TRS_LEARN in the preview) holds the books, levels, badges, rules and question bank. Progress is
  // personal: one record per role, kept on the device behind LearnStore. A shared store can replace LearnStore later
  // (same load and save calls) without touching the screens.
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
    load: function (id) { var s = LearnStore.all()[id]; return s && s.v === 1 ? s : null; },
    save: function (id, s) { var all = LearnStore.all(); all[id] = s; store('trs-learn', JSON.stringify(all)); }
  };
  function freshLearn() { return { v: 1, xp: 0, level: 1, units: {}, paid: {}, review: {}, daily: null, streak: { n: 0, last: 0, best: 0 }, badges: {}, promos: {}, finals: {}, flags: {} }; }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function learnPrep(raw) {
    if (!raw || !Array.isArray(raw.books) || !raw.books.length || !Array.isArray(raw.levels) || !raw.levels.length) throw new Error('learn.json needs books and levels.');
    var R = Object.assign({ checkSize: 8, checkPass: 6, reviewSize: 10, reviewPass: 8, finalSize: 20, finalPass: 16, finalMix: [2, 8, 10], retry: 'nextDay', inOrder: true, promotions: true, samples: false }, raw.rules || {});
    var X = Object.assign({ t1: 10, t2: 20, t3: 40, pass: 100, perfect: 50, daily: 15, streak7: 100, reviewClear: 30 }, raw.xp || {});
    var levels = raw.levels.map(function (l, i) {
      return { n: i + 1, name: l.name || 'Level ' + (i + 1), xp: +l.xp || 0, mix: Array.isArray(l.mix) && l.mix.length === 3 ? l.mix.map(Number) : [R.checkSize, 0, 0] };
    });
    var units = {};
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
      return { id: b.id, title: b.title || b.id, short: b.short || b.title || b.id, by: b.by || '', units: list, modules: modules };
    });
    var qs = {}, samples = {}, byId = {};
    (raw.questions || []).forEach(function (q) {
      if (!q || !q.id || !q.q || byId[q.id]) return;
      var tf = q.type === 'tf';
      if (tf ? typeof q.answer !== 'boolean' : !(Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)) return;
      var u = units[q.unit], book = u ? u.book : q.book;
      if (!u && !(q.sample && book)) return;
      var x = { id: q.id, unit: u ? u.id : '', book: book, tier: clamp(Math.round(+q.tier) || 1, 1, 3), tf: tf, q: q.q,
        options: tf ? ['True', 'False'] : q.options, answer: tf ? (q.answer ? 0 : 1) : q.answer, why: q.why || '', sample: !u };
      byId[x.id] = x;
      if (u) (qs[u.id] = qs[u.id] || []).push(x); else (samples[book] = samples[book] || []).push(x);
    });
    var facts = {};
    (raw.facts || []).forEach(function (f) { var k = f && f.text && (f.unit || f.book); if (k) (facts[k] = facts[k] || []).push(f.text); });
    var pg = raw.programme || {};
    return { R: R, X: X, levels: levels, books: books, units: units, qs: qs, samples: samples, byId: byId, facts: facts,
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

  // Small seeded random numbers: the same member, day and attempt always get the same questions in the same order.
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
  function quizItems(list, r) {
    return list.map(function (q) {
      var idx = q.options.map(function (o, i) { return i; }), ord = q.tf ? idx : shuffled(idx, r);
      return { id: q.id, tier: q.tier, tf: q.tf, q: q.q, why: q.why, sample: q.sample, opts: ord.map(function (i) { return { t: q.options[i], right: i === q.answer }; }) };
    });
  }
  function levelInfo(LP, S) {
    var L = LP.levels, cur = L[clamp(S.level || 1, 1, L.length) - 1], nxt = L[cur.n] || null;
    var pct = nxt ? clamp((S.xp - cur.xp) / Math.max(1, nxt.xp - cur.xp), 0, 1) : 1;
    return { cur: cur, next: nxt, pct: pct, toNext: nxt ? Math.max(0, nxt.xp - S.xp) : 0, maxTier: cur.mix[2] ? 3 : cur.mix[1] ? 2 : 1 };
  }
  function tierOpensAt(LP, t) { for (var i = 0; i < LP.levels.length; i++) if (LP.levels[i].mix[t] > 0) return LP.levels[i]; return null; }

  // Everything the Learn screens show, worked out from the questions file, a member's record and the day.
  function learnModel(LP, S, day, ctx) {
    var R = LP.R, lv = levelInfo(LP, S), passedAll = 0, totalAll = 0;
    var books = LP.books.map(function (b) {
      var prev = true, next = null, passed = 0;
      var us = b.units.map(function (u) {
        var r = S.units[u.id] || {}, ok = !!r.passed, open = ok || !R.inOrder || prev;
        prev = ok; if (ok) passed++;
        var x = Object.assign({}, u, { r: r, passed: ok, perfect: !!r.perfect, open: open, state: ok ? (r.perfect ? 'perfect' : 'passed') : open ? 'open' : 'locked',
          read: (r.read || []).length, ready: unitPool(LP, u.id).length > 0, sample: isSample(LP, u.id), wait: R.retry === 'nextDay' && r.lastDay >= day && !r.perfect });
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
      var brk = LP.pauses.filter(function (x) { return day >= x.a && day <= x.b; })[0] || null;
      pace = { state: !left ? 'done' : day < LP.start ? 'before' : brk ? 'paused' : passedAll >= Math.floor(expect) - 1 ? 'on' : 'behind', behind: Math.max(1, Math.round(expect - passedAll)),
        frac: day < LP.start ? 0 : frac, done: passedAll / totalAll, per: left ? Math.max(1, Math.round(left / weeks)) : 0, left: left, pause: brk,
        gaps: LP.pauses.filter(function (x) { return x.a > LP.start && x.a <= LP.due; }).map(function (x) { return { at: activeDays(LP, LP.start, x.a - DAY) / span, label: x.label }; }) };
    }
    // question of the day: from chapters already passed, at the tiers open to you; before the first pass, from the chapters up next
    var dPool = [], seen = {};
    function add(uid) { unitPool(LP, uid).forEach(function (q) { if (!seen[q.id] && q.tier <= lv.maxTier) { seen[q.id] = 1; dPool.push(q); } }); }
    books.forEach(function (x) { x.units.forEach(function (u) { if (u.passed) add(u.id); }); });
    if (!dPool.length) books.forEach(function (x) { if (x.next) add(x.next.id); });
    var dd = S.daily && S.daily.day === day ? S.daily : null, dq = dd ? LP.byId[dd.q] : null;
    if (!dq && dPool.length) dq = dPool[Math.floor(seeded(ctx.id + ':' + day)() * dPool.length)];
    var daily = dq ? { item: quizItems([dq], seeded(ctx.id + ':o:' + day))[0], done: !!dd, right: !!(dd && dd.right), pick: dd ? dd.pick : -1,
      unit: dq.unit ? LP.units[dq.unit] : null, book: bookOf(LP, dq.book) } : null;
    var deck = Object.keys(S.review).filter(function (k) { return LP.byId[k]; });
    var due = deck.filter(function (k) { return S.review[k].due <= day; });
    var badges = LP.badges.map(function (b) { var g = S.badges[b.id]; return Object.assign({}, b, { state: g ? (g.m ? 'mastered' : 'earned') : 'locked', at: g ? g.at : 0 }); });
    // the next badge to aim for: the locked chapter badge closest to where the member is reading
    var nb = null, need = 1e9;
    badges.forEach(function (b) {
      if (b.state !== 'locked' || b.kind !== 'units') return;
      var steps = 0;
      (b.units || []).forEach(function (uid) {
        var u = LP.units[uid], bk = u && books.filter(function (x) { return x.b.id === u.book; })[0];
        if (u && bk && !(S.units[uid] && S.units[uid].passed)) steps += bk.next ? u.i - bk.next.i + 1 : 1;
      });
      if (steps && steps < need) { need = steps; nb = b; }
    });
    return { lv: lv, books: books, passed: passedAll, total: totalAll, promo: promo, pace: pace, daily: daily,
      streak: S.streak && S.streak.last >= day - DAY ? S.streak.n : 0, deck: deck.length, due: due, badges: badges,
      earned: badges.filter(function (b) { return b.state !== 'locked'; }).length, nextBadge: nb, xp: S.xp };
  }

  // Badges are never taken away. Unit badges become "mastered" with full marks on every chapter they cover;
  // a book badge becomes mastered when its final is passed.
  function learnBadges(LP, S, day, ctx) {
    var out = [];
    function passed(u) { return !!(S.units[u] && S.units[u].passed); }
    function perfect(u) { return !!(S.units[u] && S.units[u].perfect); }
    LP.badges.forEach(function (b) {
      var have = S.badges[b.id], earn = false, master = false, bk;
      if (b.kind === 'units') { earn = (b.units || []).length > 0 && b.units.every(passed); master = earn && b.units.every(perfect); }
      else if (b.kind === 'book') { bk = bookOf(LP, b.book); earn = !!bk && bk.units.every(function (u) { return passed(u.id); }); master = earn && !!(S.finals[b.book] && S.finals[b.book].passed); }
      else if (b.kind === 'perfect') earn = Object.keys(S.units).some(function (k) { return S.units[k].perfect; });
      else if (b.kind === 'tier3') earn = !!S.flags.t3;
      else if (b.kind === 'streak') earn = (S.streak.best || 0) >= (b.n || 7);
      else if (b.kind === 'review') earn = !!S.flags.cleared;
      else if (b.kind === 'before') {
        var by = ctx.dates[String(b.dateKey || '').replace('{cycle}', ctx.cycle || '')];
        earn = !!by && (b.units || []).length > 0 && b.units.every(function (u) { return passed(u) && S.units[u].passed <= by; });
      }
      if (earn && !have) { S.badges[b.id] = { at: day, m: master ? day : 0 }; out.push({ b: b, m: master }); }
      else if (have && master && !have.m) { have.m = day; out.push({ b: b, m: true, up: true }); }
    });
    return out;
  }

  // One step of progress: answering the question of the day, finishing a check, review, promotion or final, or ticking
  // a section as read. Returns the new record and what to celebrate.
  function learnApply(LP, S0, act, day, ctx) {
    var S = JSON.parse(JSON.stringify(S0)), X = LP.X, R = LP.R, L = LP.levels, before = levelInfo(LP, S0);
    var ev = { lines: [], xp: 0, badges: [], level: null, promo: null, cert: null };
    S.flags = S.flags || {}; S.streak = S.streak || { n: 0, last: 0, best: 0 };
    function gain(what, n) { if (!n) return; S.xp += n; ev.xp += n; ev.lines.push({ what: what, xp: n }); }
    function toDeck(id) { S.review[id] = { box: 0, due: day + DAY }; }
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
      if (act.right) { gain('Question of the day', X.daily); if (act.tier === 3) S.flags.t3 = S.flags.t3 || day; } else toDeck(act.q);
      if (k.n % 7 === 0) gain(k.n + ' days running', X.streak7);
    } else if (act.kind === 'quiz') {
      var sp = act.spec, right = 0, paid = 0;
      act.answers.forEach(function (a) {
        if (a.right) {
          right++;
          if (!S.paid[a.id]) { S.paid[a.id] = 1; paid += X['t' + a.tier] || 0; }
          if (a.tier === 3) S.flags.t3 = S.flags.t3 || day;
          if (sp.kind === 'review' && S.review[a.id]) {
            var bx = S.review[a.id].box + 1;
            if (bx >= 3) delete S.review[a.id]; else S.review[a.id] = { box: bx, due: day + [1, 3, 7][bx] * DAY };
          }
        } else toDeck(a.id);
      });
      if (paid) gain(right + ' right ' + plural(right, 'answer'), paid);
      var passed = sp.kind !== 'review' && right >= sp.pass;
      ev.score = right; ev.size = sp.size; ev.pass = sp.pass; ev.passed = passed; ev.kind = sp.kind; ev.abandoned = !!act.abandoned;
      if (sp.kind === 'check') {
        var u = S.units[sp.ref] = S.units[sp.ref] || {};
        u.tries = (u.tries || 0) + 1; u.lastDay = day; u.best = Math.max(u.best || 0, right);
        u.last = sp.items.map(function (x) { return x.id; });
        if (passed && !u.passed) { u.passed = day; gain('Chapter passed', X.pass); }
        if (right === sp.size && sp.size > 0 && !u.perfect) { u.perfect = day; gain('Full marks', X.perfect); }
      } else if (sp.kind === 'promo') {
        var pr = S.promos[sp.ref] = S.promos[sp.ref] || {};
        pr.tries = (pr.tries || 0) + 1; pr.lastDay = day; pr.best = Math.max(pr.best || 0, right);
        if (passed && S.level < sp.ref) { pr.passed = day; S.level = sp.ref; }
      } else if (sp.kind === 'final') {
        var f = S.finals[sp.ref] = S.finals[sp.ref] || {};
        f.tries = (f.tries || 0) + 1; f.lastDay = day; f.best = Math.max(f.best || 0, right); f.size = sp.size;
        if (passed && !f.passed) { f.passed = day; ev.cert = sp.ref; }
      } else if (sp.kind === 'review' && act.answers.length) {
        var left = Object.keys(S.review).filter(function (id) { return LP.byId[id] && S.review[id].due <= day; }).length;
        if (!left) { S.flags.cleared = S.flags.cleared || day; if (S.flags.clearDay !== day) { S.flags.clearDay = day; gain('Review deck cleared', X.reviewClear); } }
      }
    }
    var top = L[L.length - 1];
    if (!R.promotions) { L.forEach(function (l) { if (S.xp >= l.xp && S.level < l.n) S.level = l.n; }); }
    else if (S.level === top.n - 1 && S.xp >= top.xp && LP.books.every(function (b) { return S.finals[b.id] && S.finals[b.id].passed; })) S.level = top.n;
    if (S.level > before.cur.n) ev.level = S.level;
    var after = levelInfo(LP, S);
    if (R.promotions && after.next && S.xp >= after.next.xp && (S0.xp < after.next.xp || ev.level)) ev.promo = after.next;
    ev.badges = learnBadges(LP, S, day, ctx);
    return { S: S, ev: ev };
  }

  // A sample record for the preview: halfway through, as in the design boards.
  function learnDemo(LP, kind, day, ctx) {
    var S = freshLearn();
    if (kind === 'fresh') return S;
    var ii = bookOf(LP, 'ii'), ib = bookOf(LP, 'ib');
    function pass(uid, ago, perfect) { S.units[uid] = { passed: day - ago * DAY, best: perfect ? LP.R.checkSize : LP.R.checkSize - 1, tries: 1, lastDay: day - ago * DAY, perfect: perfect ? day - ago * DAY : 0 }; }
    if (ii) ii.units.slice(0, 12).forEach(function (u, i) { pass(u.id, 40 - i * 3, u.id === 'ii-8'); });
    if (ib) { ib.units.slice(0, 2).forEach(function (u, i) { pass(u.id, 20 - i * 6, i === 0); }); if (ib.units[2]) S.units[ib.units[2].id] = { read: [0, 1] }; }
    S.xp = kind === 'promo' ? 3010 : 2140; S.level = 4; S.promos = { 2: { passed: day - 36 * DAY, best: 9, tries: 1 }, 3: { passed: day - 24 * DAY, best: 8, tries: 1 }, 4: { passed: day - 9 * DAY, best: 9, tries: 1 } };
    S.streak = { n: 6, last: day - DAY, best: 7 }; S.flags = { t3: day - 8 * DAY };
    var some = Object.keys(LP.byId).filter(function (id) { return LP.byId[id].tier <= 2; }).slice(2, 5);
    some.forEach(function (id) { S.review[id] = { box: 0, due: day }; });
    learnBadges(LP, S, day - 2 * DAY, ctx);
    return S;
  }

  function progressText(LP, LM, m) {
    var lines = ['The Rand Society · ' + LP.title + (LP.term ? ', ' + LP.term : ''), m.role + ' · Level ' + LM.lv.cur.n + ', ' + LM.lv.cur.name + ' · ' + num(LM.xp) + ' XP'];
    LM.books.forEach(function (x) { lines.push(x.b.title + ': ' + x.passed + ' of ' + x.total + ' passed' + (x.final.passed ? ', final passed' : '')); });
    lines.push('Badges: ' + LM.earned + ' of ' + LM.badges.length + (LM.streak ? ' · ' + LM.streak + ' ' + plural(LM.streak, 'day') + ' running' : ''));
    return plain(lines.join('\n'));
  }
  function backupCode(id, S) {
    try { return 'TRS1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ id: id, s: S })))); } catch (e) { return ''; }
  }
  function readBackup(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (t.indexOf('TRS1.') !== 0) return null;
    try { var o = JSON.parse(decodeURIComponent(escape(atob(t.slice(5))))); return o && o.id && o.s && o.s.v === 1 && typeof o.s.xp === 'number' ? o : null; } catch (e) { return null; }
  }

  // ---------- learn: pieces ----------
  // ---------- Learn skin: "coast" ----------
  // Learn breaks from the Society palette on purpose: an original 1980s Miami-coast look. A sunset over an Art Deco
  // shoreline on the Learn page, neon night inside a check, a sunrise when a member passes. Everything hangs off the SKIN
  // class, so another skin (or none: SKIN = '') slots in through app.css; the certificate keeps the Society look.
  var SKIN = 'coast';
  var COAST = {
    defs: "<defs><linearGradient id=\"cx-sunfill\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#FFE45C\"/><stop offset=\".5\" stop-color=\"#FF9A3D\"/><stop offset=\"1\" stop-color=\"#FF3E8A\"/></linearGradient><linearGradient id=\"cx-rim\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#FFE45C\"/><stop offset=\".5\" stop-color=\"#FF8A3D\"/><stop offset=\"1\" stop-color=\"#FF3E8A\"/></linearGradient><linearGradient id=\"cx-night\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#43188F\"/><stop offset=\"1\" stop-color=\"#160A38\"/></linearGradient><linearGradient id=\"cx-teal\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#5FF5EF\"/><stop offset=\"1\" stop-color=\"#0E8A8F\"/></linearGradient><linearGradient id=\"cx-sunset\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#E0267A\"/><stop offset=\"1\" stop-color=\"#E2541B\"/></linearGradient><linearGradient id=\"cx-arc\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#FF3E8A\"/><stop offset=\"1\" stop-color=\"#FF8A3D\"/></linearGradient><linearGradient id=\"cx-gold\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#FFF3B0\"/><stop offset=\"1\" stop-color=\"#FFC23D\"/></linearGradient><mask id=\"cx-sunmask\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"200\" height=\"112\"><rect width=\"200\" height=\"112\" fill=\"#fff\"/><g fill=\"#000\"><rect y=\"56\" width=\"200\" height=\"2\"/><rect y=\"66\" width=\"200\" height=\"3\"/><rect y=\"77\" width=\"200\" height=\"4\"/><rect y=\"89\" width=\"200\" height=\"5\"/><rect y=\"102\" width=\"200\" height=\"6\"/></g></mask><mask id=\"cx-sunmask2\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"200\" height=\"200\"><rect width=\"200\" height=\"200\" fill=\"#fff\"/><g fill=\"#000\"><rect y=\"112\" width=\"200\" height=\"3\"/><rect y=\"126\" width=\"200\" height=\"4\"/><rect y=\"141\" width=\"200\" height=\"5\"/><rect y=\"157\" width=\"200\" height=\"6\"/><rect y=\"174\" width=\"200\" height=\"7\"/></g></mask><symbol id=\"cx-sun\" viewBox=\"0 0 200 112\"><circle cx=\"100\" cy=\"100\" r=\"96\" fill=\"url(#cx-sunfill)\" mask=\"url(#cx-sunmask)\"/></symbol><symbol id=\"cx-sunfull\" viewBox=\"0 0 200 200\"><circle cx=\"100\" cy=\"100\" r=\"96\" fill=\"url(#cx-sunfill)\" mask=\"url(#cx-sunmask2)\"/></symbol><symbol id=\"cx-palm\" viewBox=\"0 0 200 400\"><path d=\"M86 400C84 330 88 230 98 150C102 118 106 96 108 80L118 82C115 100 112 122 109 154C101 232 100 330 104 400ZM111.1 78.4L103.9 75.9L97 73.9L90.1 72.6L83.4 71.9L76.9 71.8L70.5 72.4L64.2 73.5L58 75.3L52 77.6L46.1 80.7L40.3 84.3L34.6 88.6L29.1 93.6L23.7 99.2L18.4 105.4L13.3 112.3L12.6 111.9L17.6 104.8L22.7 98.3L27.9 92.4L33.4 87.2L39 82.6L44.8 78.6L50.8 75.2L57 72.4L63.4 70.3L70 68.8L76.7 68L83.6 67.8L90.7 68.3L97.9 69.4L105.4 71.2L112.9 73.6ZM100.1 72.2Q97 71.2 91.8 66.6Q98.2 71.6 107.1 74.2ZM107.1 74.2Q99.1 77.5 94.5 83.2Q98 77.2 100.1 72.2ZM92.1 70.6Q84.8 68.5 75.2 63Q85.9 68.7 98.8 71.9ZM98.8 71.9Q88.6 79.1 81.8 88.3Q87.4 78.8 92.1 70.6ZM84.2 69.8Q73.2 67.8 59.8 62.6Q74.4 67.9 90.7 70.4ZM90.7 70.4Q79.2 81.1 71.1 93.6Q78 81 84.2 69.8ZM76.6 69.9Q62.8 68.9 46.4 65Q64 68.9 82.7 69.8ZM82.7 69.8Q71 83.5 62.4 98.7Q69.8 83.5 76.6 69.9ZM69.2 70.7Q53.8 71.3 35.5 69.3Q55 71.2 74.9 70ZM74.9 70Q63.7 85.9 55.7 103Q62.5 86 69.2 70.7ZM62.1 72.3Q46.2 74.7 27.4 74.8Q47.3 74.5 67.3 71.1ZM67.3 71.1Q57.4 88.2 50.4 106.3Q56.2 88.4 62.1 72.3ZM55.2 74.7Q39.9 78.7 21.7 80.6Q41 78.3 59.9 73ZM59.9 73Q51.6 90.3 46.2 108.5Q50.4 90.7 55.2 74.7ZM48.5 77.9Q34.8 83 18.2 86.2Q35.9 82.4 52.6 75.8ZM52.6 75.8Q46.1 92.3 42.4 109.5Q45 92.8 48.5 77.9ZM42 81.8Q30.6 87.4 16.3 91.3Q31.6 86.7 45.6 79.5ZM45.6 79.5Q40.7 94.2 38.6 109.6Q39.7 94.9 42 81.8ZM35.7 86.5Q27 91.9 15.5 95.8Q27.9 91.1 38.8 84.1ZM38.8 84.1Q35.3 96.4 34.5 109.3Q34.4 97.1 35.7 86.5ZM29.6 92Q23.7 96.6 15.1 99.8Q24.6 95.7 32.1 89.5ZM32.1 89.5Q29.7 98.9 29.9 108.9Q28.9 99.7 29.6 92ZM23.6 98.2Q20.5 101.6 14.7 103.6Q21.3 100.7 25.7 95.9ZM25.7 95.9Q24 102.1 24.7 109Q23.2 103 23.6 98.2ZM17.9 105.2Q17.2 107.1 14 107.7Q18 106.2 19.6 103.1ZM19.6 103.1Q18.1 106.2 19 110.1Q17.4 107.2 17.9 105.2ZM110.2 77.9L104.7 72.5L99.3 67.6L94.1 63.3L88.9 59.5L83.9 56.3L79.1 53.6L74.3 51.3L69.6 49.6L65.1 48.5L60.7 47.8L56.4 47.7L52.1 48L48 48.9L43.9 50.4L39.9 52.4L36 54.9L35.5 54.2L39.3 51.4L43.3 49.2L47.5 47.4L51.8 46.2L56.2 45.5L60.8 45.4L65.6 45.8L70.5 46.8L75.5 48.3L80.6 50.4L85.8 53L91.2 56.1L96.7 59.8L102.3 64.1L108 68.8L113.8 74.1ZM102.8 67.5Q102.6 64.1 102.5 57.6Q103.5 64.9 108.2 72.3ZM108.2 72.3Q100.1 72.5 94.4 76.1Q99.2 71.7 102.8 67.5ZM96.6 62.4Q94.3 55.5 92.3 45.4Q95.3 56.2 101.9 66.7ZM101.9 66.7Q90.7 69.3 81.8 75.2Q89.7 68.6 96.6 62.4ZM90.4 58Q85.7 48.7 81 36.2Q86.7 49.4 95.7 61.8ZM95.7 61.8Q82.1 66.8 70.9 74.7Q81.2 66.1 90.4 58ZM84.5 54.3Q76.9 44 69.3 30.3Q78 44.6 89.7 57.5ZM89.7 57.5Q74.7 64.7 62 74.6Q73.7 64.1 84.5 54.3ZM78.7 51.4Q68.5 41.3 58 27.9Q69.6 41.8 83.8 54ZM83.8 54Q68.4 63 55.2 74.5Q67.3 62.4 78.7 51.4ZM73.1 49.1Q60.9 40.6 48.2 28.7Q62.1 41 78.1 51.1ZM78.1 51.1Q63.1 61.5 50.4 74.1Q62 61 73.1 49.1ZM67.6 47.5Q54.5 41.3 40.4 31.8Q55.7 41.7 72.5 48.9ZM72.5 48.9Q58.7 60.1 47.4 73.3Q57.6 59.8 67.6 47.5ZM62.4 46.7Q49.4 43.1 35.2 36.4Q50.6 43.3 67 47.4ZM67 47.4Q55.2 58.7 45.7 71.9Q54 58.5 62.4 46.7ZM57.3 46.5Q45.7 45.4 32.5 41.4Q46.9 45.5 61.6 46.6ZM61.6 46.6Q52.1 57.3 44.8 69.7Q50.9 57.3 57.3 46.5ZM52.5 47Q43.1 47.8 31.9 45.9Q44.3 47.7 56.3 46.5ZM56.3 46.5Q49.1 56 44.1 66.8Q47.9 56.1 52.5 47ZM47.8 48.1Q41.2 50 32.5 49.4Q42.3 49.7 51.2 47.2ZM51.2 47.2Q46.1 54.7 43.2 63.5Q45 55 47.8 48.1ZM43.3 49.9Q39.6 52 33.7 51.8Q40.7 51.5 46.2 48.6ZM46.2 48.6Q42.8 53.8 41.6 60.1Q41.7 54.3 43.3 49.9ZM39 52.3Q38 53.9 34.7 53.5Q39 53.3 41.4 50.9ZM41.4 50.9Q39.2 53.5 39 57.2Q38.1 54.1 39 52.3ZM109.6 76.9L107.3 70.7L105 65L102.8 59.6L100.7 54.6L98.6 50.1L96.6 45.9L94.6 42.2L92.7 38.8L90.8 35.9L89 33.4L87.2 31.3L85.5 29.6L83.9 28.3L82.3 27.3L80.7 26.8L79.2 26.6L79.1 25.8L80.9 25.7L82.8 26.1L84.7 26.9L86.7 28.1L88.8 29.7L90.9 31.8L93 34.3L95.2 37.2L97.4 40.5L99.7 44.2L102 48.3L104.4 52.9L106.8 57.8L109.3 63.1L111.8 68.9L114.4 75.1ZM107.9 65.6Q111.6 64 116.2 60.9Q112 65.1 110.6 72.3ZM110.6 72.3Q104.2 69.3 98.7 70.3Q103.7 68.1 107.9 65.6ZM105.1 59.3Q110.5 55.1 116.9 49.6Q111 56.2 107.9 65.6ZM107.9 65.6Q98.6 63.3 90.2 64.8Q98.1 62.2 105.1 59.3ZM102.5 53.6Q108.9 47.1 116.5 39.4Q109.4 48.2 105.2 59.5ZM105.2 59.5Q93.6 57.9 82.9 60Q93.1 56.8 102.5 53.6ZM99.9 48.3Q106.8 39.9 114.8 30.4Q107.3 41 102.6 53.8ZM102.6 53.8Q89.4 53 77 55.8Q88.8 52 99.9 48.3ZM97.4 43.7Q104 33.8 112 22.9Q104.6 34.8 100.1 48.7ZM100.1 48.7Q85.9 48.7 72.6 52.1Q85.4 47.7 97.4 43.7ZM94.9 39.5Q100.7 28.7 107.8 16.9Q101.3 29.8 97.7 44.1ZM97.7 44.1Q83.3 44.9 69.8 48.8Q82.7 43.9 94.9 39.5ZM92.5 35.9Q96.8 24.9 102.5 12.7Q97.5 25.9 95.3 40.1ZM95.3 40.1Q81.4 41.5 68.4 45.9Q80.7 40.5 92.5 35.9ZM90.2 32.9Q92.5 22.3 96.3 10.4Q93.2 23.2 93 36.6ZM93 36.6Q80.2 38.5 68.4 43.2Q79.5 37.6 90.2 32.9ZM88 30.4Q88 21 89.7 10.1Q88.8 21.9 90.8 33.6ZM90.8 33.6Q79.6 35.9 69.4 40.8Q78.8 35 88 30.4ZM85.7 28.4Q83.8 21.2 83.3 12.1Q84.6 22 88.6 31ZM88.6 31Q79.4 33.6 71.3 38.4Q78.5 32.7 85.7 28.4ZM83.6 27.1Q80.4 22.7 78.3 15.9Q81.4 23.4 86.5 29ZM86.5 29Q79.5 31.4 73.6 36Q78.5 30.8 83.6 27.1ZM81.6 26.3Q78.4 24.9 75.8 20.6Q79.5 25.3 84.5 27.5ZM84.5 27.5Q79.6 29.5 75.9 33.3Q78.5 29 81.6 26.3ZM79.7 26Q78 26.7 76.1 24.3Q79.2 26.9 82.4 26.5ZM82.4 26.5Q79.4 27.7 77.7 30.5Q78.2 27.4 79.7 26ZM109.4 76L109.5 70.4L109.7 65L109.8 60L110 55.4L110.1 51L110.2 46.9L110.4 43.2L110.5 39.8L110.6 36.7L110.8 33.9L110.9 31.5L111 29.4L111.2 27.5L111.3 26L111.5 24.9L111.6 24L112.4 24L112.5 24.9L112.7 26L112.8 27.5L113 29.4L113.1 31.5L113.2 33.9L113.4 36.7L113.5 39.8L113.6 43.2L113.8 46.9L113.9 51L114 55.4L114.2 60L114.3 65L114.5 70.4L114.6 76ZM112 66Q116 66.9 120.8 67Q116 68.1 112 73.2ZM112 73.2Q108 68.1 103.2 67Q108 66.9 112 66ZM112 60.1Q118.1 60.2 125.1 59.8Q118.1 61.4 112 67ZM112 67Q105.9 61.4 98.9 59.8Q105.9 60.2 112 60.1ZM112 54.7Q119.9 54.1 128.6 53.2Q119.9 55.3 112 61.2ZM112 61.2Q104.1 55.3 95.4 53.2Q104.1 54.1 112 54.7ZM112 49.8Q121.2 48.6 131.2 47.3Q121.2 49.8 112 55.9ZM112 55.9Q102.8 49.8 92.8 47.3Q102.8 48.6 112 49.8ZM112 45.2Q122 43.6 132.7 42.1Q122 44.8 112 50.9ZM112 50.9Q102 44.8 91.3 42.1Q102 43.6 112 45.2ZM112 41Q122.2 39.2 133.2 37.6Q122.2 40.4 112 46.4ZM112 46.4Q101.8 40.4 90.8 37.6Q101.8 39.2 112 41ZM112 37.3Q121.9 35.4 132.7 33.8Q121.9 36.6 112 42.3ZM112 42.3Q102.1 36.6 91.3 33.8Q102.1 35.4 112 37.3ZM112 34Q121.2 32.1 131.2 30.7Q121.2 33.3 112 38.6ZM112 38.6Q102.8 33.3 92.8 30.7Q102.8 32.1 112 34ZM112 31.1Q120.1 29.3 129 28.3Q120.1 30.5 112 35.3ZM112 35.3Q103.9 30.5 95 28.3Q103.9 29.3 112 31.1ZM112 28.6Q118.7 27 126.3 26.4Q118.7 28.2 112 32.5ZM112 32.5Q105.3 28.2 97.7 26.4Q105.3 27 112 28.6ZM112 26.5Q117.2 25.2 123.2 25Q117.2 26.4 112 30ZM112 30Q106.8 26.4 100.8 25Q106.8 25.2 112 26.5ZM112 24.9Q115.6 23.8 120 24.1Q115.6 25 112 28ZM112 28Q108.4 25 104 24.1Q108.4 23.8 112 24.9ZM112 23.6Q114 22.9 116.8 23.6Q114 24.1 112 26.4ZM112 26.4Q110 24.1 107.2 23.6Q110 22.9 112 23.6ZM109.6 75.1L112.2 68.9L114.7 63.1L117.2 57.8L119.6 52.9L122 48.3L124.3 44.2L126.6 40.5L128.8 37.2L131 34.3L133.1 31.8L135.2 29.7L137.3 28.1L139.3 26.9L141.2 26.1L143.1 25.7L144.9 25.8L144.8 26.6L143.3 26.8L141.7 27.3L140.1 28.3L138.5 29.6L136.8 31.3L135 33.4L133.2 35.9L131.3 38.8L129.4 42.2L127.4 45.9L125.4 50.1L123.3 54.6L121.2 59.6L119 65L116.7 70.7L114.4 76.9ZM116.1 65.6Q120.3 68.1 125.3 70.3Q119.8 69.3 113.4 72.3ZM113.4 72.3Q112 65.1 107.8 60.9Q112.4 64 116.1 65.6ZM118.9 59.3Q125.9 62.2 133.8 64.8Q125.4 63.3 116.1 65.6ZM116.1 65.6Q113 56.2 107.1 49.6Q113.5 55.1 118.9 59.3ZM121.5 53.6Q130.9 56.8 141.1 60Q130.4 57.9 118.8 59.5ZM118.8 59.5Q114.6 48.2 107.5 39.4Q115.1 47.1 121.5 53.6ZM124.1 48.3Q135.2 52 147 55.8Q134.6 53 121.4 53.8ZM121.4 53.8Q116.7 41 109.2 30.4Q117.2 39.9 124.1 48.3ZM126.6 43.7Q138.6 47.7 151.4 52.1Q138.1 48.7 123.9 48.7ZM123.9 48.7Q119.4 34.8 112 22.9Q120 33.8 126.6 43.7ZM129.1 39.5Q141.3 43.9 154.2 48.8Q140.7 44.9 126.3 44.1ZM126.3 44.1Q122.7 29.8 116.2 16.9Q123.3 28.7 129.1 39.5ZM131.5 35.9Q143.3 40.5 155.6 45.9Q142.6 41.5 128.7 40.1ZM128.7 40.1Q126.5 25.9 121.5 12.7Q127.2 24.9 131.5 35.9ZM133.8 32.9Q144.5 37.6 155.6 43.2Q143.8 38.5 131 36.6ZM131 36.6Q130.8 23.2 127.7 10.4Q131.5 22.3 133.8 32.9ZM136 30.4Q145.2 35 154.6 40.8Q144.4 35.9 133.2 33.6ZM133.2 33.6Q135.2 21.9 134.3 10.1Q136 21 136 30.4ZM138.3 28.4Q145.5 32.7 152.7 38.4Q144.6 33.6 135.4 31ZM135.4 31Q139.4 22 140.7 12.1Q140.2 21.2 138.3 28.4ZM140.4 27.1Q145.5 30.8 150.4 36Q144.5 31.4 137.5 29ZM137.5 29Q142.6 23.4 145.7 15.9Q143.6 22.7 140.4 27.1ZM142.4 26.3Q145.5 29 148.1 33.3Q144.4 29.5 139.5 27.5ZM139.5 27.5Q144.5 25.3 148.2 20.6Q145.6 24.9 142.4 26.3ZM144.3 26Q145.8 27.4 146.3 30.5Q144.6 27.7 141.6 26.5ZM141.6 26.5Q144.8 26.9 147.9 24.3Q146 26.7 144.3 26ZM110.2 74.1L116.1 68.7L122 63.9L127.7 59.6L133.3 55.8L138.7 52.6L144.1 49.9L149.3 47.7L154.4 46.1L159.4 45.1L164.3 44.6L169 44.7L173.5 45.3L177.9 46.5L182.2 48.1L186.2 50.4L190.2 53.1L189.7 53.8L185.7 51.3L181.6 49.4L177.5 48L173.2 47.2L168.9 46.9L164.4 47.1L159.9 47.8L155.3 49L150.5 50.8L145.7 53.1L140.7 55.9L135.5 59.2L130.3 63.1L124.9 67.5L119.4 72.4L113.8 77.9ZM121.3 67.4Q125 71.7 129.9 76.1Q124.1 72.5 115.9 72.2ZM115.9 72.2Q120.7 64.7 121.7 57.3Q121.6 63.9 121.3 67.4ZM127.7 62.2Q134.7 68.5 142.8 75.2Q133.8 69.2 122.4 66.5ZM122.4 66.5Q129.1 55.9 132.2 44.9Q130 55.2 127.7 62.2ZM134 57.8Q143.4 65.9 153.9 74.7Q142.5 66.6 128.7 61.5ZM128.7 61.5Q137.9 48.9 143.7 35.4Q138.9 48.2 134 57.8ZM140.1 54Q151.1 63.9 163 74.6Q150.1 64.5 134.8 57.2ZM134.8 57.2Q146.7 44 155.6 29.4Q147.7 43.3 140.1 54ZM146 50.9Q157.7 62.2 170 74.4Q156.6 62.7 140.9 53.5ZM140.9 53.5Q155.2 41.1 167 26.9Q156.3 40.6 146 50.9ZM151.7 48.5Q163.1 60.7 174.9 74Q162 61.1 146.7 50.6ZM146.7 50.6Q162.9 40.1 177 27.5Q164 39.7 151.7 48.5ZM157.3 46.9Q167.6 59.3 178.1 73.1Q166.4 59.7 152.5 48.3ZM152.5 48.3Q169.5 40.7 184.9 30.6Q170.6 40.4 157.3 46.9ZM162.6 45.9Q171.3 58 179.9 71.5Q170.1 58.2 158.1 46.7ZM158.1 46.7Q174.6 42.3 190.2 35.1Q175.8 42.1 162.6 45.9ZM167.8 45.7Q174.5 56.7 180.9 69.2Q173.3 56.7 163.5 45.9ZM163.5 45.9Q178.5 44.4 193 40.1Q179.7 44.4 167.8 45.7ZM172.8 46.1Q177.5 55.4 181.5 66.2Q176.3 55.2 168.9 45.7ZM168.9 45.7Q181.2 46.6 193.8 44.6Q182.4 46.7 172.8 46.1ZM177.6 47.1Q180.5 54.2 182.5 62.8Q179.4 53.9 174.1 46.3ZM174.1 46.3Q183.2 48.7 193.1 48.2Q184.4 48.9 177.6 47.1ZM182.2 48.8Q183.8 53.3 184.1 59.3Q182.7 52.9 179.2 47.7ZM179.2 47.7Q184.9 50.5 191.9 50.7Q186 50.9 182.2 48.8ZM186.6 51.2Q187.5 53 186.6 56.2Q186.4 52.4 184.2 49.8ZM184.2 49.8Q186.6 52.3 190.9 52.4Q187.7 52.9 186.6 51.2ZM111.1 73.6L119 71.1L126.7 69.3L134.2 68.2L141.5 67.8L148.7 68L155.7 68.9L162.5 70.4L169.2 72.6L175.6 75.5L181.8 79L187.9 83.1L193.7 87.9L199.4 93.3L204.9 99.3L210.2 106L215.3 113.3L214.7 113.8L209.3 106.7L203.9 100.2L198.2 94.4L192.5 89.3L186.6 84.9L180.6 81.1L174.4 77.9L168.1 75.4L161.7 73.6L155.2 72.4L148.5 71.8L141.7 71.9L134.7 72.6L127.6 73.9L120.3 75.9L112.9 78.4ZM124.2 72.2Q126.5 77.3 130 83.5Q125.3 77.7 117.2 74.2ZM117.2 74.2Q126.4 71.5 132.9 66.5Q127.5 71.2 124.2 72.2ZM132.6 70.6Q137.4 79.1 143.3 88.9Q136.2 79.3 125.9 71.8ZM125.9 71.8Q139.1 68.6 150.2 62.9Q140.3 68.4 132.6 70.6ZM140.8 69.8Q147.2 81.4 154.4 94.5Q146 81.5 134.3 70.4ZM134.3 70.4Q151.1 67.9 166.2 62.5Q152.2 67.8 140.8 69.8ZM148.7 69.9Q155.8 84 163.4 99.7Q154.6 84 142.6 69.7ZM142.6 69.7Q161.9 68.9 180.1 65Q163.1 68.9 148.7 69.9ZM156.4 70.7Q163.3 86.6 170.4 104.3Q162.1 86.5 150.7 70ZM150.7 70Q171.3 71.3 191.4 69.4Q172.5 71.4 156.4 70.7ZM163.8 72.4Q169.9 89.2 175.9 107.7Q168.8 88.9 158.6 71.1ZM158.6 71.1Q179.2 74.6 199.9 75.1Q180.4 74.9 163.8 72.4ZM171 74.9Q175.9 91.5 180.4 109.9Q174.8 91.1 166.3 73.2ZM166.3 73.2Q185.8 78.6 205.7 81.1Q186.9 79 171 74.9ZM178 78.2Q181.6 93.7 184.4 111Q180.5 93.2 173.8 76.1ZM173.8 76.1Q191.1 82.9 209.4 86.8Q192.2 83.4 178 78.2ZM184.7 82.2Q187.1 95.8 188.3 111.1Q186.1 95.2 181.1 80ZM181.1 80Q195.6 87.3 211.4 92.1Q196.6 88 184.7 82.2ZM191.3 87.1Q192.7 98.1 192.6 110.7Q191.7 97.4 188.2 84.7ZM188.2 84.7Q199.4 91.9 212.3 96.7Q200.4 92.6 191.3 87.1ZM197.7 92.7Q198.4 100.8 197.5 110.3Q197.5 100 195.1 90.3ZM195.1 90.3Q202.9 96.6 212.7 100.8Q203.8 97.5 197.7 92.7ZM203.9 99.2Q204.3 104.2 202.9 110.3Q203.5 103.3 201.7 96.9ZM201.7 96.9Q206.3 101.7 213.1 104.7Q207.1 102.6 203.9 99.2ZM209.9 106.4Q210.4 108.4 208.7 111.3Q209.6 107.5 208.1 104.3ZM208.1 104.3Q209.8 107.4 213.8 108.9Q210.5 108.3 209.9 106.4ZM112.4 78.6L107.3 79.7L102.1 81.4L97.1 83.9L92 87.1L87.1 91L82.2 95.7L77.4 101L72.7 107.1L68.1 114L63.6 121.5L59.1 129.8L54.8 138.8L50.6 148.5L46.5 159L42.6 170.2L38.7 182.1L37.9 181.8L41.5 169.8L45.3 158.5L49.1 147.9L53.1 138.1L57.2 128.9L61.4 120.3L65.8 112.5L70.2 105.4L74.8 99L79.6 93.2L84.5 88.2L89.6 83.8L94.8 80.1L100.2 77.2L105.8 74.9L111.6 73.4ZM102.3 78.7Q100.2 79.9 94.1 79.4Q101.3 79.6 109.2 76.4ZM109.2 76.4Q103.5 82.2 101.8 88.7Q102.4 82.6 102.3 78.7ZM96.6 81.5Q91.1 84 81.8 85.1Q92.2 83.5 102.7 78.5ZM102.7 78.5Q97 88.2 95.1 98.1Q95.9 88.7 96.6 81.5ZM91 85.2Q83.1 89.3 71.3 92.5Q84.1 88.7 96.4 81.6ZM96.4 81.6Q91.3 94.4 89.7 107.3Q90.3 95.1 91 85.2ZM85.6 89.7Q76 95.5 62.8 100.7Q77 94.8 90.3 85.8ZM90.3 85.8Q86.1 100.9 85.4 115.9Q85.2 101.7 85.6 89.7ZM80.3 95Q70 102.3 56.2 109.1Q70.9 101.5 84.3 90.9ZM84.3 90.9Q81.2 107.4 81.5 123.7Q80.4 108.3 80.3 95ZM75.1 101.2Q64.9 109.5 51.2 117.4Q65.6 108.6 78.5 97.1ZM78.5 97.1Q76.6 114 77.8 130.6Q75.8 114.9 75.1 101.2ZM70 108.3Q60.4 117 47.6 125.4Q61.1 116 72.9 104.2ZM72.9 104.2Q71.9 120.7 73.9 136.8Q71.2 121.6 70 108.3ZM65.1 116.3Q56.6 124.8 45 133Q57.2 123.8 67.5 112.3ZM67.5 112.3Q67.1 127.5 69.8 142.4Q66.5 128.5 65.1 116.3ZM60.2 125.1Q53.3 132.9 43.2 140.4Q53.8 131.9 62.2 121.4ZM62.2 121.4Q62.3 134.7 65.2 147.8Q61.7 135.8 60.2 125.1ZM55.5 134.9Q50.2 141.5 42 147.8Q50.8 140.4 57.2 131.4ZM57.2 131.4Q57.3 142.4 60.3 153.3Q56.8 143.5 55.5 134.9ZM50.9 145.6Q47.4 150.7 41 155.5Q47.9 149.6 52.3 142.3ZM52.3 142.3Q52.3 150.8 55 159.2Q51.9 151.9 50.9 145.6ZM46.5 157.2Q44.7 160.6 40.1 163.6Q45.1 159.5 47.6 154.2ZM47.6 154.2Q47.3 160 49.6 165.9Q46.8 161.2 46.5 157.2ZM42.1 169.7Q42 171.5 39 172.6Q42.3 170.3 43 167ZM43 167Q42.3 170.3 44.1 173.7Q41.9 171.4 42.1 169.7ZM112.5 73.4L118.3 75L124 77.3L129.6 80.3L134.9 83.9L140.1 88.3L145.1 93.3L150 99L154.7 105.4L159.3 112.4L163.8 120.1L168.1 128.5L172.3 137.6L176.4 147.4L180.3 157.8L184.2 168.9L187.9 180.7L187.1 180.9L183.2 169.3L179.1 158.3L174.9 148L170.6 138.4L166.2 129.5L161.7 121.3L157 113.9L152.3 107.1L147.5 101.1L142.6 95.8L137.6 91.1L132.5 87.2L127.4 84L122.1 81.5L116.9 79.7L111.5 78.6ZM121.8 78.7Q121.8 82.8 122.4 88.9Q120.7 82.4 115 76.5ZM115 76.5Q122.9 79.7 130.2 79.5Q124.1 80 121.8 78.7ZM127.7 81.6Q128.5 88.9 129.4 98.5Q127.4 88.4 121.5 78.6ZM121.5 78.6Q132.3 83.6 142.9 85.2Q133.4 84.1 127.7 81.6ZM133.4 85.3Q134.3 95.5 134.9 107.9Q133.3 94.8 128 81.8ZM128 81.8Q140.6 88.8 153.7 92.6Q141.7 89.5 133.4 85.3ZM139 89.8Q139.6 102.1 139.5 116.6Q138.6 101.3 134.3 85.9ZM134.3 85.9Q148 94.9 162.5 100.8Q148.9 95.7 139 89.8ZM144.5 95.1Q144.5 108.7 143.5 124.4Q143.6 107.9 140.4 91.1ZM140.4 91.1Q154.2 101.6 169.3 109.2Q155.1 102.4 144.5 95.1ZM149.8 101.3Q149.2 115.3 147.4 131.3Q148.4 114.4 146.3 97.2ZM146.3 97.2Q159.6 108.7 174.5 117.5Q160.4 109.6 149.8 101.3ZM155 108.3Q153.9 121.9 151.3 137.4Q153.2 121 152.1 104.2ZM152.1 104.2Q164.2 116.1 178.2 125.5Q164.9 117 155 108.3ZM160.1 116.2Q158.7 128.7 155.6 142.9Q158.1 127.7 157.6 112.2ZM157.6 112.2Q168.2 123.7 180.8 133Q168.8 124.8 160.1 116.2ZM165 124.9Q163.6 135.8 160.2 148.1Q163 134.8 163 121.2ZM163 121.2Q171.7 131.7 182.6 140.4Q172.3 132.8 165 124.9ZM169.9 134.5Q168.6 143.3 165.2 153.4Q168.1 142.3 168.2 131ZM168.2 131Q174.8 140.2 183.8 147.6Q175.3 141.3 169.9 134.5ZM174.6 145.1Q173.7 151.5 170.5 159Q173.2 150.4 173.2 141.8ZM173.2 141.8Q177.7 149.2 184.8 155Q178.2 150.3 174.6 145.1ZM179.1 156.5Q178.8 160.5 176.1 165.4Q178.3 159.4 178 153.5ZM178 153.5Q180.6 158.9 185.7 163Q181 160 179.1 156.5ZM183.6 168.8Q183.8 170.6 181.7 172.9Q183.4 169.4 182.7 166.1ZM182.7 166.1Q183.4 169.4 186.7 171.7Q183.8 170.6 183.6 168.8Z\"/></symbol><symbol id=\"cx-city\" viewBox=\"0 0 1200 70\" preserveAspectRatio=\"xMidYMax slice\"><path d=\"M0 70V52A26 26 0 0 1 53 52V70Z M57 70V60A25 25 0 0 1 107 60V70Z M111 70V46H120V40H129V34H149V40H158V46H167V70Z M169 70V64A26 26 0 0 1 222 64V70Z M227 70V30H246V14H252V30H271V70Z M272 70V34H283L287 16L291 34H302V70Z M302 70V28H311L315 10L319 28H329V70Z M329 70V41H349V25H355V41H375V70Z M375 70V57H405V70Z M406 70V36H415V30H424V24H443V30H452V36H461V70Z M462 70V30H470V24H478V18H494V24H502V30H510V70Z M511 70V33H528V17H534V33H552V70Z M553 70V58H595V70Z M600 70V57H665V70Z M670 70V63A25 25 0 0 1 721 63V70Z M724 70V45H731V39H738V33H753V39H760V45H767V70Z M771 70V51H840V70Z M840 70V39H857V23H863V39H880V70Z M885 70V40H892V34H899V28H913V34H920V40H927V70Z M928 70V20H937L941 2L945 20H954V70Z M954 70V54A23 23 0 0 1 1001 54V70Z M1003 70V42H1033V70Z M1036 70V48H1044V42H1052V36H1073V42H1081V48H1089V70Z M1094 70V53H1161V70Z M1164 70V64A26 26 0 0 1 1217 64V70Z\"/></symbol></defs>",
    scene: "<div class=\"cs-sky\"></div><div class=\"cs-stars\"><i style=\"left:64%;top:17%\"></i><i style=\"left:79%;top:42%\"></i><i style=\"left:86%;top:7%\"></i><i style=\"left:60%;top:34%\"></i><i style=\"left:54%;top:43%\"></i><i style=\"left:84%;top:14%\"></i><i style=\"left:92%;top:31%\"></i><i style=\"left:67%;top:30%\"></i><i style=\"left:97%;top:16%\"></i><i style=\"left:96%;top:5%\"></i><i style=\"left:94%;top:18%\"></i></div><div class=\"cs-sunwrap\"><i class=\"cs-glow\"></i><svg class=\"cs-sun\" viewBox=\"0 0 200 112\"><use href=\"#cx-sun\"/></svg></div><svg class=\"cs-city\" viewBox=\"0 0 1200 70\" preserveAspectRatio=\"xMidYMax slice\"><use href=\"#cx-city\"/></svg><div class=\"cs-water\"><i class=\"cs-line\"></i><i></i><i></i><i></i><i></i></div><svg class=\"cs-palm p1\" viewBox=\"0 0 200 400\"><use href=\"#cx-palm\"/></svg><svg class=\"cs-palm p2\" viewBox=\"0 0 200 400\"><use href=\"#cx-palm\"/></svg><svg class=\"cs-palm p3\" viewBox=\"0 0 200 400\"><use href=\"#cx-palm\"/></svg>",
    night: "<div class=\"qz-glow\"></div><div class=\"qz-grid\"></div>",
    sunrise: "<div class=\"qz-rays\"></div><div class=\"qz-sunrise\"><i></i><svg viewBox=\"0 0 200 112\"><use href=\"#cx-sun\"/></svg></div><div class=\"qz-confetti\"><i style=\"--x:20%;--d:132ms;--c:#FF8A3D;--r:125deg;--dx:1px;--k:1.16\"></i><i style=\"--x:51%;--d:373ms;--c:#FF8A3D;--r:119deg;--dx:-57px;--k:0.72\"></i><i style=\"--x:96%;--d:300ms;--c:#A98BF0;--r:94deg;--dx:-45px;--k:0.98\"></i><i style=\"--x:84%;--d:7ms;--c:#22E4E0;--r:127deg;--dx:24px;--k:1.01\"></i><i style=\"--x:42%;--d:682ms;--c:#22E4E0;--r:41deg;--dx:48px;--k:1.08\"></i><i style=\"--x:9%;--d:256ms;--c:#FF8A3D;--r:139deg;--dx:-11px;--k:1.18\"></i><i style=\"--x:79%;--d:530ms;--c:#FF8A3D;--r:-150deg;--dx:-48px;--k:0.74\"></i><i style=\"--x:71%;--d:561ms;--c:#FFFFFF;--r:-158deg;--dx:-54px;--k:0.92\"></i><i style=\"--x:49%;--d:610ms;--c:#FF3E8A;--r:98deg;--dx:-19px;--k:0.76\"></i><i style=\"--x:7%;--d:430ms;--c:#FFFFFF;--r:54deg;--dx:14px;--k:0.74\"></i><i style=\"--x:47%;--d:98ms;--c:#FFFFFF;--r:-58deg;--dx:41px;--k:0.74\"></i><i style=\"--x:19%;--d:695ms;--c:#FFD23F;--r:-2deg;--dx:52px;--k:1.20\"></i><i style=\"--x:79%;--d:698ms;--c:#FFFFFF;--r:43deg;--dx:-16px;--k:0.99\"></i><i style=\"--x:79%;--d:399ms;--c:#FFFFFF;--r:-164deg;--dx:-55px;--k:0.78\"></i><i style=\"--x:3%;--d:535ms;--c:#FF3E8A;--r:137deg;--dx:60px;--k:1.15\"></i><i style=\"--x:62%;--d:34ms;--c:#A98BF0;--r:-87deg;--dx:44px;--k:1.04\"></i><i style=\"--x:90%;--d:19ms;--c:#22E4E0;--r:-156deg;--dx:-23px;--k:1.23\"></i><i style=\"--x:22%;--d:65ms;--c:#FFD23F;--r:-94deg;--dx:55px;--k:0.75\"></i><i style=\"--x:79%;--d:33ms;--c:#FF3E8A;--r:168deg;--dx:57px;--k:0.93\"></i><i style=\"--x:4%;--d:283ms;--c:#22E4E0;--r:-16deg;--dx:23px;--k:1.04\"></i><i style=\"--x:94%;--d:404ms;--c:#FF3E8A;--r:-129deg;--dx:-46px;--k:1.23\"></i><i style=\"--x:58%;--d:243ms;--c:#FFD23F;--r:-61deg;--dx:-42px;--k:1.16\"></i><i style=\"--x:66%;--d:395ms;--c:#22E4E0;--r:139deg;--dx:43px;--k:0.87\"></i><i style=\"--x:12%;--d:527ms;--c:#FFFFFF;--r:-147deg;--dx:33px;--k:0.78\"></i><i style=\"--x:90%;--d:45ms;--c:#FF3E8A;--r:-107deg;--dx:-10px;--k:0.83\"></i><i style=\"--x:10%;--d:205ms;--c:#FFD23F;--r:-15deg;--dx:-5px;--k:0.96\"></i><i style=\"--x:86%;--d:511ms;--c:#FF8A3D;--r:-177deg;--dx:7px;--k:1.20\"></i><i style=\"--x:93%;--d:102ms;--c:#FF3E8A;--r:-169deg;--dx:-33px;--k:0.82\"></i></div>",
    level: "<div class=\"qz-stars\"><i style=\"left:83%;top:13%\"></i><i style=\"left:20%;top:50%\"></i><i style=\"left:84%;top:6%\"></i><i style=\"left:20%;top:14%\"></i><i style=\"left:85%;top:37%\"></i><i style=\"left:4%;top:7%\"></i><i style=\"left:92%;top:35%\"></i><i style=\"left:20%;top:11%\"></i><i style=\"left:93%;top:51%\"></i><i style=\"left:9%;top:25%\"></i><i style=\"left:85%;top:18%\"></i><i style=\"left:4%;top:39%\"></i><i style=\"left:80%;top:23%\"></i><i style=\"left:11%;top:30%\"></i><i style=\"left:86%;top:47%\"></i><i style=\"left:19%;top:32%\"></i></div><div class=\"qz-rays lv\"></div><div class=\"qz-grid run\"></div><div class=\"qz-confetti\"><i style=\"--x:20%;--d:132ms;--c:#FF8A3D;--r:125deg;--dx:1px;--k:1.16\"></i><i style=\"--x:51%;--d:373ms;--c:#FF8A3D;--r:119deg;--dx:-57px;--k:0.72\"></i><i style=\"--x:96%;--d:300ms;--c:#A98BF0;--r:94deg;--dx:-45px;--k:0.98\"></i><i style=\"--x:84%;--d:7ms;--c:#22E4E0;--r:127deg;--dx:24px;--k:1.01\"></i><i style=\"--x:42%;--d:682ms;--c:#22E4E0;--r:41deg;--dx:48px;--k:1.08\"></i><i style=\"--x:9%;--d:256ms;--c:#FF8A3D;--r:139deg;--dx:-11px;--k:1.18\"></i><i style=\"--x:79%;--d:530ms;--c:#FF8A3D;--r:-150deg;--dx:-48px;--k:0.74\"></i><i style=\"--x:71%;--d:561ms;--c:#FFFFFF;--r:-158deg;--dx:-54px;--k:0.92\"></i><i style=\"--x:49%;--d:610ms;--c:#FF3E8A;--r:98deg;--dx:-19px;--k:0.76\"></i><i style=\"--x:7%;--d:430ms;--c:#FFFFFF;--r:54deg;--dx:14px;--k:0.74\"></i><i style=\"--x:47%;--d:98ms;--c:#FFFFFF;--r:-58deg;--dx:41px;--k:0.74\"></i><i style=\"--x:19%;--d:695ms;--c:#FFD23F;--r:-2deg;--dx:52px;--k:1.20\"></i><i style=\"--x:79%;--d:698ms;--c:#FFFFFF;--r:43deg;--dx:-16px;--k:0.99\"></i><i style=\"--x:79%;--d:399ms;--c:#FFFFFF;--r:-164deg;--dx:-55px;--k:0.78\"></i><i style=\"--x:3%;--d:535ms;--c:#FF3E8A;--r:137deg;--dx:60px;--k:1.15\"></i><i style=\"--x:62%;--d:34ms;--c:#A98BF0;--r:-87deg;--dx:44px;--k:1.04\"></i><i style=\"--x:90%;--d:19ms;--c:#22E4E0;--r:-156deg;--dx:-23px;--k:1.23\"></i><i style=\"--x:22%;--d:65ms;--c:#FFD23F;--r:-94deg;--dx:55px;--k:0.75\"></i><i style=\"--x:79%;--d:33ms;--c:#FF3E8A;--r:168deg;--dx:57px;--k:0.93\"></i><i style=\"--x:4%;--d:283ms;--c:#22E4E0;--r:-16deg;--dx:23px;--k:1.04\"></i><i style=\"--x:94%;--d:404ms;--c:#FF3E8A;--r:-129deg;--dx:-46px;--k:1.23\"></i><i style=\"--x:58%;--d:243ms;--c:#FFD23F;--r:-61deg;--dx:-42px;--k:1.16\"></i><i style=\"--x:66%;--d:395ms;--c:#22E4E0;--r:139deg;--dx:43px;--k:0.87\"></i><i style=\"--x:12%;--d:527ms;--c:#FFFFFF;--r:-147deg;--dx:33px;--k:0.78\"></i><i style=\"--x:90%;--d:45ms;--c:#FF3E8A;--r:-107deg;--dx:-10px;--k:0.83\"></i><i style=\"--x:10%;--d:205ms;--c:#FFD23F;--r:-15deg;--dx:-5px;--k:0.96\"></i><i style=\"--x:86%;--d:511ms;--c:#FF8A3D;--r:-177deg;--dx:7px;--k:1.20\"></i><i style=\"--x:93%;--d:102ms;--c:#FF3E8A;--r:-169deg;--dx:-33px;--k:0.82\"></i></div>"
  };
  // gradients and artwork shared by every scene, medal and ring (kept out of view, never display:none, so references resolve)
  function SkinDefs() {
    return SKIN ? html`<svg class="skin-defs" width="0" height="0" aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: COAST.defs }}></svg>` : null;
  }
  function Scene(p) {
    return html`<div class=${'cs' + (p.cls ? ' ' + p.cls : '')} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: COAST.scene }}></div>`;
  }

  // Sound and vibration for Learn: a short synth sting when a member passes or levels up (built with Web Audio, so it works
  // offline and adds no files) and a short buzz on phones that allow it. Sound starts off; both settings stay on the device.
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
        out.gain.value = 0.8; lp.type = 'lowpass'; lp.frequency.value = 3400; echo.delayTime.value = 0.17; fb.gain.value = 0.26;
        out.connect(lp); lp.connect(c.destination); lp.connect(echo); echo.connect(fb); fb.connect(echo); echo.connect(c.destination);
        var up = lv ? [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98] : [659.25, 830.61, 987.77, 1318.51], gap = lv ? 0.075 : 0.07;
        up.forEach(function (hz, i) {
          var len = i === up.length - 1 ? (lv ? 0.9 : 0.55) : 0.2;
          voice(c, out, t + i * gap, hz, len, 'sawtooth', 0.06);
          voice(c, out, t + i * gap, hz * 1.006, len, 'square', 0.025);
        });
        voice(c, out, t, lv ? 130.81 : 164.81, lv ? 1.1 : 0.6, 'triangle', 0.16);
        if (lv) [523.25, 659.25, 783.99, 987.77].forEach(function (hz) { voice(c, out, t + up.length * gap, hz, 1.2, 'sawtooth', 0.03); });
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
      <ul class="glist">${row('sound', 'sound', 'Sound effects', 'A short synth sting when you pass or level up')}${buzz ? row('buzz', 'buzz', 'Vibration', 'A short buzz when you pass') : null}</ul>
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
  var MEDAL_COAST = {
    mastered: { rim: 'url(#cx-rim)', edge: '#FFD23F', tick: 'rgba(255,255,255,.6)', face: 'url(#cx-night)', ring: '#22E4E0', glyph: '#FFE45C', dash: 'none' },
    earned: { rim: 'url(#cx-teal)', edge: '#0E8A8F', tick: 'rgba(255,255,255,.5)', face: 'url(#cx-sunset)', ring: 'rgba(255,255,255,.7)', glyph: '#FFFFFF', dash: 'none' },
    locked: { rim: '#FFFFFF', edge: '#E4DCF5', tick: '#EFE8FA', face: '#F7F3FD', ring: '#C9BEEA', glyph: '#9C8FC4', dash: '3 3' }
  };
  function Medal(p) {
    var set = SKIN ? MEDAL_COAST : MEDAL, c = set[p.state] || set.locked, s = p.size || 64;
    if (p.onNavy && p.state === 'mastered' && !SKIN) c = Object.assign({}, c, { rim: '#0B1A30', edge: '#C9D1DC' });
    return html`<svg class="medal" width=${s} height=${s} viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="44" cy="44" r="42" fill=${c.rim} stroke=${c.edge} stroke-width="1.5"></circle>
      <circle cx="44" cy="44" r="38" fill="none" stroke=${c.tick} stroke-width="3" stroke-dasharray="1.2 2.6"></circle>
      <circle cx="44" cy="44" r="32" fill=${c.face} stroke=${c.ring} stroke-width="1.5" stroke-dasharray=${c.dash}></circle>
      <g transform="translate(26 26) scale(1.5)" fill="none" stroke=${c.glyph} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d=${MEDAL_G[p.glyph] || MEDAL_G.book}></path></g>
    </svg>`;
  }
  function Ring(p) {
    var s = p.size || 58, w = p.w || 4, r = s / 2 - w, c = 2 * Math.PI * r, mid = s / 2, sk = !!SKIN;
    return html`<svg class="ring" width=${s} height=${s} viewBox=${'0 0 ' + s + ' ' + s} aria-hidden="true">
      <circle cx=${mid} cy=${mid} r=${r} fill=${p.fill || 'none'} stroke=${p.track || (sk ? '#EEE6FB' : '#E3E8EF')} stroke-width=${w}></circle>
      <circle class="ring-arc" cx=${mid} cy=${mid} r=${r} fill="none" stroke=${p.color || (sk ? 'url(#cx-arc)' : '#0F2340')} stroke-width=${w} stroke-linecap="round"
        stroke-dasharray=${(c * clamp(p.pct, 0.012, 1)).toFixed(1) + ' ' + c.toFixed(1)} transform=${'rotate(-90 ' + mid + ' ' + mid + ')'}></circle>
      ${sk ? html`<text x=${mid - s * 0.01} y=${mid + s * 0.13} text-anchor="middle" font-family="Kanit, 'IBM Plex Sans', sans-serif" font-style="italic" font-weight="800" font-size=${Math.round(s * 0.36)} fill=${p.ink || '#24124F'}>${p.n}</text>`
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
        return html`<li key=${i} class=${on ? 'on' : ''}>${on ? TICK : LOCK}<span>${t.name}${at ? html`<small> · Level ${at.n}</small>` : null}</span></li>`;
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
      ${p.compact && SKIN ? html`<div class="cs-band"><${Scene} cls="mini" /></div>` : null}
      <div class="dq-head"><h2 id=${'dq-h' + (p.compact ? 'c' : '')} class="card-k">Question of the day</h2>${LM.streak ? html`<span class="dq-streak">${FLAME}${LM.streak} ${plural(LM.streak, 'day')} running</span>` : null}</div>
      <span class="dq-type">${it.tf ? 'True or false' : LP.tiers[it.tier - 1].name}</span>
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

  function ReviewCard(p) {
    var LM = p.LM, A = p.A;
    if (!LM.deck) return null;
    var n = LM.due.length;
    return html`<section class="card rv-card" aria-labelledby="rv-h">
      <div class="rv-t"><h2 id="rv-h" class="card-k">Review deck</h2><b>${n ? n + ' due today' : 'Nothing due today'}</b><small>${LM.deck} in the deck. Missed questions come back after 1, 3 and 7 days.</small></div>
      ${n ? html`<button class="pill" onClick=${function () { A.startQuiz('review', ''); }}>Review</button>` : null}
    </section>`;
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
    var u = p.u, LP = p.LP, R = LP.R, A = p.A, bk = bookOf(LP, u.book);
    var prev = bk.units[u.i - 1];
    var btn = !u.open ? html`<span class="pill off wide">Pass ${prev ? prev.label : 'the previous chapter'} first</span>`
      : !u.ready ? html`<span class="pill off wide">Questions coming soon</span>`
      : u.perfect ? html`<span class="pill off wide">Full marks</span>`
      : u.wait ? html`<span class="pill off wide">Next try tomorrow</span>`
      : html`<button class="pill wide" data-autofocus onClick=${function () { A.startQuiz('check', u.id); }}>${u.passed ? 'Retake for full marks' : 'Take the check'}</button>`;
    var tag = u.state === 'perfect' ? html`<${Tag} text="Full marks" tone="ok" />` : u.state === 'passed' ? html`<${Tag} text="Passed" tone="ok" />` : u.state === 'locked' ? html`<${Tag} text="Locked" tone="quiet" />` : html`<${Tag} text="Open" tone="when" />`;
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label=${u.label + ': ' + u.title}>
      <div class="sheet-head"><span class="when">${bk.title}${u.module ? ' · ' + u.module : ''}</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <span class="card-k">${u.label}</span>
        <h2 class="sheet-title">${u.title}</h2>
        ${u.pages || u.mins ? html`<p class="u-meta tnum">${u.pages ? 'Pages ' + u.pages : ''}${u.pages && u.mins ? ' · ' : ''}${u.mins ? 'about ' + readTime(u.mins) + ' of reading' : ''}</p>` : null}
        <div class="sheet-tags">${tag}${u.r.best ? html`<${Tag} text=${'Best ' + u.r.best + ' of ' + R.checkSize} tone="quiet" />` : null}</div>
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
        <section class="u-check" aria-label="Chapter check">
          <span class="card-k">Chapter check</span>
          <p>${R.checkSize} questions at your level${(LP.qs[u.id] || []).length > R.checkSize ? ', drawn from this chapter’s ' + LP.qs[u.id].length : ''}, easiest first. Pass with ${R.checkPass}; all ${R.checkSize} is full marks.${R.retry === 'nextDay' ? ' Each new try opens the next day, with a fresh mix.' : ''}</p>
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
    function copy() {
      function pick() { var el = ref.current; if (el) { el.focus(); el.select(); } }
      try { navigator.clipboard.writeText(p.code).then(function () { setCopied(true); }, pick); } catch (e) { pick(); }
    }
    return html`<${Sheet} phone=${p.phone} skin=${true} onClose=${p.onClose} label="Move your progress">
      <div class="sheet-head"><span class="when">Backup code</span><${CloseBtn} onClose=${p.onClose} /></div>
      <div class="sheet-body">
        <h2 class="sheet-title">Move your progress</h2>
        <p class="share-note">Your progress is saved on this device only. Copy this code and paste it into the app on your new phone or computer.</p>
        <textarea ref=${ref} class="share-text bk-code" rows="4" readonly value=${p.code} aria-label="Your backup code"></textarea>
        <div class="share-btns"><button class="share-btn primary" onClick=${copy}>${copied ? 'Copied' : 'Copy code'}</button></div>
        <div class="bk-restore">
          <span class="card-k">Restore from a code</span>
          <textarea class="share-text" rows="3" value=${txt} placeholder="Paste a code that starts with TRS1." onInput=${function (e) { setTxt(e.currentTarget.value); setMsg(null); }} aria-label="Paste a backup code"></textarea>
          <div class="share-btns"><button class="share-btn" disabled=${!txt.trim()} onClick=${function () { setMsg(p.restore(txt)); }}>Restore</button></div>
          ${msg ? html`<p class=${'bk-msg ' + (msg.ok ? 'ok' : 'bad')} role="status">${msg.text}</p>` : null}
        </div>
      </div>
    </${Sheet}>`;
  }

  // ---------- learn: the check, review, promotion review and book final ----------
  // Full screen on phones, a centred panel on computers. One question at a time, with the explanation after each answer.
  function Quiz(p) {
    var spec = p.spec, A = p.A, LP = p.LP, items = spec.items;
    var s = useState({ i: 0, pick: -1, answers: [], phase: 'q', ev: null, leave: false, report: false }), q = s[0], setQ = s[1];
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
    // Escape asks before leaving a check that has started (and cancels that question if it is showing)
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
      if (ev.key !== 'Tab' || !box.current) return;
      var f = box.current.querySelectorAll('button:not([disabled]), a[href], textarea');
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
      else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
    function set2(patch) { setQ(function (prev) { return Object.assign({}, prev, patch); }); }
    var it = items[q.i], answered = q.pick >= 0, X = LP.X;
    var earned = q.answers.reduce(function (t, a) { return t + (a.right && !spec.paid[a.id] ? X['t' + a.tier] || 0 : 0); }, 0);
    function choose(i) {
      if (answered) return;
      var answers = q.answers.concat([{ id: it.id, tier: it.tier, right: it.opts[i].right }]);
      live.current.started = true; live.current.answers = answers;
      set2({ pick: i, answers: answers, report: false });
    }
    function next() {
      if (q.i < items.length - 1) return set2({ i: q.i + 1, pick: -1, report: false });
      live.current.done = true;
      var ev = A.learnFinish(spec, q.answers);
      if (ev && (ev.level || (ev.passed && spec.kind !== 'review'))) Fx.play(ev.level ? 'level' : 'pass');
      set2({ phase: ev && ev.level ? 'level' : 'done', ev: ev });
    }
    function close() {
      if (live.current.started && !live.current.done && spec.kind !== 'review' && !q.leave) return set2({ leave: true });
      p.onClose();
    }
    // the phone's Back gesture: true means the check asked first instead of closing
    if (p.guard) p.guard.current = function () {
      if (q.phase === 'q' && live.current.started && !live.current.done && spec.kind !== 'review') { if (!q.leave) set2({ leave: true }); return true; }
      return false;
    };
    var label = { check: 'Chapter check', promo: 'Promotion review', final: 'Book final', review: 'Review deck' }[spec.kind];
    var top = html`<div class="qz-top">
      <button class="x" onClick=${close} aria-label=${q.phase === 'q' ? 'Leave' : 'Close'}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>
      <span class="qz-pos tnum">${q.phase === 'q' ? 'Question ' + (q.i + 1) + ' of ' + items.length : label}</span>
      <span class=${'qz-xp tnum' + (q.ev ? (q.ev.xp ? ' on' : '') : earned ? ' on' : '')}>${q.ev ? (q.ev.xp ? '+' + num(q.ev.xp) + ' XP' : '') : earned ? '+' + earned + ' XP' : ''}</span>
    </div>`;
    var content;
    if (q.phase === 'q') {
      var factAt = Math.max(0, Math.floor(items.length / 2) - 1);
      var tierName = LP.tiers[it.tier - 1].name, pts = X['t' + it.tier];
      var mail = 'Question ' + it.id + ' (' + spec.kicker + '): "' + it.q + '"\n\nWhat looks wrong: ';
      content = html`
        <div class="qz-bar" aria-hidden="true">${items.map(function (x, i) { return html`<i key=${i} class=${i < q.i || (i === q.i && answered) ? 'done' : i === q.i ? 'cur' : ''}></i>`; })}</div>
        <div class="qz-body" ref=${body}>
          <div class="qz-src"><span class="card-k">${spec.kicker}</span><span>${spec.title}</span></div>
          <span class="qz-tier">${tierName} · ${spec.paid[it.id] ? 'already counted' : pts + ' XP'}${it.sample ? ' · sample' : ''}</span>
          <h2 class="qz-q" ref=${head} tabindex="-1">${it.q}</h2>
          <div class="qz-opts" role="group" aria-label="Answers">${it.opts.map(function (o, i) {
            var st = !answered ? '' : o.right ? ' right' : i === q.pick ? ' wrong' : ' dim';
            return html`<button key=${i} class=${'qz-opt' + st} disabled=${answered} onClick=${function () { choose(i); }}>
              <span class="qz-k" aria-hidden="true">${it.tf ? (i ? 'F' : 'T') : 'ABCDEF'.charAt(i)}</span><span class="qz-t">${o.t}</span>
              ${answered && o.right ? html`<span class="qz-mark" aria-hidden="true">${TICK}</span>` : null}
              ${answered && o.right ? html`<span class="vh"> (correct answer)</span>` : answered && i === q.pick ? html`<span class="vh"> (your answer)</span>` : null}
            </button>`;
          })}</div>
          ${answered ? html`<div class=${'qz-fb ' + (it.opts[q.pick].right ? 'right' : 'wrong')} role="status">
            <div class="qz-fbh"><b>${it.opts[q.pick].right ? 'Right' : 'Not quite'}</b>${it.opts[q.pick].right && !spec.paid[it.id] ? html`<b class="tnum">+${pts} XP</b>` : null}</div>
            <p>${it.why}</p>${it.opts[q.pick].right ? null : html`<small>Added to your review deck.</small>`}
          </div>` : null}
          ${answered && spec.fact && q.i === factAt ? html`<div class="qz-fact"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"></path></svg><div><span class="card-k">Fun fact</span><p>${spec.fact}</p></div></div>` : null}
          ${q.report ? html`<div class="qz-rep"><p>Tell the Head of Research what looks wrong. The question’s reference goes with it.</p><div class="share-btns">
            <a class="share-btn" href=${'https://wa.me/?text=' + encodeURIComponent(plain(mail))} target="_blank" rel="noopener">WhatsApp</a>
            <a class="share-btn" href=${'mailto:?subject=' + encodeURIComponent('Learn: question ' + it.id) + '&body=' + encodeURIComponent(plain(mail))}>Email</a></div></div>` : null}
        </div>
        <div class="qz-foot">
          ${q.leave ? html`<div class="qz-leave" role="alert"><p>Leave now and this counts as a try. ${LP.R.retry === 'nextDay' ? 'You can try again tomorrow.' : ''}</p><div><button class="pill ghost" onClick=${function () { set2({ leave: false }); }}>Stay</button><button class="pill" onClick=${p.onClose}>Leave</button></div></div>`
            : html`<button class="qz-go" disabled=${!answered} onClick=${next}>${q.i < items.length - 1 ? 'Next question' : 'See results'}</button>
              <button class="qz-report" onClick=${function () { set2({ report: !q.report }); }}>${q.report ? 'Hide' : 'Report this question'}</button>`}
        </div>`;
    } else if (q.phase === 'level') {
      var ev = q.ev, lvl = LP.levels[ev.level - 1], prevL = LP.levels[ev.level - 2] || lvl;
      var opened = [0, 1, 2].filter(function (t) { return lvl.mix[t] > 0 && !(prevL.mix[t] > 0); })[0];
      content = html`<div class="qz-level on-navy">
        <div class="ql-in">
          <span class="ql-k">${spec.kind === 'promo' ? 'Promotion review passed · ' + ev.score + ' of ' + ev.size : 'Both book finals passed'}</span>
          ${SKIN ? html`<div class="ql-emblem"><svg class="ql-sun" viewBox="0 0 200 200" aria-hidden="true"><use href="#cx-sunfull"></use></svg><${Ring} size=${124} w=${6} pct=${1} n=${lvl.n} color="url(#cx-gold)" track="rgba(255,255,255,.18)" fill="#1A0A40" ink="#FFFFFF" /></div>`
            : html`<${Ring} size=${124} w=${6} pct=${1} n=${lvl.n} color="#FFFFFF" track="rgba(255,255,255,.14)" fill="rgba(255,255,255,.06)" ink="#FFFFFF" />`}
          <span class="ql-eyebrow">Level up</span>
          <h2 class="ql-name" ref=${head} tabindex="-1">${lvl.name}</h2>
          <p class="ql-note">${opened != null ? LP.tiers[opened].name + ' questions are now open' + (LP.tiers[opened].note ? ': ' + LP.tiers[opened].note.charAt(0).toLowerCase() + LP.tiers[opened].note.slice(1) : '') + '.' : 'Checks now mix in harder questions.'}</p>
        </div>
        ${lvl.n < LP.levels.length ? html`<div class="ql-mix"><span class="card-k">Each chapter check from now on</span><ul>${scaleMix(lvl.mix, LP.R.checkSize).map(function (c, t) {
          var was = scaleMix(prevL.mix, LP.R.checkSize)[t];
          return html`<li key=${t} class=${c ? '' : 'off'}><b class="tnum">${c}</b><small>${LP.tiers[t].name}</small>${c !== was ? html`<em class="tnum">${c > was ? '+' : '−'}${Math.abs(c - was)}</em>` : null}</li>`;
        })}</ul></div>` : null}
        ${ev.badges.map(function (x) { return html`<div key=${x.b.id} class="ql-badge"><${Medal} state=${x.m ? 'mastered' : 'earned'} glyph=${x.b.glyph} size=${68} onNavy=${true} /><div><span class="card-k">New badge${x.m ? ' · Mastered' : ''}</span><b>${x.b.name}</b><small>${x.b.rule}</small></div></div>`; })}
        <div class="ql-btns"><button class="pill ghost-navy" onClick=${A.shareProgress}>Share my progress</button><button class="pill white" onClick=${function () { set2({ phase: 'done' }); }}>Continue</button></div>
      </div>`;
    } else if (q.phase === 'cert') {
      var bk = bookOf(LP, spec.ref);
      content = html`<div class="qz-body" ref=${body}>
        <h2 class="qz-q" ref=${head} tabindex="-1">Book final passed</h2>
        <${Certificate} LP=${LP} book=${bk} role=${p.role} best=${q.ev.score} size=${q.ev.size} at=${p.day} />
      </div>
      <div class="qz-foot"><button class="qz-go" onClick=${p.onClose}>Done</button><button class="qz-report" onClick=${A.shareProgress}>Share my progress</button></div>`;
    } else {
      var e = q.ev || { lines: [], badges: [], score: 0, size: items.length };
      var title = spec.kind === 'review' ? 'Review done' : e.passed ? { check: 'Chapter passed', promo: 'Promoted', final: 'Book final passed' }[spec.kind] : 'Not yet';
      var note = spec.kind === 'review' ? (p.dueLeft ? p.dueLeft + ' still due today.' : 'Your deck is clear for today.')
        : e.passed ? (spec.kind === 'check' && e.score < e.size ? 'A retake with full marks makes this chapter’s badge mastered.' : '')
        : 'You need ' + e.pass + ' of ' + e.size + '. Missed questions are in your review deck' + (LP.R.retry === 'nextDay' ? '; your next try opens tomorrow.' : '.');
      content = html`<div class="qz-body" ref=${body}>
        <div class="qr-score">
          ${SKIN ? html`<${Ring} size=${96} w=${6} pct=${e.size ? e.score / e.size : 0} n=${e.score} color=${spec.kind === 'review' ? '#22E4E0' : e.passed ? 'url(#cx-gold)' : 'url(#cx-arc)'} track="rgba(255,255,255,.16)" fill="rgba(26,10,64,.55)" ink="#FFFFFF" />`
            : html`<${Ring} size=${96} w=${6} pct=${e.size ? e.score / e.size : 0} n=${e.score} color=${e.passed || spec.kind === 'review' ? '#0F2340' : '#3E5A82'} />`}
          <div><h2 class="qr-title" ref=${head} tabindex="-1">${title}</h2><span class="qr-of tnum">${e.score} of ${e.size} right${spec.kind === 'review' ? '' : ' · pass with ' + e.pass}</span></div>
        </div>
        ${note ? html`<p class="qr-note">${note}</p>` : null}
        ${e.lines.length ? html`<ul class="qr-xp">${e.lines.map(function (l, i) { return html`<li key=${i}><span>${l.what}</span><b class="tnum">+${l.xp} XP</b></li>`; })}${e.lines.length > 1 ? html`<li class="tot"><span>This ${label.toLowerCase()}</span><b class="tnum">+${e.xp} XP</b></li>` : null}</ul>` : html`<p class="qr-note muted">No new XP this time: questions only pay the first time you get them right.</p>`}
        ${e.badges.map(function (x) { return html`<div key=${x.b.id} class="qr-badge"><${Medal} state=${x.m ? 'mastered' : 'earned'} glyph=${x.b.glyph} size=${60} /><div><span class="card-k">${x.up ? 'Badge mastered' : 'New badge'}</span><b>${x.b.name}</b><small>${x.b.rule}</small></div></div>`; })}
        ${e.promo ? html`<div class="qr-promo"><span class="card-k">Unlocked</span><b>${e.promo.n === LP.levels.length ? e.promo.name + ' opens once both book finals are passed' : 'Promotion review for ' + e.promo.name}</b><small>${e.promo.n === LP.levels.length ? '' : 'Find it on your level card.'}</small></div>` : null}
      </div>
      <div class="qz-foot">${e.cert ? html`<button class="qz-go" onClick=${function () { set2({ phase: 'cert' }); }}>See your certificate</button>` : html`<button class="qz-go" onClick=${p.onClose}>Done</button>`}</div>`;
    }
    var won = q.phase === 'done' && q.ev && q.ev.passed && spec.kind !== 'review';
    var deco = !SKIN ? '' : q.phase === 'level' ? 'level' : won ? 'sunrise' : 'night';
    return html`<div class=${'qz-wrap' + (SKIN ? ' ' + SKIN : '')}>
      <div class="scrim" onClick=${q.phase === 'q' ? null : p.onClose}></div>
      <div ref=${box} class=${'quiz' + (SKIN ? ' ' + SKIN : '') + (q.phase === 'level' ? ' navy' : '') + (won && SKIN ? ' sunrise' : '')} role="dialog" aria-modal="true" aria-label=${label + ': ' + spec.title} onKeyDown=${onKey}>
        ${deco ? html`<div key=${deco} class=${'qz-deco ' + deco} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: COAST[deco] }}></div>` : null}
        ${q.phase === 'level' ? null : top}
        ${content}
      </div>
    </div>`;
  }

  function Footer() {
    return html`<footer class="foot-slim"><span>Members only. Not for external circulation.</span></footer>`;
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
      // the install card appears from the second visit, for members who haven't installed the app, and can be put off for a month
      if (PWA && !standalone()) {
        var visits = (parseInt(read('trs-visits'), 10) || 0) + 1; store('trs-visits', String(visits));
        var later = parseInt(read('trs-install-later'), 10) || 0;
        if (visits >= 2 && Date.now() - later > 30 * DAY) set({ showInstall: true });
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
      return function () {
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
      var showNotice = N && N.id !== seenNotice;
      if (!items.length) saveSnap(m.id, cur);
      if (!items.length && !showNotice) { if (st.changes) set({ changes: null }); return; }
      set({ changes: { member: m.id, snap: cur, items: items, noticeId: showNotice ? N.id : '',
        title: showNotice ? (N.title || 'Notice') : 'Dates changed since your last visit', text: showNotice ? N.text : '' } });
    }, [st.P, st.mi]);

    // Learn's skin reaches the edges of the screen too: the page behind the bounce, the status bar and the browser bar
    var skinKey = !SKIN ? '' : st.sheet && st.sheet.kind === 'quiz' ? 'quiz' : st.tab === 'learn' && st.P ? 'learn' : '';
    useEffect(function () {
      var de = document.documentElement, mt = document.querySelector('meta[name="theme-color"]');
      if (SKIN) de.classList.toggle(SKIN + '-on', !!skinKey);
      if (mt) mt.setAttribute('content', skinKey === 'quiz' ? '#120A2E' : skinKey ? '#1A0A40' : '#0F2340');
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
    P.analyst.forEach(function (e) { lctx.dates[e.key] = e.ms; });
    function getLS(id) { if (!learnRef.current[id]) learnRef.current[id] = LearnStore.load(id) || freshLearn(); return learnRef.current[id]; }
    var LM = null;
    if (LP) { try { LM = learnModel(LP, getLS(M.m.id), learnDay, lctx); } catch (e) { try { console.warn('Learn:', e); } catch (x) { /* no console */ } } }
    if (LM && LM.daily && !LM.daily.done) M.badges.learn = 'q';
    // The questions for a check, promotion review, book final or review session: drawn to the member's level, easiest first.
    function quizSpec(kind, ref) {
      if (!LP) return null;
      var S = getLS(M.m.id), R = LP.R, lvI = levelInfo(LP, S), tries = 0, pool = [], mix = null, size = 0, pass = 0, kicker = '', title = '', factKey = '', avoid = {};
      function passedPool() {
        var seen = {}, out = [];
        LP.books.forEach(function (b) { b.units.forEach(function (u) { if (S.units[u.id] && S.units[u.id].passed) unitPool(LP, u.id).forEach(function (q) { if (!seen[q.id]) { seen[q.id] = 1; out.push(q); } }); }); });
        return out;
      }
      if (kind === 'check') {
        var u = LP.units[ref], r0 = S.units[ref] || {};
        if (!u) return null;
        pool = unitPool(LP, ref); mix = lvI.cur.mix; size = R.checkSize; pass = R.checkPass; tries = r0.tries || 0;
        kicker = bookOf(LP, u.book).title + ' · ' + u.label; title = u.title; factKey = LP.facts[ref] ? ref : u.book;
        (r0.last || []).forEach(function (id) { avoid[id] = 1; });
      } else if (kind === 'promo') {
        var to = LP.levels[ref - 1];
        if (!to) return null;
        pool = passedPool();
        if (!pool.length && LM) LM.books.forEach(function (x) { if (x.next) pool = pool.concat(unitPool(LP, x.next.id)); });
        mix = to.mix; size = R.reviewSize; pass = R.reviewPass; tries = (S.promos[ref] || {}).tries || 0;
        kicker = 'Promotion review'; title = to.name;
      } else if (kind === 'final') {
        var bk = bookOf(LP, ref), seen = {};
        if (!bk) return null;
        bk.units.forEach(function (x) { unitPool(LP, x.id).forEach(function (q) { if (!seen[q.id]) { seen[q.id] = 1; pool.push(q); } }); });
        mix = R.finalMix; size = R.finalSize; pass = R.finalPass; tries = (S.finals[ref] || {}).tries || 0;
        kicker = 'Book final'; title = bk.title; factKey = ref;
      } else {
        pool = (LM ? LM.due : []).map(function (id) { return LP.byId[id]; }).filter(Boolean); size = Math.min(12, pool.length);
        kicker = 'Review deck'; title = pool.length + ' due today';
      }
      var r = seeded([M.m.id, kind, ref, learnDay, tries].join(':'));
      var picked = mix ? pickQs(pool, mix, size, r, avoid) : shuffled(pool, r).slice(0, size);
      var facts = factKey ? LP.facts[factKey] || [] : [];
      return { kind: kind, ref: ref, items: quizItems(picked, r), size: picked.length, pass: kind === 'review' ? 0 : Math.ceil(picked.length * pass / Math.max(1, size)),
        kicker: kicker, title: title, fact: facts.length ? facts[Math.floor(r() * facts.length)] : '', paid: Object.assign({}, S.paid) };
    }
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
      restoreLearn: function (text) {
        var o = readBackup(text), mi = -1;
        if (!o) return { ok: false, text: 'That code isn’t valid. Copy the whole code, starting with TRS1.' };
        P.members.forEach(function (x, j) { if (x.id === o.id) mi = j; });
        if (mi < 0) return { ok: false, text: 'That code is for a role this app doesn’t have.' };
        learnRef.current[o.id] = o.s; LearnStore.save(o.id, o.s);
        if (mi !== M.mi) store('trs-member', o.id);
        set(function (prev) { return { learnTick: prev.learnTick + 1, mi: mi }; });
        return { ok: true, text: 'Restored: Level ' + o.s.level + ', ' + num(o.s.xp) + ' XP' + (mi !== M.mi ? ', for the ' + P.members[mi].role : '') + '.' };
      },
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
    var sheet = null;
    if (st.sheet && st.sheet.kind === 'share') {
      sheet = html`<${ShareSheet} key=${'share' + st.sheet.subject} phone=${st.phone} onClose=${A.close} title=${st.sheet.title} kicker=${st.sheet.kicker} subject=${st.sheet.subject} text=${st.sheet.text} note=${st.sheet.note} rows=${st.sheet.rows} />`;
    } else if (st.sheet && st.sheet.kind === 'search') {
      sheet = html`<${SearchSheet} key="search" phone=${st.phone} M=${M} onClose=${A.close} openAny=${A.openAny} openRule=${A.openRule} />`;
    } else if (st.sheet && st.sheet.kind === 'cal') {
      sheet = html`<${CalSheet} key="cal" phone=${st.phone} m=${M.m} calBase=${calBase} android=${/Android/i.test(navigator.userAgent || '')} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'member') {
      sheet = html`<${MemberSheet} key="member" phone=${st.phone} members=${P.members} mi=${M.mi} pick=${A.pick} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'quiz' && LP) {
      sheet = html`<${Quiz} key=${'quiz' + st.sheet.id} spec=${st.sheet.spec} LP=${LP} A=${A} onClose=${A.close} role=${M.m.role} day=${learnDay} dueLeft=${LM ? LM.due.length : 0} guard=${quizGuard} />`;
    } else if (st.sheet && st.sheet.kind === 'unit' && LM) {
      var uu = null;
      LM.books.forEach(function (x) { x.units.forEach(function (u) { if (u.id === st.sheet.unit) uu = u; }); });
      if (uu) sheet = html`<${UnitSheet} key="unit" phone=${st.phone} u=${uu} LP=${LP} A=${A} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'badges' && LM) {
      sheet = html`<${BadgesSheet} key="badges" phone=${st.phone} LM=${LM} LP=${LP} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'cert' && LM) {
      var fb = getLS(M.m.id).finals[st.sheet.book];
      if (fb && fb.passed) sheet = html`<${CertSheet} key="cert" phone=${st.phone} LP=${LP} book=${bookOf(LP, st.sheet.book)} role=${M.m.role} f=${fb} share=${A.shareProgress} onClose=${A.close} />`;
    } else if (st.sheet && st.sheet.kind === 'backup' && LP) {
      sheet = html`<${BackupSheet} key="backup" phone=${st.phone} code=${backupCode(M.m.id, getLS(M.m.id))} restore=${A.restoreLearn} onClose=${A.close} />`;
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
      head = html`<${PageHead} tab=${tab} M=${M} A=${A} st=${st} eyebrow=${LP ? LP.title : 'Required reading'} title="Learn" text=${LP && !isNaN(LP.due) ? 'Two books by ' + dMonth(LP.due) + NB + D(LP.due).getUTCFullYear() + '.' : 'The Society’s required reading.'} />`;
      if (!LM) content = [html`<section key="ll" class="card rcard"><span class="card-k">Learn</span><p>${st.learnErr ? 'The reading programme couldn’t load (' + st.learnErr + '). Check your connection, then reopen the app.' : 'Loading the reading programme…'}</p></section>`];
      else {
        var lvc = html`<${LevelCard} key="lv" LM=${LM} LP=${LP} A=${A} role=${m.role} />`, dqc = html`<${DailyCard} key="dq" LM=${LM} LP=${LP} A=${A} />`;
        var bks = LM.books.map(function (x) { return html`<${BookCard} key=${'bk' + x.b.id} bk=${x} LP=${LP} A=${A} open=${!!st.bookOpen[x.b.id]} />`; });
        var rest = [html`<${PaceCard} key="pc" LM=${LM} LP=${LP} />`, html`<${ReviewCard} key="rv" LM=${LM} A=${A} />`, html`<${BadgesCard} key="bd" LM=${LM} A=${A} />`, html`<${ProgressCard} key="pg" A=${A} />`, html`<${FxCard} key="fx" />`,
          window.TRS_LEARN ? html`<${LearnTools} key="lt" A=${A} dayText=${wk(learnDay) + ' ' + dMonth(learnDay)} />` : null];
        content = phone ? [lvc, dqc].concat(bks, rest) : cols([lvc].concat(bks, [rest[0], rest[2]]), [dqc, rest[1], rest[3], rest[4], rest[5]]);
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
      content = phone
        ? [changes, html`<${NextCard} key="nx" M=${M} A=${A} />`, st.showInstall && (st.canInstall || isIOS()) ? html`<${InstallCard} key="in" A=${A} st=${st} />` : null,
          html`<${Queue} key="q" M=${M} />`, html`<${NextMeet} key="nm" M=${M} A=${A} />`, dailyToday]
        : cols([html`<${NextCard} key="nx" M=${M} A=${A} />`], [html`<${NextMeet} key="nm" M=${M} A=${A} />`, html`<${Queue} key="q" M=${M} />`, dailyToday], changes ? [html`<div key="chw" class="wide">${changes}</div>`] : []);
    }

    var skinPage = tab === 'learn' && SKIN;
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
      ${st.updateReady && !st.toast ? html`<div class="toast" role="status"><span><b>A new version is ready</b></span><button onClick=${function () { location.reload(); }}>Refresh</button></div>` : null}
      ${st.toast ? html`<div class="toast" role="status"><span><b>${st.toast.text}</b> ${st.toast.title}</span>${st.toast.info ? null : html`<button onClick=${A.undo}>Undo</button>`}</div>` : null}
      ${sheet}
    </div>`;
  }

  root.innerHTML = '';
  render(html`<${App} />`, root);
})();
