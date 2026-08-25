# Vendored Claude Code skills

These 74 skill folders were vendored (copied) from upstream skill collections that are
**not** packaged as Claude Code plugins/marketplaces. They load automatically for any
Claude Code session opened in this repo.

Plugin-based skills (Superpowers, Trail of Bits, UI/UX Pro Max, Marketing Skills,
Context Engineering Kit, Caveman, Playwright, iOS Simulator, Frontend Slides,
Anthropic official skills, React Native) are **not** here — they are declared in
`.claude/settings.json` and installed from their GitHub marketplaces on first trust.

## Sources

| Prefix / folders | Upstream repo |
|---|---|
| `stop-slop` | hardikpandya/stop-slop |
| `remotion` | remotion-dev/skills |
| `d3js-visualization` | chrisvoncsefalvay/claude-d3js-skill |
| `obsidian-second-brain` | eugeniughelbur/obsidian-second-brain |
| `arcads-*` (6) | krusemediallc/arcads-claude-code |
| `sales-*` (14) | zubair-trabzada/ai-sales-team-claude |
| seomachine skills (25) | TheCraigHewitt/seomachine |
| entrepreneur skills (25) | mfwarren/entrepreneur-claude-skills |

## Notes

- The 120 MB `references/` image set of the **arcads** repo (influencer/product photos)
  was intentionally **not** vendored to keep this repo lean. Pull it from the upstream
  repo if a skill needs those assets.
- The `ai-sales-team` SKILL.md files had no YAML frontmatter upstream; `name` +
  `description` frontmatter was added so Claude Code recognizes them as skills.
- To remove a vendored skill, just delete its folder.
