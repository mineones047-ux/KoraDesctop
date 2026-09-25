/**
 * ReAct agent loop: think -> call_tool -> observe -> ... -> finish.
 *
 * Bounded by CONFIG.agent.MAX_STEPS + IterationBudget, guarded by ToolLoopGuard /
 * detectDegenerateRepetition / boundToolError, with a retry policy keyed on the
 * `[kora:<reason>]` error markers produced by the LLM gateway.
 *
 * The model answers with a single JSON decision
 * ({"action":"call_tool","tool":...} | {"action":"finish","answer":...});
 * dangerous tools pause the loop for user confirmation (resumeAfterConfirmation),
 * and Stop is checked after the LLM call *and* before tool execution.
 * See docs/PROJECT_HANDOFF.md §4.3.
 */
import { useState, useCallback, useRef } from 'react'
import { useAgent } from './planner'
import { useMemory } from './memory'
import { agentRegistry } from './tool-registry'
import type { PlanStep, ToolId } from './planner'
import type { MemoryEntry } from './memory'
import {
  IterationBudget,
  ToolLoopGuard,
  parseLlmErrorReason,
  isRetryableReason,
  backoffDelayMs,
  sleep,
  detectDegenerateRepetition,
  isEmptyResponse,
} from './guards'
import { buildSystemPrompt, buildFinalAnswerPrompt, buildMemorySummaryPrompt } from './prompts'
import { fitToTokenBudget } from './token-budget'
import { CONFIG } from '../config'

export interface AgentLLMOptions {
  provider: string
  model?: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  /** Ask the gateway for server-side JSON (`response_format: json_object`). */
  jsonMode?: boolean
}

export interface ReActResult {
  success: boolean
  answer?: string
  error?: string
}

interface AgentDecision {
  thought: string
  action: 'call_tool' | 'finish'
  tool?: string
  parameters?: Record<string, unknown>
  answer?: string
}

interface CycleContext {
  query: string
  llmOptions: AgentLLMOptions
  /** Two-tier routing: small tier for decisions; null/absent = single tier. */
  decisionLlmOptions?: AgentLLMOptions | null
}

const MAX_AGENT_STEPS = CONFIG.agent.MAX_STEPS

function summarizeResult(result: unknown): string {
  try {
    const s = JSON.stringify(result)
    return s && s.length > 1500 ? s.slice(0, 1500) + '...' : (s ?? String(result))
  } catch {
    return String(result)
  }
}

export function parseAgentResponse(text: string): AgentDecision | null {
  let cleaned = text.trim()
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) cleaned = fence[1].trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    const action = parsed.action === 'finish' ? 'finish' : parsed.action === 'call_tool' ? 'call_tool' : null
    if (!action) return null
    return {
      thought: typeof parsed.thought === 'string' ? parsed.thought : '',
      action,
      tool: typeof parsed.tool === 'string' ? parsed.tool : undefined,
      parameters:
        parsed.parameters && typeof parsed.parameters === 'object'
          ? (parsed.parameters as Record<string, unknown>)
          : undefined,
      answer: typeof parsed.answer === 'string' ? parsed.answer : undefined,
    }
  } catch {
    return null
  }
}

const FS_QUERY_REGEX =
  /(?:файл|файлы|папк|директор|каталог|прочитай|прочитат|посмотр|что (?:в|находится|лежит|есть)|содержим|список|какие|list|dir|folder|director|file|files|ls|contents|read|show|open|exists|find|grep)/i

function isFileSystemQuery(query: string): boolean {
  return FS_QUERY_REGEX.test(query)
}

