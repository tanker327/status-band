<div align="center">

# status-band

**Everything you glance at during a Claude Code session, in one band above the prompt.**

Context forecast · prompt-cache timer with auto-compact · usage pace · git and PR state

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://claude.com/claude-code)
![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)

</div>

```
╭────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⊟ ✦ Model: claude-opus-5-5 ▾ · ◑ Effort: medium ▾ · ☀ Context: Clear ▁▂▂▃ 18% 184K/1M · ~14 turns left                 │
│   ♨ Cache: WARM ████████████████░░░░ ◷ Expires: 48m · Cached: 184K · Hit: 96% · ⟳ Auto-compact: compacts at 2m left    │
│   ⧖ Session (5h): ██░░░░░░ 24% ↻ Resets: 3h12m ▼ Pace: under · ▦ Weekly (7d): █████░░░ 61% ↻ Resets: 2d4h ▲ Pace: over │
│   ⎇ Branch: feat/cache-timer · ⇄ PR: #42 ✓ approved · +156 −23 · Cost: $1.84 · ◷ Elapsed: 47m                          │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Why

A long Claude Code session has a few numbers that quietly decide how it goes: how full the context is, whether the prompt cache is still warm, and how much of your usage limit is left. status-band keeps them in view so you don't have to keep asking, and acts on the one that matters most: it can compact the conversation before the cache expires, so your next message doesn't pay to rewrite a large uncached context.

## Install

In Claude Code:

```
/plugin marketplace add tanker327/status-band
/plugin install status-band@status-band
```

The band appears above the prompt in your next session. To update later:

```
claude plugin update status-band@status-band
```

## What's in the band

### ✦ Model and ◑ effort

The current model and effort level. Click **Model** to pick the model for the next run, or **Effort** to choose `low`, `medium`, `high`, `xhigh`, or `max`. If the cache is warm, switching model asks first, since each model has its own cache and the next request would rewrite it.

### ☀ Context forecast

How full the context window is, shown as weather, with a sparkline of the last 12 turns and an estimate of the turns left before it reaches 90%.

| Weather | Context used |
| --- | --- |
| ☀ Clear | under 25% |
| ☁ Cloudy | 25–50% |
| ☂ Showers | 50–75% |
| ☇ Storm | 75–90%, or 3 turns or fewer left |
| ↯ Compact soon | 90% and up |

### ♨ Prompt cache

A countdown for the prompt cache since the last request: tokens cached and the session's cache hit ratio. It also warns when a request missed a cache that should have been warm.

| State | Meaning |
| --- | --- |
| `WARM` | Cached; plenty of time left |
| `COOLING` | In the last fifth of its lifetime |
| `EXPIRED` | Gone; the next request rewrites the whole context |
| `COLD` | The model changed, so there's no cache for it yet |
| `IDLE` | No request yet this session |

**⟳ Auto-compact** (off by default, click to toggle) compacts the conversation two minutes before the cache expires. It runs once per request, waits while subagents are running, and skips contexts smaller than `minCompactTokens`.

### ⧖ Usage pace

Your 5-hour and 7-day usage, shown when your account reports them. Each has a bar, the time until it resets (click to switch between a countdown and the clock time), and a pace marker: **▼ under** if you're using it slower than time passes, **▲ over** if faster.

### ⎇ Work

The git branch (or ⑂ worktree), lines added and removed against `HEAD`, the open pull request and its review state (✓ approved, ◌ pending, ✗ changes requested, ✎ draft), the session's cost, and time elapsed.

### ⊟ One-line mode

Click `⊟` to fold the band into a single line of icons and click `⊞` to expand it again. In one-line mode, click any icon to show its name. Both choices are remembered across sessions.

## Settings

Open `/plugin`, choose status-band, and set:

| Option | Default | What it does |
| --- | --- | --- |
| `models` | `opus,sonnet,haiku,fable` | Names the model picker offers, comma-separated, each as `/model` takes it |
| `cacheMinutes` | `60` | How long the prompt cache lives: `60`, or `5` on the short lifetime |
| `minCompactTokens` | `100000` | Auto-compact leaves a context smaller than this alone |

## Requirements

- Claude Code with function-hook plugin support
- `git` for the branch and diff line
- [`gh`](https://cli.github.com/), signed in, for the pull request state (optional; the band leaves it out without `gh`)

Everything runs locally. The plugin reads the session's own usage figures and runs `git` and `gh` in your working directory. Its only network traffic is `gh pr view`, which asks GitHub about the current branch's pull request.

## Contributing

Issues and pull requests are welcome. See [docs/development.md](docs/development.md) for how to run, test, and format the plugin.

## License

[MIT](LICENSE)
