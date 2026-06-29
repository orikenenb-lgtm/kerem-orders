# Kerem Orders

Wholesale order-management web app for Kerem Toys. Currently adding an **additive-only CRM module** (see CRM Rules below).

---

## ⚙️ Operating Principles — read first, applies to every task

- **Work until it's actually done.** Don't stop at the first blocker or hand back a half-finished task. Plan → implement → verify → report. Keep going until the goal is met and proven.
- **Self-verify before saying "done."** After any change, run the relevant typecheck, lint, and tests. Never claim success on unverified code. If something fails, fix it and re-run.
- **Debug before escalating.** On an error, try at least 2–3 distinct approaches yourself before asking. Read the actual error, check logs, form a hypothesis, test it.
- **Smallest correct change.** Solve the task; don't refactor unrelated code or rename things "while you're in there."
- **Ask only when truly blocked** — genuine ambiguity, or a destructive/irreversible action (see Guardrails). Otherwise decide and proceed.
- **Talk to the user in Hebrew. Write all code, comments, commit messages, and docs in English.**

---

## 🧱 Tech Stack
<!-- Verified against requirements.txt, requirements-dev.txt, landing/package.json, railway.toml. -->
- **Backend:** Python + **FastAPI** (uvicorn), in `app/` → deployed on **Railway**. Key deps: pydantic, pydantic-settings, supabase, slowapi, requests.
- **Landing / Frontend:** **Next.js 15** (App Router) + React 19 + TypeScript, in `landing/` → deployed on **Vercel**.
- **Database:** **Supabase** (PostgreSQL), accessed via the Python `supabase` client.
- **Package managers:** **pip** for the Python backend (`requirements.txt`), **npm** for the Next.js landing (`landing/package.json`).
- **Integrations:** Rivhit Online (orders/invoicing — token stays backend-only), Resend (email), Telegram (notifications), an internal scheduler for auto-sync.

---

## ▶️ Commands
<!-- These are the REAL scripts for this repo. Backend = Python/pytest; landing = Next.js/npm. -->

**Backend (Python / FastAPI — run from the repo root)**
- Install: `pip install -r requirements.txt`  (dev/test extras: `pip install -r requirements-dev.txt`)
- Dev / run: `uvicorn app.main:app --reload`
- Test: `pytest`
- Note: no separate typecheck/linter is configured for the backend — `pytest` is the gate. Add type hints + pydantic models on new code.

