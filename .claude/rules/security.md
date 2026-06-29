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
