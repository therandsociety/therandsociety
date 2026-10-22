#!/usr/bin/env python3
"""Build the President's GitHub forms (.github/ISSUE_TEMPLATE/*.yml) from data.json: record a result, record attendance,
post a notice and change a date. The dropdowns list the dates and roles in data.json, so the forms are rebuilt whenever it
changes (.github/workflows/calendar.yml and record.yml). tools/record.py reads a submitted form and applies it.

Every option ends with its key in square brackets, such as "Fri 6 Nov · Outlines and capacity map [nov6]": record.py reads
the keys, so a reworded title never breaks a form."""
import json, os, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '.github', 'ISSUE_TEMPLATE')

RESULTS = [('accepted', 'Accepted'), ('minor', 'Accepted, minor corrections'), ('revise', 'Revision required'),
           ('incomplete', 'Not completed'), ('clear', 'Clear the record')]
ATTEND = [('present', 'Present'), ('excused', 'Excused (an approved absence)'), ('absent', 'Absent')]
PUBLIC = 'This page is public and stays as the dated record: use roles, never names.'


def load():
    with open(os.path.join(ROOT, 'data.json'), encoding='utf-8') as f:
        return json.load(f)


def day(s):
    return dt.date(*map(int, s.split('-')))


def short(d):
    return d.strftime('%a ') + str(d.day) + d.strftime(' %b')


def label(e, cycle=False):
    """'Fri 6 Nov · Outlines and capacity map [nov6]'; a range shows both ends."""
    a = day(e['date'])
    when = short(a)
    if e.get('end') and e['end'] != e['date']:
        when += ' to ' + short(day(e['end']))
    title = e.get('title', e['key'])
    if cycle and e.get('cycle'):
        title += ', Cycle ' + e['cycle']
    return when + ' · ' + title + ' [' + e['key'] + ']'


def member_label(m):
    return m.get('role', m['id']) + ' [' + m['id'] + ']'


def deliverables(D):
    """Deadlines someone leads, Society and analyst, in date order (review comments are the reviewer's, so not listed)."""
    out = []
    for e in D.get('society', []):
        if e.get('type') == 'deadline' and 'lead' in (e.get('roles') or {}).values():
            out.append((e['date'], 0, label(e)))
    for e in D.get('analyst', []):
        if e.get('type') == 'deadline' and not e['key'].startswith('a-fb'):
            out.append((e['date'], 1, label(dict(e, title='Analyst: ' + e.get('title', '')), cycle=True)))
    return [x[2] for x in sorted(out)]


def meetings(D):
    return [label(e) for e in sorted(D.get('society', []), key=lambda x: x['date']) if e.get('type') == 'meeting']


def dates(D):
    rows = [(e['date'], 0, label(e)) for e in D.get('society', [])]
    rows += [(e['date'], 1, label(dict(e, title='Analyst: ' + e.get('title', '')), cycle=True)) for e in D.get('analyst', [])]
    return [x[2] for x in sorted(rows)]


# ---- a small YAML writer: every string goes out JSON-quoted, which YAML reads as a double-quoted scalar ----
def q(s):
    return json.dumps(s, ensure_ascii=False)


def form(name, about, title, intro, fields):
    lines = ['# Built by tools/forms.py from data.json. Edit that script, not this file.',
             'name: ' + q(name), 'description: ' + q(about), 'title: ' + q(title), 'body:',
             '  - type: markdown', '    attributes:', '      value: ' + q(intro)]
    for f in fields:
        lines += ['  - type: ' + f['type'], '    id: ' + f['id'], '    attributes:', '      label: ' + q(f['label'])]
        if f.get('description'):
            lines.append('      description: ' + q(f['description']))
        if f.get('placeholder'):
            lines.append('      placeholder: ' + q(f['placeholder']))
        if f['type'] == 'dropdown':
            if f.get('multiple'):
                lines.append('      multiple: true')
            lines.append('      options:')
            lines += ['        - ' + q(o) for o in f['options']]
            if f.get('default') is not None:
                lines.append('      default: ' + str(f['default']))
        lines += ['    validations:', '      required: ' + ('true' if f.get('required') else 'false')]
    return '\n'.join(lines) + '\n'


