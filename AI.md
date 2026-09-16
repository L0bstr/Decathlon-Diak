# AI.md — Decathlon-Diak

> Status: describes current reality as of the last review, not a target
> design. Read §0 before making any change.

## 0. Rules for AI-Assisted Development
Read this whole file before making changes. In priority order:

1. **Behavior for legitimate users must not change** unless explicitly
   asked. Same data, same UI, same 5-min parse/sync cadence, same tabs.
   Security tightening for *unauthorized* callers (§13) is the one
   exception — that's a fix, not a behavior change.
2. **Never weaken the access model.** `appsscript.json`'s
   `executeAs: USER_ACCESSING` stays as-is (§4). Every new client-callable
   function that reads or writes real data gets wrapped in
   `requireAccess_` (§8) — no exceptions, including "small" ones (§7 flags
   the two existing exceptions as bugs, not precedent).
3. **§13 is a proposal list, not applied state.** Nothing in §13 is true of
   the code yet. When a suggestion is implemented: move its substance out
   of §13, update §6/§7/§8 to describe the new reality, and add a
   `CHANGELOG.md` line. An AI should never assume a §13 item is already
   done without checking the actual file.
4. **Don't touch the fragile areas in §8** without calling it out
   explicitly and explaining the tradeoff first.
5. **Update this file in the same change** that alters structure, data
   model, conventions, or constants — not as a followup. A stale AI.md is
   worse than no AI.md.
6. **Log every change** in `CHANGELOG.md`: date, what, why, which file(s).
7. **Never deploy.** Propose changes only — `clasp push`/`deploy` is
   manual, run by the project owner (§10).
8. When a request conflicts with any rule above, say so and ask, rather
   than silently picking one side.

## 1. Project Purpose
Webapp giving Decathlon student employees visibility into their shifts and
monthly analytics.

- **Source of truth**: a shared Google Sheet ("the database") where shifts and
  assigned student names live.
- **Server**: polls the sheet every X minutes, parses it, stores it, serves
  it to clients on request.
- **Client**: web interface with:
  - [x] single employee view
  - [x] daily shift info
  - [x] monthly summary/analytics
  - [x] automatic shift → Google Calendar sync
  - [ ] user-defined notifications (Discord/email) on DB events (create/delete/take/release shift)
  - [ ] automatic shift assignment with custom priorities

## 2. Runtime Environment
- **Sheet parsing** (`parseSpreadsheet`, `server/Parse.js`): reads the
  previous, current, and next month's tabs from the source spreadsheet,
  writes the result to Script Property `LastSnapshot` as one JSON blob.
  Runs `requireAccess_`-gated as whoever triggers it.
  ⚠️ **No trigger-creation code for this exists in the project.** The
  time-driven trigger must be installed manually via the Apps Script editor
  (Triggers UI), interval = **every 5 minutes**. Not reproducible from
  source alone — a fresh deploy needs this trigger added by hand.
  A manual refresh path also exists: `requestManualRefresh()` (navbar
  button), rate-limited to 1 per 30s via a shared Script Property
  (`LastManualRefresh`), independent of the automatic trigger.
- **Calendar sync** (`server/Calendar.js`): per-user, not global. Each
  student who enables sync gets their own installable time-driven trigger
  (`syncCalendar_`, every 5 min — `SYNC_INTERVAL_MINUTES_`), created by
  their own `enableSync()` call and running under their own account/user
  properties. Sync reconciles the student's shifts (from `LastSnapshot`)
  against `#decathlondiak`-tagged events on their chosen calendar — creates
  missing, updates changed, deletes stale tagged events; only checks the
  current+next month date range (same as the snapshot). A separate
  `clearSyncedEvents()` does a full wipe over a ±1 year window for manual
  resets. A manual "sync now" path (`runSyncNow`) also exists, independent
  of whether the trigger is on.
- Platform: Google Apps Script, V8 runtime, `Europe/Budapest` timezone.
  Advanced Service enabled: **Sheets API v4** (used only for the
  lightweight access-check in `Verify.js`, not for parsing — parsing uses
  `SpreadsheetApp`). Standard GAS constraints apply (6 min execution limit
  per run, daily quotas on Calendar/UrlFetch/triggers).

