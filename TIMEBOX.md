# TIMEBOX

**Mode: A (Docker Compose).** `make up` ran cleanly; no `setup_issue.md` needed.

| Phase | Time |
|---|---|
| Setup — read the handout, `npm install`, first Docker build, `.env`, stack verified live | ~0:45 |
| Read + run + audit — `reproduce_bugs.sh`, source read, live probing of every money path | ~0:30 |
| One verified fix + characterization test (RED → GREEN → rollback proof → e2e re-verify) | ~0:25 |
| Memo, evidence, reproduction stubs | ~0:25 |
| **Total** | **~2:05** |

Under the 3–4h guide. The audit was fast because the defects are dense and the repro
script surfaces the first one immediately; the time went into *proving* them against
the running Postgres rather than into breadth.

## Tooling disclosure

AI assistance (Claude) was used for source review, drafting, and generating the
verification commands — which the handout explicitly permits ("you may use any tools,
libraries, or references you like"). Every defect below was confirmed by executing it
against the running stack and reading the resulting DB rows; nothing here is asserted
from code-reading alone. I can derive and defend each finding live.

## Known environment note

`reproduce_bugs.sh:52` uses `date +%s%3N` for the latency samples, which is GNU-specific
and fails on macOS/BSD `date`:

```
./reproduce_bugs.sh: line 53: 17858758063N: value too great for base (error token is "17858758063N")
```

Sections 1–4 of the script (the parts that prove the money defects) run fine; only the
latency print is affected. Re-measured separately with `python3` — ~98–142 ms per guarded
request, consistent with auth being resolved twice per request. Not a defect in the
application, so it was left unpatched rather than spending diff budget on it.

## Scope discipline

Per the handout's "do not gold-plate or rewrite": **one** defect was implemented (the
settlement webhook amount/idempotency bug, 27 insertions / 8 deletions, flag-guarded).
Four further verified defects — unverified webhook signatures, missing ownership authz,
unbounded/replayable refunds, non-idempotent join — were written up in `audit_memo.md`
and, for the top two, turned into runnable failing-test stubs in `test/stubs/` rather
than fixed. That was a deliberate scoping choice, not a time constraint.