function extractPath(query: string): string | null {
  const win = query.match(/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/)
  if (win) return win[0]
  const nix = query.match(/(?:~|\/)[^\s"'<>|]+/)
  return nix ? nix[0] : null
}

const RETRY_CORRECTIONS = [
  '',
  'Your previous response was not a valid JSON decision. Reply with ONLY a JSON object like {"thought":"...","action":"call_tool","tool":"dir","parameters":{"path":"C:\\\\Users\\\\name"}}. No markdown, no code fences, no explanations.',
  'This is your last attempt. Reply with ONLY a valid JSON object. "action" must be "call_tool" (with "tool" and "parameters") or "finish" (with "answer").',
]

export function useReActAgent() {
  const { state, think, act, observe, requestConfirmation, approveConfirmation, denyConfirmation, abort, reset } = useAgent()
  const { addEntry, getFullHistory } = useMemory()

  const [currentPlan, setCurrentPlan] = useState<PlanStep[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<ReActResult | null>(null)
  const [liveTranscript, setLiveTranscript] = useState('')

  const runningRef = useRef(false)
  const abortRef = useRef(false)
  const stepRef = useRef(0)
  const toolsUsedRef = useRef(0)
  const cycleRef = useRef<CycleContext | null>(null)
  const pendingToolRef = useRef<{ tool: ToolId; parameters: Record<string, unknown> } | null>(null)
  const budgetRef = useRef<IterationBudget>(new IterationBudget(MAX_AGENT_STEPS))
  const loopGuardRef = useRef<ToolLoopGuard>(new ToolLoopGuard())
  const historyTrimRef = useRef(0)
  /** Compacted note for history dropped by the token budget (per cycle). */
  const summaryRef = useRef('')
  /** The exact dropped text the current summary covers (avoid re-summarising). */
  const summarizedForRef = useRef('')

  const stopRunning = useCallback(() => {
    runningRef.current = false
    setIsRunning(false)
  }, [])

  const finishCycle = useCallback((res: ReActResult) => {
    stopRunning()
    setResult(res)
    if (res.answer) {
      addEntry({ role: 'assistant', content: res.answer })
    }
  }, [stopRunning, addEntry])

  const observeStep = useCallback(async (toolResult: unknown, thought: string) => {
    setCurrentPlan((prev) => [...prev, { action: 'observe', thought, result: toolResult }])
    observe(toolResult, thought)
    addEntry({ role: 'assistant', content: `Observation (${thought}): ${summarizeResult(toolResult)}` })
  }, [observe, addEntry])

  // LLM calls are streamed so the user sees the agent "thinking" live instead
  // of a frozen window while a local model works. We buffer the full text for
  // the existing retry/guard logic while mirroring it into liveTranscript.
  const streamDecisionText = useCallback(
    (messages: { role: string; content: string }[], llmOptions: AgentLLMOptions): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (abortRef.current || !runningRef.current) {
          reject(new Error('aborted'))
          return
        }

        let acc = ''
        let settled = false
        let unsubscribe = () => {}
        let transcriptTimer: ReturnType<typeof setTimeout> | null = null

        const clearTranscriptTimer = () => {
          if (transcriptTimer !== null) {
            clearTimeout(transcriptTimer)
            transcriptTimer = null
          }
        }

        // Live "thinking" text mirrors the stream, but coalesced so the modal
        // repaints at most once per interval instead of on every token.
        const scheduleTranscript = () => {
          if (transcriptTimer !== null) return
          transcriptTimer = setTimeout(() => {
            transcriptTimer = null
            setLiveTranscript(acc)
          }, CONFIG.stream.RENDER_INTERVAL_MS)
        }

        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTranscriptTimer()
          unsubscribe()
          fn()
        }

        const handle = window.kora.ai.chatStream(messages, llmOptions, (chunk: string) => {
          if (settled) return
          if (chunk === '[DONE]' || chunk === '[ABORT]') {
            setLiveTranscript('')
            settle(() => resolve(acc))
            return
          }
          if (chunk.startsWith('[ERROR]')) {
            setLiveTranscript('')
            settle(() => reject(new Error(chunk.slice(7).trim())))
            return
          }
          acc += chunk
          scheduleTranscript()
        })
        unsubscribe = handle.unsubscribe
      })
    },
    [],
  )

  const runStep = useCallback(async (): Promise<void> => {
    const ctx = cycleRef.current
    if (!ctx || abortRef.current || !runningRef.current) return

    if (stepRef.current >= MAX_AGENT_STEPS || budgetRef.current.remaining <= 0) {
      finishCycle({ success: false, error: `Reached the limit of ${MAX_AGENT_STEPS} agent steps` })
      return
    }
    if (!budgetRef.current.consume()) {
      finishCycle({ success: false, error: `Reached the limit of ${MAX_AGENT_STEPS} agent steps` })
      return
    }

    // Two-tier routing (ROADMAP Phase 0): the small decision tier picks the
    // next tool; the large model only writes the final answer (finish branch).
    const decisionTier: AgentLLMOptions =
      ctx.decisionLlmOptions &&
      (ctx.decisionLlmOptions.provider !== ctx.llmOptions.provider ||
        (ctx.decisionLlmOptions.model ?? '') !== (ctx.llmOptions.model ?? ''))
        ? ctx.decisionLlmOptions
        : ctx.llmOptions
    const twoTierActive = decisionTier !== ctx.llmOptions

    const llmOptions: AgentLLMOptions = {
      ...decisionTier,
      // Low temperature is critical for reliable JSON/tool calls on local models
      temperature: Math.min(typeof decisionTier.temperature === 'number' ? decisionTier.temperature : 1, 0.7),
      // Structured output (ROADMAP Phase 0): the decision call asks the gateway
      // for response_format json_object so the model is constrained to valid
      // JSON server-side; unsupported providers fall back transparently.
      jsonMode: true,
    }

    // Ask the model. Retry policy (ported from Hermes):
    // - invalid JSON → correction prompts
    // - empty response → fail fast after 2 in a row
    // - degenerate repetition → correction, then give up
    // - rate_limit/server_error/network/timeout → backoff retries
    // - context_overflow → drop oldest half of history once
    let decision: AgentDecision | null = null
    let lastMessages: { role: string; content: string }[] = []
    let correctionIdx = 0
    let transientRetries = 0
    let emptyCount = 0
    let overflowTrimmed = false
    const maxLoops = 14
    for (let loop = 0; loop < maxLoops; loop++) {
      let llmText: string
      try {
        const allEntries = getFullHistory()
        // Hard fallback trim (context_overflow recovery, unchanged) …
        const trimOffset = Math.min(historyTrimRef.current, Math.max(0, allEntries.length - 4))
        // … then the token budget (ROADMAP Phase 0): bound what we send per
        // call, dropping the oldest entries first and keeping a recent tail.
        const fit = fitToTokenBudget(allEntries.slice(trimOffset), CONFIG.agent.HISTORY_TOKEN_BUDGET, 4)

        // Summarise newly dropped history once per distinct segment. The note is
        // injected as a system message; failures are non-fatal (the cycle simply
        // continues without a summary).
        if (fit.droppedText && fit.droppedText !== summarizedForRef.current) {
          summarizedForRef.current = fit.droppedText
          try {
            const summaryInput =
              (summaryRef.current ? `Existing note:\n${summaryRef.current}\n\n` : '') + fit.droppedText
            const note = (
              await streamDecisionText(
                [
                  {
                    role: 'system',
                    content: buildMemorySummaryPrompt() + summaryInput.slice(0, CONFIG.agent.SUMMARIZE_INPUT_CAP),
                  },
                  { role: 'user', content: 'Summarize the dropped segment above into the single compact note.' },
                ],
                { ...ctx.llmOptions, jsonMode: false },
              )
            ).trim()
            if (note && !isEmptyResponse(note)) summaryRef.current = note
          } catch {
            if (abortRef.current) return
          }
          if (abortRef.current || !runningRef.current) return
        }

        const history = fit.kept.map((e: MemoryEntry) => ({
          role: e.role,
          content: e.content,
        }))
        const messages = [
          { role: 'system', content: buildSystemPrompt() },
          ...(summaryRef.current
            ? [{ role: 'system', content: `[Earlier conversation summary]\n${summaryRef.current}` }]
            : []),
          ...history,
        ]
        const lastUser = [...history].reverse().find((m) => m.role === 'user')
        if (!lastUser || lastUser.content !== ctx.query) {
          messages.push({ role: 'user', content: ctx.query })
        }
        if (RETRY_CORRECTIONS[correctionIdx]) {
          messages.push({ role: 'user', content: RETRY_CORRECTIONS[correctionIdx] })
        }
        lastMessages = messages
        llmText = await streamDecisionText(messages, llmOptions)
      } catch (err) {
        if (abortRef.current) return
        const reason = parseLlmErrorReason(err)
        if (reason === 'context_overflow' && !overflowTrimmed) {
          overflowTrimmed = true
          const total = getFullHistory().length
          historyTrimRef.current += Math.max(2, Math.ceil(total / 2))
          continue
        }
        if (isRetryableReason(reason) && transientRetries < 2) {
          transientRetries++
          await sleep(backoffDelayMs(transientRetries))
          continue
        }
        finishCycle({ success: false, error: `Agent LLM error (${reason}): ${(err as Error).message}` })
        return
      }

      // empty-response guard: deterministic-empty outputs skip the retry budget quickly
      if (isEmptyResponse(llmText)) {
        emptyCount++
        if (emptyCount >= 2) {
          finishCycle({
            success: false,
            error: 'The model returned an empty response twice in a row. It may be overloaded — try again or switch models.',
          })
          return
        }
        continue
      }
      emptyCount = 0

      // repetition guard: degenerate looping text is not worth parsing
      if (detectDegenerateRepetition(llmText)) {
        if (correctionIdx >= RETRY_CORRECTIONS.length - 1) break
        correctionIdx++
        continue
      }

      // Stop pressed while the LLM call was in flight — do not act on a stale decision
      if (abortRef.current || !runningRef.current) return

      decision = parseAgentResponse(llmText)
      if (decision) break

      if (correctionIdx >= RETRY_CORRECTIONS.length - 1) break
      correctionIdx++
    }

    if (!decision) {
      finishCycle({
        success: false,
        error: 'The model did not return a valid tool decision after several attempts. Try again or switch to a stronger model.',
      })
      return
    }

    setCurrentPlan((prev) => [...prev, { action: 'think', thought: decision.thought }])
    think(decision.thought)

    if (decision.action === 'finish') {
      // Grounding guard: if the task is about the file system but no tool was used,
      // the answer is likely a hallucination. Force a real directory listing first.
      if (isFileSystemQuery(ctx.query) && toolsUsedRef.current === 0) {
        const dirPath = extractPath(ctx.query) ?? '~'
        setCurrentPlan((prev) => [
          ...prev,
          { action: 'act', thought: `Grounding: listing ${dirPath}`, tool: 'dir', parameters: { path: dirPath } },
        ])
        act('dir', { path: dirPath })
        let toolResult: unknown
        try {
          toolResult = await agentRegistry.execute('dir', { path: dirPath })
        } catch (err) {
          toolResult = { success: false, error: (err as Error).message }
        }
        await observeStep(toolResult, `Directory listing of ${dirPath}`)
        loopGuardRef.current.record('dir', { path: dirPath }, toolResult)
        toolsUsedRef.current += 1
        stepRef.current += 1
        await runStep()
        return
      }
      let answer = decision.answer || 'Task completed.'
      if (twoTierActive) {
        // Two-tier routing: the LARGE model turns the conversation into the
        // final prose answer; the small tier only produced the JSON decision.
        if (abortRef.current || !runningRef.current) return
        try {
          const answerMessages = [
            { role: 'system' as const, content: buildFinalAnswerPrompt() },
            ...lastMessages.filter((m) => m.role !== 'system' && !RETRY_CORRECTIONS.includes(m.content)),
          ]
          const big = (await streamDecisionText(answerMessages, { ...ctx.llmOptions, jsonMode: false })).trim()
          if (big && !isEmptyResponse(big)) answer = big
        } catch {
          // Keep the small tier's answer rather than failing a finished cycle.
          if (abortRef.current) return
        }
        if (abortRef.current || !runningRef.current) return
        setLiveTranscript('')
      }
      finishCycle({ success: true, answer })
      return
    }

    const tool = decision.tool as ToolId
    const parameters = decision.parameters ?? {}
    if (!tool) {
      finishCycle({ success: false, error: 'Agent requested a tool call without a tool name.' })
      return
    }

    setCurrentPlan((prev) => [...prev, { action: 'act', thought: `Executing ${tool}`, tool, parameters }])
    act(tool, parameters)

    if (abortRef.current || !runningRef.current) return

    let toolResult: unknown
    try {
      toolResult = await agentRegistry.execute(tool, parameters)
    } catch (err) {
      toolResult = { success: false, error: (err as Error).message }
    }

    if (
      toolResult &&
      typeof toolResult === 'object' &&
      (toolResult as { status?: string }).status === 'pending_confirmation'
    ) {
      pendingToolRef.current = { tool, parameters }
      requestConfirmation('tool', { tool, parameters })
      return
    }

    await observeStep(toolResult, `Result of ${tool}`)

    // tool loop guard: inject a synthetic warning when the agent repeats itself
    const guardMessage = (() => {
      loopGuardRef.current.record(tool, parameters, toolResult)
      return loopGuardRef.current.check()
    })()
    if (guardMessage) {
      addEntry({ role: 'assistant', content: `⚠️ ${guardMessage}` })
    }

    toolsUsedRef.current += 1
    stepRef.current += 1
    await runStep()
  }, [think, act, observe, observeStep, finishCycle, requestConfirmation, getFullHistory, addEntry, streamDecisionText])

  const resumeAfterConfirmation = useCallback(async (approved: boolean): Promise<void> => {
    const pending = pendingToolRef.current
    const ctx = cycleRef.current
    pendingToolRef.current = null
    if (!pending || !ctx || !runningRef.current) return

    if (approved) {
      approveConfirmation()
      let toolResult: unknown
      try {
        toolResult = await agentRegistry.execute(pending.tool, pending.parameters, { approved: true })
      } catch (err) {
        toolResult = { success: false, error: (err as Error).message }
      }
      await observeStep(toolResult, `Result of ${pending.tool}`)
    } else {
      denyConfirmation()
      await observeStep(
        { success: false, error: 'Action was denied by the user' },
        `User denied ${pending.tool}`
      )
    }
    stepRef.current += 1
    await runStep()
  }, [approveConfirmation, denyConfirmation, observeStep, runStep])

  const startCycle = useCallback(async (query: string, llmOptions: AgentLLMOptions, decisionLlmOptions?: AgentLLMOptions | null): Promise<void> => {
    abortRef.current = false
    setResult(null)
    setCurrentPlan([])
    setLiveTranscript('')
    reset()
    stepRef.current = 0
    toolsUsedRef.current = 0
    budgetRef.current = new IterationBudget(MAX_AGENT_STEPS)
    loopGuardRef.current.reset()
    historyTrimRef.current = 0
    summaryRef.current = ''
    summarizedForRef.current = ''
    cycleRef.current = { query, llmOptions, decisionLlmOptions: decisionLlmOptions ?? null }
    runningRef.current = true
    setIsRunning(true)

    try {
      await agentRegistry.refreshMcpTools()
    } catch (err) {
      console.warn('[AGENT] Failed to refresh MCP tools:', err)
    }

    addEntry({ role: 'user', content: query })
    await runStep()
  }, [reset, addEntry, runStep])

  const stop = useCallback(() => {
    abortRef.current = true
    pendingToolRef.current = null
    abort()
    stopRunning()
    setLiveTranscript('')
  }, [abort, stopRunning])

  return {
    state,
    isRunning,
    currentPlan,
    result,
    liveTranscript,
    startCycle,
    stop,
    resumeAfterConfirmation,
  }
}
