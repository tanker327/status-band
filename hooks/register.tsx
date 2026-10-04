import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Git, Menu, Prefs, Snapshot } from '../types'
import {
  EFFORTS,
  EFFORT_ICON,
  HISTORY,
  WINDOW_MS,
  bar,
  cacheState,
  clockTime,
  duration,
  elapsed,
  forecast,
  hitRatio,
  isOverPace,
  parseShortstat,
  shouldCompact,
  sparkline,
  tokens,
  turnsLeft,
} from './logic'

const TICK_MS = 10_000
/** The slow readings (git, the config rows) are taken every sixth tick. */
const SLOW_EVERY = 6
/** The pull request is asked for every thirtieth tick: it goes over the network. */
const PR_EVERY = 30
const COMPACTED_NOTE_MS = 5 * 60000
const MISS_FLOOR = 2000

const INITIAL: Snapshot = {
  now: 0,
  model: '',
  effort: null,
  isThinkingOff: false,
  isFast: false,
  tokens: null,
  window: 200000,
  history: [],
  lastRequestAt: null,
  ttlMinutes: 60,
  cacheRead: 0,
  cacheInput: 0,
  isMiss: false,
  isCold: false,
  compacted: null,
  limits: [],
  costUsd: null,
  startedAt: 0,
  subagents: 0,
}
const PREFS: Prefs = { isAutoCompact: false, isCollapsed: false, labels: [], isResetClock: false }
const CLOSED: Menu = { open: null, pending: null }

const snap = atom({ plugin: 'status-band', key: 'snap' } as const, INITIAL)
const git = atom({ plugin: 'status-band', key: 'git' } as const, null as Git | null)
const prefs = atom({ plugin: 'status-band', key: 'prefs' } as const, PREFS)
const menu = atom({ plugin: 'status-band', key: 'menu' } as const, CLOSED)

const PR_MARK = {
  approved: { icon: '✓', word: 'approved', color: 'green' },
  pending: { icon: '◌', word: 'pending', color: 'yellow' },
  changes_requested: { icon: '✗', word: 'changes requested', color: 'red' },
  draft: { icon: '✎', word: 'draft', color: 'gray' },
} as const

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

type Engine = EngineInterface

/** What the manifest's userConfig holds, set when the module registers. */
const config = { ttlDefault: 60, minTokens: 100000, models: ['opus', 'sonnet', 'haiku', 'fable'] }

// Module variables: lost on a hot reload, which only costs one repeated attempt.
let attemptedFor: number | null = null
let ticks = 0

const savePrefs = async ($: Engine, change: (held: Prefs) => Prefs) => {
  await update($, prefs, change)
  await $.store.set('prefs', await read($, prefs))
}

const refresh = async ($: Engine) => {
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const model = await $.session.model()
  const running = (await $.agent.list()).filter(agent => agent.status === 'running').length
  await update($, snap, held => ({
    ...held,
    now,
    model,
    tokens: usage.context.tokens ?? null,
    window: usage.context.window,
    limits: usage.rateLimits.map(limit => ({ ...limit })),
    costUsd: usage.cost?.usd ?? null,
    startedAt: usage.startedAt,
    subagents: running,
  }))
}

const run = async ($: Engine, argv: readonly string[]): Promise<string | null> => {
  try {
    const result = await $.process.run(argv, { timeoutMs: 8000 })

    return result.exitCode === 0 ? result.stdout.trim() : null
  } catch {
    return null
  }
}

const readPullRequest = async ($: Engine): Promise<Git['pr']> => {
  const text = await run($, ['gh', 'pr', 'view', '--json', 'number,reviewDecision,isDraft'])
  if (text === null) return null
  try {
    const found = JSON.parse(text) as { number?: unknown; reviewDecision?: unknown; isDraft?: unknown }
    if (typeof found.number !== 'number') return null
    const state =
      found.isDraft === true
        ? 'draft'
        : found.reviewDecision === 'APPROVED'
          ? 'approved'
          : found.reviewDecision === 'CHANGES_REQUESTED'
            ? 'changes_requested'
            : 'pending'

    return { number: found.number, state }
  } catch {
    return null
  }
}

