# Git Workflow

- Branch per task: `feat/...`, `fix/...`, `chore/...`. Never commit straight to `main`.
- Conventional Commits, in English: `feat: add crm_leads table`, `fix: correct RTL padding on order list`.
- Small, focused commits — one logical change each.
- Run the verification gate before every commit.
- Open a PR for review; let the `reviewer` sub-agent check the diff first.
- NEVER force-push shared branches or rewrite published history without confirmation.
- Never commit secrets, `.env*`, build output, or `node_modules`.
