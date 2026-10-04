# Development

status-band is a Claude Code plugin built from function hooks. There is no package.json or build step: `claude-code` and `claude-code/testing` come from the Claude Code host runtime.

## Layout

| Path | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | The plugin manifest and its `userConfig` options |
| `.claude-plugin/marketplace.json` | The marketplace entry, so the repo installs with `/plugin marketplace add` |
| `hooks/hooks.json` → `hooks/register.tsx` | The hooks module: atoms, refresh ticks, and the band's UI |
| `hooks/logic.ts` | Pure helpers, tested directly |
| `types/index.d.ts` | The plugin's `$.state` contract; keep it in sync with the atom shapes |
| `tests/band.test.ts` | Tests, run by `claude plugin test` |

## Run it locally

```sh
claude --plugin-dir .
```

Or add the folder as a marketplace and install from it. Claude Code then reads the plugin from this folder, and `/reload-plugins` picks up edits:

```sh
claude plugin marketplace add .
claude plugin install status-band@status-band
```

Loading the plugin writes `.claude-plugin/types/` (ignored by git), which `tsconfig.json` extends for editor type checking.

## Check and test

```sh
claude plugin validate .
claude plugin test .
```

`validate` warns that `CLAUDE.md` at the plugin root isn't loaded as context. That's expected: the file is for working on the repo.

## Format

No semicolons, single quotes (`.prettierrc.json`):

```sh
npx prettier@3 --write "hooks/**/*.{ts,tsx}" "tests/**/*.ts" "types/**/*.ts"
```

## Release

1. Bump `version` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
2. Commit, tag (`git tag v0.1.0`), and push with tags.

Users get the new version with `claude plugin update status-band@status-band`.