OUTCOMES = [('approved', 'Approved'), ('rejected', 'Not approved'), ('deferred', 'Deferred'), ('noted', 'Noted')]


def decisions(D):
    out = []
    for d in sorted(D.get('decisions') or [], key=lambda x: (x.get('date', ''), x.get('id', '')), reverse=True):
        out.append(short(day(d['date'])) + ' · ' + d.get('title', d['id']) + ' [' + d['id'] + ']')
    return out or ['No decisions recorded yet [none]']


def build(D):
    members = D.get('members', [])
    files = {}
    files['1-result.yml'] = form(
        'Record a result', 'A quality-gate result for one or more Members: accepted, minor corrections, revision or not completed.',
        'Result',
        'Records the quality-gate outcome in data.json. Members see it in the app within a few minutes (green when accepted, '
        'orange for a revision or not completed) and on the Society board. ' + PUBLIC,
        [dict(type='dropdown', id='item', label='Deliverable', options=deliverables(D), required=True),
         dict(type='dropdown', id='members', label='Members', description='Choose every Member with this result.',
              multiple=True, options=[member_label(m) for m in members], required=True),
         dict(type='dropdown', id='result', label='Result', options=[t + ' [' + k + ']' for k, t in RESULTS], required=True),
         dict(type='textarea', id='note', label='Note', description='Optional: the reviewer, or what needs correcting.')])
    files['2-attendance.yml'] = form(
        'Record attendance', 'Who attended a meeting, from its minutes. Every meeting counts towards the 70% rule.',
        'Attendance',
        'Records attendance in data.json. Every meeting counts towards the 70% rule (Constitution 2.6). An approved absence, '
        'including a notified November exam exemption, is Excused and doesn’t count against the Member. ' + PUBLIC,
        [dict(type='dropdown', id='meeting', label='Meeting', options=meetings(D), required=True)]
        + [dict(type='dropdown', id='att-' + m['id'], label=m.get('role', m['id']), options=[t + ' [' + k + ']' for k, t in ATTEND],
                default=0, required=True) for m in members]
        + [dict(type='textarea', id='note', label='Note', description='Optional: the minutes reference, or the reason for an approved absence.')])
    files['3-notice.yml'] = form(
        'Post a notice', 'A message to every Member: a note on Today, or a pop-up shown once per phone.',
        'Notice',
        'Posting replaces the current notice. Each Member sees it once, on their next visit. ' + PUBLIC,
        [dict(type='dropdown', id='action', label='What to do', options=['Post a new notice [post]', 'Remove the current notice [remove]'],
              default=0, required=True),
         dict(type='dropdown', id='style', label='Show it as', options=['A note on Today [note]', 'A pop-up message, once per phone [popup]'],
              default=0, required=True),
         dict(type='input', id='title', label='Title', placeholder='Formal IC 1 moved'),
         dict(type='textarea', id='text', label='Message', description='A blank line starts a new paragraph.'),
         dict(type='textarea', id='points', label='Short list', description='Optional, pop-up only: one point per line.'),
         dict(type='dropdown', id='sign', label='Signed by', options=[member_label(m) for m in members] + ['Unsigned [none]'],
              default=next((i for i, m in enumerate(members) if m['id'] == 'pres'), 0), required=True),
         dict(type='input', id='until', label='Show until', description='Optional, YYYY-MM-DD: no one sees it after that day.',
              placeholder='2026-11-08')])
    files['4-date.yml'] = form(
        'Change a date', 'Move a deadline, meeting or milestone after a recorded decision.',
        'Date change',
        'Dates follow the Master Calendar unless the Members decide otherwise; record the decision below. Members see '
        '“Dates changed since your last visit” and their calendars catch up on their next refresh. A meeting’s '
        'pre-read moves with it, and a date that runs over several days keeps its length unless you give a new last day. ' + PUBLIC,
        [dict(type='dropdown', id='item', label='Date to change', options=dates(D), required=True),
         dict(type='input', id='date', label='New date', description='YYYY-MM-DD', placeholder='2026-12-13', required=True),
         dict(type='input', id='end', label='New last day', description='Optional, YYYY-MM-DD: only for something that runs over several days.'),
         dict(type='input', id='time', label='New cut-off time', description='Optional, HH:MM, for a deadline that closes at a different time.',
              placeholder='17:00'),
         dict(type='textarea', id='decision', label='Decision on record', description='The minutes or written resolution behind the change.',
              required=True)])
    files['5-link.yml'] = form(
        'Add a link', 'A template, agenda, pre-read or minutes on a date, shown in its panel in the app.',
        'Link',
        'Adds a link to a date: Members see it as a button in that date\u2019s panel (up to four per date). Use a Google Drive '
        'share link to the file, kept on Restricted with Members added, so the link opens only for them. Adding a link with a '
        'label the date already has replaces it. ' + PUBLIC,
        [dict(type='dropdown', id='item', label='Date to link', options=dates(D), required=True),
         dict(type='dropdown', id='action', label='Add or remove', options=['Add this link [add]', 'Remove the link with this label [remove]'],
              default=0, required=True),
         dict(type='input', id='label', label='Label', description='What the button says, in a few words.', placeholder='Thesis template', required=True),
         dict(type='input', id='url', label='Link', description='The full address, starting https://. Not needed to remove a link.',
              placeholder='https://drive.google.com/file/d/…')])
    files['6-decision.yml'] = form(
        'Record a decision', 'An IC decision or written resolution, with its vote, rationale and review date, for the decision register.',
        'Decision',
        'Adds the decision to the register on the Meetings page, with a review date (a month later unless you say otherwise) '
        'so the IC can check whether it played out as the rationale expected. Record it from the approved minutes. ' + PUBLIC,
        [dict(type='dropdown', id='meeting', label='Taken at', options=meetings(D) + ['Written resolution [resolution]'], required=True),
         dict(type='input', id='date', label='Date of a written resolution', description='YYYY-MM-DD. Only for a written resolution; a meeting uses its own date.'),
         dict(type='input', id='title', label='Decision', description='One line, such as: Approve the Portfolio Framework.', required=True),
         dict(type='dropdown', id='outcome', label='Outcome', options=[t + ' [' + k + ']' for k, t in OUTCOMES], required=True),
         dict(type='input', id='vote', label='Vote', description='As minuted, roles not names.', placeholder='3 for, 0 against, 1 absent'),
         dict(type='textarea', id='rationale', label='Rationale', description='Why, in two or three lines.', required=True),
         dict(type='dropdown', id='owner', label='Owner', options=[member_label(m) for m in members] + ['No owner [none]'], required=True),
         dict(type='input', id='review', label='Review on', description='Optional, YYYY-MM-DD. Leave blank for a month after the decision; write none for no review.')])
    files['7-review.yml'] = form(
        'Review a decision', 'Record how a decision played out, and set the next review if there is one.',
        'Review',
        'Closes the review prompt on the decision register and keeps what the IC concluded. ' + PUBLIC,
        [dict(type='dropdown', id='decision', label='Decision to review', options=decisions(D), required=True),
         dict(type='textarea', id='note', label='What happened', description='Did it play out as the rationale expected? What would you do differently?', required=True),
         dict(type='input', id='next', label='Next review', description='Optional, YYYY-MM-DD.')])
    files['config.yml'] = 'blank_issues_enabled: false\n'
    return files


def main():
    files = build(load())
    os.makedirs(OUT, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    print('forms: ' + ', '.join(sorted(files)))


if __name__ == '__main__':
    main()
