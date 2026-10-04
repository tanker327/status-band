# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin (`status-band`) built from function hooks: it renders a band above the prompt showing a context forecast, a prompt-cache timer with auto-compact, usage pace, and git state. There is no package.json or build step: `claude-code` and `claude-code/testing` come from the Claude Code host runtime. Load the `plugin-authoring` skill before you change the hooks module or the tests.

- `.claude-plugin/plugin.json`: the manifest and `userConfig` (models, cacheMinutes, minCompactTokens)
- `.claude-plugin/marketplace.json`: the marketplace entry. Bump its `version` with the manifest's
- `hooks/hooks.json` → `hooks/register.tsx`: the hooks module (atoms, refresh ticks, UI)
- `hooks/logic.ts`: pure helpers
- `types/index.d.ts`: `Snapshot`/`Git`/`Prefs`/`Menu`, plus the `PluginState['status-band']` module augmentation. Keep this file in sync when you change atom shapes.

## Testing

Run the tests with `claude plugin test .`, and check the manifest and hooks with `claude plugin validate .`. The tests use `claude-code/testing`, which comes from the host runtime. Ignore the validate warning about CLAUDE.md at the plugin root: that file is for working on the repo, not part of the plugin.

## Conventions

- Keep `hooks/logic.ts` pure (no `$`), so tests can call its helpers directly. Put anything that needs `$` in `register.tsx`.
- Start boolean names with `is`/`has` (`isAutoCompact`, `isMiss`, `hasSurvey`).
- Write no semicolons and use single quotes. `.prettierrc.json` enforces this. Format with `npx prettier@3 --write "hooks/**/*.{ts,tsx}" "tests/**/*.ts" "types/**/*.ts"`. There's no package.json, so run it through npx.
