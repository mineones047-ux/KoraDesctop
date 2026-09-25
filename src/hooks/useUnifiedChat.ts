import { useCallback, useRef } from 'react'
import { useChat } from './useChat'
import { useReActAgent } from '../agent'
import { needsAgent } from '../agent/intent'
import type { ConfigData } from '../types'
import type { Translations } from '../i18n/en'
import { resolveProviderConfig, resolveDecisionLlmOptions } from '../lib/resolve-provider'

function toLlmOptions(config: ConfigData) {
  const base = resolveProviderConfig(config)
  return {
    ...base,
    temperature: config.temperature,
  }
}

/**
 * Unified entry point for chat + agent.
 *
 * Every user message flows through sendMessage:
 *  - `!` commands and plain conversational turns are handled by the chat
 *    streaming pipeline (unchanged behaviour).
 *  - requests that clearly need the computer's tools (files, shell, web,
 *    system control) are auto-routed to the agent loop. When the agent has a
 *    final answer, it is appended into the same chat so the conversation
 *    stays readable in one place.
 */
export function useUnifiedChat() {
  const chat = useChat()
  const agent = useReActAgent()
  const agentRef = useRef(agent)
  agentRef.current = agent

  const sendMessage = useCallback(
    async (content: string, config: ConfigData, t: Translations) => {
      if (!needsAgent(content)) {
        await chat.sendMessage(content, config, t)
        return
      }

      // Ensure a chat exists so the agent output lands somewhere visible.
      if (!chat.activeChatId) chat.createChat()

      chat.appendMessage({ role: 'user', content })

      await agentRef.current.startCycle(content, toLlmOptions(config), resolveDecisionLlmOptions(config))

      const result = agentRef.current.result
      if (result) {
        chat.appendMessage({
          role: 'assistant',
          content: result.success ? result.answer || '' : `⚠️ ${result.error || 'Agent error'}`,
        })
      }
    },
    [chat.sendMessage, chat.createChat, chat.appendMessage, chat.activeChatId]
  )

  const stopGeneration = useCallback(() => {
    if (agentRef.current.isRunning) {
      agentRef.current.stop()
      return
    }
    chat.stopGeneration()
  }, [chat.stopGeneration])

  return {
    ...chat,
    sendMessage,
    stopGeneration,
    isLoading: chat.isLoading || agent.isRunning,
  }
}
