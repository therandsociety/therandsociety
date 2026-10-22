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

**A message that opens over the app.** Add `"popup": true` and the notice opens as a message the first time each member opens the app (after the role picker on a first visit), once per phone. Optional fields: `from` (the line above the title, such as "From the President"), `points` (a short list shown under the text), `close` (a paragraph after the list), `sign` (a role, never a name), `button` (the closing button; "Got it" if left out) and `until` (YYYY-MM-DD: no one sees it after that day). In `text` and `close`, a blank line (`\n\n`) starts a new paragraph. Give it a new `id` each time, or members who saw the last one won't see it.

### Calendar reminders

Members can subscribe to their own calendar from the app ("Get reminders in your calendar" under the term plan). The feeds live in `cal/` and are rebuilt automatically by GitHub (see `.github/workflows/calendar.yml`) a minute or two after you change `data.json`. Calendar apps refresh subscribed calendars on their own schedule: Apple Calendar within a few hours, Google Calendar sometimes up to a day. Google also ignores the built-in reminders, so members on Google switch on notifications for the calendar once. If the site moves to a new address, update `site.url` so the links inside calendar entries point to it.

**Common mistakes:** every item in a list needs a comma after it except the last one; text goes inside straight double quotes `"like this"`; dates are always `YYYY-MM-DD`.

### Teams links and today

On the day of a meeting the app counts down to 17:00, shows "Live now" during it, and offers a **Join on Teams** button from 30 minutes before. Put your standing Teams meeting link in `site.teams`, or give a single meeting its own link with a `link` field on that meeting. With no link, everything works except the button. On a deadline day the top card counts down to the cut-off ("3 h 20 min left").

### Previewing another day

Add `?asof=2027-02-10` to the address to see the dashboard as it will look on that date, and `&now=16:45` to preview a time of day. Members never see this unless they type it.

### Opening and updating

The full launch screen plays on the first open of each day; after that the app opens in about a second with a slimmer header. After you publish a change to the app itself, open copies show **A new version is ready · Refresh**. Under the term plan, members see when the dates were last checked, or that they are offline and seeing the saved copy, with a **Refresh** button. Press `/` on a computer (or tap the magnifier beside "Term plan") to search dates, meetings and rules.

On phones the app stays upright unless the member has auto-rotate switched on: `manifest.webmanifest` deliberately sets no `orientation`, because `"any"` makes installed Android apps turn sideways even with the phone's rotation lock on. (Android picks up a manifest change for installed apps within a few days; iPhones always follow their own rotation lock.)

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

The Learn section turns the two required books (The Intelligent Investor and Investment Banking, by 28 February 2027) into chapter checks, levels, badges and, for Investment Banking, banking skills and deal files. Everything it shows comes from **`learn.json`**. Progress stays on each member's phone (localStorage key `trs-learn`); members can move it to a new phone with a backup code, and share a summary with **Share my progress**. The design rests on the research report in the project docs (*Learn: evidence-based question and practice design*).

### How a member learns