## 3. Project Structure
**Naming convention**: GAS has no real folders. Every file's "name" is a
flat string that may contain `/`, which the Apps Script editor renders as
a fake tree — e.g. `client/pages/Index` is the file's literal name, used
verbatim in code (`HtmlService.createTemplateFromFile('client/pages/Index')`
in `WebApp.js`, `getPage('client/pages/' + name)`). The `server/`,
`client/src/`, `client/pages/` layout below is that same flat namespace
rendered as a tree, and is also what clasp mirrors locally as real folders.
**Rule**: any new file's name must follow this `area/subarea/Name` scheme,
matching whichever literal string will be used to reference it in code
(`createTemplateFromFile`, `createHtmlOutputFromFile`, `getSheetByName`-
style callers, etc.) — don't introduce a real nested folder that isn't
also the literal GAS file name.

**Providing this project to an AI assistant**: primary method is connecting
this repo via GitHub sync (Claude Projects → GitHub integration) — it
preserves real paths, so this section's tree and the connector's view of
the repo match exactly, no renaming needed. If a repo connection isn't
available and files must be uploaded individually instead, flatten each
name by replacing `/` with `-` (e.g. `client/pages/Index.html` →
`client-pages-Index.html`) using `flatten.sh` (outside the repo) — that
keeps the GAS name recoverable from the uploaded filename alone, so this
tree stays the single source of truth instead of two versions drifting
apart.

```
project/
├── appsscript.json
├── README.md
├── server/
│   ├── Parse.js
│   ├── Verify.js
│   ├── DayInfo.js
│   ├── Stats.js
│   ├── Calendar.js
│   └── Manual.js
└── client/
    ├── src/
    │   ├── WebApp.js
    │   └── Settings.js
    └── pages/
        ├── Index.html
        ├── Home.html
        ├── Statisztika.html
        ├── Ranglista.html
        └── Settings.html
```
**Server side** (`server/`)
- `Parse.js` — parses the source spreadsheet into `LastSnapshot`; also owns
  `requestManualRefresh` (rate-limited manual refresh) and shared date
  helpers (`tabNameForDate_`, `getTargetTabNames_`) reused by other modules.
- `Verify.js` — the access-check layer. `hasSheetAccess()` (cached 5 min per
  user) + `requireAccess_(fn, fallback)` wrapper, applied to every
  client-callable function that touches real data. This **is** the auth
  model — no separate login; access = having read access to the underlying
  Google Sheet, checked live via a minimal Sheets API call.
- `DayInfo.js` — per-day info for the Home page: one student's shift (or
  rest day), pay, coworkers, days-until-next-workday/restday, month
  workday counts. Reads only `LastSnapshot`, never the spreadsheet directly.
- `Stats.js` — monthly aggregates (hours planned/worked, pay, Sundays
  worked, longest streak, favorite area, avg shift length) for one student
  (`getMonthStats`, Statisztika page) or everyone (`getLeaderboard`,
  Ranglista page). Reuses helpers from `DayInfo.js`.
- `Calendar.js` — Google Calendar sync (see §2).
- `Manual.js` — a one-off script (`setLatestVersionUrl`) run manually from
  the Apps Script editor to set the "newer version available" banner URL.
  Not part of the request flow.

**Client side**
- `client/src/WebApp.js` — `doGet()` entry point, serves `Index.html`
  templated with `latestVersionUrl`/`currentUrl`; `getPage(name)` returns a
  page's raw HTML for client-side injection (ungated — page markup isn't
  sensitive, only the data it later requests is).
- `client/src/Settings.js` — per-user settings (`DiakNeve` = the student's
  chosen display name, stored in User Properties) and `getSettingsData()`,
  a combined single-round-trip loader for the Settings page.
