export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  /** The clock at the last refresh, in milliseconds. */
  now: number
  model: string
  effort: string | null
  isThinkingOff: boolean
  isFast: boolean
  /** Context fill; null before the first response and right after a compact. */
  tokens: number | null
  window: number
  /** Context percent after each of the last main requests, oldest first. */
  history: number[]
  /** When the last main-conversation request started; null before any. */
  lastRequestAt: number | null
  ttlMinutes: number
  /** Session totals behind the hit ratio. */
  cacheRead: number
  cacheInput: number
  /** The last main request read nothing from a cache that should have been warm. */
  isMiss: boolean
  /** The model changed since the last request, so its cache is gone. */
  isCold: boolean
  compacted: { from: number; at: number } | null
  limits: Limit[]
  costUsd: number | null
  startedAt: number
  subagents: number
}

export type Git = {
  branch: string
  worktree: string | null
  added: number
  removed: number
  pr: { number: number; state: 'approved' | 'pending' | 'changes_requested' | 'draft' } | null
}

export type Prefs = {
  isAutoCompact: boolean
  isCollapsed: boolean
  /** Icons whose names are shown in the one-line mode. */
  labels: string[]
  isResetClock: boolean
}

export type Menu = { open: 'model' | 'effort' | null; pending: string | null }

declare module 'claude-code' {
  interface PluginState {
    'status-band': { snap: Snapshot; git: Git | null; prefs: Prefs; menu: Menu }
  }
}
