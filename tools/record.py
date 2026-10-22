#!/usr/bin/env python3
"""Apply one of the President's GitHub forms (tools/forms.py) to data.json.

Usage: python3 tools/record.py <event.json> <out-dir>
Reads the issue in the GitHub event, checks it against data.json, and if it is sound writes data.json and three files in
<out-dir>: title.txt (the issue's new title, which makes the issue list read as a log), comment.md (the reply) and
commit.txt (the commit message). Exit code 0: recorded. Exit code 2: nothing changed; comment.md says why.
Runs on GitHub (.github/workflows/record.yml); needs nothing beyond Python 3."""
import json, os, re, sys, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data.json')
SAST = dt.timezone(dt.timedelta(hours=2))
RESULT_WORD = {'accepted': 'Accepted', 'minor': 'Accepted, minor corrections', 'revise': 'Revision required',
               'incomplete': 'Not completed', 'clear': 'Record cleared'}
ATTEND_WORD = {'present': 'present', 'excused': 'excused', 'absent': 'absent'}


class Stop(Exception):
    """A form that can't be applied; the message goes back to the President."""


def today():
    return dt.datetime.now(SAST).date()


def day(s, what):
    m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', (s or '').strip())
    if not m:
        raise Stop(what + ' must be written YYYY-MM-DD, such as 2026-12-13.')
    try:
        return dt.date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        raise Stop(what + ' (' + s.strip() + ') is not a real date.')


def nice(d):
    return d.strftime('%A ') + str(d.day) + d.strftime(' %B %Y')


def sections(body):
    """Issue-form body -> {label: value}. GitHub writes each field as '### Label', a blank line, then the answer."""
    out, cur = {}, None
    for line in (body or '').replace('\r\n', '\n').split('\n'):
        if line.startswith('### '):
            cur = line[4:].strip(); out[cur] = []
        elif cur is not None:
            out[cur].append(line)
    res = {}
    for k, v in out.items():
        t = '\n'.join(v).strip()
        res[k] = '' if t == '_No response_' else t
    return res


def keys(value):
    return re.findall(r'\[([A-Za-z0-9_-]+)\]', value or '')


def one(value, what):
    k = keys(value)
    if len(k) != 1:
        raise Stop('Choose one ' + what + ' from the list.')
    return k[0]


def find(D, key):
    for lst in ('society', 'analyst'):
        for e in D.get(lst, []):
            if e.get('key') == key:
                return lst, e
    raise Stop('There is no date with the key ' + key + ' in data.json. The form may be out of date: reload it and try again.')


def member(D, mid):
    for m in D.get('members', []):
        if m['id'] == mid:
            return m
    raise Stop('There is no Member with the id ' + mid + '.')


def role(m):
    return m.get('roleShort') or m.get('role') or m['id']


def names(ms):
    """'the President', 'the President and the COO', 'the President, the COO and the Portfolio Manager'"""
    t = ['the ' + role(m) for m in ms]
    return t[0] if len(t) == 1 else ', '.join(t[:-1]) + ' and ' + t[-1]


def leads(lst, e, m):
    if (e.get('roles') or {}).get(m['id']) == 'lead':
        return True
    return lst == 'analyst' and e.get('who') == 'all' and (not e.get('cycle') or e['cycle'] == m.get('cycle', 'A'))


# ---------------------------------------------------------------- the four forms
def result(D, f):
    lst, e = find(D, one(f.get('Deliverable'), 'deliverable'))
    mids = keys(f.get('Members'))
    if not mids:
        raise Stop('Choose at least one Member.')
    res = one(f.get('Result'), 'result')
    if res not in RESULT_WORD:
        raise Stop('Choose a result from the list.')
    ms = [member(D, x) for x in mids]
    bad = [role(m) for m in ms if not leads(lst, e, m)]
    if bad:
        raise Stop('“' + e['title'] + '” isn’t led by the ' + ' or the '.join(bad) + ', so there’s no result to record for them.')
    st = dict(e.get('status') or {})
    for m in ms:
        if res == 'clear':
            st.pop(m['id'], None)
        else:
            st[m['id']] = res
    if st:
        e['status'] = st
    else:
        e.pop('status', None)
    who = ', '.join(role(m) for m in ms)
    word = RESULT_WORD[res]
    title = word + ': ' + e['title'] + ' · ' + who
    note = f.get('Note', '')
    comment = ('**' + word + '** for ' + names(ms) + ' on “' + e['title'] + '” (' + nice(day(e['date'], 'date')) + ').\n\n'
               + ('The record is cleared, so the app goes back to the date and any “submitted” mark.' if res == 'clear' else
                  'Members see it in the app within a few minutes, and on the Society board.')
               + ('\n\nNote: ' + note if note else ''))
    return title, comment


