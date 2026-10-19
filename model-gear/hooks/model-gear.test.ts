import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'

import {
  candidatesFor,
  chipLabel,
  guessEffort,
  guessLevel,
  isShortReply,
  namedEffort,
  parseEffort,
  parseLevel,
  statusLine,
} from './logic'

const PLUGIN = 'model-gear'
const OPTIONS = ['Default (recommended)', 'fable', 'opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku']
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PRESENTATION = { isFullscreen: false, columns: 100 }

type World = { model: string; sets: string[]; asked: number; sent: TurnStepInput['effort'][] }

/** Stands in for the engine beneath the mod: the /config model row, the quick check, the store, the requests. */
function world(
  on: On,
  setup: { model: string; answer?: string; store?: Record<string, unknown>; refuse?: string; isBroken?: boolean },
): World {
  const seen: World = { model: setup.model, sets: [], asked: 0, sent: [] }

  mock.store(on, setup.store ?? {})
  on('config.list', () => {
    if (setup.isBroken === true) throw new Error('settings unreadable')
    const row = {
      key: 'model',
      label: 'Model',
      kind: 'choice' as const,
      value: seen.model,
      options: OPTIONS,
      provider: { plugin: 'engine', tier: 'core' as const },
      isLocked: false,
    }
    return { value: [row] }
  })
  on('config.set', ($, e) => {
    if (e.value === setup.refuse) return { deny: 'not on this plan' }
    seen.sets.push(String(e.value))
    seen.model = String(e.value)
    return { value: e.value }
  })
  on('model.complete', () => {
    seen.asked += 1
    return {
      value:
        setup.answer === undefined
          ? { isAnswered: false as const, reason: 'aborted' as const, usage: ZERO }
          : { isAnswered: true as const, text: setup.answer, usage: ZERO },
    }
  })
  on('session.model', () => ({ value: seen.model }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.step', async function* ($, e) {
    seen.sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('command.run', { command: 'effort' }, ($, e) => ({ text: `Set effort level to ${e.args}` }))

  return seen
}

/** One model request of the main loop (or a subagent's), read to its end. */
async function step($: Engine, input: Partial<TurnStepInput> = {}): Promise<void> {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1, ...input })
  for await (const _chunk of stream) {
    // The bottom yields nothing; reading drains it.
  }
  await stream.result
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const command = (args: string) => ({
  command: 'modelgear',
  args,
  origin: { kind: 'composer' as const },
  presentation: PRESENTATION,
})

describe('reading the one-word answer', () => {
  test('finds the level in a short reply, the longer word first', async () => {
    expect(parseLevel('strong')).toBe('strong')
    expect(parseLevel('Strongest.')).toBe('strongest')
    expect(parseLevel(' small\n')).toBe('small')
    expect(parseLevel('Everyday')).toBe('everyday')
    expect(parseLevel('I would say small')).toBe('small')
    expect(parseLevel('banana')).toBeUndefined()
    expect(parseLevel('')).toBeUndefined()
  })
})

describe('spotting a short reply', () => {
  test('under four words, or only go-ahead words, is a short reply', async () => {
    expect(isShortReply('yes')).toBe(true)
    expect(isShortReply('ok')).toBe(true)
    expect(isShortReply('keep going')).toBe(true)
    expect(isShortReply('do it')).toBe(true)
    expect(isShortReply('fix the tests')).toBe(true)
    expect(isShortReply('yes please keep going with that now')).toBe(true)
    expect(isShortReply('Refactor the billing service to use the new API')).toBe(false)
    expect(isShortReply('ok now build the login page')).toBe(false)
  })
})

describe('the word-based fallback', () => {
  test('guesses from the words and says strong when in doubt', async () => {
    expect(guessLevel('Translate this paragraph into French')).toBe('small')
    expect(guessLevel('Summarize this email thread for me')).toBe('small')
    expect(guessLevel('Write a short email to my landlord about the heating')).toBe('everyday')
    expect(guessLevel('What is the capital of Australia?')).toBe('small')
    expect(guessLevel('Refactor the payment service and add tests')).toBe('strong')
    expect(guessLevel('Migrate the entire codebase from Python 2 to Python 3')).toBe('strongest')
    expect(guessLevel('hmm, thinking about that thing we discussed yesterday')).toBe('strong')
  })

  test('is used when the quick check gives no answer', async ($, on) => {
    const seen = world(on, { model: 'opus', store: { enabled: true } })

    await $.prompt.submit(typed('Translate this paragraph into French for the newsletter'))

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['haiku'])
  })

  test('steps down a line when a level has no model in the install', async () => {
    expect(candidatesFor('strongest', ['opus', 'sonnet', 'haiku'])).toEqual(['opus', 'sonnet', 'haiku'])
    expect(candidatesFor('small', ['sonnet', 'opus'])).toEqual(['sonnet', 'opus'])
    expect(candidatesFor('everyday', OPTIONS)[0]).toBe('sonnet')
  })
})

