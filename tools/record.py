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
    if e.get('type') == 'meeting' and new.weekday() not in (5, 6):
        raise Stop('Meetings are on a Sunday (or a Saturday the Members agree), and ' + nice(new) + ' is a ' + new.strftime('%A') + '.')
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
    mt = f.get('New meeting time', '').strip()
    if mt:
        if e.get('type') != 'meeting':
            raise Stop('Only a meeting has a meeting time; use New cut-off time for a deadline.')
        m2 = re.fullmatch(r'(([01]\d|2[0-3]):[0-5]\d)\s*(?:-|–|—|to)\s*(([01]\d|2[0-3]):[0-5]\d)', mt)
        if not m2:
            raise Stop('The meeting time must look like 08:30-09:30: its start and end.')
        if m2[3] <= m2[1]:
            raise Stop('The meeting must end after it starts (' + m2[1] + ').')
        if (m2[1], m2[3]) == ('17:00', '18:30'):
            e.pop('time', None); e.pop('endTime', None)   # back to the standard time
        else:
            e['time'], e['endTime'] = m2[1], m2[3]
        notes.append('It now runs ' + m2[1] + ' to ' + m2[3] + '.')
    if e.get('preread'):
        e['preread'] = (day(e['preread'], 'The pre-read date') + delta).isoformat()
        notes.append('Pre-reads move with it, to ' + nice(day(e['preread'], 'pre-read')) + '.')
    # the thesis path (cycles) repeats the analyst dates and the Pitch ICs: keep it in step
    key = e['key']
    paths = []
    for c, cy in (D.get('cycles') or {}).items():
        lc = c.lower()
        related = key in ('a-brief', 'a-cand') or (lst == 'analyst' and e.get('cycle') == c) or key == 'pic' + lc
        if not related:
            continue
        moved = False
        for st in cy.get('path', []):
            if st.get('date') == old.isoformat():
                st['date'] = new.isoformat(); moved = True
        if key == 'pic' + lc and cy.get('pitch') == old.isoformat():
            cy['pitch'] = new.isoformat(); moved = True
        if moved:
            paths.append(cy.get('name', 'Cycle ' + c))
    if paths:
        notes.append(('The thesis path for ' + paths[0] + ' moves' if len(paths) == 1 else 'The thesis paths for ' + ' and '.join(paths) + ' move') + ' with it.')
    # wording elsewhere that still names the old date, such as "15 Jan" in a scorecard or a role's list
    olds = [str(old.day) + ' ' + old.strftime('%b'), str(old.day) + ' ' + old.strftime('%B')]
    hits = []
    def scan(x, where):
        if isinstance(x, dict):
            for k2, v in x.items():
                if k2 not in ('date', 'end', 'preread', 'pitch'):
                    scan(v, where + '.' + k2 if where else k2)
        elif isinstance(x, list):
            for i, v in enumerate(x):
                scan(v, where + '[' + str(i) + ']')
        elif isinstance(x, str) and any(re.search(r'(?<!\d)' + re.escape(o) + r'\b', x) for o in olds):
            hits.append(place(where) + ': “' + x + '”')
    def place(where):
        """members[0].owns[1].when -> 'Head of Research, What you own (Financials theme primer)'"""
        m = re.match(r'members\[(\d+)\]\.owns\[(\d+)\]', where)
        if m:
            mm = D['members'][int(m[1])]
            return role(mm) + ', What you own (' + mm['owns'][int(m[2])].get('name', '') + ')'
        m = re.match(r'analystScorecard\[(\d+)\]', where)
        if m:
            return 'Analyst scorecard (' + D['analystScorecard'][int(m[1])].get('name', '') + ')'
        return '`' + where + '`'
    scan({k: v for k, v in D.items() if k not in ('_readme',)}, '')
    T = D.get('term', {})
    if T.get('start') and T.get('close') and not (day(T['start'], 'term.start') <= new <= day(T['close'], 'term.close')):
        notes.append('The new date is outside the term (' + T['start'] + ' to ' + T['close'] + ').')
    title = 'Moved: ' + e['title'] + ' · now ' + new.strftime('%a ') + str(new.day) + new.strftime(' %b') + (', ' + e.get('time', '17:00') + ' to ' + e.get('endTime', '18:30') if mt else '')
    comment = ('**' + e['title'] + '** ' + ('stays on ' + nice(new) if new == old else 'moves from ' + nice(old) + ' to ' + nice(new)) + (', closing at ' + t if t else '') + '.\n\n'
               + (' '.join(notes) + '\n\n' if notes else '')
               + 'Decision on record: ' + decision + '\n\nMembers see “Dates changed since your last visit” on their next visit, and calendars catch up on their next refresh. Dates that depend on this one are unchanged: move them with their own forms if the decision says so.'
               + ('\n\nThese lines in data.json still mention ' + olds[0] + '; edit them if they mean this date:\n' + '\n'.join('- ' + h for h in hits[:8]) if hits else ''))
    return title, comment


