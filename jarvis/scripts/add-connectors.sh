#!/usr/bin/env bash
# ----------------------------------------------------------------------
# Add MCP connectors to Claude Code — ONE AT A TIME, verified between each.
#
#   ./scripts/add-connectors.sh
#
# The rule from the guide, and it is the whole point:
#     read-only before write · one connector before two · verified before trusted
#
# This script deliberately refuses to bulk-install. Every connector gets
# added, then confirmed with /mcp, then read-tested, before you're offered
# the next one.
# ----------------------------------------------------------------------
set -uo pipefail

C_CY=$'\033[36m'; C_GR=$'\033[32m'; C_AM=$'\033[33m'; C_RD=$'\033[31m'
C_DM=$'\033[2m';  C_B=$'\033[1m';   C_0=$'\033[0m'

say()  { printf '%s\n' "$*"; }
head2(){ printf '\n%s%s%s\n' "$C_CY$C_B" "$*" "$C_0"; }
dim()  { printf '%s%s%s\n' "$C_DM" "$*" "$C_0"; }
warn() { printf '%s⚠️  %s%s\n' "$C_AM" "$*" "$C_0"; }
ok()   { printf '%s✅ %s%s\n' "$C_GR" "$*" "$C_0"; }
err()  { printf '%s❌ %s%s\n' "$C_RD" "$*" "$C_0"; }

ask() {  # ask "prompt" -> 0 if yes
  local reply
  printf '\n%s%s%s [y/N] ' "$C_B" "$1" "$C_0"
  read -r reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy] ]]
}

command -v claude >/dev/null 2>&1 || {
  err "claude not found. Install it first:"
  say "    npm install -g @anthropic-ai/claude-code"
  exit 1
}

# ----------------------------------------------------------------------
add_connector() {
  local name="$1" url="$2" why="$3" test_prompt="$4" caution="${5:-}"

  head2 "── $name ─────────────────────────────────────────"
  say "$why"
  [[ -n "$caution" ]] && warn "$caution"
  dim "  claude mcp add --transport http $name $url"

  ask "Add the $name connector now?" || { dim "Skipped $name."; return 0; }

  if ! claude mcp add --transport http "$name" "$url"; then
    err "Adding $name failed. Check the URL and try again."
    return 1
  fi

  ok "$name registered."
  say ""
  say "${C_B}Now finish the login:${C_0}"
  say "  1. Run ${C_CY}claude${C_0}, then ${C_CY}/mcp${C_0}"
  say "  2. Pick ${C_B}$name${C_0} and complete the OAuth flow in the browser"
  say "  3. Confirm it shows as connected in ${C_CY}/mcp${C_0}"
  say ""
  say "${C_B}Then read-test it before you trust it with anything:${C_0}"
  say "  ${C_CY}$test_prompt${C_0}"
  say ""
  dim "Also add it at https://claude.ai/customize/connectors if you'll run routines —"
  dim "cloud routines use the web connectors, not your local ones."

  ask "Did $name connect and pass its read test?" \
    && ok "$name verified." \
    || warn "Leave $name unverified for now — don't give it write access until it passes."
}

# ----------------------------------------------------------------------
cat <<BANNER

${C_CY}${C_B}J.A.R.V.I.S — connector setup${C_0}

The order below is deliberate: cheapest and safest first, the things that
spend money or touch people last. Stop anywhere. You do not need all of them.

${C_DM}Every connector is optional. A Jarvis with two working connectors beats
one with eight that you haven't verified.${C_0}
BANNER

# --- 1. read-only first ----------------------------------------------
add_connector \
  "revenuecat" \
  "https://mcp.revenuecat.ai/mcp" \
  "Revenue and subscriptions. Only relevant if you sell through RevenueCat.
Free up to \$2,500/mo tracked revenue, then 1%." \
  '"Show my active subscriptions and this month'"'"'s revenue vs last month."' \
  "Use a READ-ONLY API key so it can report but never change your products."

# --- 2. analytics + posting ------------------------------------------
add_connector \
  "metricool" \
  "https://ai.metricool.com/mcp" \
  "Schedules posts AND reads analytics back — suggests best times. Works on