**Landing (Next.js — run from `landing/`)**
- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`  (also type-checks)

**Database / Supabase**
- Schema is managed directly in Supabase (via the Supabase MCP or dashboard); there is no local `supabase/migrations/` folder yet.
- If you start keeping SQL migrations, create `supabase/migrations/` and keep every change additive.
- Never run destructive SQL against production — see Guardrails.

---

## 🗂️ Architecture
<!-- Point to where things live; don't describe them in prose. -->
- `app/` — FastAPI backend (`main.py`, `config.py`, `dependencies.py`, `rate_limit.py`, `scheduler.py`)
- `app/routers/` — API route modules (admin, admin_quotes, admin_sync, auth, orders, products)
- `app/services/` — business logic + external integrations (Supabase, Rivhit, notifications)
- `app/schemas/` — pydantic request/response models
- `landing/` — Next.js marketing/landing site (App Router, RTL / Hebrew-first)
- `tests/` — pytest suite (`test_*.py`)
- `scripts/` — utility scripts
- `docs/` — project documentation
- `.claude/agents/` — custom sub-agents (see Sub-Agents)
- `.claude/rules/` — detailed playbooks (see Playbooks)

---

## 🔒 CRM Module Rules — additive-only, NON-NEGOTIABLE
The CRM is added without any risk to the live order system:
- **Prefix everything `crm_`** — new tables, columns, files, routes, components.
- **Never modify, rename, or migrate existing tables/columns.** Add new ones only.
- **Behind feature flags, off by default.** Existing flows must work untouched when the flag is off.
- **No edits to existing business logic** unless explicitly told. New CRM code stays isolated.
- If a task seems to require touching existing tables/code — stop and ask first.
- Full detail: read `.claude/rules/crm.md` before any CRM work.

---

## 📐 Conventions
- **Backend:** type hints on new code; pydantic models for all request/response I/O. No bare `except:`.
- **Landing:** TypeScript strict mode; no `any` unless justified with a comment.
- UI is Hebrew-first / RTL; support both dark and light mode.
- Run the verification gate (`pytest` for backend; `npm run lint` + `npx tsc --noEmit` for landing) **before every commit**.
- Conventional Commits (`feat:`, `fix:`, `chore:` …), in English.
- Never commit secrets. `.env*` stays out of git.

---

## 🛡️ Guardrails — confirm with the user before any of these
Force-push or history rewrite, deleting/dropping data or tables, editing existing (non-`crm_`) DB schema, production deploys, rotating credentials, or anything irreversible.
<!-- Auto-run permissions are enforced in .claude/settings.json: safe ops auto-approved, destructive ops blocked or set to ask. -->

---

## 🔌 Tools & MCP Connectors — use the right tool, don't reinvent
Connected MCP servers. Prefer them over shelling out when one fits:
- **GitHub** → branches, commits, PRs, issues, repo reads.
- **Vercel** → landing deploys, build logs, env vars, preview URLs.
- **Supabase** → schema, migrations, SQL queries, table inspection.
- **Gmail** → reading/sending project email when asked.
- **Datadog** → logs, monitoring, error investigation (region US1).

Check the live tool list at runtime; if a needed connector is missing, say which one to enable.

---

## 🤖 Sub-Agents & Parallel Work — split the work, stay fast
Delegate to keep the main context clean and run independent work in parallel.

### Auto-delegation by task size — decide yourself, DON'T ask
Judge every task's size and complexity, then delegate to sub-agents automatically and proactively. This is your DEFAULT behavior — you decide based on scope, never ask the user which agents to use.
- **Small task** (one file, a trivial/local change): do it directly in the main thread. No agents needed.
- **Medium task** (a feature touching a few files): hand it to the relevant specialist agent — frontend for UI, db-migrator for any schema work, deployer for deploys — then ALWAYS run reviewer before declaring it done.
- **Large / complex task** (spans multiple layers, e.g. UI + API + DB): break it into independent parts and run them in PARALLEL across agents (Explore for reads, plus the matching specialists), synthesize the results, then run reviewer as the final gate.
- Bias strongly toward delegating over doing everything in the main thread. The bigger and more complex the task, the more you parallelize across agents.
- reviewer is mandatory at the end of every medium and large task — never skip it.

- **Built-ins:** `Explore` for read-only codebase search, `Plan` to research before a strategy. Let these absorb heavy reads instead of dumping files into the main thread.
- **Parallelize** independent parts of a job (e.g. explore backend, landing, and DB at once), then synthesize.
- **Custom agents (in `.claude/agents/`):**
  - `reviewer` — verification gate; runs pytest + landing lint/typecheck + critiques the diff. Use before declaring anything done.
  - `db-migrator` — additive-only Supabase schema changes (enforces CRM rules).
  - `deployer` — Railway (FastAPI) / Vercel (landing) deploys; previews auto, production only after you confirm.
  - `frontend` — Next.js/React/TS UI with RTL + theming + the CRM palette.
- One scope + success criteria per agent. Never have two agents editing the same file.
- Manage/create with `/agents`. Files load at session start — restart after hand-editing one.

---

## 📚 Playbooks — read the relevant file before that type of work
Detailed rules live in `.claude/rules/`. Read the matching file on demand (keeps context lean):
- `.claude/rules/crm.md` — full additive-only CRM architecture (read before ANY CRM work).
- `.claude/rules/testing.md` — what to run and how to verify.
- `.claude/rules/security.md` — secrets, auth, Supabase RLS, input handling.
- `.claude/rules/frontend.md` — RTL, theming, palette, component rules.
- `.claude/rules/deployment.md` — Railway/Vercel runbook + rollback.
- `.claude/rules/git-workflow.md` — branching + conventional commits.
<!-- To force one to ALWAYS load every session, import it: add a line like  @.claude/rules/crm.md  here. -->

---

# 📎 Appendix — Full inlined configuration (self-contained copy)

> **Why this exists:** the canonical config still lives as separate files under `.claude/` — that is what Claude Code actually enforces and loads (permissions from `.claude/settings.json`, sub-agents from `.claude/agents/`, playbooks read on demand from `.claude/rules/`). This appendix mirrors all of them inside CLAUDE.md so the file is self-contained and everything is visible in one place.
>
> **Keep in sync:** if you edit a file under `.claude/`, update its copy here too (and vice-versa). **The files win** — they are what actually runs. Pasting permissions/agents here as text does NOT make them active; only the real files do.

---

## 📎 A — Permissions  (mirror of `.claude/settings.json`)

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(python:*)",
      "Bash(python3:*)",
      "Bash(pip:*)",
      "Bash(pip3:*)",
      "Bash(pytest:*)",
      "Bash(uvicorn:*)",
      "Bash(ruff:*)",
      "Bash(mypy:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(pnpm:*)",
      "Bash(node:*)",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git branch:*)",
      "Bash(git checkout:*)",
      "Bash(git switch:*)",
      "Bash(git stash:*)"
    ],
    "ask": [
      "Bash(git push:*)",
      "Bash(git merge:*)",
      "Bash(vercel:*)",
      "Bash(railway:*)",
      "Bash(supabase db push:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/.env)",
      "Read(./**/.env.*)",
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Bash(git reset --hard:*)",
      "Bash(supabase db reset:*)"
    ]
  }
}
```