const refreshSlow = async ($: Engine, withPullRequest: boolean) => {
  const rows = await $.config.list()
  const isThinkingOff = rows.find(row => /thinking/i.test(row.key))?.value === false
  const isFast = rows.find(row => /fast/i.test(row.key))?.value === true
  await update($, snap, held => ({ ...held, isThinkingOff, isFast }))

  const branch = await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null) {
    await update($, git, () => null)

    return
  }
  const dirs = (await run($, ['git', 'rev-parse', '--git-dir', '--git-common-dir']))?.split('\n') ?? []
  const top = dirs.length === 2 && dirs[0] !== dirs[1] ? await run($, ['git', 'rev-parse', '--show-toplevel']) : null
  const worktree = top?.split(/[\\/]/).pop() ?? null
  const stat = parseShortstat((await run($, ['git', 'diff', '--shortstat', 'HEAD'])) ?? '')
  const held = await read($, git)
  const pr = withPullRequest || held === null || held.branch !== branch ? await readPullRequest($) : held.pr
  await update($, git, () => ({ branch, worktree, added: stat.added, removed: stat.removed, pr }))
}

const markCompacted = async ($: Engine, from: number | null) => {
  const at = await $.clock.now()
  await update($, snap, held => ({
    ...held,
    now: at,
    compacted: { from: from ?? 0, at },
    // The compaction is itself a request, so the cache's hour starts over.
    lastRequestAt: at,
    tokens: null,
    isMiss: false,
    isCold: false,
  }))
}

const autoCompact = async ($: Engine) => {
  const held = await read($, snap)
  const cache = cacheState(held)
  const isDue = shouldCompact({
    isOn: (await read($, prefs)).isAutoCompact,
    state: cache.state,
    leftMs: cache.leftMs,
    tokens: held.tokens,
    minTokens: config.minTokens,
    subagents: held.subagents,
    isAttempted: attemptedFor === held.lastRequestAt,
  })
  if (!isDue) return
  attemptedFor = held.lastRequestAt
  try {
    const result = await $.session.compact()
    if (result.messages !== undefined) await markCompacted($, held.tokens)
  } catch {
    // A turn was running: compact rejects, and the turn's next request restarts the timer.
  }
}

