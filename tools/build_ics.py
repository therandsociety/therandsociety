#!/usr/bin/env python3
"""Build one calendar feed per member (cal/<link>.ics) from data.json: deadlines and meetings from both roles, with reminders.
Also writes one file per meeting (cal/m/<key>.ics) for the app's Add to calendar button.

Runs automatically on GitHub whenever data.json changes (.github/workflows/calendar.yml), and needs nothing beyond Python 3.
The rules mirror the app: a member gets the Society dates they lead or attend, and the analyst dates for their pitch cycle."""
import json, os, re, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAST = dt.timezone(dt.timedelta(hours=2))

def esc(s):
    return str(s).replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\r\n', '\\n').replace('\n', '\\n')

def fold(line):
    """Fold to 75 octets per RFC 5545 without splitting a UTF-8 character."""
    out, cur, size = [], '', 0
    for ch in line:
        b = len(ch.encode('utf-8'))
        if size + b > (75 if not out else 74):
            out.append(cur); cur, size = ch, b
        else:
            cur += ch; size += b
    out.append(cur)
    return '\r\n '.join(out)

def day(s):
    return dt.date(*map(int, s.split('-')))

def utc(d, hhmm):
    h, m = map(int, hhmm.split(':'))
    return dt.datetime(d.year, d.month, d.day, h, m, tzinfo=SAST).astimezone(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')

def by(mp, mid, fallback):
    return (mp or {}).get(mid) or fallback

def build(data, member, site_url, stamp):
    mid, cyc = member['id'], member.get('cycle', 'A')
    sector = member.get('sector', '')
    role = member.get('roleShort') or member.get('role')
    default_time = data.get('term', {}).get('defaultTime') or ''
    fill = lambda s: str(s or '').replace('{sector}', sector)
    app = site_url.rstrip('/') + '/#' + member['link']
    events = []
    notes = data.get('analystMeetings', {})
    for e in data.get('society', []):
        part = e.get('roles', {}).get(mid)
        who = e.get('who')
        if not (who in ('all', 'some') or part):
            continue
        title, detail = by(e.get('titleBy'), mid, e.get('title')), by(e.get('detailBy'), mid, e.get('detail'))
        if e.get('type') == 'meeting':
            labels, generic = [], False
            if part == 'lead':
                labels.append(by(e.get('labelBy'), mid, e.get('leadLabel') or 'You lead'))
            elif part == 'support':
                specific = by(e.get('labelBy'), mid, e.get('supportLabel'))
                labels.append(specific or 'You support'); generic = not specific
            note = notes.get(e['key'])
            if note and note.get('cycle') and note['cycle'] != cyc:
                note = None
            if note and note.get('label'):
                if generic:
                    labels = []
                labels.append(note['label'])
            desc = fill(detail) + ('\n\nAs an analyst: ' + fill(note['detail']) if note and note.get('detail') else '')
            link = e.get('link') or (data.get('site') or {}).get('teams') or ''
            events.append(dict(key=e['key'], date=e['date'], time='17:00', end_time='18:30', summary=title + (' · ' + ' · '.join(labels) if labels else ''), desc=desc, kind='meeting', link=link))
        elif part == 'lead' or who == 'some':
            if e.get('type') == 'marker' and part != 'lead':
                continue
            summary = (role + ': ' + title) if part == 'lead' else (title + ' (if writing)')
            events.append(dict(key=e['key'], date=e['date'], end=e.get('end'), time=e.get('time') or (default_time if e.get('type') == 'deadline' and not e.get('end') else ''),
                               summary=summary, desc=fill(detail), kind='deadline' if e.get('type') == 'deadline' else 'marker'))
    for e in data.get('analyst', []):
        if e.get('cycle') and e['cycle'] != cyc:
            continue
        part = e.get('roles', {}).get(mid) or ('lead' if e.get('who') == 'all' else None)
        if part != 'lead':
            continue
        events.append(dict(key=e['key'], date=e['date'], end=e.get('end'), time=e.get('time') or (default_time if not e.get('end') else ''),
                           summary='Analyst: ' + by(e.get('titleBy'), mid, e.get('title')), desc=fill(by(e.get('detailBy'), mid, e.get('detail'))), kind='deadline'))
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Rand Society//Members app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             'X-WR-CALNAME:' + esc('Rand Society · ' + role), 'X-WR-CALDESC:' + esc('Your deadlines and meetings as ' + role + ' and ' + sector + ' analyst.'),
             'X-WR-TIMEZONE:Africa/Johannesburg', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H']
    for ev in sorted(events, key=lambda x: (x['date'], x.get('time') or '')):
        d0 = day(ev['date'])
        link = ev.get('link') or ''
        lines += ['BEGIN:VEVENT', 'UID:' + ev['key'] + '-' + mid + '@therandsociety', 'DTSTAMP:' + stamp, 'SUMMARY:' + esc(ev['summary']),
                  'DESCRIPTION:' + esc((('Join on Teams: ' + link + '\n\n') if link else '') + ev['desc'] + '\n\nOpen the app: ' + app), 'URL:' + (link or app)]
        if ev['kind'] == 'meeting':
            lines += ['DTSTART:' + utc(d0, ev['time']), 'DTEND:' + utc(d0, ev['end_time']), 'LOCATION:' + esc(link or 'Microsoft Teams'),
                      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev['summary']), 'TRIGGER:-PT1H', 'END:VALARM']
        elif ev.get('end') or not ev.get('time'):
            d1 = day(ev['end']) if ev.get('end') else d0
            lines += ['DTSTART;VALUE=DATE:' + d0.strftime('%Y%m%d'), 'DTEND;VALUE=DATE:' + (d1 + dt.timedelta(days=1)).strftime('%Y%m%d'), 'TRANSP:TRANSPARENT',
                      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev['summary']), 'TRIGGER:PT8H', 'END:VALARM']
        else:
            start = dt.datetime.strptime(utc(d0, ev['time']), '%Y%m%dT%H%M%SZ')
            lines += ['DTSTART:' + start.strftime('%Y%m%dT%H%M%SZ'), 'DTEND:' + (start + dt.timedelta(minutes=30)).strftime('%Y%m%dT%H%M%SZ'), 'TRANSP:TRANSPARENT',
                      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('Due in 2 days: ' + ev['summary']), 'TRIGGER:-P2DT8H', 'END:VALARM',
                      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('Due today: ' + ev['summary']), 'TRIGGER:-PT8H', 'END:VALARM']
        lines.append('END:VEVENT')
    lines.append('END:VCALENDAR')
    return '\r\n'.join(fold(l) for l in lines) + '\r\n', len(events)