---

## 📎 B — Sub-agent definitions  (mirror of `.claude/agents/*.md`)

### B.1 `reviewer`  — `.claude/agents/reviewer.md`

```markdown
---
name: reviewer
description: Use PROACTIVELY before declaring any coding task done. Runs the tests (pytest for the backend) plus the landing lint/typecheck, then reviews the diff for bugs, security issues, and violations of the additive-only CRM rules. Returns a prioritized report. Read-only — never edits files.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are the verification gate for Kerem Orders. You do NOT write or edit code.

When invoked:
1. Run `git status` and `git diff HEAD` to see exactly what changed.
2. Run the project's verification gate and report every failure with file:line:
   - **Backend (Python/FastAPI):** `pytest` from the repo root.
   - **Landing (Next.js):** from `landing/`, run `npm run lint` and `npx tsc --noEmit`.
   - Only run the side that the diff actually touches; run both if unsure.
3. Review the diff for:
   - Bugs, unhandled errors, broken or loosened types (missing/incorrect Python type hints; TS types weakened to `any`).
   - Security issues (injection, secrets committed in code, missing auth checks, the Rivhit/service keys leaking to the frontend).
   - **CRM rule violations:** any change to existing (non-`crm_`) tables, columns, or business logic; a missing `crm_` prefix; CRM code not behind a feature flag.
   - Convention breaks (TS `any`, missing RTL handling, bare `except:`, non-conventional commit messages).
4. Return a prioritized report — **CRITICAL / HIGH / MEDIUM / LOW** — each item with file:line and the minimal suggested fix. Do not modify anything.

If the tests, lint, and typecheck all pass and no CRITICAL/HIGH issues remain, say so clearly so the main agent can proceed.
```

### B.2 `db-migrator`  — `.claude/agents/db-migrator.md`

```markdown
---
name: db-migrator
description: Use PROACTIVELY for any Supabase/Postgres schema work on Kerem Orders. Plans and writes additive-only schema changes following the CRM rules. Use whenever a task needs new tables or columns.
tools: Read, Grep, Glob, Bash, Edit
model: sonnet
---

You are the database migration specialist for Kerem Orders. The live order system must never break.

Hard rules:
- **Additive only.** Create new tables/columns; never ALTER, rename, or DROP existing ones.
- **Prefix every new object `crm_`** — tables, columns, indexes, constraints.
- This repo has **no local `supabase/migrations/` folder**; schema is managed in Supabase (via the Supabase MCP or dashboard). Apply changes there, or — if you start version-controlling SQL — create `supabase/migrations/` and add a new timestamped file per change.
- **Never run destructive SQL against production.** Propose the change; don't auto-apply to prod.

When invoked:
1. Inspect the existing schema first (via the Supabase MCP, `list_tables` / `describe`) so you don't collide with existing names.
2. Write the change as a new, additive unit — a `crm_`-prefixed table/column. Include the `up` SQL; add a `down` / rollback note when feasible.
3. Summarize what the change adds and confirm it touches nothing existing.
4. If the task seems to require modifying an existing (non-`crm_`) table, STOP and report back — do not proceed.
```