describe('switching on a new prompt', () => {
  test('a typed prompt moves the model to the level the small model named', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'everyday', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))

    expect(seen.asked).toBe(1)
    expect(seen.sets).toEqual(['sonnet'])
  })

  test('a model the plan refuses steps down to the next one', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strongest', store: { enabled: true }, refuse: 'fable' })

    await $.prompt.submit(typed('Plan and carry out a migration of every service to the new queue'))

    expect(seen.sets).toEqual(['opus'])
  })
})

describe('staying out of the way', () => {
  test('a short reply keeps the current model', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small', store: { enabled: true } })

    await $.prompt.submit(typed('ok keep going'))

    expect(seen.asked).toBe(0)
    expect(seen.sets).toEqual([])
    expect(seen.model).toBe('opus')
  })

  test('slash commands, messages sent mid-turn and switched-off sessions are never sorted', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small', store: { enabled: true } })

    await $.prompt.submit(typed('/review the whole pull request carefully please'))
    await $.prompt.submit({ ...typed('also translate the README into Spanish'), turnId: 'turn-1' })
    await $.command.run(command('off'))
    await $.prompt.submit(typed('Translate the README into Spanish for the docs site'))

    expect(seen.asked).toBe(0)
  })

  test('a model picked by hand turns Model Gear off', async ($, on) => {
    world(on, { model: 'haiku', store: { enabled: true, previous: 'opus', applied: 'haiku' } })

    await $.config.set({
      key: 'model',
      value: 'sonnet',
      previous: 'haiku',
      provider: { plugin: 'engine', tier: 'core' },
      origin: { kind: 'composer' },
    })
    const after = await $.command.run(command('status'))

    expect(after.text).toBe('Model Gear is off. The model is sonnet.')
  })
})

describe('going back to the earlier model when turned off', () => {
  test('off puts back the model in use before Model Gear was turned on', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong' })

    const on1 = await $.command.run(command('on'))
    await $.prompt.submit(typed('Build a CSV import for the customers table with tests'))
    const off = await $.command.run(command('off'))

    expect(on1.text).toBe('Model Gear is on. Turning it off puts sonnet back.')
    expect(seen.sets).toEqual(['opus', 'sonnet'])
    expect(off.text).toBe('Model Gear is off. The model is back to sonnet.')
  })

  test('a failing command answers with a sentence', async ($, on) => {
    world(on, { model: 'opus', isBroken: true })

    const answer = await $.command.run(command('on'))

    expect(answer.text).toBe('Model Gear could not do that just now. Nothing was changed.')
  })
})

describe('reading the effort', () => {
  test('finds the effort after the level, extra high and maximum included', async () => {
    expect(parseEffort('strong high')).toBe('high')
    expect(parseEffort('Strongest xhigh.')).toBe('xhigh')
    expect(parseEffort('strong extra high')).toBe('xhigh')
    expect(parseEffort('strongest x-high')).toBe('xhigh')
    expect(parseEffort('strongest maximum')).toBe('max')
    expect(parseEffort('small low\n')).toBe('low')
    expect(parseEffort('strong')).toBeUndefined()
  })

  test('takes an effort the person named in the prompt', async () => {
    expect(namedEffort('Refactor the parser, use max effort')).toBe('max')
    expect(namedEffort('ultrathink about the cache design')).toBe('max')
    expect(namedEffort('low effort is fine, just rename the file')).toBe('low')
    expect(namedEffort('Refactor the parser')).toBeUndefined()
  })

  test('guesses from the level and steps up or down on the words', async () => {
    expect(guessEffort('Translate this paragraph into French', 'small')).toBe('low')
    expect(guessEffort('Write a short email to my landlord', 'everyday')).toBe('medium')
    expect(guessEffort('Refactor the payment service and add tests', 'strong')).toBe('high')
    expect(guessEffort('Find the root cause of this race condition', 'strong')).toBe('xhigh')
    expect(guessEffort('Quickly add a log line to the handler', 'strong')).toBe('medium')
    expect(guessEffort('Migrate the entire codebase to Python 3', 'strongest')).toBe('xhigh')
    expect(guessEffort('Translate this, quickly', 'small')).toBe('low')
  })
})

