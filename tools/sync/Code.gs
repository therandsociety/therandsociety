/**
 * The Rand Society: progress online.
 *
 * Keeps each member's progress (Learn and their "submitted" marks) in this Google Sheet, so it survives a lost phone and
 * the President can see the team at a glance. Runs as a web app on the Society's Google account; members never sign in to
 * Google. Each role picks a six-digit PIN the first time it saves. The PIN never leaves the phone: the app sends a hash of
 * it, and this sheet keeps only a salted hash of that.
 *
 * Setup and PIN resets: see README.md, section "Progress online". Nothing here holds a name; rows are roles.
 * @OnlyCurrentDoc
 */

var ROLES = { hor: 'Head of Research', pres: 'President & IC Chair', pm: 'Portfolio Manager', coo: 'COO & External Affairs' };
var BOARD = ['pres'];           // roles that see the team view
var MAX_TRIES = 5;              // wrong PINs before a role is locked
var LOCK_MINUTES = 15;
var PART = 45000;               // characters per cell (Sheets allows 50,000)
var PARTS = 20;

var M_HEAD = ['Role', 'Title', 'Online since', 'Last saved', 'Level', 'XP', 'Chapters passed', 'Streak', 'Last active', 'Version', 'PIN check', 'Salt', 'Wrong PINs', 'Locked until'];
var S_HEAD = ['Role', 'Version', 'Saved', 'Summary', 'Stats'].concat(range(PARTS).map(function (i) { return 'Part ' + (i + 1); }));
var Q_HEAD = ['Question', 'Chapter', 'Asked', 'Missed', 'Missed %', 'Members'];
var C = { title: 1, since: 2, saved: 3, level: 4, xp: 5, passed: 6, streak: 7, active: 8, version: 9, hash: 10, salt: 11, tries: 12, locked: 13 };

function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

// Run once from the editor (Run > setup) to create the three sheets. Safe to run again.
function setup() { sheets(); return 'Ready'; }

function doGet() { return reply({ ok: true, app: 'trs-progress', v: 1 }); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e && e.postData && e.postData.contents || ''); } catch (x) { return reply({ ok: false, err: 'bad' }); }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { return reply({ ok: false, err: 'busy' }); }
  try { return reply(handle(req || {})); }
  catch (x) { return reply({ ok: false, err: 'server', msg: String(x && x.message || x) }); }
  finally { lock.releaseLock(); }
}

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle(r) {
  var role = String(r.role || '');
  if (!ROLES[role]) return { ok: false, err: 'role' };
  var sh = sheets(), row = memberRow(sh.m, role), m = row.v, now = Date.now();
  var claimed = !!m[C.hash];
  if (r.action === 'hello') {
    var out = { ok: true, claimed: claimed, locked: +m[C.locked] > now ? +m[C.locked] : 0 };
    if (claimed && validKey(r.key) && hash(m[C.salt] + r.key) === m[C.hash]) { out.mine = true; out.version = +m[C.version] || 0; out.saved = +m[C.saved] || 0; }
    return out;
  }
  if (r.action === 'claim') {
    if (claimed) return { ok: false, err: 'claimed' };
    if (!validKey(r.key)) return { ok: false, err: 'bad' };
    var salt = Utilities.getUuid();
    m[C.title] = ROLES[role]; m[C.since] = new Date(now); m[C.hash] = hash(salt + r.key); m[C.salt] = salt; m[C.tries] = 0; m[C.locked] = '';
    if (!m[C.version]) m[C.version] = 0;
    writeRow(sh.m, row.at, m);
    return { ok: true, version: +m[C.version] || 0, saved: +m[C.saved] || 0 };
  }
  // everything else needs the PIN
  if (!claimed) return { ok: false, err: 'unclaimed' };
  if (+m[C.locked] > now) return { ok: false, err: 'locked', until: +m[C.locked] };
  if (!validKey(r.key) || hash(m[C.salt] + r.key) !== m[C.hash]) {
    m[C.tries] = (+m[C.tries] || 0) + 1;
    if (m[C.tries] >= MAX_TRIES) { m[C.locked] = new Date(now + LOCK_MINUTES * 60000); m[C.tries] = 0; }
    writeRow(sh.m, row.at, m);
    return +m[C.locked] > now ? { ok: false, err: 'locked', until: +m[C.locked] } : { ok: false, err: 'pin', left: MAX_TRIES - m[C.tries] };
  }
  if (+m[C.tries] || m[C.locked]) { m[C.tries] = 0; m[C.locked] = ''; writeRow(sh.m, row.at, m); }
  var srow = stateRow(sh.s, role);

  if (r.action === 'load') return { ok: true, version: +m[C.version] || 0, saved: +m[C.saved] || 0, state: readState(srow.v) };

  if (r.action === 'save') {
    var version = +m[C.version] || 0;
    // another phone saved since this one last synced: send that back and let the phone decide
    if (version && +r.base !== version && !r.force) return { ok: false, err: 'newer', version: version, saved: +m[C.saved] || 0, state: readState(srow.v) };
    var text = JSON.stringify(r.state || null);
    if (text.length > PART * PARTS) return { ok: false, err: 'big' };
    var sum = r.summary && typeof r.summary === 'object' ? r.summary : {};
    var stats = r.stats && typeof r.stats === 'object' ? r.stats : {};
    version++;
    var v = srow.v;
    v[0] = role; v[1] = version; v[2] = new Date(now); v[3] = JSON.stringify(sum).slice(0, PART); v[4] = JSON.stringify(stats).slice(0, PART);
    for (var i = 0; i < PARTS; i++) v[5 + i] = text.slice(i * PART, (i + 1) * PART);
    writeRow(sh.s, srow.at, v);
    m[C.saved] = new Date(now); m[C.version] = version;
    m[C.level] = sum.level || ''; m[C.xp] = sum.xp || 0; m[C.passed] = sum.passed != null ? sum.passed + ' of ' + (sum.total || '?') : '';
    m[C.streak] = sum.streak || 0; m[C.active] = sum.active || '';
    writeRow(sh.m, row.at, m);
    missedSheet(sh);
    return { ok: true, version: version, saved: now };
  }

  if (r.action === 'board') {
    if (BOARD.indexOf(role) < 0) return { ok: false, err: 'role' };
    var list = [], all = sh.m.getDataRange().getValues().slice(1), states = sh.s.getDataRange().getValues().slice(1);
    Object.keys(ROLES).forEach(function (id) {
      var mm = all.filter(function (x) { return x[0] === id; })[0] || [], ss = states.filter(function (x) { return x[0] === id; })[0] || [];
      list.push({ role: id, title: ROLES[id], online: !!mm[C.hash], saved: +mm[C.saved] || 0, summary: parse(ss[3]) || null });
    });
    return { ok: true, members: list, missed: missed(states, 30) };
  }
  return { ok: false, err: 'bad' };
}