- `client/pages/Index.html` — shell: navbar, `#app` container, all shared
  client-side JS (~450 lines, all pages run in this one global scope):
  - `appState` — shared client cache: `diakNeve`, `hasAccess`,
    `dayInfoCache`, `statsCache`, `leaderboardCache`, `settingsCache`,
    `activePageController`.
  - `runScript()` — promisifies `google.script.run`.
  - `loadPage()`/`goToPage()` — tab switching; `pageCache` holds fetched
    page HTML so revisits don't re-fetch.
  - `preloadRemainingPages_()` — after Home loads, sequentially (not
    parallel — pages share DOM ids like `#month-title`) fetches and
    renders Statisztika/Ranglista/Settings into a hidden detached div, so
    their own `<script>` runs once and warms their data caches ahead of a
    real visit.
  - Shared helpers used by multiple pages: `escapeHtml` (XSS guard for
    sheet-sourced names/areas), `renderNoNameMessageHtml`,
    `renderNoAccessMessageHtml`, `progressBar`, `arrowButtonHtml`.
  - Manual DB-refresh button wiring (30s optimistic countdown, resynced to
    server's actual `secondsRemaining` on mismatch).
  - "Newer version available" banner, compared server-side in `doGet`.
- `client/pages/Home.html` — single employee day view (uses `DayInfo.js`).
- `client/pages/Statisztika.html` — monthly stats for one student (uses
  `Stats.js` → `getMonthStats`).
- `client/pages/Ranglista.html` — leaderboard across all students (uses
  `Stats.js` → `getLeaderboard`).
- `client/pages/Settings.html` — name selection, calendar sync toggle/picker.

## 4. External Dependencies
- **Source Google Sheet** — referenced only by ID, via Script Property
  `SpreadSheetID` (never hardcoded). Accessed two ways: `SpreadsheetApp`
  for parsing (`Parse.js`), Advanced Sheets API v4 for the lightweight
  access check (`Verify.js`).
- **Google Calendar** (`CalendarApp`) — listing user's calendars, creating
  installable per-user triggers, reading/writing/deleting tagged events.
- **appsscript.json**: `executeAs: USER_ACCESSING`, `access: ANYONE`. This
  is load-bearing — the whole access-check model (`Verify.js`) only works
  because the web app runs as the visiting user, not the owner. If this is
  ever changed to `executeAs: ME`, `hasSheetAccess()` always returns true
  and the auth model silently breaks.
- No external (non-Google) APIs. Deploy uses clasp, run manually by the
  project owner (§10) — not automated, no CI.

## 5. Data Model

**`LastSnapshot`** (Script Property, JSON, global — one shared parse for
everyone):
```
{
  "2026 Augusztus": {                          // tab name: "YYYY <Hungarian month>"
    "2026-08-01": {                             // ISO date
      "fitti": [ {"time": "9-18", "name": "Julcsi"}, {"time": "14-20", "name": null} ],
      "hegy":  [ ... ]
    }, ...
  }, ...
}
```
- Built from 3 tabs at a time: previous, current, next month.
- `area` names come straight from the sheet's bold row labels in column A.
- `time` is a raw string like `"9-18"` or `"9.5-18"` (fractional hours
  supported); parsed on demand by `parseShiftHours_` in `DayInfo.js`.
- `name: null` = an open/unfilled slot for that time.
- Name cleanup (`cleanName_` in `Parse.js`) strips trailing junk typed
  alongside a name (stray timeframes, `"!!"`, `"int."` trainee notes).

**Other Script Properties**: `SpreadSheetID`, `LastManualRefresh`
(manual-refresh cooldown timestamp), `LatestVersionUrl` (version-check
banner, set manually via `Manual.js`).

**User Properties** (per visiting user): `DiakNeve` (chosen display name),
`SyncCalendarId`, `SyncTriggerId`.

**CacheService**: `hasSheetAccess` result, per-user cache, 5 min TTL
(`Verify.js`).

**Client-side cache** (`appState` in `Index.html`, in-memory only, lost on
reload): `diakNeve`, `hasAccess`, `dayInfoCache`, `statsCache`,
`leaderboardCache`, `settingsCache`, plus `pageCache` for fetched page HTML.
Cleared on: name change (`dayInfoCache`+`statsCache`), manual DB refresh
(all three data caches).

## 6. Coding Conventions (as observed — descriptive, not prescriptive yet)
- ES5-style function syntax throughout (`function() {}`, `var`, no arrow
  functions/`let`/`const` except in `Manual.js`). Consistent across all
  files — likely deliberate for GAS/Rhino-era habit or just unreviewed AI
  output; confirm before assuming it's intentional.
- Trailing underscore = private/internal convention, applied consistently
  (`requireAccess_`, `loadSnapshot_`, `findStudentShift_`, etc.) vs. no
  underscore for client-callable functions (`getDayInfo`, `getMonthStats`).
- Every client-callable data function is wrapped in `requireAccess_(fn,
  fallback)` returning a safe fallback (`null`/`[]`/`{success:false,...}`)
  rather than throwing — callers never need try/catch for access failures.
- Heavy use of file-header JSDoc-style comments explaining *why*, not just
  what (rationale for design choices is written inline — e.g. why
  `executeAs: USER_ACCESSING` matters, why preload is sequential not
  parallel). This is a strength — preserve the pattern in new code.
- Shared helpers are cross-referenced by file+name in comments rather than
  re-declared (e.g. `Stats.js` explicitly notes it reuses `DayInfo.js`
  helpers) — keep doing this instead of duplicating logic.
- No module system — every `.js`/`.gs` file shares one global scope (GAS
  default). Function-name collisions are the real risk, not imports.

## 7. Anti-Patterns / Risk Areas Actually Present
- **No trigger-creation code for the core parse job** — the thing the
  entire app depends on (`parseSpreadsheet` on a schedule) exists only as
  manual config in the live Apps Script project, not in source. Not
  reproducible from this repo alone; a fresh deploy would silently never
  update `LastSnapshot` until someone remembers to add the trigger by hand.
- **`parseTab_` issues one Sheets range read per (area, day) pair**, not a
  batched read. For 3 tabs × ~30 days × N areas that's potentially
  hundreds of small `getRange(...).getDisplayValues()` calls in a single
  parse run (`parseAreaShiftsForDay_`, called from inside a nested
  `days.forEach(areas.forEach(...))`). This is the biggest performance
  risk in the codebase: parse time scales with `days × areas`, and as
  either grows this heads toward the 6-minute trigger execution ceiling —
  a timeout there means a silently stale `LastSnapshot` for everyone.
- **`getPage(name)` takes the page name straight from the client** with no
  allowlist before `HtmlService.createHtmlOutputFromFile('client/pages/' +
  name)`. Low impact today (page markup isn't sensitive, per its own
  comment), but it's an open-ended "load any `.html` file in the project by
  name" primitive with no validation — an easy, free thing to close off.
- **`saveDiakNeve`/`getDiakNeve` are the only client-callable functions not
  wrapped in `requireAccess_`** — every other function that reads or
  writes anything goes through the access check (§3, §8); these two are
  the exception. Low impact (they only touch the caller's own private
  property, never real shift data) but inconsistent with the stated model.
- **Global shared parse state**: `LastSnapshot` is one Script Property for
  *all* users — fine for read load, but means one parse failure or bad
  write affects everyone simultaneously, and there's no versioning/rollback
  if a parse produces bad data (e.g. sheet mid-edit when it fires).
- **Known duplicate-shift edge case** (self-documented, `DayInfo.js:42`):
  if the same name appears twice in one day's slots, `findStudentShift_`
  silently takes the first match. Not yet surfaced to the user as an error.
- Sheet parsing (`getAreaRanges_`) depends on formatting conventions (bold
  text + background-color change marks a new area, a cell reading exactly
  `"óraszám"` ends it) rather than an explicit schema — fragile to manual
  sheet edits that don't preserve formatting.
- **Inconsistent client-callable return shapes**: some functions return
  `{success, reason}` (`enableSync`, `runSyncNow`, `clearSyncedEvents`,
  `requestManualRefresh`), others return raw data-or-fallback
  (`getDayInfo`, `getMonthStats`, `getNames`), one returns a bare boolean
  (`hasSheetAccess`). Each call site already handles its own shape
  correctly, so this isn't a live bug — but it's easy for a future
  AI-assisted change to get wrong by assuming the wrong shape. Worth
  documenting explicitly (§13) rather than force-unifying, since unifying
  would change every call site's actual return contract.
- **Styling isn't isolated either.** `Index.html` carries a 155-line
  `<style>` block (the whole theme: colors, layout, components), and all 5
  pages combined use inline `style="..."` attributes 82 times — several
  patterns repeated verbatim (e.g. `style="color:var(--text-dim);
  margin:0;"` appears 8 times, a card-container style 3 times, a table-cell
  padding pattern 5+ times across `Ranglista.html`). No shared class for
  any of these — each page reinvents the same rules inline.
- No automated tests of any kind currently.

## 8. Do-Not-Touch / Fragile Areas
- **`appsscript.json` → `webapp.executeAs`**: must stay `USER_ACCESSING`.
  Changing it to `ME` breaks the entire access-check model silently (see §4).
- **`Verify.js`**: the access-check is the *only* auth boundary in this
  app. Any new client-callable function that reads/writes real data must
  be wrapped in `requireAccess_`, or it's an open unguarded endpoint (per
  GAS's default "every top-level function is callable from client" model).
- **`Parse.js` sheet-shape assumptions**: `AREA_TERMINATOR_LABEL_ =
  'óraszám'`, header-row day-columns, bold+background area detection.
  Changing sheet layout/formatting without updating these breaks parsing
  silently (no error, just missing data).
- **`Calendar.js` `SYNC_TAG_`**: the only thing distinguishing
  app-managed calendar events from a user's own. Changing this constant
  orphans every previously-created event (sync will stop recognizing them
  and start duplicating).

## 9. Testing Approach
Currently manual only, no written test plan and no automated tests.
Given the parsing logic is the highest-risk area (silent-failure prone,
depends on sheet formatting), a reasonable next step: a small set of
representative sheet fixtures (as JSON, not live Sheets) run through
`parseTab_`/`getAreaRanges_` to catch regressions before they hit
production data. Worth revisiting once code stabilizes rather than upfront.

## 10. Deployment Process
Manual: `clasp push` + `clasp deploy`, run by project owner. AI assistants
should propose code changes only, never attempt to deploy. Note: the
"newer version available" banner (`LatestVersionUrl`) is also set manually
per deploy via `Manual.js` — easy to forget after a new deployment.

## 11. Open Issues / Known Bugs
- Duplicate same-day shift for one name is silently mishandled (§7).
- Trigger for `parseSpreadsheet` isn't in source (5 min interval, set
  manually in the Apps Script editor) — not reproducible on redeploy (§2, §7).