def link(D, f):
    lst, e = find(D, one(f.get('Date to link'), 'date'))
    act = one(f.get('Add or remove'), 'action')
    label = re.sub(r'\s+', ' ', f.get('Label', '')).strip()
    if not label:
        raise Stop('Give the link a label, such as Thesis template.')
    if len(label) > 40:
        raise Stop('Keep the label to 40 characters or fewer; it becomes a button.')
    links = [l for l in (e.get('links') or []) if isinstance(l, dict)]
    same = [l for l in links if l.get('label', '').lower() == label.lower()]
    if act == 'remove':
        if not same:
            raise Stop('“' + e['title'] + '” has no link called “' + label + '”.')
        links = [l for l in links if l not in same]
        if links:
            e['links'] = links
        else:
            e.pop('links', None)
        return 'Link removed: ' + label + ' · ' + e['title'], 'The link **' + label + '** is removed from “' + e['title'] + '”.'
    url = f.get('Link', '').strip()
    if not re.fullmatch(r'https://\S+', url):
        raise Stop('The link must be a full address starting https://.')
    if not same and len(links) >= 4:
        raise Stop('“' + e['title'] + '” already has four links, the most the app shows. Remove one first.')
    if same:
        same[0]['url'] = url; same[0]['label'] = label
    else:
        links.append({'label': label, 'url': url})
    e['links'] = links
    return ('Link: ' + label + ' · ' + e['title'],
            '**' + label + '** is linked on “' + e['title'] + '” (' + nice(day(e['date'], 'date')) + ')' + (', replacing the old address' if same else '') + '.\n\n'
            'Members see it as a button in that date\u2019s panel within a few minutes. Check the file is shared with the Members, or the button opens a request for access.')


OUTCOME_WORD = {'approved': 'Approved', 'rejected': 'Not approved', 'deferred': 'Deferred', 'noted': 'Noted'}


def decision(D, f):
    where = one(f.get('Taken at'), 'meeting')
    if where == 'resolution':
        d = day(f.get('Date of a written resolution'), 'The date of a written resolution')
        place = 'Written resolution'
        meeting = ''
    else:
        lst, e = find(D, where)
        if e.get('type') != 'meeting':
            raise Stop('“' + e['title'] + '” is not a meeting.')
        d = day(e['date'], 'The meeting date')
        place, meeting = e['title'], e['key']
    if d > today():
        raise Stop(place + ' is on ' + nice(d) + ', which hasn’t happened yet. Record decisions from the minutes.')
    title = re.sub(r'\s+', ' ', f.get('Decision', '')).strip()
    rationale = f.get('Rationale', '').strip()
    if not title or not rationale:
        raise Stop('A decision needs a one-line decision and its rationale.')
    out = one(f.get('Outcome'), 'outcome')
    if out not in OUTCOME_WORD:
        raise Stop('Choose an outcome from the list.')
    owner = one(f.get('Owner'), 'owner')
    if owner != 'none':
        member(D, owner)
    rv = f.get('Review on', '').strip()
    if rv.lower() == 'none':
        review = ''
    elif rv:
        r = day(rv, 'Review on')
        if r <= d:
            raise Stop('The review date must be after the decision.')
        review = r.isoformat()
    else:
        review = (d + dt.timedelta(days=30)).isoformat()
    ds = D.setdefault('decisions', [])
    n = 1 + sum(1 for x in ds if x.get('date') == d.isoformat())
    rec = {'id': 'D-' + d.isoformat() + '-' + str(n), 'date': d.isoformat(), 'title': title, 'outcome': out, 'rationale': rationale}
    if meeting:
        rec['meeting'] = meeting
    if f.get('Vote', '').strip():
        rec['vote'] = f['Vote'].strip()
    if owner != 'none':
        rec['owner'] = owner
    if review:
        rec['review'] = review
    ds.append(rec)
    ds.sort(key=lambda x: (x.get('date', ''), x.get('id', '')))
    return (OUTCOME_WORD[out] + ': ' + title + ' · ' + (('IC ' + str(e.get('ic'))) if meeting and e.get('ic') else place),
            '**' + OUTCOME_WORD[out] + ':** ' + title + ' (' + place + ', ' + nice(d) + ').\n\n'
            + ('Vote: ' + rec['vote'] + '\n\n' if rec.get('vote') else '') + 'Rationale: ' + rationale + '\n\n'
            + ('Owner: the ' + role(member(D, owner)) + '.\n\n' if owner != 'none' else '')
            + ('Review on ' + nice(day(review, 'review')) + ': the register shows a prompt from a week before.' if review else 'No review date.')
            + '\n\nIt appears in the decision register on the Meetings page within a few minutes.')