the free plan. The best all-rounder; start here if you're picking one." \
  '"Show my post performance for the last 14 days. Do not schedule anything."' \
  "Test with a draft or one throwaway channel before you let it publish."

add_connector \
  "buffer" \
  "https://mcp.buffer.com/mcp" \
  "Alternative to Metricool. Great at creating and queueing, but posts
per-channel (one at a time) and has no analytics." \
  '"List my connected channels and anything currently queued."' \
  "Pick Metricool OR Buffer. Running both just splits your queue."

# --- 3. email, drafts only -------------------------------------------
add_connector \
  "gmail" \
  "https://gmail.mcp.claude.com/mcp" \
  "Search, read, label and DRAFT replies. It cannot send — by design. Drafts
land in your Drafts folder and you hit send.
Pairs with the customer-support skill in claude/skills/." \
  '"Read my unread emails from the last 2 days and group them needs-a-reply / FYI / ignore. Do not draft anything yet."' \
  "Only connect a mailbox you trust. Email carries prompt injection — see the note at the bottom."

# --- 4. real money, last ----------------------------------------------
head2 "── meta ads ─────────────────────────────────────────"
say "Read campaign performance and, with approval, adjust budgets.
Connects with normal Meta Business OAuth — no developer app, no app review."
warn "This one spends real money. Two things before you wire it:"
say "  • ${C_B}Verify the connector host in Meta's own Business help.${C_0}"
say "    It's referenced as both mcp.facebook.com/ads and mcp.meta.com/ads,"
say "    and this script will not guess for you."
say "  • ${C_B}Cap your budgets on Meta's side first${C_0} — before Claude ever writes."
say ""
dim "This is for PAID ads only. Organic Instagram insights are a different"
dim "Meta API needing a developer app and weeks of review — keep pulling those"
dim "from Metricool instead."

if ask "Have you verified the host and want to add it now?"; then
  printf '\n%sPaste the exact MCP URL from Meta Business help: %s' "$C_B" "$C_0"
  read -r meta_url </dev/tty
  if [[ "$meta_url" =~ ^https:// ]]; then
    claude mcp add --transport http meta-ads "$meta_url" \
      && ok "meta-ads registered — now /mcp to authenticate." \
      || err "Adding meta-ads failed."
    say ""
    say "${C_B}First question, read-only:${C_0}"
    say "  ${C_CY}\"Show my active ad sets from the last 7 days by CPM. Do not change anything.\"${C_0}"
  else
    err "That didn't look like an https:// URL. Skipping."
  fi
else
  dim "Skipped Meta Ads. Sensible — it's the one that can cost you money."
fi

# --- 5. github (for Tom) ----------------------------------------------
head2 "── github ───────────────────────────────────────────"
say "Only needed if you want Tom (claude/agents/tom.md) reviewing PRs.
Tom is scoped to hold this connector alone."
warn "The guide doesn't specify a host for this one. Check GitHub's own MCP
documentation for the current endpoint rather than trusting a guess."
if ask "Add GitHub with a URL you've verified?"; then
  printf '\n%sPaste the GitHub MCP URL: %s' "$C_B" "$C_0"
  read -r gh_url </dev/tty
  if [[ "$gh_url" =~ ^https:// ]]; then
    claude mcp add --transport http github "$gh_url" \
      && ok "github registered — now /mcp to authenticate." \
      || err "Adding github failed."
  else
    err "That didn't look like an https:// URL. Skipping."
  fi
fi

# ----------------------------------------------------------------------
cat <<'FOOTER'

──────────────────────────────────────────────────────────────
Where you are now:

  claude          then  /mcp        confirm every connector is green
  claude mcp list             see what's registered
  claude mcp remove NAME      undo any of the above

Not done here (they aren't terminal commands):

  • Claude for Chrome — install the "Claude" extension from the Chrome
    Web Store, sign in, pin it, grant per-site access. Keep it on
    per-action approval. Keep it away from banking and password managers.
  • Web connectors for routines — https://claude.ai/customize/connectors

──────────────────────────────────────────────────────────────
The one rule: three connectors cause real-world side effects.

  the browser   acts on any site you're logged into
  ad spend      read-only until trusted, then cap budgets on Meta's side
  email         drafts only, never auto-send

Jarvis proposes. You approve.
──────────────────────────────────────────────────────────────
FOOTER
