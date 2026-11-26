# CLAUDE.md

## What this is

A Claude Code plugin (`status-band`) built from function hooks: it renders a band above the prompt showing a context forecast, a prompt-cache timer with auto-compact, usage pace, and git state. There is no package.json or build step: `claude-code` and `claude-code/testing` come from the Claude Code host runtime. Load the `plugin-authoring` skill before you change the hooks module or the tests.

`docs/development.md` covers running the plugin locally and the release steps.

## Keep in sync

- Version: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the badge in `README.md`.
- userConfig defaults (`opus,sonnet,haiku,fable`, `60`, `100000`): `plugin.json`, `INITIAL`, `config` and the `register()` fallbacks in `hooks/register.tsx`, and the settings table in `README.md`.
- Atom shapes: `types/index.d.ts` (the `PluginState['status-band']` augmentation). A new `Prefs` field also needs a line in the `session.start` restore block in `register.tsx`, or it won't survive a restart.

## Testing

Run the tests with `claude plugin test .`, and check the manifest and hooks with `claude plugin validate .`. The tests use `claude-code/testing`, which comes from the host runtime. Ignore the validate warning about CLAUDE.md at the plugin root: that file is for working on the repo, not part of the plugin.

- You can't run a single test: `claude plugin test` takes only a directory, and the testing kit has no `test.only`.
- The integration test in `tests/band.test.ts` stubs every `$` call a tick makes. When you add a `$` call to `refresh` or `refreshSlow`, stub it there too: `tick()` catches errors and only logs them to debug, so a missing stub fails quietly.

## Conventions

- Keep `hooks/logic.ts` pure (no `$`), so tests can call its helpers directly. Put anything that needs `$` in `register.tsx`.
- Start boolean names with `is`/`has` (`isAutoCompact`, `isMiss`, `isResetClock`).
- Write no semicolons and use single quotes (`.prettierrc.json`). Nothing runs prettier automatically, so format before you finish with `npx prettier@3 --write "hooks/**/*.{ts,tsx}" "tests/**/*.ts" "types/**/*.ts"`. There's no package.json, so run it through npx.