// which questions the team misses most: asked at least three times across members, by share missed
function missed(states, n) {
  var by = {};
  states.forEach(function (s) {
    var st = parse(s[4]) || {};
    Object.keys(st).forEach(function (id) {
      var x = st[id]; if (!x || !(x[0] > 0)) return;
      var b = by[id] = by[id] || { id: id, asked: 0, missed: 0, members: 0 };
      b.asked += +x[0] || 0; b.missed += +x[1] || 0; b.members++;
    });
  });
  return Object.keys(by).map(function (k) { return by[k]; }).filter(function (b) { return b.asked >= 3 && b.missed > 0; })
    .sort(function (a, b) { return b.missed / b.asked - a.missed / a.asked || b.missed - a.missed; }).slice(0, n);
}
function missedSheet(sh) {
  var rows = missed(sh.s.getDataRange().getValues().slice(1), 200).map(function (b) {
    return [b.id, b.id.replace(/-.*$/, '').replace(/^([a-z]+)(\d+)$/, '$1-$2'), b.asked, b.missed, Math.round(100 * b.missed / b.asked), b.members];
  });
  sh.q.clearContents();
  sh.q.getRange(1, 1, 1, Q_HEAD.length).setValues([Q_HEAD]);
  if (rows.length) sh.q.getRange(2, 1, rows.length, Q_HEAD.length).setValues(rows);
}

function readState(v) {
  var t = '';
  for (var i = 0; i < PARTS; i++) t += v[5 + i] || '';
  return t ? parse(t) : null;
}
function parse(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function validKey(k) { return typeof k === 'string' && /^[0-9a-f]{64}$/.test(k); }
function hash(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

function sheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function get(name, head) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); }
    return sh;
  }
  var m = get('Members', M_HEAD), s = get('State', S_HEAD), q = get('Missed', Q_HEAD);
  var have = m.getDataRange().getValues().map(function (x) { return x[0]; });
  Object.keys(ROLES).forEach(function (id) {
    if (have.indexOf(id) < 0) { var row = M_HEAD.map(function () { return ''; }); row[0] = id; row[C.title] = ROLES[id]; row[C.version] = 0; m.appendRow(row); }
  });
  return { m: m, s: s, q: q };
}
function memberRow(sh, role) {
  var all = sh.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) if (all[i][0] === role) { var v = all[i].slice(); while (v.length < M_HEAD.length) v.push(''); return { at: i + 1, v: v }; }
  var row = M_HEAD.map(function () { return ''; }); row[0] = role; sh.appendRow(row);
  return { at: all.length + 1, v: row };
}
function stateRow(sh, role) {
  var all = sh.getDataRange().getValues();
  for (var i = 1; i < all.length; i++) if (all[i][0] === role) { var v = all[i].slice(); while (v.length < S_HEAD.length) v.push(''); return { at: i + 1, v: v }; }
  var row = S_HEAD.map(function () { return ''; }); row[0] = role; sh.appendRow(row);
  return { at: all.length + 1, v: row };
}
function writeRow(sh, at, v) { sh.getRange(at, 1, 1, v.length).setValues([v]); }
