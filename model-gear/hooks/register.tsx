import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PromptSubmitInput, Register } from 'claude-code'

import type { Effort, LastPick } from '../types'
import {
  CLASSIFIER_SYSTEM,
  candidatesFor,
  chipLabel,
  classifierPrompt,
  guessEffort,
  guessLevel,
  isEffort,
  isSameModel,
  isShortReply,
  lineOf,
  namedEffort,
  parseEffort,
  parseLevel,
  restoreValue,
  smallestModel,
  statusLine,
} from './logic'

const MODEL_KEY = 'model'
const GOLD = '#F2C46D'
const SLATE = '#262B33'
const INK = '#0D1117'
const LIGHT = '#E6EDF3'
const MUTED = '#7D8590'

// $.state drives the chip; $.store is the record that outlives the session.
const enabled = atom({ plugin: 'model-gear', key: 'enabled' } as const, false)
const last = atom({ plugin: 'model-gear', key: 'last' } as const, null)

type Engine = EngineInterface

async function modelRow($: Engine): Promise<ConfigRow | undefined> {
  const rows = await $.config.list()

  return rows.find(row => row.key === MODEL_KEY)
}

function asText(value: ConfigRow['value']): string {
  return typeof value === 'string' ? value : String(value)
}

/** Pins the model and effort under the prompt. A failed pin leaves the line as it was. */
function showLine($: Engine, pick: LastPick | null, isOn: boolean): void {
  try {
    $.ui.status(statusLine(isOn, pick))
  } catch {
    // The chip still shows the same words.
  }
}

async function isEnabled($: Engine): Promise<boolean> {
  return (await $.store.get('enabled')) === true
}

async function turnOn($: Engine): Promise<string> {
  if (await isEnabled($)) {
    await update($, enabled, () => true)
    return 'Model Gear is already on.'
  }

  const row = await modelRow($)
  if (row === undefined) {
    return "Model Gear can't find the model setting in this version of Claude Code, so it stayed off."
  }
  if (row.isLocked) {
    return 'Your organization sets the model here, so Model Gear stayed off.'
  }

  const previous = asText(row.value)
  await $.store.set('previous', previous)
  await $.store.delete('applied')
  await $.store.set('enabled', true)
  await update($, enabled, () => true)

  return `Model Gear is on. Turning it off puts ${previous} back.`
}

/** `restore` is false when the person picked a model by hand: theirs stays. */
async function turnOff($: Engine, restore: boolean): Promise<string> {
  const wasOn = await isEnabled($)
  const previous = await $.store.get('previous')

  await $.store.set('enabled', false)
  await $.store.delete('previous')
  await $.store.delete('applied')
  await update($, enabled, () => false)
  await update($, last, () => null)
  showLine($, null, false)

  if (!wasOn) return 'Model Gear is already off.'
  if (!restore || typeof previous !== 'string') return 'Model Gear is off.'

  const row = await modelRow($)
  const value = restoreValue(previous, row?.options ?? [])
  if (row !== undefined && isSameModel(asText(row.value), value)) {
    return `Model Gear is off. The model is ${value}, as before.`
  }

  const result = await $.config.set({ key: MODEL_KEY, value })

  return result.deny === undefined
    ? `Model Gear is off. The model is back to ${value}.`
    : `Model Gear is off, but ${value} could not be put back: ${result.deny}`
}

async function status($: Engine): Promise<string> {
  const model = await $.session.model()
  if (!(await isEnabled($))) return `Model Gear is off. The model is ${model}.`

  const pick = await read($, last)
  const previous = await $.store.get('previous')
  const lines = [`Model Gear is on. The model is ${model}.`]
  if (pick !== null) {
    const how = pick.isGuess ? 'guessed from its words' : 'sorted by the small model'
    const effort = isEffort(pick.effort) ? ` at ${pick.effort} effort` : ''
    lines.push(`Your last prompt was ${pick.level} (${how}), so it ran on ${pick.model}${effort}.`)
  }
  if (typeof previous === 'string') lines.push(`Turning it off puts ${previous} back.`)

  return lines.join(' ')
}

async function runCommand($: Engine, args: string): Promise<string> {
  const word = args.trim().toLowerCase()

  if (word === 'on') return turnOn($)
  if (word === 'off') return turnOff($, true)
  if (word === '' || word === 'status') return status($)

  return `Model Gear takes on, off or status, not "${args.trim()}".`
}

async function toggle($: Engine): Promise<void> {
  try {
    if (await isEnabled($)) await turnOff($, true)
    else await turnOn($)
  } catch {
    // A press that fails leaves the switch where it was.
  }
}

