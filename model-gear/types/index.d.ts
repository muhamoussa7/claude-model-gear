export type Level = 'small' | 'everyday' | 'strong' | 'strongest'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type LastPick = { level: Level; effort: Effort; model: string; isGuess: boolean }

declare module 'claude-code' {
  interface PluginState {
    'model-gear': { enabled: boolean; last: LastPick | null }
  }
}