const tick = async ($: Engine) => {
  try {
    await refresh($)
    if (ticks % SLOW_EVERY === 0) await refreshSlow($, ticks % PR_EVERY === 0)
    ticks += 1
    await autoCompact($)
  } catch (error) {
    $.ui.log(`status-band: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

const switchModel = async ($: Engine, name: string) => {
  await update($, menu, () => CLOSED)
  try {
    await $.command.run({ command: 'model', args: name })
    await update($, snap, held => ({ ...held, isCold: held.lastRequestAt !== null }))
    await refresh($)
  } catch {
    $.ui.toast(`Could not switch to ${name}`)
  }
}

const pickModel = async ($: Engine, name: string) => {
  const held = await read($, snap)
  const { state } = cacheState(held)
  const isWarm = (state === 'WARM' || state === 'COOLING') && (held.tokens ?? 0) > 0
  if (isWarm) await update($, menu, () => ({ open: null, pending: name }))
  else await switchModel($, name)
}

const pickEffort = async ($: Engine, level: string) => {
  await update($, menu, () => CLOSED)
  try {
    await $.command.run({ command: 'effort', args: level })
    await update($, snap, held => ({ ...held, effort: level }))
  } catch {
    $.ui.toast(`Could not set effort to ${level}`)
  }
}

export const register: Register = (on, options) => {
  config.ttlDefault = number(options['cacheMinutes'], 60)
  config.minTokens = number(options['minCompactTokens'], 100000)
  config.models = String(options['models'] ?? 'opus,sonnet,haiku,fable')
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')
  const { minTokens, models } = config

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const stored = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (stored !== undefined && stored !== null && typeof stored === 'object') {
      await update($, prefs, held => ({
        isAutoCompact: stored.isAutoCompact === true,
        isCollapsed: stored.isCollapsed === true,
        labels: Array.isArray(stored.labels) ? stored.labels.filter(label => typeof label === 'string') : held.labels,
        isResetClock: stored.isResetClock === true,
      }))
    }
    await update($, snap, held => (held.lastRequestAt === null ? { ...held, ttlMinutes: config.ttlDefault } : held))
    await tick($)
    $.clock.every(TICK_MS, () => {
      void tick($)
    })

    return started
  })

  // Every main-conversation request restarts the cache timer; a subagent's does not.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const startedAt = isMain ? await $.clock.now() : 0
    const result = yield* next(e)
    if (isMain && result.usage !== null) {
      const used: ModelUsage = result.usage
      const input = used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
      const context = (await $.session.usage()).context
      await update($, snap, held => {
        const before = cacheState({ ...held, now: startedAt }).state

        return {
          ...held,
          now: startedAt,
          effort: e.effort === undefined ? held.effort : String(e.effort),
          lastRequestAt: startedAt,
          isCold: false,
          isMiss:
            (before === 'WARM' || before === 'COOLING') && used.cache_read_input_tokens === 0 && input > MISS_FLOOR,
          cacheRead: held.cacheRead + used.cache_read_input_tokens,
          cacheInput: held.cacheInput + input,
          tokens: context.tokens ?? held.tokens,
          window: context.window,
        }
      })
    }

    return result
  })

  // One sparkline sample per finished main turn, so "turns left" counts turns.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
      await update($, snap, held => {
        if (held.tokens === null) return held
        const percent = Math.round((held.tokens / held.window) * 100)

        return { ...held, history: [...held.history, percent].slice(-HISTORY) }
      })
    }

    return result
  })

  // A model switch forfeits the old model's cache, and says which lifetime the cache has.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await update($, snap, held => ({
      ...held,
      ttlMinutes: e.cache_ttl === '5m' ? 5 : 60,
      isCold: held.lastRequestAt !== null,
    }))

    return result
  })

  // A compaction the person or the engine ran (this mod's own is recorded where it is called).
  on('session.compact', async ($, e, next) => {
    const before = (await read($, snap)).tokens
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages !== undefined) {
      await markCompacted($, before)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, snap)
    const g = await read($, git)
    const p = await read($, prefs)
    const m = await read($, menu)

    type El = JSX.Element
    const sep = (): El => <Text dimColor> · </Text>
    const line = (groups: readonly (readonly El[] | null)[], lead: readonly El[] = []): El => {
      const kids: El[] = [...lead]
      let count = 0
      for (const group of groups) {
        if (group === null || group.length === 0) continue
        if (count > 0) kids.push(sep())
        kids.push(...group)
        count += 1
      }

      return (
        <Box flexDirection="row" flexWrap="wrap">
          {kids}
        </Box>
      )
    }
    /** An icon and its name: always named in the full band, named on a click in the one-line band. */
    const icon = (key: string, glyph: string, name: string, color?: string): El[] =>
      p.isCollapsed
        ? [
            <Button
              key={`name-${key}`}
              plain
              label={glyph}
              onPress={() => {
                void savePrefs($, held => ({
                  ...held,
                  labels: held.labels.includes(key) ? held.labels.filter(k => k !== key) : [...held.labels, key],
                }))
              }}
            />,
            ...(p.labels.includes(key) ? [<Text color={color}> {name}</Text>] : []),
          ]
        : [
            <Text color={color}>
              {glyph} {name.charAt(0).toUpperCase() + name.slice(1)}
            </Text>,
          ]
    const fold: El[] = [
      <Button
        key="fold"
        plain
        dimColor
        label={p.isCollapsed ? '⊞' : '⊟'}
        onPress={() => {
          void update($, menu, () => CLOSED)
          void savePrefs($, held => ({ ...held, isCollapsed: !held.isCollapsed }))
        }}
      />,
      <Text> </Text>,
    ]

    // Context
    const percent = s.tokens === null ? null : Math.round((s.tokens / s.window) * 100)
    const eta = percent === null ? null : turnsLeft(s.history, percent)
    const weather = percent === null ? null : forecast(percent, eta)

    // Cache
    const cache = cacheState(s)
    const cacheColor =
      cache.state === 'WARM' ? 'green' : cache.state === 'COOLING' ? 'yellow' : cache.state === 'IDLE' ? 'gray' : 'red'
    const isLive = cache.state === 'WARM' || cache.state === 'COOLING'
    const leftMinutes = Math.ceil(cache.leftMs / 60000)
    const subagents: El[] | null =
      s.subagents > 0 ? [<Text color="cyan">⋔ Subagents: {s.subagents} running</Text>] : null
    const flags: El[] = [
      ...(s.isFast ? [sep(), ...icon('fast', '»', 'fast', 'cyan')] : []),
      ...(s.isThinkingOff ? [sep(), ...icon('think', '⊘', 'thinking off', 'yellow')] : []),
    ]
    const effort = s.effort ?? '–'
    const effortIcon = EFFORT_ICON[effort] ?? '◌'

    // Usage windows
    const windows = (['five_hour', 'seven_day'] as const).flatMap(kind => {
      const limit = s.limits.find(one => one.kind === kind)

      return limit === undefined ? [] : [{ kind, name: kind === 'five_hour' ? '5h' : '7d', limit }]
    })
    const usageColor = (used: number) => (used >= 90 ? 'red' : used >= 70 ? 'yellow' : 'green')
    const overPace = (kind: string, used: number, resetsAt: string | undefined) =>
      resetsAt !== undefined && isOverPace(used, Date.parse(resetsAt), s.now, WINDOW_MS[kind] ?? 1)

    // Git
    const mark = g?.pr ? PR_MARK[g.pr.state] : null

    if (p.isCollapsed) {
      return line(
        [
          [...icon('model', '✦', 'model'), <Text bold> {s.model}</Text>],
          [...icon('effort', effortIcon, 'effort'), <Text> {effort}</Text>, ...flags],
          weather === null || percent === null
            ? [<Text dimColor>ctx –</Text>]
            : [
                ...icon('weather', weather.icon, weather.word, weather.color),
                <Text color={weather.color}> ctx {percent}%</Text>,
              ],
          [
            ...icon('cache', isLive || cache.state === 'IDLE' ? '♨' : '❄', 'cache', cacheColor),
            <Text color={cacheColor}> {isLive ? `${leftMinutes}m` : cache.state.toLowerCase()}</Text>,
            ...(p.isAutoCompact ? [<Text> </Text>, ...icon('auto', '⟳', 'auto-compact')] : []),
            ...(s.subagents > 0
              ? [
                  <Text> </Text>,
                  ...icon('subagents', '⋔', 'subagents', 'cyan'),
                  <Text color="cyan"> {s.subagents}</Text>,
                ]
              : []),
          ],
          ...windows.map(({ kind, name, limit }) => [
            <Text dimColor>{name} </Text>,
            <Text color={usageColor(limit.percentUsed)}>{Math.round(limit.percentUsed)}%</Text>,
            ...(overPace(kind, limit.percentUsed, limit.resetsAt) ? [<Text color="red">▲</Text>] : []),
          ]),
          g === null
            ? null
            : [
                ...(g.worktree === null ? icon('branch', '⎇', 'branch') : icon('worktree', '⑂', 'worktree')),
                <Text> {g.worktree ?? g.branch}</Text>,
                ...(g.pr && mark
                  ? [
                      <Text> </Text>,
                      ...icon('pr', '⇄', `PR #${g.pr.number}`),
                      <Text> </Text>,
                      ...icon('review', mark.icon, mark.word, mark.color),
                    ]
                  : []),
              ],
        ],
        fold,
      )
    }

    const rows: El[] = []

    // Line 1: model, effort, flags, context
    rows.push(
      line(
        [
          [
            <Button
              key="model"
              plain
              label={`✦ Model: ${s.model || '–'} ${m.open === 'model' ? '▴' : '▾'}`}
              onPress={() => {
                void update($, menu, (held): Menu => ({ open: held.open === 'model' ? null : 'model', pending: null }))
              }}
            />,
          ],
          [
            <Button
              key="effort"
              plain
              label={`${effortIcon} Effort: ${effort} ${m.open === 'effort' ? '▴' : '▾'}`}
              onPress={() => {
                void update($, menu, (held): Menu => ({
                  open: held.open === 'effort' ? null : 'effort',
                  pending: null,
                }))
              }}
            />,
            ...flags,
          ],
          weather === null || percent === null || s.tokens === null
            ? [<Text dimColor>context appears after the next response</Text>]
            : [
                <Text color={weather.color}>
                  {weather.icon} Context: {weather.word} {sparkline(s.history)} {percent}%
                </Text>,
                <Text>
                  {' '}
                  {tokens(s.tokens)}/{tokens(s.window)}
                </Text>,
              ],
          eta === null ? null : [<Text dimColor>~{eta} turns left</Text>],
        ],
        fold,
      ),
    )

    if (m.pending !== null) {
      const name = m.pending
      rows.push(
        <Text color="yellow">
          {'  '}⚠ Switch to {name}? The cache is per model, so the next request rewrites {tokens(s.tokens ?? 0)}.
        </Text>,
        <Box flexDirection="row" columnGap={2} paddingLeft={2}>
          <Button
            key="switch"
            variant="primary"
            label={`switch to ${name}`}
            onPress={() => {
              void switchModel($, name)
            }}
          />
          <Button
            key="keep"
            autoFocus
            label={`keep ${s.model}`}
            onPress={() => {
              void update($, menu, () => CLOSED)
            }}
          />
        </Box>,
      )
    } else if (m.open === 'model') {
      rows.push(
        <Box flexDirection="row" columnGap={2} paddingLeft={2} flexWrap="wrap">
          <Text dimColor>model for next run</Text>
          {models.map(name => (
            <Button
              key={`model-${name}`}
              plain
              label={`✦ ${name}`}
              onPress={() => {
                void pickModel($, name)
              }}
            />
          ))}
        </Box>,
      )
    } else if (m.open === 'effort') {
      rows.push(
        <Box flexDirection="row" columnGap={2} paddingLeft={2} flexWrap="wrap">
          <Text dimColor>effort for next run</Text>
          {EFFORTS.map(level => (
            <Button
              key={`effort-${level}`}
              plain
              label={`${EFFORT_ICON[level] ?? ''} ${level}${level === s.effort ? ' ✓' : ''}`}
              onPress={() => {
                void pickEffort($, level)
              }}
            />
          ))}
        </Box>,
      )
    }

    // Line 2: cache
    const autoText = !p.isAutoCompact
      ? 'off'
      : s.compacted !== null && s.now - s.compacted.at < COMPACTED_NOTE_MS
        ? `compacted ${tokens(s.compacted.from)}`
        : (s.tokens ?? 0) < minTokens
          ? `skip (<${tokens(minTokens)})`
          : s.subagents > 0
            ? 'waits for subagents'
            : cache.state === 'COOLING'
              ? `compacts in ${Math.max(0, leftMinutes - 2)}m`
              : 'compacts at 2m left'
    const auto: El[] = [
      <Button
        key="auto"
        plain
        dimColor={!p.isAutoCompact}
        label={`⟳ Auto-compact: ${autoText}`}
        onPress={() => {
          void savePrefs($, held => ({ ...held, isAutoCompact: !held.isAutoCompact }))
        }}
      />,
    ]
    const cacheLead: El[] = [
      <Text> </Text>,
      <Text> </Text>,
      <Text color={cacheColor}>{isLive || cache.state === 'IDLE' ? '♨' : '❄'} Cache: </Text>,
      <Text color={cacheColor} bold>
        {cache.state.padEnd(7)}
      </Text>,
      <Text> </Text>,
    ]
    const ratio = hitRatio(s.cacheRead, s.cacheInput)
    if (isLive) {
      const cells = bar(cache.leftMs / (s.ttlMinutes * 60000), 20)
      rows.push(
        line(
          [
            [
              <Text color={cacheColor}>{cells.fill || '█'}</Text>,
              <Text dimColor>{cells.rest}</Text>,
              <Text> ◷ Expires: {leftMinutes}m</Text>,
            ],
            s.tokens === null ? null : [<Text>Cached: {tokens(s.tokens)}</Text>],
            ratio === null
              ? null
              : [
                  <Text color={ratio < 70 ? 'yellow' : undefined} dimColor={ratio >= 70}>
                    Hit: {ratio}%
                  </Text>,
                ],
            auto,
            s.isMiss ? [<Text color="red">missed the cache on the last request</Text>] : null,
            subagents,
          ],
          cacheLead,
        ),
      )
    } else {
      rows.push(
        line(
          [
            cache.state === 'COLD' ? [<Text>model changed</Text>] : null,
            cache.state === 'IDLE' || s.tokens === null
              ? null
              : [<Text>next request rewrites {tokens(s.tokens)}</Text>],
            auto,
            subagents,
          ],
          cacheLead.slice(0, 4),
        ),
      )
    }

    // Line 3: usage windows, when the account reports them
    if (windows.length > 0) {
      rows.push(
        line(
          windows.map(({ kind, limit }) => {
            const cells = bar(limit.percentUsed / 100, 8)
            const resetsAt = limit.resetsAt === undefined ? null : Date.parse(limit.resetsAt)

            return [
              <Text color="cyan">{kind === 'five_hour' ? '⧖' : '▦'} </Text>,
              <Text>{kind === 'five_hour' ? 'Session (5h):' : 'Weekly (7d):'} </Text>,
              <Text color={usageColor(limit.percentUsed)}>{cells.fill}</Text>,
              <Text dimColor>{cells.rest}</Text>,
              <Text> {Math.round(limit.percentUsed)}% </Text>,
              ...(resetsAt === null
                ? []
                : [
                    <Button
                      key={`reset-${kind}`}
                      plain
                      dimColor
                      label={
                        p.isResetClock
                          ? `↻ Resets: ${clockTime(resetsAt, kind === 'seven_day')}`
                          : `↻ Resets: ${duration(resetsAt - s.now)}`
                      }
                      onPress={() => {
                        void savePrefs($, held => ({ ...held, isResetClock: !held.isResetClock }))
                      }}
                    />,
                    <Text> </Text>,
                    overPace(kind, limit.percentUsed, limit.resetsAt) ? (
                      <Text color="red">▲ Pace: over</Text>
                    ) : (
                      <Text color="green">▼ Pace: under</Text>
                    ),
                  ]),
            ]
          }),
          [<Text> </Text>, <Text> </Text>],
        ),
      )
    }

    // Line 4: the work itself
    rows.push(
      line(
        [
          g === null || g.worktree === null
            ? null
            : [<Text color="cyan">⑂ Worktree: </Text>, <Text>{g.worktree}</Text>],
          g === null ? null : [<Text color="cyan">⎇ Branch: </Text>, <Text>{g.branch}</Text>],
          g === null || g.pr === null || mark === null
            ? null
            : [
                <Text color="cyan">⇄ PR: </Text>,
                <Text>#{g.pr.number} </Text>,
                <Text color={mark.color} bold>
                  {mark.icon} {mark.word}
                </Text>,
              ],
          g === null
            ? null
            : [<Text color="green">+{g.added}</Text>, <Text> </Text>, <Text color="red">−{g.removed}</Text>],
          s.costUsd === null ? null : [<Text>Cost: ${s.costUsd.toFixed(2)}</Text>],
          s.startedAt > 0 ? [<Text dimColor>◷ Elapsed: {elapsed(s.now - s.startedAt)}</Text>] : null,
        ],
        [<Text> </Text>, <Text> </Text>],
      ),
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {rows}
      </Box>
    )
  })
}
