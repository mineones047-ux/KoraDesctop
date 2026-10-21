/**
 * The agent's public surface — this barrel is what other modules import.
 *
 * Kept separate from `planner.ts` so consumers depend on one stable entry point; the
 * internal file layout can change without touching every import site.
 */

// Agent state machine: `think/act/observe` bookkeeping plus the confirmation slot.
export { useAgent, DEFAULT_AGENT_STATE, isMcpToolId } from './planner'
export type { PlanStep, AgentState, ToolId, BuiltinToolId, ToolMetadata, ParameterDefinition } from './planner'
// What tools exist, their argument schemas and which need the user's OK.
export {
  BUILTIN_TOOL_METADATA,
  getAllToolMetadata,
  agentRegistry,
  ToolRegistry,
} from './tool-registry'
// Long-term facts the agent carries between chats (name, preferences, context).
export { useMemory } from './memory'
export type { MemoryEntry, MemoryBank } from './memory'
// The ReAct loop proper: LLM call → tool dispatch → observe, with budgets and retries.
export { useReActAgent } from './orchestrator'
export type { AgentLLMOptions, ReActResult } from './orchestrator'
// Assembles the system prompt from the template, tool schemas, skills and memory.
export { buildSystemPrompt } from './prompts'
// Decides whether a message should go to the agent loop at all, or be answered directly.
export { needsAgent, hasToolIntent, isCommandMessage } from './intent'
// Runaway protection: iteration budget, degenerate-repetition detection, retry backoff.
export {
  IterationBudget,
  ToolLoopGuard,
  parseLlmErrorReason,
  isRetryableReason,
  backoffDelayMs,
  sleep,
  detectDegenerateRepetition,
  isEmptyResponse,
  boundToolError,
} from './guards'
export type { FailoverReason } from './guards'
