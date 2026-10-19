import type { Effort, LastPick, Level } from '../types'

export const LEVELS: readonly Level[] = ['small', 'everyday', 'strong', 'strongest']

// Lowest first, as the engine orders them: xhigh sits between high and max.
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// The model lines, smallest first. An option in the install's model list is
// placed by the line name it contains, so new versions are picked up without
// naming them here.
export const LINES = ['haiku', 'sonnet', 'opus', 'fable'] as const
export type Line = (typeof LINES)[number]

const LEVEL_LINE: Record<Level, Line> = {
  small: 'haiku',
  everyday: 'sonnet',
  strong: 'opus',
  strongest: 'fable',
}

// The effort each level gets when nothing in the prompt says otherwise.
const LEVEL_EFFORT: Record<Level, Effort> = {
  small: 'low',
  everyday: 'medium',
  strong: 'high',
  strongest: 'xhigh',
}

export const CLASSIFIER_SYSTEM = [
  'You sort a request for an AI assistant by how capable a model it needs and how hard that model should think.',
  'Answer with exactly two words: the level, then the effort. For example: strong high',
  '',
  'Level:',
  'small: quick, simple jobs. Summarize, sort, extract, rename, translate, reformat, a short factual answer.',
  'everyday: an email, a post, a short draft, a small edit, a simple question about one file, a quick chart.',
  'strong: the default for anything that matters. Building or changing software, multi-step projects, research, analysis, long documents, planning, anything touching several files or tools.',
  'strongest: only the very hardest. Deep research that runs for hours, a very large build or migration, a problem the strong model would likely fall short on.',
  '',
  'Effort:',
  'low: the answer is obvious or mechanical. A lookup, a rename, a reformat, a translation, a one-line reply.',
  'medium: a few plain steps. Routine writing, a small edit, a simple question about code.',
  'high: needs real thought. Most coding, debugging, analysis, careful writing, weighing options.',
  'xhigh: hard and multi-step. Tricky bugs, architecture, large builds, long research, work where a mistake is costly.',
  'max: only the hardest reasoning, where getting it right matters far more than time or cost.',
  '',
  'Pick the two separately: a small job can still need care, and a strong model can move fast on routine work.',
  'When unsure, say strong high.',
].join('\n')

export function classifierPrompt(text: string): string {
  return `<request>\n${text.slice(0, 6000)}\n</request>\n\nTwo words: the level (small, everyday, strong or strongest), then the effort (low, medium, high, xhigh or max).`
}

/** The level named in the small model's answer, or undefined when it named none. */
export function parseLevel(answer: string): Level | undefined {
  const found = answer.toLowerCase().match(/\b(strongest|strong|everyday|small)\b/)

  return found ? (found[1] as Level) : undefined
}

/** The effort named in an answer, "extra high" and "maximum" read as xhigh and max. */
export function parseEffort(answer: string): Effort | undefined {
  const lower = answer
    .toLowerCase()
    .replace(/\b(extra|x)[- ]high\b/g, 'xhigh')
    .replace(/\bmaximum\b/g, 'max')
  const found = lower.match(/\b(xhigh|max|high|medium|low)\b/)

  return found ? (found[1] as Effort) : undefined
}

export function isEffort(value: unknown): value is Effort {
  return EFFORTS.includes(value as Effort)
}

