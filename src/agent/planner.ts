import { useState, useCallback } from 'react'

export type BuiltinToolId =
  | 'shell'
  | 'file'
  | 'patch_file'
  | 'grep'
  | 'open'
  | 'dir'
  | 'write'
  | 'rename'
  | 'delete'
  | 'mkdir'
  | 'stat'
  | 'exists'
  | 'help'
  | 'volume'
  | 'mute'
  | 'brightness'
  | 'windows'
  | 'shutdown'
  | 'restart'
  | 'sleep'
  | 'lock'
  | 'search'
  | 'clipboard'
  | 'ai_chat'
  | 'ai_list_models'
  | 'ai_test_connection'
  | 'tts_synthesize'
  | 'tts_voices'

export type ToolId = BuiltinToolId | `mcp__${string}__${string}`

export function isMcpToolId(id: string): id is `mcp__${string}__${string}` {
  return id.startsWith('mcp__')
}

export interface ToolMetadata {
  id: ToolId
  name: string
  description: string
  requiresConfirmation: boolean
  parameters: ParameterDefinition[]
}

export interface ParameterDefinition {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description: string
}

export interface PlanStep {
  action: 'think' | 'act' | 'observe'
  thought: string
  tool?: ToolId
  parameters?: Record<string, unknown>
  result?: unknown
  continue?: boolean
}

export interface AgentState {
  isThinking: boolean
  isExecuting: boolean
  currentStep: number
  totalSteps: number
  history: PlanStep[]
  pendingConfirmation: { type: string; params: Record<string, unknown> } | null
  abortRequested: boolean
}

export const DEFAULT_AGENT_STATE: AgentState = {
  isThinking: false,
  isExecuting: false,
  currentStep: 0,
  totalSteps: 0,
  history: [],
  pendingConfirmation: null,
  abortRequested: false,
}

export function useAgent() {
  const [state, setState] = useState<AgentState>(DEFAULT_AGENT_STATE)

  const think = useCallback((query: string, context?: Record<string, unknown>): PlanStep => {
    setState((s) => ({
      ...s,
      isThinking: true,
      currentStep: s.currentStep + 1,
      totalSteps: s.totalSteps + 1,
      history: [
        ...s.history,
        { action: 'think', thought: `Analyzing: ${query}`, ...(context ? { parameters: context } : {}) },
      ],
    }))

    return {
      action: 'think',
      thought: `Analyzing query: ${query}`,
      parameters: context,
    }
  }, [])

  const act = useCallback((tool: ToolId, parameters: Record<string, unknown>): PlanStep => {
    setState((s) => ({
      ...s,
      isExecuting: true,
      currentStep: s.currentStep + 1,
      history: [...s.history, { action: 'act', thought: `Executing ${tool}`, tool, parameters }],
    }))

    return {
      action: 'act',
      thought: `Executing ${tool}`,
      tool,
      parameters,
    }
  }, [])

  const observe = useCallback((result: unknown, thought?: string): PlanStep => {
    setState((s) => ({
      ...s,
      currentStep: s.currentStep + 1,
      history: [...s.history, { action: 'observe', thought: thought || 'Observing result', result }],
    }))

    return {
      action: 'observe',
      thought: thought || 'Observing result',
      result,
    }
  }, [])

  const requestConfirmation = useCallback((type: string, params: Record<string, unknown>): void => {
    setState((s) => ({
      ...s,
      pendingConfirmation: { type, params },
    }))
  }, [])

  const approveConfirmation = useCallback((): boolean => {
    setState((s) => ({
      ...s,
      pendingConfirmation: null,
    }))
    return true
  }, [])

  const denyConfirmation = useCallback((): boolean => {
    setState((s) => ({
      ...s,
      pendingConfirmation: null,
    }))
    return false
  }, [])

  const abort = useCallback((): void => {
    setState({
      ...DEFAULT_AGENT_STATE,
      abortRequested: true,
    })
  }, [])

  const reset = useCallback((): void => {
    setState(DEFAULT_AGENT_STATE)
  }, [])

  return {
    state,
    think,
    act,
    observe,
    requestConfirmation,
    approveConfirmation,
    denyConfirmation,
    abort,
    reset,
  }
}