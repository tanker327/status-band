import { expect, mock, test } from 'claude-code/testing'

import {
  cacheState,
  duration,
  forecast,
  isOverPace,
  parseShortstat,
  shouldCompact,
  sparkline,
  tokens,
  turnsLeft,
} from '../hooks/logic'

const BAND = {
  plugin: 'status-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const MINUTE = 60000

test('the forecast follows the fill, and a short runway is at least a storm', () => {
  expect(forecast(10, null).word).toBe('Clear')
  expect(forecast(62, 14).word).toBe('Showers')
  expect(forecast(60, 2).word).toBe('Storm')
  expect(forecast(93, null).word).toBe('Compact soon')
  expect(turnsLeft([10, 20, 30, 40], 40)).toBe(5)
  expect(turnsLeft([80, 90, 10, 12], 12)).toBe(null)
  expect(sparkline([0, 50, 100])).toBe('         ▁▅█')
})

test('figures are spelled as the band shows them', () => {
  expect(tokens(234000)).toBe('234K')
  expect(tokens(1000000)).toBe('1M')
  expect(duration(259 * MINUTE)).toBe('4h19m')
  expect(duration(9 * MINUTE + 42000)).toBe('9m42s')
  expect(duration(43 * 60 * MINUTE)).toBe('1d19h')
  expect(parseShortstat(' 3 files changed, 156 insertions(+), 23 deletions(-)')).toEqual({ added: 156, removed: 23 })
  expect(isOverPace(88, 40 * MINUTE, 0, 300 * MINUTE)).toBe(true)
  expect(isOverPace(4, 259 * MINUTE, 0, 300 * MINUTE)).toBe(false)
})

test('the cache cools in its last fifth and auto-compact fires only in the last two minutes', () => {
  const at = (minutes: number) => cacheState({ lastRequestAt: 0, ttlMinutes: 60, isCold: false, now: minutes * MINUTE })
  expect(at(10).state).toBe('WARM')
  expect(at(50).state).toBe('COOLING')
  expect(at(75).state).toBe('EXPIRED')
  expect(cacheState({ lastRequestAt: null, ttlMinutes: 60, isCold: false, now: 0 }).state).toBe('IDLE')

  const due = (minutes: number, over: Partial<Parameters<typeof shouldCompact>[0]> = {}) =>
    shouldCompact({
      isOn: true,
      ...at(minutes),
      tokens: 250000,
      minTokens: 100000,
      subagents: 0,
      isAttempted: false,
      ...over,
    })
  expect(due(30)).toBe(false)
  expect(due(58.5)).toBe(true)
  // Waking at minute 75 must not compact a cache that is already gone.
  expect(due(75)).toBe(false)
  expect(due(58.5, { isOn: false })).toBe(false)
  expect(due(58.5, { tokens: 72000 })).toBe(false)
  expect(due(58.5, { subagents: 3 })).toBe(false)
  expect(due(58.5, { isAttempted: true })).toBe(false)
})

test('the band folds to one line, names an icon on a click, and keeps both choices', async ($, on) => {
  // The test stands for the store, so it sees what the band saves.
  const saved: unknown[] = []
  on('store.get', () => ({ value: saved.at(-1) }))
  on('store.set', (_, e) => {
    if (e.key === 'prefs') saved.push(e.value)

    return { value: undefined }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    expect((await ui.find({ key: 'fold' }))?.text).toBe('⊟')
    expect(await ui.find({ key: 'auto' })).toBeDefined()
    expect(await ui.find({ key: 'name-cache' })).toBeUndefined()

    await ui.press({ key: 'fold' })
    expect((await ui.find({ key: 'fold' }))?.text).toBe('⊞')
    expect(await ui.find({ key: 'auto' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: ' cache' })).toBeUndefined()

    await ui.press({ key: 'name-cache' })
    expect(await ui.find({ type: 'Text', text: ' cache' })).toBeDefined()
    expect(saved.at(-1)).toMatchObject({ isCollapsed: true, labels: ['cache'] })

    await ui.press({ key: 'name-cache' })
    await ui.press({ key: 'fold' })
    await ui.unmount()
  }
})

test('the effort picker opens from the band and runs /effort', async ($, on) => {
  mock.store(on)
  const ran: string[] = []
  on('command.run', (_, e) => {
    ran.push(`${e.command} ${e.args}`)

    return { text: '' }
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'effort-xhigh' })).toBeUndefined()
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'effort-xhigh' })
  expect(ran).toEqual(['effort xhigh'])
  expect((await ui.find({ key: 'effort' }))?.text).toContain('xhigh')
  await ui.unmount()
})

test('auto-compact runs once, two minutes before the cache expires, and asks before a warm model switch', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 1_000_000,
      context: { tokens: 250000, window: 1000000, percent: 25 },
      rateLimits: [],
      cost: { usd: 1.84 },
    },
  }))
  on('session.model', () => ({ value: 'Fable' }))
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let compactions = 0
  on('session.compact', () => {
    compactions += 1

    return { messages: [] }
  })
  const ran: string[] = []
  on('command.run', (_, e) => {
    ran.push(`${e.command} ${e.args}`)

    return { text: '' }
  })
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'ok' }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: 'fable',
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 240000,
        cache_creation_input_tokens: 9990,
      },
    }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'fable', effort: 'high', messageCount: 1 })) {
    // drain the response
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'auto' }))?.text).toContain('off')
  expect(await ui.find({ type: 'Text', text: 'Hit: 96%' })).toBeDefined()

  // The full band names each item next to its icon.
  expect((await ui.find({ key: 'model' }))?.text).toContain('✦ Model: ')
  expect((await ui.find({ key: 'effort' }))?.text).toContain(' Effort: ')
  expect(await ui.find({ type: 'Text', text: /◷ Expires: \d+m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Cost: $1.84' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◷ Elapsed: / })).toBeDefined()

  // A warm cache: picking another model asks first, and keeping changes nothing.
  await ui.press({ key: 'model' })
  await ui.press({ key: 'model-opus' })
  expect(ran).toEqual([])
  await ui.press({ key: 'keep' })
  expect(ran).toEqual([])

  await ui.press({ key: 'auto' })
  await clock.advance(30 * MINUTE)
  expect(compactions).toBe(0)
  await clock.advance(28.5 * MINUTE)
  expect(compactions).toBe(1)
  // The compaction restarted the timer, so nothing more happens in the old window.
  await clock.advance(5 * MINUTE)
  expect(compactions).toBe(1)
  await ui.unmount()
})