- Roadmap items not yet built: user-defined notifications
  (Discord/email) on DB events; automatic shift assignment with priorities.

## 12. Change Log Expectations
`CHANGELOG.md` exists (created alongside this file). Rule: any AI-assisted
change appends a dated one-line entry (what changed, why, which file).
Adjust the convention once it's been used a few times and you know what's
actually useful to look back on.

## 13. Suggested Improvements
Constraints: output must stay behaviorally identical for legitimate use —
same data, same UI, same 5-min cadence, same tabs/features. Where a change
tightens an edge case for *unauthorized* callers, that's called out
explicitly; it's a security fix, not a feature/UX change.

### Performance (highest impact)
1. **Batch `parseTab_`'s Sheets reads.** Replace the per-(area, day)
   `getRange().getDisplayValues()` calls in `parseAreaShiftsForDay_` with
   one read per tab: `sheet.getRange(1, 1, lastRow, lastCol)
   .getDisplayValues()` (plus the existing single background/font-weight
   reads for area detection, already batched), then slice that in-memory
   2D array for each area/day instead of hitting the Sheets service again.
   Same output, same parse logic — this only changes *how many round
   trips* fetch the data, from `O(areas × days)` down to `O(1)` per tab.
   This is the fix most worth doing first: it directly removes the
   codebase's biggest scaling risk (§7) and gives the most execution-time
   headroom for free.
