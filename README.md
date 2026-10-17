# The Rand Society members' app

A small installable web app. Members open the link, pick their role once, and can add it to their home screen. It works offline after the first visit and picks up date changes automatically.

## Changing a date or a line of text

Everything members see comes from **`data.json`**. Nothing else needs editing.

1. On GitHub, open `data.json` and click the pencil icon.
2. Make the change (see the field guide below).
3. Click **Commit changes**.
4. Wait a minute or two, then open **`check.html`** on the site. It tells you whether the file is valid and points to the line if it isn't.

If the file ever has a mistake, members keep seeing the last good version until it is fixed. Nobody gets a blank screen.

### Field guide

Each date is one block in the `society` list (Society-role work) or the `analyst` list (analyst work):

| Field | What it does | Example |
|---|---|---|
| `key` | A unique short name. Never reuse one. | `"nov6"` |
| `date` | The day, written year-month-day. | `"2026-11-06"` |
| `end` | Last day, for something that runs over several days. | `"2026-11-07"` |
| `type` | `deadline`, `meeting` (Sunday 17:00 Teams meeting) or `marker` (a term milestone). | `"deadline"` |
| `time` | A same-day cut-off. | `"17:00"` |
| `title` | The line members see in the list. | `"Outlines and capacity map"` |
| `detail` | The paragraph shown when they tap it. | |
| `who` | `all` (every member sees it) or `some` (only applies to some, such as exam writers). Leave it out to show it only to the roles listed. | `"all"` |
| `roles` | Which roles lead or support it. Role ids: `hor`, `pres`, `pm`, `coo`. | `{"pm": "lead", "hor": "support"}` |
| `titleBy`, `detailBy` | A different title or paragraph for a particular role. | `{"pres": "Capacity map completed"}` |
| `leadLabel`, `labelBy` | The small tag, such as "You chair" or "You minute". | `"You chair"` |
| `cycle` | Analyst dates only: `A` or `B`. Only members in that pitch cycle see it. | `"A"` |

Deadlines without a `time` close at `term.defaultTime` (17:00). Members see this in the Rules panel, and the calendar feeds use it for reminders.

Each member's pitch cycle is the `cycle` field in the `members` list. Change a member from `"A"` to `"B"` and their analyst deadlines and thesis path move to Cycle B.

### Telling members about a change

You don't need to: when a date, end date or time changes, each member sees a short "Dates changed since your last visit" note the next time they open the app, listing what moved. To add a message of your own, add a block like this near the top of the file, and change the `id` each time you post a new one:

```json
"notice": { "id": "2026-11-02", "title": "Formal IC 1 moved", "text": "IC 1 moves to 13 December because two Members are writing exams." },
```

Delete the block when it's no longer needed.

### Calendar reminders

Members can subscribe to their own calendar from the app ("Get reminders in your calendar" under the term plan). The feeds live in `cal/` and are rebuilt automatically by GitHub (see `.github/workflows/calendar.yml`) a minute or two after you change `data.json`. Calendar apps refresh subscribed calendars on their own schedule, usually within a few hours. If the site moves to a new address, update `site.url` so the links inside calendar entries point to it.

**Common mistakes:** every item in a list needs a comma after it except the last one; text goes inside straight double quotes `"like this"`; dates are always `YYYY-MM-DD`.

### Previewing another day

Add `?asof=2027-02-10` to the address to see the dashboard as it will look on that date. Members never see this unless they type it.

## Role links

Each link opens straight to that role. Add `-analyst` to open the analyst view.

- `/#research` · `/#president` · `/#portfolio` · `/#coo`
- `/#research-analyst` and so on

## Files

- `data.json`: all dates and wording
- `index.html`, `app.js`, `app.css`: the app (no build step)
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: home-screen install
- `check.html`: the data checker
- `cal/`: calendar feeds, one per member (built automatically; don't edit by hand)
- `tools/build_ics.py`, `.github/workflows/calendar.yml`: what rebuilds the feeds
