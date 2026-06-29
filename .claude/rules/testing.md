# Testing & Verification

Run this gate before claiming any task done (the `reviewer` sub-agent automates it).

## What to run
1. **Backend tests:** `pytest` from the repo root — all green. Tests live in `tests/` (`test_*.py`), using `httpx`/FastAPI's TestClient.
2. **Landing lint:** from `landing/`, `npm run lint` — fix any warning you introduced.
3. **Landing typecheck / build:** from `landing/`, `npx tsc --noEmit` (or `npm run build`, which also type-checks) — zero errors.

Run only the side your change touches; run everything if unsure.

## Rules
- New backend behavior gets a `pytest` test. A bug fix gets a regression test that fails before the fix and passes after.
- Don't delete or weaken a failing test to make it pass — fix the code.
- For CRM code, test BOTH paths: flag-on (feature works) and flag-off (no-op, nothing fires).
- The backend has no separate typecheck/linter configured — `pytest` is the gate. If you add one (ruff/mypy), wire it in here and in CLAUDE.md.
- If a command name here is wrong, get the real one from `requirements*.txt` / `landing/package.json` and update CLAUDE.md.