- **Book 1 builds judgement.** Recall and concept questions on Graham's ideas, then scenario questions: an answer and the reason for it, sorting (defensive or enterprising, investment or speculation), and Graham's numbers applied in rands (margin of safety, the 25–75 rule, the defensive screen).
- **Book 2 builds technical skill.** Calculations are typed in, with new figures on every try. Help fades with the member: a worked example first (with one "check the method" question to answer before they start), then the working with one step left blank, then nothing. A chapter check passes with 6 of 8, including at least 3 calculations right. Each chapter's calculations, mistakes to find and estimates follow a plan per level (`books[].check.plans`).
- **Sure or Not sure.** Every answer is submitted with one of the two. On a question not yet got right, Sure and right earns half its XP again and Sure and wrong costs its XP; on questions already got right, Sure only feeds the calibration measure, so reviews can't be farmed for points. A session never goes below zero and confidence never changes a pass. Learn shows how often a member's Sure is right and, from three weeks after a skill is first met, how much of it has held (the aim is 80% for both).
- **Spaced practice.** Missed questions come back after 1, 3, 7 and 16 days (confident misses first). Every banking skill of a passed chapter comes back 2, 7, 16 and 35 days after the pass (the next day if the check didn't show it right), with new figures, until it is **secure**: right on three days at least a week apart, one of them typed. A chapter is **desk-ready** when every skill in it is secure and its deal file is closed. There is a weekly mix of six questions from passed chapters, a short warm-up after a break, and a pre-thesis review of Comps and DCF in the week before each Pitch Cycle's thesis is due (it reads `a-thesisA` or `a-thesisB` from `data.json`). Practice pauses with the programme.
- **Before you read.** Each Investment Banking chapter opens with three unmarked questions to try before reading; guessing first makes the reading stick.
- **Deal files and tombstones.** Each Investment Banking chapter has one fictional company, a page of facts in rands and six linked questions; each gives the result it needs, so one slip doesn't sink the rest. Closing it (5 of 6) adds a tombstone to the member's Deal book, showing the figure they worked out. Commendations mark a first desk-ready chapter, a clean deal file, a month of weekly mixes and sound judgement.
- **Paper LBO sprint.** Once Chapter 4 is passed, three quick LBO estimates against one clock, with a personal best (`schedule.sprint`).
- **Shared progress, later.** `learnSummary()` in `app.js` already produces what a shared store would hold for the President's view (level, chapters, skills by state, deal files, how often Sure is right; no answers).

### The file

| Field | What it does |
|---|---|
| `programme` | `start` and `due` dates for the pace line, and `pauses`: breaks the pace and practice leave out, such as `{"from": "2026-12-19", "to": "2027-01-04", "label": "Year-end recess"}` |
| `rules` | Chapter check size and pass mark (8 and 6), promotion review (10 and 8), book final (20 and 16, with its mix), `retry: "nextDay"`, `inOrder`, `confidence` (Sure and Not sure on or off) |
| `xp` | Points: `t1`, `t2`, `t3` by tier; `calc`, `err` and `case` for calculations, mistakes and deal-file questions; `deal` for closing a file; `weekly`, `warm`, `pret`; `sure` (0.5: the share added for Sure and right) |
| `schedule` | `skill` and `miss` (days between returns), `after` (days to the next return for a skill not yet secure), `weekly` (questions in the weekly mix), `reviewMax`, and `preThesis` (`dateKey`, `days`, `units`) |
| `tiers`, `levels` | The three question tiers and the seven levels from Intern to Partner, each with its check mix (recall, concept, applied) |
| `books` | Each book's chapters (`units`): `id`, `label`, `short`, `title`, `pages`, `mins`, `ideas`, `sections`. A book with `check` uses plans: `pass`, `passCalc`, `support` (help by level: `walk`, `fade`, `solo`), `plans` (per level: `r` recall, `c` concept, and `a`, the applied slots: `num`, `err`, `est`, `mcq3`, `case3`), `final`, `promoCase` |
| `skills` | Banking skills: `id`, `unit`, `name`; `typed: false` for a skill with no calculation |
| `cases` | Deal files: `id`, `unit`, `title` (the company), `deal` (the tombstone's deal type), `lead`, `vars`, `let`, `when`, `facts` (label and value pairs), `tomb` (`value`, `line`), `pass`, `items` (the linked questions) |
| `questions` | One per line: `id`, `unit`, `tier`, `type`, `skill`, `q`, `why`, `src` (where to reread), `pre: true` for a before-you-read question, and the fields for its type (below) |
| `facts`, `badges` | Fun facts per chapter or book, and the badge shelf (`kind: "desk"` badges need their chapters desk-ready) |

| `type` | Fields |
|---|---|
| `tf` | `answer`: true or false |
| `mcq` | `options`, `answer` (the number of the right option, counting from 0), `miss` (optional: what each wrong option shows, `null` for the right one) |
| `two` | Answer and reason: `options` and `answer`, then `reason` with `q`, `options` and `answer`; `aq` labels the first part. `keep: true` keeps the options in the order written (used for True / False, then why) |
| `num` | A calculation: `ans` (its formula), `in` (`R`, `Rm`, `Rbn`, `m`, `x`, `%` or none), `dp`, `tol`, `work` (the working shown after), `errs` (likely slips, each a formula `v` and a `why`), `steps` (for the worked example and the blank step: `t`, `v`, `in`, `dp`, `key`), `ask`, `hint`, `signed` |
| `est` | An estimate in the head: `ans`, `band` (lowest and highest accepted), `secs` (target time), `in`, `dp` |
| `err` | Find the mistake: `lines`, `bad` (the wrong line), `fix` with `q`, `options` and `answer` |
| `order` | `items`, written in the right order (the app shuffles them) |
| `dir` | Which way: `measures`, each with `name` and `dir` (`up`, `down` or `same`); `mag` asks for the size too |
| `sort` | `cats` (two) and `items`, each with `t` and `c` (0 or 1) |

**Figures that change.** A question with `vars` draws new figures every try. Each variable is `[lowest, highest, step, example]` or `{"pick": [...], "base": ...}`; `let` works out the rest; `when` lists conditions that must come out above zero (a draw that fails is drawn again, and the example must pass them too). Formulas use `+ - * / ^`, brackets, `min`, `max`, `abs`, `floor`, `ceil`, `sqrt`, `ln`, `exp`, `pow` and `round(x, places)`, never code. In text, `{x|R2}` shows R12.35, `{x|R0m}` R1,235m, `{x|R1bn}` R1.2bn, `{x|1%}` 12.4%, `{x|1x}` 6.5×, and `{x|2}` a plain number. A deal file's variables are shared by all its questions.

**Writing questions.** In our own words, never text pasted from the books. Applied cases use rands and fictional companies; the books' own historical figures stay in dollars. Give every wrong option a reason to tempt someone (a real misunderstanding), keep the options about the same length, and for calculations list the likely slips in `errs`, so a member who makes one is told what went wrong.

**Fixing a question.** Members can tap **Report this question**; the message carries its `id` (such as `ib3-28`). Find that line in `learn.json`, correct it, commit, then open `check.html`. It checks the structure and then draws every question the way members see it, with the app's own engine: those with changing figures 120 times each, confirming the answer as displayed is marked right, that no listed slip would be marked right, and that no figure comes out broken. Options are shuffled in the app, so `answer` just points to the right one.

**Learn's look.** Learn has two looks, and each member chooses with the **Society look** switch at the bottom of the Learn page (the choice stays on their device). **Stripes** is the default: 1970s racing stripes on cream, where the stripes carry meaning. The Learn header climbs one step for every level reached; each question type has a colour (recall teal, concept marigold, applied tangerine); passed chapters fill teal and full marks marigold; banking skills fill teal when secure and marigold when desk-ready; tombstones are espresso slabs with the stripes across the top; a pass breaks the stripes out of their range; a level-up climbs to the new level's ring. Burgundy is the action colour and red is kept for wrong answers and falling behind. Pretoria's jacarandas flower in the header and fall when a member passes. The **Society look** shows Learn in the app's own navy and silver, with navy tombstones carrying the TRS monogram. The default is one line in `app.js` (`var SKIN_DEFAULT = 'stripes';`); the look's artwork, medals and rings sit in `makeSkin()` and its styles in the "Learn skin: stripes" block of `app.css`, so another look can slot in without touching the rest. The certificate keeps the Society look either way. Learn-only fonts: Michroma (big titles) and Fraunces (headings and scores); questions stay in IBM Plex Sans. Members can turn on **Sound effects** (off by default) and **Vibration** (on by default) under **Effects** on the Learn page. Motion stops for anyone with reduced motion turned on.

## Role links

Each link opens straight to that role. Add `-analyst` to open the analyst view.

- `/#research` · `/#president` · `/#portfolio` · `/#coo`
- `/#research-analyst` and so on

## Files

- `data.json`: all dates and wording
- `learn.json`: the reading programme and question bank
- `index.html`, `app.js`, `app.css`: the app (no build step)
- `fonts/`: IBM Plex Sans and Newsreader for the app; Fraunces and Michroma for Learn's stripes look
- `sw.js`: offline support
- `manifest.webmanifest`, `icons/`: home-screen install
- `check.html`: the checker for both files (it loads `app.js` to draw every Learn question with the app's own engine)
- `cal/`: calendar feeds, one per member, and `cal/m/`, one file per meeting (built automatically; don't edit by hand)
- `tools/build_ics.py`, `.github/workflows/calendar.yml`: what rebuilds the feeds