def attendance(D, f):
    lst, e = find(D, one(f.get('Meeting'), 'meeting'))
    if e.get('type') != 'meeting':
        raise Stop('“' + e['title'] + '” is not a meeting.')
    d = day(e['date'], 'The meeting date')
    if d > today():
        raise Stop(e['title'] + ' is on ' + nice(d) + ' and hasn’t happened yet.')
    rec = dict(e.get('attendance') or {})
    rows = []
    for m in D.get('members', []):
        v = keys(f.get(m.get('role', m['id']), ''))
        if len(v) != 1 or v[0] not in ATTEND_WORD:
            raise Stop('Choose present, excused or absent for the ' + role(m) + '.')
        rec[m['id']] = v[0]
        rows.append('| ' + role(m) + ' | ' + ATTEND_WORD[v[0]].capitalize() + ' |')
    e['attendance'] = rec
    n = sum(1 for v in rec.values() if v == 'present')
    title = 'Attendance: ' + e['title'] + ' · ' + str(n) + ' of ' + str(len(rec)) + ' present'
    comment = ('**Attendance recorded** for ' + e['title'] + ' (' + nice(d) + ').\n\n| Member | |\n|---|---|\n' + '\n'.join(rows)
               + ('\n\nQuorum is three of four Members; this meeting had ' + str(n) + ' present.' if n < 3 else '')
               + '\n\nEach Member’s count on Meetings updates within a few minutes.'
               + ('\n\nNote: ' + f['Note'] if f.get('Note') else ''))
    return title, comment


def slug(t):
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')[:32].strip('-')


def notice(D, f):
    act = one(f.get('What to do'), 'action')
    if act == 'remove':
        if not D.get('notice'):
            raise Stop('There is no notice to remove.')
        old = D.pop('notice')
        return 'Notice removed: ' + (old.get('title') or old.get('id', '')), 'The notice “' + (old.get('title') or old.get('id', '')) + '” is removed. No one sees it from now on.'
    title, text = f.get('Title', '').strip(), f.get('Message', '').strip()
    if not title or not text:
        raise Stop('A notice needs a title and a message.')
    style = one(f.get('Show it as'), 'way to show it')
    n = {'id': today().isoformat() + '-' + (slug(title) or 'notice'), 'title': title, 'text': text}
    if D.get('notice') and D['notice'].get('id') == n['id']:
        n['id'] += '-2'
    signer = one(f.get('Signed by'), 'signature')
    if style == 'popup':
        n['popup'] = True
        n['from'] = 'From the ' + role(member(D, signer)) if signer != 'none' else 'From the Society'
        pts = [re.sub(r'^\s*[-*•]\s*', '', p).strip() for p in f.get('Short list', '').split('\n')]
        pts = [p for p in pts if p]
        if pts:
            n['points'] = pts
        if signer != 'none':
            n['sign'] = member(D, signer).get('role', signer)
        n['button'] = 'Got it'
    until = f.get('Show until', '').strip()
    if until:
        u = day(until, 'Show until')
        if u < today():
            raise Stop('Show until (' + nice(u) + ') has already passed, so no one would see it.')
        n['until'] = u.isoformat()
    replaced = D.get('notice')
    # the notice goes near the top of the file, where the README says to look for it
    items = list(D.items())
    D.clear()
    for k, v in items:
        if k == 'notice':
            continue
        D[k] = v
        if k == 'updated':
            D['notice'] = n
    if 'notice' not in D:
        D['notice'] = n
    how = 'a pop-up message, once per phone' if style == 'popup' else 'a note on Today'
    comment = ('**Notice posted** as ' + how + ': “' + title + '”.' + (' It replaces “' + (replaced.get('title') or replaced.get('id')) + '”.' if replaced else '')
               + ('\n\nShown until ' + nice(day(n['until'], 'until')) + '.' if n.get('until') else '') + '\n\nEach Member sees it once, on their next visit.')
    return 'Notice: ' + title, comment