### B.3 `deployer`  — `.claude/agents/deployer.md`

```markdown
---
name: deployer
description: Use for deploying Kerem Orders — the FastAPI backend to Railway and the Next.js landing to Vercel. Runs the pre-deploy verification gate, handles preview deploys automatically, and pushes to production ONLY after the user explicitly confirms. Checks Datadog after deploy.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You handle deployments for Kerem Orders. Safety first — the live system stays up.

Before any deploy:
1. Run the verification gate. If anything is red, STOP and report — do not deploy.
   - **Backend (Railway):** `pytest` from the repo root.
   - **Landing (Vercel):** from `landing/`, `npm run lint` and `npm run build`.

Preview deploys (Vercel preview, Railway non-prod):
- Fine to run automatically. Return the preview URL and the build status.

Production deploys:
- **Never deploy to production without explicit user confirmation in this session.**
- State exactly what is shipping (branch / commit) and to where (Railway backend and/or Vercel landing), then wait for a clear "yes."
- After a prod deploy: check the build logs, confirm the Railway healthcheck (`/health`) is green, then watch Datadog (US1) for new errors for a few minutes.
- If errors spike, roll back to the previous good deployment and report.

Env vars: configure via the Vercel/Railway dashboards or their MCP. Never bake secrets into code or logs (Supabase service key, Rivhit token, Resend/Telegram keys stay server-side).

Always end with: what you deployed, where, the URL, and current health.
```

### B.4 `frontend`  — `.claude/agents/frontend.md`

```markdown
---
name: frontend
description: Use for Next.js (App Router) + React + TypeScript UI work on Kerem Orders — the landing site and CRM dashboards. Enforces Hebrew-first/RTL, dark+light theming, and the indigo/teal CRM palette. Use PROACTIVELY for any frontend task.
tools: Read, Grep, Glob, Edit, Bash
model: sonnet
---

You are the frontend specialist for Kerem Orders. The UI lives in `landing/` (Next.js 15, App Router, React 19, TypeScript).

Conventions you always follow:
- **RTL / Hebrew-first.** Use logical CSS (margin-inline, padding-inline, `start`/`end`) — never hardcoded left/right. All copy in Hebrew, centralized for easy editing.
- **Theming.** Support dark and light mode via theme tokens — no hardcoded hex in components.
- **CRM palette:** indigo + teal, consistent across the leads, sales-rep, and collections dashboards.
- **TypeScript strict.** Type all props, no `any`. Small, composable components; keep shared UI together under `landing/app/` (or a `landing/components/` folder).
- **CRM isolation.** CRM components are prefixed `Crm*` and render only when the CRM feature flag is on. With the flag off, render nothing and fire no queries.

Workflow:
1. Read existing components first to match patterns; don't reinvent styling.
2. Make the smallest correct change.
3. Run `npm run lint` and `npx tsc --noEmit` from `landing/` before handing back.
4. Report what you built, where, and any prop/contract the FastAPI backend must provide.
```

---

## 📎 C — Playbooks  (mirror of `.claude/rules/*.md`)

### C.1 CRM — additive-only  — `.claude/rules/crm.md`

```markdown
# CRM Module — Additive-Only Architecture

The CRM is layered on top of the live Kerem Orders system. The order system must keep working untouched at all times.

## Naming
- Every new object is prefixed `crm_`: tables, columns, indexes, constraints, API routes (a `crm` router in `app/routers/`, mounted under `/crm/...`), Next.js components (`Crm*`), and files (under a `crm/` folder or named `crm_*`).

## Database
- **Additive only.** CREATE new `crm_` tables and columns. NEVER ALTER, RENAME, or DROP existing tables or columns.
- If CRM needs data from an existing table, READ it — don't change its schema. Foreign keys go FROM `crm_` tables TO existing IDs, never the reverse.
- Enable Supabase RLS on every new `crm_` table.
- Use the `db-migrator` sub-agent for all schema changes.

## Feature flags
- All CRM features sit behind a flag, OFF by default (a backend setting in `app/config.py`, mirrored to the landing).
- With the flag off, the app must behave exactly as before — no new routes, no UI, no queries firing.

## Code isolation
- Don't edit existing business logic to make CRM work. Add new modules: new routers in `app/routers/`, new services in `app/services/`, new `Crm*` components in `landing/`.
- Shared utilities: import them read-only; don't change their signatures.

## Stop conditions
- If a task appears to require touching existing (non-`crm_`) schema or logic — STOP and ask. Propose an additive alternative instead.
```