const ACK_WORDS = new Set([
  'yes', 'y', 'yep', 'yeah', 'yup', 'ok', 'okay', 'k', 'sure', 'fine', 'alright',
  'go', 'ahead', 'keep', 'going', 'continue', 'carry', 'on', 'proceed', 'next',
  'do', 'it', 'that', 'this', 'with', 'please', 'pls', 'now', 'and', 'then', 'right', 'lets', "let's",
  'thanks', 'thank', 'you', 'ty', 'sounds', 'looks', 'good', 'great', 'perfect',
  'cool', 'nice', 'lgtm', 'no', 'nope', 'stop', 'again', 'retry', 'try',
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .split(' ')
    .filter(word => word !== '')
}

/** A reply to what Claude just said: under four words, or nothing but "yes, keep going" words. */
export function isShortReply(text: string): boolean {
  const all = words(text)

  return all.length < 4 || all.every(word => ACK_WORDS.has(word))
}

const STRONGEST = [
  /\bmigrat(e|ion|ing)\b.*\b(entire|whole|all|every)\b/,
  /\b(entire|whole) (codebase|code base|repo|repository|monorepo|system|platform|stack)\b/,
  /\bdeep research\b/,
  /\bfor (several |many )?hours\b/,
  /\bfrom scratch\b/,
  /\blarge[- ]scale\b/,
]

const STRONG = /\b(build|implement|refactor|debug|fix|bug|bugs|feature|features|code|coding|app|api|deploy|tests?|migrate|research|analy[sz]e|analysis|plan|planning|roadmap|design|architecture|project|investigate|review|report|integrate|optimi[sz]e|files|repo|repository|database|schema|script|function|endpoint|pipeline|strategy)\b/
const SMALL = /\b(summari[sz]e|summary|tl;?dr|sort|extract|rename|translate|translation|reformat|format|convert|define|definition|spell|spelling|capitali[sz]e|lowercase|uppercase|alphabeti[sz]e)\b/
const EVERYDAY = /\b(email|e-mail|post|tweet|draft|letter|message|reply|caption|bio|blurb|edit|tweak|reword|rephrase|proofread|chart|graph|file|explain|what does)\b/
const QUESTION = /^(what|who|when|where|which|how (many|much|old|far|long|big|tall))\b/

/** A guess from the prompt's words, used when the small model gives no answer. */
export function guessLevel(text: string): Level {
  const lower = text.toLowerCase()
  const count = words(text).length

  if (STRONGEST.some(pattern => pattern.test(lower))) return 'strongest'
  if (count > 150 || STRONG.test(lower)) return 'strong'
  if (SMALL.test(lower)) return 'small'
  if (EVERYDAY.test(lower)) return 'everyday'
  if (count <= 15 && QUESTION.test(lower.trim())) return 'small'

  return 'strong'
}

const NAMED_EFFORT = /\b(low|medium|high|xhigh|x-high|extra[- ]high|max|maximum) effort\b/
const MAX_EFFORT = /\bultrathink\b|\bthink as hard as (you can|possible)\b/
const HARDER = /\b(careful|carefully|thorough|thoroughly|in[- ]depth|tricky|subtle|difficult|complex|edge cases?|race conditions?|concurrency|security|prove|proof|rigorous|rigorously|root cause|step by step|think (hard|harder|carefully))\b/
const EASIER = /\b(quick|quickly|simple|simply|brief|briefly|rough|roughly|one[- ]liner|tiny)\b/

/** The effort the person asked for in so many words ("use max effort", "ultrathink"). */
export function namedEffort(text: string): Effort | undefined {
  const lower = text.toLowerCase()
  const named = lower.match(NAMED_EFFORT)?.[1]
  if (named !== undefined) return parseEffort(named)
  if (MAX_EFFORT.test(lower)) return 'max'

  return undefined
}

/** A guess from the prompt's words: the level's usual effort, a step up or down. */
export function guessEffort(text: string, level: Level): Effort {
  const named = namedEffort(text)
  if (named !== undefined) return named

  const lower = text.toLowerCase()
  const step = (HARDER.test(lower) ? 1 : 0) - (EASIER.test(lower) ? 1 : 0)
  const index = EFFORTS.indexOf(LEVEL_EFFORT[level]) + step

  return EFFORTS[Math.min(Math.max(index, 0), EFFORTS.length - 1)] ?? LEVEL_EFFORT[level]
}

export function lineOf(model: string): Line | undefined {
  const lower = model.toLowerCase()

  return LINES.find(line => lower.includes(line))
}

/** The install's option for one line: the plainest spelling when it lists several. */
export function optionForLine(options: readonly string[], line: Line): string | undefined {
  const matches = options.filter(option => lineOf(option) === line)
  const plain = matches.filter(option => !/1m/i.test(option))
  const pool = plain.length > 0 ? plain : matches

  return [...pool].sort((a, b) => a.length - b.length)[0]
}

/**
 * The options to try for a level, best first: the level's own line, then each
 * smaller line, then (when nothing smaller exists) each larger one.
 */
export function candidatesFor(level: Level, options: readonly string[]): string[] {
  const target = LINES.indexOf(LEVEL_LINE[level])
  const order = [
    ...LINES.slice(0, target + 1).reverse(),
    ...LINES.slice(target + 1),
  ]

  return order
    .map(line => optionForLine(options, line))
    .filter((option): option is string => option !== undefined)
}

/** The smallest line the install lists, for the quick check. */
export function smallestModel(options: readonly string[]): string | undefined {
  return candidatesFor('small', options)[0]
}

export function isSameModel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The option that puts `previous` back, as close as the install's list allows. */
export function restoreValue(previous: string, options: readonly string[]): string {
  const exact = options.find(option => isSameModel(option, previous))
  if (exact !== undefined) return exact

  if (/default/i.test(previous)) {
    const fallback = options.find(option => /default/i.test(option))
    if (fallback !== undefined) return fallback
  }

  const line = lineOf(previous)
  const sameLine = line === undefined ? undefined : optionForLine(options, line)

  return sameLine ?? previous
}

/**
 * The chip's words, shortened on a narrow terminal so the footer never wraps.
 * Once a prompt is sorted it names the model and effort in use, since the
 * footer's own effort reads the saved setting, not the one sent.
 */
export function chipLabel(isOn: boolean, columns: number, pick: LastPick | null = null): string {
  const state = isOn ? 'On' : 'Off'
  const isWide = columns >= 60

  if (isOn && pick !== null && isEffort(pick.effort)) {
    return isWide ? ` Model Gear: ${pick.model} · ${pick.effort} ` : ` Gear: ${pick.effort} `
  }

  return isWide ? ` Model Gear: ${state} ` : ` Gear: ${state} `
}

/**
 * The line pinned under the prompt: the model and effort the last prompt got,
 * worded as the chip has them, minus the "Model Gear:" label because the
 * engine already prefixes the plugin's name. Undefined clears the line.
 */
export function statusLine(isOn: boolean, pick: LastPick | null): string | undefined {
  if (!isOn || pick === null || !isEffort(pick.effort)) return undefined

  return `${pick.model} · ${pick.effort}`
}
