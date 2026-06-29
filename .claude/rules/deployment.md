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