def longday(d):
    return d.strftime('%A ') + str(d.day) + d.strftime(' %B')

def build_meeting(data, e, site_url, stamp):
    """One meeting on its own (cal/m/<key>.ics), for the app's Add to calendar button."""
    d0 = day(e['date'])
    link = e.get('link') or (data.get('site') or {}).get('teams') or ''
    app = site_url.rstrip('/') + '/#meetings'
    desc = str(e.get('detail') or '')
    if e.get('preread'):
        desc += '\n\nPre-reads by ' + longday(day(e['preread'])) + ', 17:00.'
    desc += '\n\nMinutes by ' + longday(d0 + dt.timedelta(days=2)) + ', 17:00.'
    if link:
        desc += '\n\nJoin on Teams: ' + link
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Rand Society//Members app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             'BEGIN:VEVENT', 'UID:' + e['key'] + '-meeting@therandsociety', 'DTSTAMP:' + stamp,
             'SUMMARY:' + esc('Rand Society · ' + e.get('title', 'Meeting')), 'DESCRIPTION:' + esc(desc + '\n\nOpen the app: ' + app),
             'DTSTART:' + utc(d0, '17:00'), 'DTEND:' + utc(d0, '18:30'), 'LOCATION:' + esc(link or 'Microsoft Teams'), 'URL:' + (link or app),
             'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.get('title', 'Meeting')), 'TRIGGER:-PT1H', 'END:VALARM',
             'END:VEVENT', 'END:VCALENDAR']
    return '\r\n'.join(fold(l) for l in lines) + '\r\n'

def main():
    with open(os.path.join(ROOT, 'data.json'), encoding='utf-8') as f:
        data = json.load(f)
    site = (data.get('site') or {}).get('url')
    if not site and os.path.exists(os.path.join(ROOT, 'CNAME')):
        with open(os.path.join(ROOT, 'CNAME')) as f:
            site = 'https://' + f.read().strip() + '/'
    site = site or 'https://therandsociety.github.io/therandsociety/'
    stamp = (data.get('updated') or '2026-01-01').replace('-', '') + 'T000000Z'
    os.makedirs(os.path.join(ROOT, 'cal'), exist_ok=True)
    for m in data['members']:
        text, n = build(data, m, site, stamp)
        with open(os.path.join(ROOT, 'cal', m['link'] + '.ics'), 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        print('cal/%s.ics: %d events' % (m['link'], n))
    # one file per meeting; files for meetings no longer in data.json are removed
    mdir = os.path.join(ROOT, 'cal', 'm')
    os.makedirs(mdir, exist_ok=True)
    keep = set()
    for e in data.get('society', []):
        if e.get('type') == 'meeting' and e.get('key') and e.get('date'):
            name = e['key'] + '.ics'
            keep.add(name)
            with open(os.path.join(mdir, name), 'w', encoding='utf-8', newline='') as f:
                f.write(build_meeting(data, e, site, stamp))
    for name in os.listdir(mdir):
        if name.endswith('.ics') and name not in keep:
            os.remove(os.path.join(mdir, name))
    print('cal/m/: %d meetings' % len(keep))

if __name__ == '__main__':
    main()
