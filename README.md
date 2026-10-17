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

Each member's pitch cycle is the `cycle` field in the `members` list. Change a member from `"A"` to `"B"` and their analyst deadlines and thesis path move to Cycle B.

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