/** The small model's answer for the prompt, or undefined when it gave none in time. */
async function askSmallModel($: Engine, text: string, options: readonly string[]): Promise<string | undefined> {
  const small = smallestModel(options)
  const names = small === undefined ? [] : [small, lineOf(small)]

  for (const model of new Set(names)) {
    if (model === undefined) continue
    try {
      const reply = await $.model.complete({
        model,
        system: CLASSIFIER_SYSTEM,
        prompt: classifierPrompt(text),
        maxTokens: 12,
        effort: 'low',
        timeoutMs: 4000,
      })

      return reply.isAnswered ? reply.text : undefined
    } catch {
      // The engine would not send to this spelling; try the line's alias.
    }
  }

  return undefined
}

function isTypedWhileIdle(e: PromptSubmitInput): boolean {
  const kind = e.origin.kind
  const isTyped = kind === 'composer' || kind === 'bridge'

  return isTyped && e.turnId === undefined && !e.text.trimStart().startsWith('/')
}

async function pickModel($: Engine, text: string): Promise<void> {
  const row = await modelRow($)
  if (row === undefined || row.isLocked) return

  const current = asText(row.value)
  const applied = await $.store.get('applied')
  if (typeof applied === 'string' && !isSameModel(current, applied)) {
    // The model moved since Model Gear set it (/model, the picker): the person's pick wins.
    await turnOff($, false)
    return
  }

  const options = row.options ?? []
  const answer = await askSmallModel($, text, options)
  const answered = answer === undefined ? undefined : parseLevel(answer)
  const level = answered ?? guessLevel(text)
  // An effort the person named in the prompt wins over the small model's.
  const effort =
    namedEffort(text) ?? (answer === undefined ? undefined : parseEffort(answer)) ?? guessEffort(text, level)

  let chosen: string | undefined
  for (const value of candidatesFor(level, options)) {
    if (isSameModel(current, value)) {
      chosen = value
      break
    }
    const result = await $.config.set({ key: MODEL_KEY, value })
    if (result.deny === undefined) {
      chosen = value
      break
    }
  }
  if (chosen === undefined) return

  const after = await modelRow($)
  await $.store.set('applied', asText(after?.value ?? chosen))
  const pick: LastPick = { level, effort, model: chosen, isGuess: answered === undefined }
  await update($, last, () => pick)
  showLine($, pick, true)
}

/**
 * The effort to send on the main loop's requests: the last pick's while
 * Model Gear is on. The engine has no effort row in /config, so it is set
 * on each request rather than saved; the person's own setting is untouched.
 */
async function effortToSend($: Engine): Promise<Effort | undefined> {
  if (!(await isEnabled($))) return undefined
  const pick = await read($, last)

  return pick !== null && isEffort(pick.effort) ? pick.effort : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'modelgear',
        description: 'Model Gear: pick the model for each prompt (on, off, status)',
        argumentHint: 'on|off|status',
      })
      // Every new session starts on. A session that is already on keeps its saved
      // "previous" model; turning on again would overwrite it with the auto pick.
      if (!(await isEnabled($))) await turnOn($)
      else await update($, enabled, () => true)
    } catch {
      // The command or the chip may be missing this session; prompts still go through.
    }

    return next(e)
  })

  on('command.run', { command: 'modelgear' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch {
      return { text: 'Model Gear could not do that just now. Nothing was changed.' }
    }
  }).catch(() => ({ text: 'Model Gear could not do that just now. Nothing was changed.' }))

  on('prompt.submit', async ($, e, next) => {
    try {
      if (isTypedWhileIdle(e) && !isShortReply(e.text) && (await isEnabled($))) {
        await pickModel($, e.text)
      }
    } catch {
      // Any failure keeps the current model; the prompt always goes through.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('config.set', { key: MODEL_KEY }, async ($, e, next) => {
    const result = await next(e)
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'

    if (result.deny === undefined && isPersons) {
      try {
        if (await isEnabled($)) await turnOff($, false)
      } catch {
        // The person's own pick has landed either way.
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  // Subagents get the same effort as the main loop but keep their own model.
  // A model that takes no effort is sent none.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort !== undefined ? await effortToSend($) : undefined

    return yield* next(effort === undefined || effort === e.effort ? e : { ...e, effort })
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // An effort set by hand wins, as a model picked by hand does.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isEffortChange = !e.args.trim().toLowerCase().startsWith('ultracode')

    if (isPersons && isEffortChange) {
      try {
        if (await isEnabled($)) {
          await turnOff($, false)
          $.ui.toast('Model Gear is off, so the effort you set stays. /modelgear on turns it back on.')
        }
      } catch {
        // The person's own effort has landed either way.
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const isOn = await read($, enabled)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const label = chipLabel(isOn, columns)
    const modes = e.props.modes.join(' & ')

    return (
      <Box flexDirection="row">
        {modes !== '' && (
          <Box flexShrink={1}>
            <Text color={MUTED} wrap="truncate-end">
              {modes}{' '}
            </Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Button key="model-gear-toggle" label={label.trim()} plain onPress={() => toggle($)}>
            <Text color={isOn ? INK : LIGHT} backgroundColor={isOn ? GOLD : SLATE} bold={isOn}>
              {label}
            </Text>
          </Button>
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