2. **Move `parseSpreadsheet`'s trigger into code.** Add a one-time
   `setupTriggers_()` (e.g. in a new `Setup.js`) that creates the 5-min
   trigger idempotently (delete-then-recreate by handler name, same
   pattern `disableSyncTriggerOnly_` already uses for per-user triggers).
   Run once per deploy from the editor. Removes the single biggest
   reliability gap: a fresh deploy silently never updating `LastSnapshot`
   until someone remembers to click through the Triggers UI.
3. *(Lower priority — only worth it if the roster grows a lot)*
   `getLeaderboard` recomputes stats per name via `computeStatsForName_`,
   rescanning all dates once per name (`O(names × dates)`). A single pass
   that tallies every name at once would be `O(dates)` total. At current
   scale (a few dozen names, ~30 dates) this isn't measurable — flag it,
   don't chase it yet.

### Security (tightens edge cases only, no change for legitimate use)
4. **Allowlist `getPage(name)`.** Check `name` against the known set of
   page files (`['Home', 'Statisztika', 'Ranglista', 'Settings']`) before
   calling `HtmlService.createHtmlOutputFromFile`, returning a 404-style
   empty output otherwise. Every real navbar click keeps working exactly
   as today; only an arbitrary/invalid `name` from a crafted client call
   is affected.
5. **Wrap `saveDiakNeve`/`getDiakNeve` in `requireAccess_`** for
   consistency with every other client-callable function (§8's stated
   model). Only changes behavior for callers who don't have sheet access
   in the first place — today they can silently set a name that can never
   match real shift data anyway, so this closes the inconsistency without
   removing anything a legitimate user relies on.
