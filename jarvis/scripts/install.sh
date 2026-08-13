#!/usr/bin/env bash
# ----------------------------------------------------------------------
# Link the skills and sub-agents in this repo into ~/.claude, so they're
# version-controlled here but live where Claude Code looks for them.
#
#   ./scripts/install.sh            symlink (edits here take effect at once)
#   ./scripts/install.sh --copy     copy instead (if you'd rather they diverge)
#
# Safe to re-run. Refuses to clobber anything it didn't create.
# ----------------------------------------------------------------------
set -euo pipefail

C_GR=$'\033[32m'; C_AM=$'\033[33m'; C_DM=$'\033[2m'; C_B=$'\033[1m'; C_0=$'\033[0m'
ok()   { printf '%s✅ %s%s\n' "$C_GR" "$*" "$C_0"; }
warn() { printf '%s⚠️  %s%s\n' "$C_AM" "$*" "$C_0"; }
dim()  { printf '%s%s%s\n' "$C_DM" "$*" "$C_0"; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
MODE="link"
[[ "${1:-}" == "--copy" ]] && MODE="copy"

install_one() {
  local src="$1" dst="$2" label="$3"
  [[ -e "$src" ]] || return 0

  if [[ -L "$dst" ]]; then
    rm "$dst"
  elif [[ -e "$dst" ]]; then
    warn "$label already exists at $dst and isn't a symlink — leaving it alone."
    dim "   Move it aside and re-run if you want the repo version."
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  if [[ "$MODE" == "link" ]]; then
    ln -s "$src" "$dst"
    ok "$label → linked"
  else
    cp -R "$src" "$dst"
    ok "$label → copied"
  fi
}

printf '\n%sInstalling into %s%s\n\n' "$C_B" "$DEST" "$C_0"

for skill in "$HERE"/claude/skills/*/; do
  [[ -d "$skill" ]] || continue
  name="$(basename "$skill")"
  install_one "${skill%/}" "$DEST/skills/$name" "skill: $name"
done

for agent in "$HERE"/claude/agents/*.md; do
  [[ -f "$agent" ]] || continue
  name="$(basename "$agent")"
  install_one "$agent" "$DEST/agents/$name" "agent: ${name%.md}"
done

cat <<EOF

$(dim "Verify:")
  claude        then  /agents      should list tom and mira
                      /help        skills load on demand, not up front

$(dim "Before the support skill drafts anything real:")
  fill in claude/skills/customer-support/faqs.md and refund-policy.md.
  They ship as skeletons on purpose — an FAQ full of invented answers
  produces confident, wrong, on-brand emails.

EOF
