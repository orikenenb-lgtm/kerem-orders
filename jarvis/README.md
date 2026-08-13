# J.A.R.V.I.S

Built from [Cindy Zhu's guide](https://cindyzhu.com.au/guides/build-your-own-jarvis-with-claude.html).

You don't download Jarvis, you assemble it. Claude Code is the brain; the
connectors are the hands. Everything in this folder is the assembly — the
dashboard, the voice loop, the skills, the sub-agents, the routine.

```
jarvis/
├── dashboard.html          the command center — one self-contained file
├── jarvis_data.js          ← the only file you touch day to day
├── server.py               the voice loop: mic → claude -p → Fish Audio
├── .env.example            copy to .env, add your keys
├── scripts/
│   ├── install.sh          links the skills + agents into ~/.claude
│   ├── add-connectors.sh   adds MCP connectors, one at a time, verified
│   └── generate_brief.py   builds jarvis_brief.mp3 for the BRIEF ME button
└── claude/
    ├── skills/customer-support/    voice, FAQs, refund policy, templates
    ├── agents/tom.md               dev work — the only holder of GitHub
    ├── agents/mira.md              inbox triage — drafts, never sends
    └── routines/daily-brief.md     the 9am routine (set this up LAST)
```

---

## See it in 30 seconds

```bash
cd jarvis
python3 -m http.server 8765      # or just open dashboard.html
open http://localhost:8765/dashboard.html
```

That's the dashboard with sample data. It won't talk yet — that's next.

---

## The order to build it in

Straight from the guide, and the order matters: **read-only before write, one
connector before two, verified before trusted.**

### 1. Claude Code + one read-only connector

```bash
npm install -g @anthropic-ai/claude-code
claude                       # sign in
```

Then add exactly one connector and read-test it:

```bash
./scripts/add-connectors.sh
```

It walks you through them one at a time and refuses to bulk-install. Stop
after the first one. Confirm with `/mcp` inside `claude`.

Needs a **Claude Pro** ($20/mo) or **Max** ($100/mo) plan — voice, Chrome,
Design, sub-agents and routines all live on paid plans and share the same
usage budget. Max is the honest pick if you'll run a daily routine.

### 2. Voice

**Talking to it** — free, built in, no setup:

```
/voice          in Claude Code, then hold Space and speak
/voice tap      tap-to-start, tap-to-send
```

Needs a Claude.ai login (not a raw API key) and a local mic. Doesn't use
tokens. [Docs](https://code.claude.com/docs/en/voice-dictation)

**Talking back**, in a British butler voice — [Fish Audio](https://fish.audio/?fpr=cindy10):

```bash
cp .env.example .env
# put your key in FISH_AUDIO_API_KEY
# browse the Voice Library for "butler" or a calm British male voice;
# the id in the URL (fish.audio/m/<id>/) is your FISH_AUDIO_REFERENCE_ID
```

Then give BRIEF ME something to say:

```bash
set -a && . ./.env && set +a
python3 scripts/generate_brief.py --print     # check the words first
python3 scripts/generate_brief.py             # writes jarvis_brief.mp3
```

Emotion tags work on S2.1: `[calm] Your 3pm is confirmed. [amused] Shall I
cancel the 4pm as well?`

> Don't clone a real celebrity's voice for anything you publish — likeness
> and IP risk. Use a library voice or your own.

**The full loop** — actually talking to it:

```bash
set -a && . ./.env && set +a
python3 server.py
open http://localhost:8765
```

Press **🎙 SPEAK**. The browser transcribes you, `/ask` runs it through
`claude -p` with all your skills and connectors attached, and the reply comes
back in the British voice while the sphere pulses.

Open it at **localhost**, not the `.html` file — the mic won't work over
`file://`.

### 3. Support knowledge base (no Gmail yet)

```bash
./scripts/install.sh          # links skills + agents into ~/.claude
```

Then **fill in the FAQs before it drafts anything real:**

- `claude/skills/customer-support/faqs.md`
- `claude/skills/customer-support/refund-policy.md`

These ship as skeletons on purpose. An FAQ file with invented answers is
worse than no FAQ file — it produces confident, wrong, on-brand emails.

Test it with pasted messages before it touches a mailbox.

### 4. Gmail — drafts only

`./scripts/add-connectors.sh` → gmail. It can search, read, label and draft.
It **cannot send**, by design. Drafts land in Drafts and you hit send.

First question, read-only:

> "Read my unread emails from the last 2 days, group them needs-a-reply /
> FYI / ignore, and don't draft anything yet."

The guide's "handles 90%" means *drafting* 90%, not sending it. Keep it
drafts-only until it's been right dozens of times.

### 5. Ads — read-only first

`./scripts/add-connectors.sh` → meta ads. Two things first: **verify the
connector host in Meta's own Business help** (it's referenced as both
`mcp.facebook.com/ads` and `mcp.meta.com/ads`), and **cap your budgets on
Meta's side** before it ever writes. This one spends real money.

### 6. Your posting tool

Metricool is the one to start with — it schedules *and* reads analytics back,
and works on the free plan. Buffer queues well but has no analytics. Postiz
if you'd rather self-host. Test with a draft or one throwaway channel.

### 7. Sub-agents — start with one

Already written, installed by `install.sh`:

- **tom** — code and build work. The only agent holding your GitHub
  connector. Only acts on approved directions.
- **mira** — inbox triage and draft replies. Holds Gmail.

```
"Have Tom review the back-end PR."
"Have Mira go through this morning's email."
```

`description` is the routing signal, `tools` is an allowlist, `model` can be
haiku for cheap jobs, and `mcpServers` scopes a connector to that agent
alone. [Docs](https://code.claude.com/docs/en/sub-agents)

Start with these two. Not ten.

### 8. The routine — last

See `claude/routines/daily-brief.md`. Read the warning at the top before you
enable it: a routine runs with **no approval prompts** and can **write**
through any connector you include.

---

## Also worth doing

**Claude for Chrome** — a side panel that can see and act in your browser.
Install the "Claude" extension from the Chrome Web Store, sign in, pin it,
grant per-site access.

> It acts on whatever you're logged into, and a malicious page can try to
> hijack it (prompt injection). Keep it on **per-action approval**, start
> with sites you trust, and keep it away from banking and password managers.

**Redesign the dashboard** — drag a reference image onto the terminal, or
`@mockup.png`, then:

> "Build this dashboard as a self-contained HTML file. Then take a
> screenshot of the result, compare it to my reference, list the
> differences, and fix them. Repeat until it matches."

That self-correction only works if Claude can actually screenshot what it
built — connect Claude for Chrome or the Chrome DevTools MCP first, otherwise
you're the one checking.

---

## The one rule

Three connectors cause real-world side effects:

| | |
|---|---|
| **the browser** | acts on any site you're logged into |
| **ad spend** | read-only until trusted, then cap budgets |
| **email** | drafts, never auto-send |

**Jarvis proposes. You approve.**

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Mic button does nothing | Opened as `file://`. Use `http://localhost:8765`. |
| "Couldn't reach Claude" | `claude` not on PATH — set `JARVIS_CLAUDE_BIN` in `.env`. |
| Replies come back silent | `FISH_AUDIO_API_KEY` unset. Check `curl localhost:8765/health`. |
| Fish Audio 402 / model error | `s2.1-pro-free` was free through end of July 2026. Switch to a paid model string. |
| BRIEF ME pulses but says nothing | No `jarvis_brief.mp3` yet — run `scripts/generate_brief.py`. |
| Sphere but no HUD | `jarvis_data.js` failed to parse. Check the browser console. |
| Connector missing in a routine | Routines use your **web** connectors — add them at [claude.ai/customize/connectors](https://claude.ai/customize/connectors). |

`curl localhost:8765/health` reports which half is wired up.

---

## Security notes

- `server.py` binds to `127.0.0.1` on purpose. `/ask` runs a subprocess with
  your Claude session and connectors attached — don't expose it to a network.
- `.env`, `.audio_cache/` and `jarvis_brief.mp3` are gitignored. Keep it that way.
- Email and web pages are untrusted input. Both `mira` and the support skill
  are told to treat instructions found inside them as content to report, not
  commands to follow.
- Want a read-only Jarvis for the voice loop? Set
  `JARVIS_CLAUDE_ARGS=--allowed-tools "Read Grep Glob"` in `.env`.