describe('sending the effort with the model', () => {
  test('a typed prompt gets the model and the effort the small model named', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'everyday medium', store: { enabled: true } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))
    await step($, { effort: 'high' })

    expect(seen.sets).toEqual(['sonnet'])
    expect(seen.sent).toEqual(['medium'])
  })

  test('a strong model can still be sent a high effort rather than the saved one', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true } })

    await $.prompt.submit(typed('Debug why the checkout total is off by one cent'))
    await step($, { model: 'claude-opus-5-5', effort: 'xhigh' })

    expect(seen.sets).toEqual(['opus'])
    expect(seen.sent).toEqual(['high'])
  })

  test('the words decide the effort when the quick check gives no answer', async ($, on) => {
    const seen = world(on, { model: 'opus', store: { enabled: true } })

    await $.prompt.submit(typed('Translate this paragraph into French for the newsletter'))
    await step($, { model: 'claude-haiku-5-5', effort: 'medium' })

    expect(seen.sets).toEqual(['haiku'])
    expect(seen.sent).toEqual(['low'])
  })

  test('a one-word answer from the small model still gets an effort', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong', store: { enabled: true } })

    await $.prompt.submit(typed('Refactor the payment service and add tests'))
    await step($)

    expect(seen.sent).toEqual(['high'])
  })

  test('an effort named in the prompt beats the small model', async ($, on) => {
    const seen = world(on, { model: 'sonnet', answer: 'strong high', store: { enabled: true } })

    await $.prompt.submit(typed('Review the auth middleware for holes, use max effort'))
    await step($)

    expect(seen.sent).toEqual(['max'])
  })

  test('a short reply keeps the effort the last prompt got', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'strongest xhigh', store: { enabled: true } })

    await $.prompt.submit(typed('Plan and carry out a migration of every service to the new queue'))
    await step($)
    await $.prompt.submit(typed('ok keep going'))
    await step($, { index: 1 })

    expect(seen.asked).toBe(1)
    expect(seen.sent).toEqual(['xhigh', 'xhigh'])
  })

  test('subagents get the same effort, and a model without an effort setting is left alone', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low', store: { enabled: true } })

    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await step($, { agentId: 'agent-1', effort: 'high' })
    await step($, { agentId: 'agent-1', effort: undefined })
    await step($, { effort: undefined })

    expect(seen.sent).toEqual(['low', undefined, undefined])
  })

  test('nothing is changed while Model Gear is off or before a prompt is sorted', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low' })

    await step($, { effort: 'xhigh' })
    await $.command.run(command('on'))
    await step($, { effort: 'xhigh' })
    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await step($, { effort: 'xhigh' })
    await $.command.run(command('off'))
    await step($, { effort: 'xhigh' })

    expect(seen.sent).toEqual(['xhigh', 'xhigh', 'low', 'xhigh'])
  })

  test('an effort set by hand turns Model Gear off and keeps that effort', async ($, on) => {
    const seen = world(on, { model: 'opus', answer: 'small low', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Summarize this changelog into three bullet points'))
    await $.command.run({ ...command('max'), command: 'effort' })
    await step($, { model: 'claude-haiku-5-5', effort: 'max' })
    const after = await $.command.run(command('status'))

    expect(seen.sent).toEqual(['max'])
    expect(seen.model).toBe('haiku')
    expect(after.text).toBe('Model Gear is off. The model is haiku.')
  })

  test('status names the effort the last prompt ran at', async ($, on) => {
    world(on, { model: 'opus', answer: 'everyday medium', store: { enabled: true, previous: 'opus' } })

    await $.prompt.submit(typed('Write a short post announcing our new opening hours'))
    const answer = await $.command.run(command('status'))

    expect(answer.text).toBe(
      'Model Gear is on. The model is sonnet. Your last prompt was everyday (sorted by the small model), so it ran on sonnet at medium effort. Turning it off puts opus back.',
    )
  })
})

describe('the line under the prompt', () => {
  test('names the model and effort of the last prompt while on, and clears when off', () => {
    const pick = { level: 'strong' as const, effort: 'high' as const, model: 'opus', isGuess: true }

    expect(statusLine(true, pick)).toBe('opus · high')
    expect(statusLine(true, null)).toBeUndefined()
    expect(statusLine(false, pick)).toBeUndefined()
  })
})

describe('the status bar chip', () => {
  test('says only whether it is on, in a wide and a narrow footer', () => {
    expect(chipLabel(true, 120)).toBe(' Model Gear: On ')
    expect(chipLabel(false, 120)).toBe(' Model Gear: Off ')
    expect(chipLabel(true, 40)).toBe(' Gear: On ')
    expect(chipLabel(false, 40)).toBe(' Gear: Off ')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`flips on one press and fits a narrow and a wide ${surface}`, async ($, on) => {
      const seen = world(on, { model: 'sonnet' })

      for (const columns of [40, 160]) {
        const ui = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'SessionMode',
          props: { modes: ['focus'] },
          viewport: { columns, rows: 24 },
        })
        const offLabel = chipLabel(false, columns)
        const onLabel = chipLabel(true, columns)
        expect(offLabel.length).toBeLessThan(columns / 2)

        expect(await ui.find({ type: 'Text', text: offLabel })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
        await ui.press({ key: 'model-gear-toggle' })
        expect(await ui.find({ type: 'Text', text: onLabel })).toBeDefined()
        await ui.press({ key: 'model-gear-toggle' })
        expect(await ui.find({ type: 'Text', text: offLabel })).toBeDefined()
        await ui.unmount()
      }

      expect(seen.model).toBe('sonnet')
    })
  }
})
