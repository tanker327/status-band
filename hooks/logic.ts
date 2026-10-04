// Pure helpers of the band: no `$`, so the tests call them directly.

export const HISTORY = 12
export const COMPACT_AT = 90
const BARS = '▁▂▃▄▅▆▇█'

export type Forecast = { icon: string; word: string; color: string }

const FORECAST: readonly (Forecast & { upTo: number })[] = [
  { upTo: 25, icon: '☀', word: 'Clear', color: 'green' },
  { upTo: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', color: 'yellow' },
  { upTo: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
]
const STORM = 3

export const EFFORT_ICON: Readonly<Record<string, string>> = {
  low: '◔',
  medium: '◑',
  high: '◕',
  xhigh: '●',
  max: '◉',
}
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** One bar per sample, scaled against the whole window, padded to HISTORY. */
export function sparkline(history: readonly number[]): string {
  return history
    .slice(-HISTORY)
    .map(p => BARS[Math.min(BARS.length - 1, Math.max(0, Math.floor((p / 100) * BARS.length)))] ?? '▁')
    .join('')
    .padStart(HISTORY, ' ')
}

/** Turns until the compaction threshold at the average growth; drops (compactions) ignored. */
export function turnsLeft(history: readonly number[], percent: number): number | null {
  const gains: number[] = []
  for (let i = 1; i < history.length; i++) {
    const gain = (history[i] ?? 0) - (history[i - 1] ?? 0)
    if (gain > 0) gains.push(gain)
  }
  if (gains.length < 3 || percent >= COMPACT_AT) return null
  const average = gains.reduce((a, b) => a + b, 0) / gains.length

  return Math.floor((COMPACT_AT - percent) / average)
}

/** The weather for a fill; three turns or fewer of runway is at least a storm. */
export function forecast(percent: number, eta: number | null): Forecast {
  let index = FORECAST.findIndex(f => percent < f.upTo)
  if (index < 0) index = FORECAST.length - 1
  if (eta !== null && eta <= 3) index = Math.max(index, STORM)

  return FORECAST[index] ?? FORECAST[0]!
}

export function tokens(n: number): string {
  return n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1e3)}K`
}

/** A bar of `cells` cells: the filled part and the rest. */
export function bar(fraction: number, cells: number): { fill: string; rest: string } {
  const filled = Math.min(cells, Math.max(0, Math.round(fraction * cells)))

  return { fill: '█'.repeat(filled), rest: '░'.repeat(cells - filled) }
}

const two = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** 1d19h, 4h19m, or 9m42s under ten minutes. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60)}h`
  if (minutes >= 10) return `${Math.floor(minutes / 60)}h${two(minutes % 60)}m`

  return `${minutes}m${two(seconds % 60)}s`
}

/** Session length: 45m or 3h05m. */
export function elapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))

  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${two(minutes % 60)}m` : `${minutes}m`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** 4:45pm, or Mon 7:26am with the day. */
export function clockTime(ms: number, withDay: boolean): string {
  const date = new Date(ms)
  const hours = date.getHours()
  const time = `${hours % 12 || 12}:${two(date.getMinutes())}${hours < 12 ? 'am' : 'pm'}`

  return withDay ? `${DAYS[date.getDay()] ?? ''} ${time}` : time
}

export type CacheState = 'IDLE' | 'WARM' | 'COOLING' | 'EXPIRED' | 'COLD'

/** Where the cache stands: cooling is the last fifth of its lifetime. */
export function cacheState(args: { lastRequestAt: number | null; ttlMinutes: number; isCold: boolean; now: number }): {
  state: CacheState
  leftMs: number
} {
  if (args.lastRequestAt === null) return { state: 'IDLE', leftMs: 0 }
  if (args.isCold) return { state: 'COLD', leftMs: 0 }
  const ttlMs = args.ttlMinutes * 60000
  const leftMs = args.lastRequestAt + ttlMs - args.now
  if (leftMs <= 0) return { state: 'EXPIRED', leftMs: 0 }

  return { state: leftMs <= ttlMs * 0.2 ? 'COOLING' : 'WARM', leftMs }
}

export const COMPACT_LEAD_MS = 2 * 60000

/** Auto-compact fires only inside the last two minutes of a warm cache, once per request. */
export function shouldCompact(args: {
  isOn: boolean
  state: CacheState
  leftMs: number
  tokens: number | null
  minTokens: number
  subagents: number
  isAttempted: boolean
}): boolean {
  return (
    args.isOn &&
    !args.isAttempted &&
    args.subagents === 0 &&
    (args.state === 'WARM' || args.state === 'COOLING') &&
    args.leftMs > 0 &&
    args.leftMs <= COMPACT_LEAD_MS &&
    (args.tokens ?? 0) >= args.minTokens
  )
}

export const WINDOW_MS: Readonly<Record<string, number>> = {
  five_hour: 5 * 3600000,
  seven_day: 7 * 86400000,
}

/** Whether a window is being used faster than it elapses. */
export function isOverPace(percentUsed: number, resetsAtMs: number, now: number, windowMs: number): boolean {
  const elapsedPercent = (1 - Math.max(0, resetsAtMs - now) / windowMs) * 100

  return percentUsed > elapsedPercent
}

/** `3 files changed, 156 insertions(+), 23 deletions(-)` as counts. */
export function parseShortstat(text: string): { added: number; removed: number } {
  return {
    added: Number(/(\d+) insertion/.exec(text)?.[1] ?? 0),
    removed: Number(/(\d+) deletion/.exec(text)?.[1] ?? 0),
  }
}

export function hitRatio(cacheRead: number, cacheInput: number): number | null {
  return cacheInput > 0 ? Math.round((cacheRead / cacheInput) * 100) : null
}