6. **Guard `LastSnapshot` against bad parses.** `parseSpreadsheet`
   currently overwrites the shared snapshot unconditionally. Add a sanity
   check (non-empty result, expected tab count) before overwriting, and
   keep the previous good snapshot until a new one passes — a sheet caught
   mid-edit shouldn't be able to blank out data for everyone for 5 minutes.

### Structure / future development
7. **Split pure logic out of the GAS-API-calling files** into a
   dependency-free module (e.g. `Domain.js`): `cleanName_`,
   `parseShiftHours_`, `paidHours_`, `hourlyRateForDate_`,
   `findStudentShift_`, `collectCoworkers_`, `computeStatsForName_`,
   `isoToDate_`/`dateToIso_`, `tabNameForDate_`/`getTargetTabNames_`. None
   of these touch `SpreadsheetApp`/`CalendarApp`/`PropertiesService` — they
   already take plain data in, return plain data out. Isolating them means
   this logic can run in a local Node test with zero GAS mocking, which is
   what makes suggestion 9 below actually cheap to do.
8. **Centralize constants likely to change into one `Config.js`**:
   `SYNC_TAG_`, `AREA_TERMINATOR_LABEL_`, `WEEKDAY_RATE_FT_`/
   `SUNDAY_RATE_FT_` (Hungarian wage rates — these change ~yearly),
   `SYNC_INTERVAL_MINUTES_`, `MANUAL_REFRESH_COOLDOWN_MS_`. One file, one
   place to edit, instead of hunting through whichever file happens to
   define each one today.
9. **Add fixture-based tests once §7's split lands.** Save a few
   representative sheet-shaped fixtures (mimicking `getValues()`/
   `getBackgrounds()`/`getFontWeights()` output) and run `parseTab_`
   against them in a small local Node test — no live Sheet, no clasp
   push needed. Also cover the pure `Domain.js` functions directly
   (`cleanName_` edge cases, `computeStatsForName_` streak/pay math).
   Catches formatting-assumption and pay-calculation regressions before
   they hit production data.
10. **Split `Index.html`'s shared script out of the markup.** ~270 lines of
    shared client JS (cache, page-loading, refresh button, `escapeHtml`,
    etc.) live inline in the shell page. Move to its own `AppShell.html`
    and pull it in via `HtmlService` templating
    (`<?!= include('AppShell') ?>`) — same runtime behavior, but
    diffs/reviews on shell logic vs. markup stop colliding.
11. **Isolate styling the same way, and de-duplicate it while you're there.**
    Move `Index.html`'s 155-line `<style>` block into its own `Style.html`,
    included via the same `<?!= include('Style') ?>` mechanism (loads once,
    applies globally — identical to today since it's already one global
    stylesheet for all pages). Then turn the repeated inline `style="..."`
    patterns (§7 — `.text-dim` label text ×8, the card container ×3, table-
    cell padding/alignment ×5+ in `Ranglista.html`) into real classes
    (`.card`, `.text-dim`, `.stat-cell`, etc.) defined once in `Style.html`
    and referenced by `class="..."` instead of repeated inline `style="..."`.
    Purely a source-organization + de-duplication change — computed styles
    stay pixel-identical, but a future color/spacing tweak happens in one
    place instead of N inline copies, and the HTML in each page gets
    noticeably shorter and easier to scan.
12. **Document the client-callable API surface as a table in this file** —
    every `google.script.run`-called function, its params, its actual
    return shape (per the inconsistency noted in §7), and which
    `requireAccess_` fallback it uses. This is the app's real API contract
    (client ↔ server boundary), currently implicit across 5 files. One
    table here means an AI editing either side doesn't have to re-derive
    it by reading all of `server/` and `client/src/` first.
13. **Surface parse health.** Store `LastParseSuccess`/`LastParseError`
    (timestamp + message) in Script Properties on every `parseSpreadsheet`
    run. Cheap to add, makes "is the 5-min job actually running" answerable
    without checking Stackdriver logs — especially useful once suggestion
    1 changes how that function reads data.
14. **Handle the known duplicate-name case instead of just flagging it.**
    `findStudentShift_`'s TODO (DayInfo.js:42) already names the fix:
    detect >1 match and return an explicit conflict result instead of
    silently picking the first, so the UI can show something instead of
    quietly showing wrong data.

Nothing else stood out as worth changing — the access-check pattern,
snapshot-based read model, and per-user trigger ownership for calendar
sync are all solid given the platform's constraints.
