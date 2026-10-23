/**
 * The agent's state machine — `think → act → observe` bookkeeping.
 *
 * Scope note: the *loop* itself lives in `orchestrator.ts` (this is the ReAct loop
 * proper, with the LLM call, retries and guards). What lives here is the bookkeeping
 * around it: which step we are on, what happened, and — most importantly — the
 * pending-confirmation slot that a dangerous tool waits in.
 *
 * `think`/`act`/`observe` are exposed as callbacks that both return the `PlanStep` and
 * append it to `state.history`, so the Agent panel can render the trace without the
 * orchestrator having to thread it through separately.
 */
import { useState, useCallback } from 'react'

/** Every built-in tool the agent can call. Kept as a literal union so a typo in the
 *  registry or the prompt is a compile error rather than a runtime "unknown tool". */
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
  | 'skill'
  | 'mcp_servers'
  | 'mcp_manage'

/** A tool id: either a built-in, or an MCP tool named `mcp__<server>__<tool>`.
 *  The template-literal arm is what lets the agent discover new tools at runtime without
 *  a code change — the registry builds those ids dynamically. */
export type ToolId = BuiltinToolId | `mcp__${string}__${string}`

/**
 * Narrowing guard: is this id a dynamically discovered MCP tool?
 *
 * The orchestrator uses this to decide whether a tool needs a definition fetched from a
 * server before it can be called, rather than looked up in `BUILTIN_TOOL_METADATA`.
 */
export function isMcpToolId(id: string): id is `mcp__${string}__${string}` {
  return id.startsWith('mcp__')
}

/** What the agent tells the model a tool does, and whether it needs the user's OK.
 *  This is the exact shape the Rust `kora-core::ToolMetadata` mirrors, so the prompt
 *  reads the same in both implementations. */
export interface ToolMetadata {
  id: ToolId
  name: string
  description: string
  requiresConfirmation: boolean
  parameters: ParameterDefinition[]
}

/** One argument of a tool, in the shape the system prompt renders. */
export interface ParameterDefinition {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description: string
}

/** One entry in the agent's visible trace. `action` says which phase produced it. */
export interface PlanStep {
  action: 'think' | 'act' | 'observe'
  thought: string
  tool?: ToolId
  parameters?: Record<string, unknown>
  result?: unknown
  continue?: boolean
}

/** The whole of the agent's UI-visible state. */
export interface AgentState {
  isThinking: boolean
  isExecuting: boolean
  currentStep: number
  totalSteps: number
  history: PlanStep[]
  /** Set while a dangerous tool waits for the user; `null` when nothing is pending. */
  pendingConfirmation: { type: string; params: Record<string, unknown> } | null
  abortRequested: boolean
}

/** The state a fresh cycle starts from. Exported so `reset` and `abort` share one source
 *  of truth instead of each spelling out the zero value. */
export const DEFAULT_AGENT_STATE: AgentState = {
  isThinking: false,
  isExecuting: false,
  currentStep: 0,
  totalSteps: 0,
  history: [],
  pendingConfirmation: null,
  abortRequested: false,
}

/**
 * The agent bookkeeping hook.
 *
 * Returns the current `AgentState` plus the callbacks that advance it. The orchestrator
 * drives this; the Agent panel renders `state.history` and `state.pendingConfirmation`.
 *
 * The confirmation callbacks are pure state transitions and return a boolean for
 * convenience — the *authorisation* itself is not here. The security boundary is the
 * denylist in the main process; this only records that the user said yes.
 */
export function useAgent() {
  const [state, setState] = useState<AgentState>(DEFAULT_AGENT_STATE)

  /** Record "I am working out what to do", and return that step for the caller to use. */
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

  /** Record "I am calling a tool", and return that step. The tool itself is executed by
   *  the orchestrator via the registry — this only records the intent. */
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

  /** Record what a tool returned, so the next `think` step has the trace to reason from. */
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

  /** Park a tool call that the user must approve before it runs. The orchestrator awaits
   *  `approve`/`deny`, then either dispatches the call or turns it into a refusal. */
  const requestConfirmation = useCallback((type: string, params: Record<string, unknown>): void => {
    setState((s) => ({
      ...s,
      pendingConfirmation: { type, params },
    }))
  }, [])

  /** The user said yes: clear the prompt, report success to the awaiting orchestrator. */
  const approveConfirmation = useCallback((): boolean => {
    setState((s) => ({
      ...s,
      pendingConfirmation: null,
    }))
    return true
  }, [])

  /** The user said no: clear the prompt, report refusal. The orchestrator feeds that back
   *  to the model as a tool result so it can react rather than stall. */
  const denyConfirmation = useCallback((): boolean => {
    setState((s) => ({
      ...s,
      pendingConfirmation: null,
    }))
    return false
  }, [])

  /** User pressed stop. Clears the trace but keeps `abortRequested` set, so a cycle already
   *  in flight notices the cancellation between steps instead of starting fresh. */
  const abort = useCallback((): void => {
    setState({
      ...DEFAULT_AGENT_STATE,
      abortRequested: true,
    })
  }, [])

  /** Start a new cycle: back to the zero state, no abort flag. */
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