def review_decision(D, f):
    did = one(f.get('Decision to review'), 'decision')
    if did == 'none':
        raise Stop('There are no decisions to review yet.')
    rec = next((x for x in D.get('decisions') or [] if x.get('id') == did), None)
    if not rec:
        raise Stop('There is no decision ' + did + ' in data.json. The form may be out of date: reload it and try again.')
    note = f.get('What happened', '').strip()
    if not note:
        raise Stop('Say what happened: did it play out as the rationale expected?')
    rec['reviewed'] = {'date': today().isoformat(), 'note': note}
    nx = f.get('Next review', '').strip()
    if nx:
        r = day(nx, 'Next review')
        if r <= today():
            raise Stop('The next review must be after today.')
        rec['review'] = r.isoformat()
    else:
        rec.pop('review', None)
    return ('Reviewed: ' + rec['title'],
            '**Reviewed:** ' + rec['title'] + ' (decided ' + nice(day(rec['date'], 'date')) + ').\n\n' + note
            + ('\n\nNext review on ' + nice(day(rec['review'], 'review')) + '.' if rec.get('review') else '\n\nNo further review is set.'))


FORMS = [({'Deliverable', 'Result'}, result), ({'Meeting'}, attendance), ({'What to do', 'Message'}, notice), ({'Date to change', 'New date'}, move), ({'Date to link', 'Label'}, link), ({'Taken at', 'Decision', 'Rationale'}, decision), ({'Decision to review', 'What happened'}, review_decision)]


def apply(D, body):
    f = sections(body)
    for need, fn in FORMS:
        if need <= set(f):
            return fn(D, f)
    raise Stop('This doesn’t look like one of the Society’s forms. Open a new issue and choose one of the Society’s forms.')


def check(D):
    """The same basics check.html enforces, for what the forms can change."""
    ids = {m['id'] for m in D.get('members', [])}
    for rec in D.get('decisions') or []:
        day(rec.get('date', ''), 'decision date')
        if rec.get('outcome') not in OUTCOME_WORD or not rec.get('title'):
            raise Stop('A decision in data.json is not valid.')
        if rec.get('review'):
            day(rec['review'], 'review date')
    for lst in ('society', 'analyst'):
        for e in D.get(lst, []):
            day(e['date'], e['key'] + ' date')
            if e.get('end') and day(e['end'], e['key'] + ' end') < day(e['date'], e['key'] + ' date'):
                raise Stop(e['key'] + ': the last day is before the date.')
            for r, v in (e.get('status') or {}).items():
                if r not in ids or v not in ('accepted', 'minor', 'revise', 'incomplete'):
                    raise Stop(e['key'] + ': a result is not valid.')
            for l in (e.get('links') or []):
                if not (isinstance(l, dict) and l.get('label') and re.fullmatch(r'https://\S+', l.get('url', ''))):
                    raise Stop(e['key'] + ': a link needs a label and a full https:// address.')
            for r, v in (e.get('attendance') or {}).items():
                if r not in ids or v not in ATTEND_WORD:
                    raise Stop(e['key'] + ': an attendance entry is not valid.')
            if e.get('endTime') and not (re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', e['endTime']) and e['endTime'] > e.get('time', '17:00')):
                raise Stop(e['key'] + ': the meeting must end after it starts.')
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