def move(D, f):
    lst, e = find(D, one(f.get('Date to change'), 'date'))
    old = day(e['date'], 'The current date')
    new = day(f.get('New date'), 'New date')
    decision = f.get('Decision on record', '').strip()
    if not decision:
        raise Stop('Record the decision behind the change: the minutes or the written resolution.')
    if e.get('type') == 'meeting' and new.weekday() != 6:
        raise Stop('Meetings are on Sundays, and ' + nice(new) + ' is a ' + new.strftime('%A') + '.')
    delta = new - old
    notes = []
    e['date'] = new.isoformat()
    end_in = f.get('New last day', '').strip()
    if end_in:
        end = day(end_in, 'New last day')
        if end < new:
            raise Stop('The new last day is before the new date.')
        if end == new:
            e.pop('end', None)
        else:
            e['end'] = end.isoformat()
    elif e.get('end'):
        e['end'] = (day(e['end'], 'The current last day') + delta).isoformat()
        notes.append('It still runs to ' + nice(day(e['end'], 'end')) + ', the same length as before.')
    t = f.get('New cut-off time', '').strip()
    if t:
        if not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', t):
            raise Stop('The cut-off time must look like 17:00.')
        if e.get('type') != 'deadline':
            raise Stop('Only a deadline has a cut-off time.')
        e['time'] = t
    if e.get('preread'):
        e['preread'] = (day(e['preread'], 'The pre-read date') + delta).isoformat()
        notes.append('Pre-reads move with it, to ' + nice(day(e['preread'], 'pre-read')) + '.')
    T = D.get('term', {})
    if T.get('start') and T.get('close') and not (day(T['start'], 'term.start') <= new <= day(T['close'], 'term.close')):
        notes.append('The new date is outside the term (' + T['start'] + ' to ' + T['close'] + ').')
    title = 'Moved: ' + e['title'] + ' · now ' + new.strftime('%a ') + str(new.day) + new.strftime(' %b')
    comment = ('**' + e['title'] + '** moves from ' + nice(old) + ' to ' + nice(new) + (', closing at ' + t if t else '') + '.\n\n'
               + (' '.join(notes) + '\n\n' if notes else '')
               + 'Decision on record: ' + decision + '\n\nMembers see “Dates changed since your last visit” on their next visit, and calendars catch up on their next refresh. Dates that depend on this one are unchanged: move them with their own forms if the decision says so.')
    return title, comment


FORMS = [({'Deliverable', 'Result'}, result), ({'Meeting'}, attendance), ({'What to do', 'Message'}, notice), ({'Date to change', 'New date'}, move)]


def apply(D, body):
    f = sections(body)
    for need, fn in FORMS:
        if need <= set(f):
            return fn(D, f)
    raise Stop('This doesn’t look like one of the Society’s forms. Open a new issue and choose Record a result, Record attendance, Post a notice or Change a date.')


def check(D):
    """The same basics check.html enforces, for what the forms can change."""
    ids = {m['id'] for m in D.get('members', [])}
    for lst in ('society', 'analyst'):
        for e in D.get(lst, []):
            day(e['date'], e['key'] + ' date')
            if e.get('end') and day(e['end'], e['key'] + ' end') < day(e['date'], e['key'] + ' date'):
                raise Stop(e['key'] + ': the last day is before the date.')
            for r, v in (e.get('status') or {}).items():
                if r not in ids or v not in ('accepted', 'minor', 'revise', 'incomplete'):
                    raise Stop(e['key'] + ': a result is not valid.')
            for r, v in (e.get('attendance') or {}).items():
                if r not in ids or v not in ATTEND_WORD:
                    raise Stop(e['key'] + ': an attendance entry is not valid.')
            if e.get('preread') and day(e['preread'], 'pre-read') >= day(e['date'], 'date'):
                raise Stop(e['key'] + ': the pre-read date must be before the meeting.')


def main():
    event, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    with open(event, encoding='utf-8') as fh:
        issue = json.load(fh).get('issue') or {}
    with open(DATA, encoding='utf-8') as fh:
        D = json.load(fh)
    before = json.dumps(D, sort_keys=True)
    try:
        title, comment = apply(D, issue.get('body') or '')
        if json.dumps(D, sort_keys=True) == before:
            comment += '\n\nIt was already recorded this way, so nothing changed.'
        else:
            D['updated'] = today().isoformat()
        check(D)
    except Stop as err:
        with open(os.path.join(out, 'comment.md'), 'w', encoding='utf-8') as fh:
            fh.write('**Not recorded.** ' + str(err) + '\n\nNothing in the app changed. Open a new form when you’re ready.\n')
        print('stopped: ' + str(err))
        sys.exit(2)
    with open(DATA, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(D, indent=2, ensure_ascii=False))
    n = issue.get('number')
    with open(os.path.join(out, 'title.txt'), 'w', encoding='utf-8') as fh:
        fh.write(title)
    with open(os.path.join(out, 'comment.md'), 'w', encoding='utf-8') as fh:
        fh.write(comment + '\n')
    with open(os.path.join(out, 'commit.txt'), 'w', encoding='utf-8') as fh:
        fh.write(title + (' (#' + str(n) + ')' if n else '') + '\n\nRecorded from the President’s form' + (' #' + str(n) if n else '') + '.\n')
    print('recorded: ' + title)


if __name__ == '__main__':
    main()