### C.2 Testing & Verification  — `.claude/rules/testing.md`

```markdown
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
```

### C.3 Security Checklist  — `.claude/rules/security.md`

```markdown
# Security Checklist

Apply on any code that touches data, auth, input, or external calls.

- **Secrets:** never hardcode keys/tokens. Read from env (`app/config.py` via pydantic-settings). Never commit `.env*`. The Supabase service-role key, Rivhit token, and Resend/Telegram keys stay **server-side only** — never ship them to the landing.
- **Supabase:** enable RLS on new tables; least-privilege policies; use the service key server-side ONLY, never in the frontend.
- **Input:** validate and sanitize all user input (pydantic models on every endpoint). Use parameterized queries / the Supabase client — no string-built SQL.
- **Auth:** every protected route checks auth and ownership. Don't trust client-supplied IDs.
- **Errors/logs:** never log secrets, tokens, or full PII.
- **Rate limiting:** keep `slowapi` limits on public endpoints; don't remove them.
- **Dependencies:** don't add a package without a clear need; prefer well-maintained ones.

Flag anything risky as CRITICAL/HIGH and stop if unsure.
```

### C.4 Frontend Conventions  — `.claude/rules/frontend.md`

```markdown
# Frontend Conventions (Next.js + React + TS)

The UI lives in `landing/` — Next.js 15 (App Router), React 19, TypeScript.

## Language & direction
- Hebrew-first, RTL. Use logical CSS props (`margin-inline`, `padding-inline`, `start`/`end`) — never hardcode left/right.
- All UI strings in Hebrew; keep them centralized for easy editing.

## Theming
- Support dark and light mode. Read colors from theme tokens — no hardcoded hex in components.
- CRM palette: indigo + teal. Keep it consistent across the leads, sales-rep, and collections dashboards.

## Components
- TypeScript strict; type all props. No `any`.
- Small, composable components; keep shared UI together under `landing/app/` (or a `landing/components/` folder).
- CRM components prefixed `Crm*`, rendered only when the CRM feature flag is on.
- Accessibility basics: labels, visible focus states, keyboard navigation.

Use the `frontend` sub-agent for UI work.
```

### C.5 Deployment Runbook  — `.claude/rules/deployment.md`

```markdown
# Deployment Runbook

## Environments
- Backend (FastAPI) → Railway (`railway.toml`: `uvicorn app.main:app`, healthcheck `/health`). Landing (Next.js) → Vercel. DB → Supabase.

## Flow
1. **Pre-deploy:** run the full verification gate — `pytest` (backend) and, from `landing/`, `npm run lint` + `npm run build`. Don't deploy red.
2. **Preview deploys** (Vercel preview / Railway non-prod) — fine to do automatically.
3. **Production deploys require explicit user confirmation.** State what's shipping and to where, then wait.
4. **Env vars:** set via the platform (Vercel/Railway dashboards or MCP). Never bake secrets into code.
5. **Post-deploy:** check build logs; confirm the Railway `/health` check is green; watch Datadog (US1) for new errors for a few minutes. If errors spike, roll back.

## Rollback
- Vercel: redeploy the previous good deployment.
- Railway: redeploy the previous build.
- Report what happened and why.

Use the `deployer` sub-agent. It will never push to prod without your go-ahead.
```

### C.6 Git Workflow  — `.claude/rules/git-workflow.md`

```markdown
# Git Workflow

- Branch per task: `feat/...`, `fix/...`, `chore/...`. Never commit straight to `main`.
- Conventional Commits, in English: `feat: add crm_leads table`, `fix: correct RTL padding on order list`.
- Small, focused commits — one logical change each.
- Run the verification gate before every commit.
- Open a PR for review; let the `reviewer` sub-agent check the diff first.
- NEVER force-push shared branches or rewrite published history without confirmation.
- Never commit secrets, `.env*`, build output, or `node_modules`.
```
