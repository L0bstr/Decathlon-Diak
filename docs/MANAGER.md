# MANAGER.md — Decision Philosophy for Decathlon-Diak

Read alongside `AI.md`. `AI.md` is ground truth for what the code *does*.
This file is ground truth for how we decide *whether and how* to change it.

## Starting stance
The project works and is in real use by students who depend on accurate
shift/pay/calendar data. The default answer to "should we change X" is
**no**. A change earns its place; it doesn't get one just for being
technically better in the abstract.

## What "better" means here (tied to §1 of AI.md)
- Reliability of the parse/sync pipeline outranks elegance of the code
  that runs it — if that breaks, nothing else in the app matters.
- Data correctness (pay math, shift assignment) outranks almost everything
  else — this touches real income.
- Security's threat model is narrow and specific: "can someone see shift/
  pay data they're not entitled to." There's no adversarial API partner,
  no money moving through the app, no PII beyond names and shifts. Don't
  import a bigger threat model than this app actually has.
- Maintainability sized to reality: one small-maintainer GAS project for a
  few dozen users, not a company platform. Enterprise patterns (heavy
  abstraction, generic frameworks, defensive layers against threats that
  don't exist here) aren't "better" just because they're general best
  practice — they cost more than they're worth at this scale.

## The filter — every proposed change answers these before entering the backlog
1. **Concrete failure mode.** Not "this isn't best practice" — "this
   breaks / loses data / lets someone see something they shouldn't when
   X happens." If you can't name the X, it doesn't qualify yet.
2. **Who benefits, how much.** Every student? Some students? Just the
   maintainer's future debugging time?
3. **What could this change break, and how would we know?**
4. **Is the effort proportional?** A two-line guard is worth almost any
   plausible failure mode. A multi-file refactor needs a real, observed
   pain point — not a hypothetical one.

A proposal that can't clear #1 with a concrete scenario doesn't go into
AI.md §13/§11. Say so and move on — don't pad the backlog with "good
practice" items nobody actually needs.

## Design decisions already made — don't relitigate without new information
- **Auth = Sheet access, no separate login.** Simplest model that maps
  exactly onto who should see what. A real user system would be more
  "correct" in general and buys nothing here.
- **One shared `LastSnapshot`, not per-user caches.** Simpler; the access
  check happens on read (`Verify.js`), not on what's stored.
- **Per-user calendar-sync triggers, not one centralized job.** Matches
  GAS's actual trigger-ownership model and keeps one student's sync
  failure from breaking everyone's calendar.
- **No test framework / CI yet.** Deliberate given current scale, not an
  oversight. Revisit if manual verification actually stops being enough
  in practice — not preemptively.
- **No deploy automation.** Deploy stays a manual, reviewed action. This
  is a feature, not a gap to close.

*(This list grows as real decisions get made — log new ones here, in this
file, when the manager session settles something. AI.md stays "what is
true," this stays "why we chose it.")*

## When a structural/file change is warranted, and when it isn't
- Split or restructure a file when its size is **actively causing
  confusion or a real mistake right now** — not preemptively, "for
  cleanliness."
- A new abstraction needs at least 2 real duplicated instances already in
  the code, not an anticipated 3rd that might show up later.
- Prefer the smallest change that resolves the actual, observed problem
  over the most thorough/general one.

## Manager session's job, restated
Run every request through the filter above first. If it fails, say so and
explain why — don't add it to the backlog to be polite. If it passes,
scope it precisely per `AI.md`'s process (§0). Bias toward small,
justified changes over ambitious ones.
