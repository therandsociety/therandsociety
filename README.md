# The Rand Society members' app

A small installable web app. Members open the link, pick their role once, and can add it to their home screen. It works offline after the first visit and picks up date changes automatically.

## Changing a date or a line of text

Everything members see comes from **`data.json`** (dates and wording) and **`learn.json`** (the reading programme; see [Learn](#learn)). Nothing else needs editing.

1. On GitHub, open `data.json` and click the pencil icon.
2. Make the change (see the field guide below).
3. Click **Commit changes**.
4. Wait a minute or two, then open **`check.html`** on the site. It checks both files, says whether they are valid and points to the line if one isn't.

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
| `status` | Quality-gate result per member: `accepted`, `minor`, `revise` or `incomplete` (see below). | `{"pm": "accepted"}` |
| `preread` | Meetings only: the day pre-reads go out (17:00). Leave it out and the meeting shows no pre-read step. | `"2027-02-13"` |
| `links` | Up to four links shown on the date: a template, folder or pre-read. Full https:// addresses only. | `[{"label": "Thesis template", "url": "https://…"}]` |

Deadlines without a `time` close at `term.defaultTime` (17:00). Members see this in the Rules panel, and the calendar feeds use it for reminders.

Each member's pitch cycle is the `cycle` field in the `members` list. Change a member from `"A"` to `"B"` and their analyst deadlines and thesis path move to Cycle B.

### Recording accepted work

Members can mark their own deadlines as submitted (only they see that). When a piece of work passes the quality gate, record it so it turns green for that member, and everyone sees the same truth. Add a `status` to the date, naming each member by role id:

```json
"status": { "pres": "accepted", "coo": "revise" }
```

The four outcomes follow Term Plan 19.1:

| Value | Members see |
|---|---|
| `accepted` | Green, "Accepted" |
| `minor` | Green, "Minor corrections" (accepted subject to minor corrections) |
| `revise` | Orange, "Revision needed", until you change it, even if the member had marked it submitted |
| `incomplete` | Orange, "Not completed" |

Analyst deadlines live in the `analyst` list; for example, accepted sector briefs go on the `a-brief` item. Every Member sees every recorded result on the **Society board** (Plan section), in keeping with equal standing and the collective traffic-light reviews.

### Reviewer lists ("Waiting on you")

The Head of Research and Portfolio Manager see a **Waiting on you** card listing the work other Members will send them for review. It appears a fortnight before the work arrives and drops off once its review date has passed or the work is accepted. The rows come from `reviewQueues`, keyed by the reviewer's role id:

```json
"reviewQueues": {
  "pm": [ { "what": "thesis candidate", "arrives": "a-brief", "due": "a-cand", "doneOn": "a-cand", "dueLabel": "Pre-clear by" } ]
}
```

| Field | What it does |
|---|---|
| `what` | Shown after the Member's sector, such as "TMT thesis candidate". |
| `arrives` | The analyst key for the day the work can first come in. |
| `due` | The analyst key for the day the review is due. |
| `doneOn` | The analyst key whose `status` marks it accepted (defaults to `arrives`). |
| `dueLabel` | The wording before the date, such as "Accept by". |

Write `{cycle}` inside a key (`a-thesis{cycle}`) and each Member's own pitch cycle is filled in. Recording `"accepted"` for a Member on the `doneOn` item turns their row green.

### Readiness checklists

Some deliverables carry a checklist of what the Society's documents require (sector brief, thesis candidate, full thesis, final pre-read, secondary contribution, handover). Members tick items as they work; ticks stay on their phone, and the next-deadline card shows "Checklist 2/8". Each checklist lives under `checklists`:

```json
{ "id": "brief", "for": ["a-brief"], "title": "Sector brief and watchlist", "source": "Term Plan v1.1, sections 4.5 and 5.1", "items": ["Value chain", "…"] }
```

`for` names the date keys it belongs to. Ticks are saved by position, so add new items at the end of a list; inserting one in the middle shifts members' ticks.

### Library

Templates and folders (Term Plan 6.1, the Template and Asset Pack) can be listed under `library` as `{ "title", "url", "note" }`. The Library card appears under You once there is at least one link.

### Telling members about a change

You don't need to: when a date, end date or time changes, each member sees a short "Dates changed since your last visit" note the next time they open the app, listing what moved. To add a message of your own, add a block like this near the top of the file, and change the `id` each time you post a new one:

```json
"notice": { "id": "2026-11-02", "title": "Formal IC 1 moved", "text": "IC 1 moves to 13 December because two Members are writing exams." },
```

Delete the block when it's no longer needed.

### Calendar reminders

Members can subscribe to their own calendar from the app ("Get reminders in your calendar" under the term plan). The feeds live in `cal/` and are rebuilt automatically by GitHub (see `.github/workflows/calendar.yml`) a minute or two after you change `data.json`. Calendar apps refresh subscribed calendars on their own schedule: Apple Calendar within a few hours, Google Calendar sometimes up to a day. Google also ignores the built-in reminders, so members on Google switch on notifications for the calendar once. If the site moves to a new address, update `site.url` so the links inside calendar entries point to it.

**Common mistakes:** every item in a list needs a comma after it except the last one; text goes inside straight double quotes `"like this"`; dates are always `YYYY-MM-DD`.

### Teams links and today

On the day of a meeting the app counts down to 17:00, shows "Live now" during it, and offers a **Join on Teams** button from 30 minutes before. Put your standing Teams meeting link in `site.teams`, or give a single meeting its own link with a `link` field on that meeting. With no link, everything works except the button. On a deadline day the top card counts down to the cut-off ("3 h 20 min left").

### Previewing another day

Add `?asof=2027-02-10` to the address to see the dashboard as it will look on that date, and `&now=16:45` to preview a time of day. Members never see this unless they type it.

### Opening and updating

The full launch screen plays on the first open of each day; after that the app opens in about a second with a slimmer header. After you publish a change to the app itself, open copies show **A new version is ready · Refresh**. Under the term plan, members see when the dates were last checked, or that they are offline and seeing the saved copy, with a **Refresh** button. Press `/` on a computer (or tap the magnifier beside "Term plan") to search dates, meetings and rules.

## Sections

A bar along the bottom on phones, and a sidebar on computers, switches between five sections (Today, Plan, Meetings, Learn and You). Each keeps its own scroll position; tapping the current one returns to the top, and the phone's Back button returns to Today before it leaves the app.

| Section | What it shows |
|---|---|
| **Today** | Your next deadline, the week ahead, the next meeting with its agenda, pre-reads and minutes dates, and "Waiting on you" for reviewers |
| **Plan** | The term timeline and every date for the chosen role |
| **Meetings** | The next meeting in full (who leads, what to prepare), and every IC and learning session this term |
| **Learn** | The required reading: level, question of the day, both books chapter by chapter, checks, review deck and badges |
| **You** | What the role owns and its safeguard (or the analyst's coverage, thesis path and scorecard), Send my update, the Library, rules, calendar reminders and installing the app |

Meetings come from the `meeting` items in `society` (with `analystMeetings` for the analyst notes). Around each Sunday meeting the app shows the agenda (Friday 17:00) and minutes (Tuesday 17:00), as the Master Calendar's meeting protocol sets. A pre-read step appears only where a meeting has a `preread` date: the calendar sets one on Friday 4 December for IC 1 and on the Saturday before each Pitch IC. Each meeting has **Add to calendar** (a calendar file built with the feeds, in `cal/m/`) and **Can't attend** (a ready apology for an official channel). An orange dot on Today means something you lead is due within two days; a dot on Meetings means a meeting is today.

Link straight to a section with `/#plan`, `/#meetings`, `/#learn` or `/#you` (old `/#role` and `/#guide` links open You). On Android and computers, pressing and holding the installed app's icon offers shortcuts.

### Header photos

Plan, Meetings, Learn and You open on a plain navy band. To give one a photo, as Today has, put the picture in the `img` folder and name it in `data.json`:

```json
"photos": {
  "plan": "img/plan.webp",
  "meetings": { "src": "img/meetings.webp", "phone": "img/meetings-phone.webp", "position": "50% 40%" }
}
```

`phone` is an optional taller crop for phones; `position` moves the focal point (left-right, then top-bottom). Keep each picture under about 300 KB (WebP is best) so the app stays quick on mobile data. Each photo is downloaded only when that section is opened, then kept for offline use.

## Learn

The Learn section turns the two required books (The Intelligent Investor and Investment Banking, by 28 February 2027) into chapter checks, levels and badges. Everything it shows comes from **`learn.json`**. Progress stays on each member's phone (localStorage key `trs-learn`); members can move it to a new phone with a backup code, and share a summary with **Share my progress**.

| Field | What it does |
|---|---|
| `programme` | `start` and `due` dates for the pace line, and `pauses`: breaks the pace leaves out, such as `{"from": "2026-12-19", "to": "2027-01-04", "label": "Year-end recess"}` |
| `rules` | Chapter check size and pass mark (8 and 6), promotion review (10 and 8), book final (20 and 16, with its recall/concept/applied mix), `retry: "nextDay"`, `inOrder` |
| `xp`, `levels` | XP per question tier and event; the seven levels from Intern to Partner, each with its check mix (recall, concept, applied) |
| `books` | Each book's chapters (`units`): `id`, `label`, `title`, `pages`, `mins` (reading time), `ideas` (three key ideas), `sections` (reading ticks) |
| `questions` | One per line: `id`, `unit`, `tier` (1 recall, 2 concept, 3 applied), `type` (`tf` or `mcq`), `q`, `options` (mcq), `answer` (true/false, or the number of the right option counting from 0), `why` |
| `facts`, `badges` | Fun facts per chapter or book, and the badge shelf |

**Fixing a question.** Members can tap **Report this question**; the message carries its `id` (such as `ib3-28`). Find that line in `learn.json`, correct it, commit, then open `check.html`. Options are shuffled in the app, so the right answer can sit anywhere in the list; `answer` just points to it.

**Learn's look.** Learn deliberately breaks from the Society palette with a skin of its own, set by one line in `app.js`: `var SKIN_DEFAULT = 'stripes';`. **Stripes** (1970s racing stripes on cream) makes the stripes carry meaning: the Learn header climbs one step for every level reached; each question type has a colour (recall teal, concept marigold, applied tangerine); passed chapters fill teal and full marks marigold; a pass breaks the stripes out of their range; a level-up climbs to the new level's ring. Burgundy is the action colour and red is kept for wrong answers and falling behind. In October and November Pretoria's jacarandas flower in the header and fall when a member passes. **Coast** (a 1980s Miami-coast look) is the alternative, and `''` returns Learn to navy and silver. Each skin is a block at the end of `app.css` plus its entry in the skin registry in `app.js`, so a new skin slots in without touching anything else. The certificate keeps the Society look. Fonts for Learn only: Fraunces and Michroma (Stripes), Kanit and Michroma (Coast); questions stay in IBM Plex Sans. Members can turn on **Sound effects** (a chime on a pass and an opening bell on a level-up with Stripes; a synth sting with Coast; off by default) and **Vibration** (on supported phones; on by default) under **Effects** on the Learn page; both settings stay on their device. Motion stops for anyone with reduced motion turned on. The preview build's "Preview only" card switches between the skins and turns the jacarandas on or off.

## Role links

Each link opens straight to that role. Add `-analyst` to open the analyst view.

- `/#research` · `/#president` · `/#portfolio` · `/#coo`
- `/#research-analyst` and so on

## Files

- `data.json`: all dates and wording
- `learn.json`: the reading programme and question bank
- `index.html`, `app.js`, `app.css`: the app (no build step)
- `fonts/`: IBM Plex Sans and Newsreader for the app; Fraunces, Kanit and Michroma for Learn only
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: home-screen install
- `check.html`: the checker for both files
- `cal/`: calendar feeds, one per member, and `cal/m/`, one file per meeting (built automatically; don't edit by hand)
- `tools/build_ics.py`, `.github/workflows/calendar.yml`: what rebuilds the feeds
