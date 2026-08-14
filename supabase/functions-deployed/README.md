# DEPLOYED edge-function sources — byte-exact snapshot (2026-08-14)

**This directory is the rollback artifact** required by
`docs/edge-functions-runbook.md` Step 1. Every file here is the **exact,
unmodified source** of the function deployed to project
`mcdchalyzeqjkkgfeznd`, exported with the official read-only
`supabase functions download` (CLI v2.114.0) after a one-time owner
`supabase login` on 2026-08-14.

- **Nothing was sanitized** — a full secret scan found **zero embedded
  literals**: every credential is read at runtime from `Deno.env.get(...)`
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
  `ORIENT_MODEL`) or from the Vault via RPC (`_get_rivhit_token`,
  `_get_sync_secret`).
- A second byte-exact copy lives OUTSIDE Git in the owner's private storage
  (`Documents\kerem-orders-deployed-functions-BACKUP-2026-08-14.zip` +
  `kerem-orders-deployed-export-2026-08-14\` with `MANIFEST.sha256.txt`).
- Do **not** edit these files. The proposed replacement for `rivhit-img`
  lives separately in `supabase/functions/rivhit-img/`.

## Deployed inventory at export time (`supabase functions list`)

There are **11 ACTIVE functions**, not the 5 previously assumed:

| function | version | verify_jwt | notes | local sha256 (first 12) |
|---|---|---|---|---|
| `rivhit-img` | **11** | off (plain `<img>` needs it off; URL allowlist is the gate) | the image proxy this PR proposes to replace; `ezbr_sha256 d0752de68da3…` | `2ce867c824fc` |
| `rivhit-sync` | 8 | off, but internally gated (vault `sync_trigger_secret` or manager JWT) | Rivhit token via Vault RPC | `aa23b6ab031a` |
| `rivhit-push` | 9 | off, internally JWT-gated | Rivhit token via Vault RPC | `de1378522f39` |
| `signup` | 3 | off (public signup by design) | service-role used internally | `a1b0d63b6bc2` |
| `detect-orientation` | 8 | off, internally manager-gated (401 otherwise) | calls Anthropic; env `ANTHROPIC_API_KEY`/`ORIENT_MODEL` | `7c5cf6895595` |
| `image-audit` | 2 | off, internally gated (401) | full-catalog probe writer | `57cc2bf50cd0` |
| `image-thumbs` | 6 | off, internally gated (401) | thumbnail pre-generation | `cebdc61d76c3` |
| `rivhit-probe-img` | 2 | **on** | retired stub — always `410 gone` | `b4625b5a949b` |
| `rivhit-probe-groups` | 2 | **on** | retired stub — always `410 gone` | `b4625b5a949b` |
| `rivhit-probe-prices` | 4 | **on** | retired stub — always `410 gone` | `b4625b5a949b` |
| `rivhit-probe-ops` | 11 | **on** | retired stub — always `410 gone` | `b4625b5a949b` |

The four probe stubs share one identical 4-line source ("Retired diagnostic
function … no delete on the platform").

## Rollback pointer

To roll `rivhit-img` back to the pre-cut-over behavior, deploy
`supabase/functions-deployed/rivhit-img/index.ts` (= deployed **v11**,
`ezbr_sha256 d0752de68da33770435afc477c13cb582499608dba47657b0abdbbd24522c4ba`)
per runbook Step 5. No env vars are required by `rivhit-img` itself.
