/**
 * Chat layer: message list, streaming, `!` commands, Stop and persistence.
 *
 * Streaming contract (docs/PROJECT_HANDOFF.md §6.1): payloads arrive as text
 * deltas, terminators as control strings ('[DONE]' / '[ERROR] <msg>'); '[ABORT]'
 * is sent back on the control channel. Token updates are coalesced to
 * CONFIG.stream.RENDER_INTERVAL_MS and `done()` always flushes the final text,
 * so nothing is lost on end/error/timeout/Stop.
 *
 * Commands found in the *model's* reply are displayed, never executed
 * (anti prompt-injection). Dangerous `!` commands need an explicit `!confirm`.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Message, Chat, ConfigData } from '../types'
import type { Translations } from '../i18n/en'
import { CONFIG } from '../config'
import { resolveProviderConfig } from '../lib/resolve-provider'
import {
  getCommandHandler,
  DANGEROUS_COMMANDS,
  describeDangerousCommand,
  type PendingAction,
  type CommandResult,
} from '../lib/commands'

const CMD_REGEX = /!(shell|file|open|dir|write|rename|delete|mkdir|stat|exists|help|calc|random|uuid|time|shutdown|restart|sleep|lock|volume|mute|brightness|windows|find|clipboard|search|confirm|deny)(?:\s+[^\n`!]+)?/g

/** Command names found in a model's reply — displayed, never executed. */
function extractCommands(text: string): string[] {
  const matches = text.match(CMD_REGEX)
  if (!matches) return []
  const seen = new Set<string>()
  const unique: string[] = []
  for (const m of matches) {
    const cmd = m.trim()
    if (!seen.has(cmd)) {
      seen.add(cmd)
      unique.push(cmd)
    }
  }
  return unique
}

/**
 * Does this command need the user to type `!confirm` first?
 *
 * `!clipboard` is special-cased: reading the clipboard is harmless, but `!clipboard <text>`
 * *writes* it, and a page that convinces the model to write the clipboard is a real
 * exfiltration path. So the decision depends on the arguments, not just the name.
 */
function isDangerousCommand(cmd: string): boolean {
  const trimmed = cmd.trim()
  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  if (name === 'clipboard' && trimmed.slice(11).trim().length > 0) return true
  return DANGEROUS_COMMANDS.has(name)
}

/**
 * Dispatch one `!` command, parking dangerous ones for confirmation.
 *
 * Returns `{isCommand: false}` for anything that is not a known command, and the caller
 * then treats the text as an ordinary chat message — so an unrecognised `!` word reaches
 * the model instead of vanishing.
 */
async function processCommand(
  content: string,
  t: Translations,
  bypassConfirm: boolean,
  pendingConfirmRef: MutableRefObject<PendingAction | null>,
): Promise<CommandResult> {
  const trimmed = content.trim()

  // Dangerous commands require explicit user confirmation before execution
  if (!bypassConfirm && isDangerousCommand(trimmed)) {
    const spaceIdx = trimmed.indexOf(' ')
    const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
    const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)
    const description = describeDangerousCommand(name, args, t)

    pendingConfirmRef.current = {
      type: name === 'shutdown' ? 'shutdown' : name === 'restart' ? 'restart' : 'command',
      args: [trimmed],
      description,
    }
    return {
      isCommand: true,
      output: `⚠️ **${t.danger.title}**\n\n${description}\n\n${t.danger.hint}`,
    }
  }

  // Parse command name and args
  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)

  const handler = getCommandHandler(name)
  if (handler) {
    return handler(args, t, { pendingConfirmRef, processCommand })
  }

  return { isCommand: false, output: '' }
}

/** A chat message as the model sees it (role + text). */
type HistoryEntry = { role: string; content: string }

/** First line of the first message, trimmed to the title limit. */
function titleFromMessage(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, CONFIG.chat.MAX_TITLE_LENGTH)
}

/**
 * The chat layer: messages, streaming, `!` commands, Stop, and persistence.
 *
 * Owns the renderer side of a conversation. Three invariants are worth knowing before
 * changing anything here:
 *  1. commands the *model* writes are displayed, never executed;
 *  2. a dangerous command typed by the *user* still needs an explicit `!confirm`;
 *  3. `done()` always flushes the accumulated text, so Stop, timeout and error all leave
 *     the same partial answer on screen rather than an empty bubble.
 */
export function useChat() {
  const pendingConfirmRef = useRef<PendingAction | null>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const chatsLoaded = useRef(false)
  const activeStreamHandleRef = useRef<{ chatId: string; messageId: string; stop: () => void } | null>(null)
  const stoppedStreamIdsRef = useRef<Set<string>>(new Set())
  const streamFinishersRef = useRef<Map<string, () => void>>(new Map())

  // Stop the in-flight generation, keeping whatever has already streamed in
  const stopGeneration = useCallback(() => {
    const handle = activeStreamHandleRef.current
    if (!handle) return
    stoppedStreamIdsRef.current.add(handle.messageId)
    try {
      handle.stop()
    } catch (err) {
      console.error('Failed to stop stream:', err)
    }
    // Resolve the pending stream promise immediately so isLoading resets
    const finisher = streamFinishersRef.current.get(handle.messageId)
    if (finisher) {
      streamFinishersRef.current.delete(handle.messageId)
      finisher()
    }
  }, [])

  // Load chats from disk on mount
  useEffect(() => {
    if (chatsLoaded.current) return
    chatsLoaded.current = true
    window.kora.chats.load().then((saved) => {
      if (saved.length > 0) {
        setChats(saved)
      }
    }).catch((err) => {
      console.error('Failed to load chats:', err)
    })
  }, [])

  // Save chats to disk on changes. Private (`ephemeral`) chats are filtered out: they
  // exist only in memory, which is what "private" promises.
  const latestChatsRef = useRef<Chat[]>([])
  latestChatsRef.current = chats

  useEffect(() => {
    if (!chatsLoaded.current) return
    const timer = setTimeout(() => {
      const persistent = chats.filter((chat) => !chat.ephemeral)
      window.kora.chats.save(persistent).catch((err: unknown) => {
        console.error('Failed to save chats:', err)
      })
    }, CONFIG.chat.SAVE_DEBOUNCE_MS) // debounce
    return () => clearTimeout(timer)
  }, [chats])

  // Flush pending save when the window is closing
  useEffect(() => {
    const flush = () => {
      window.kora.chats.saveSync(latestChatsRef.current.filter((chat) => !chat.ephemeral))
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)

  const createChat = useCallback((options?: { ephemeral?: boolean }) => {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: 'New chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ephemeral: options?.ephemeral || undefined,
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(newChat.id)
    return newChat.id
  }, [])

  const appendAssistantMessage = useCallback((chatId: string, content: string) => {
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    }
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? { ...chat, messages: [...chat.messages, message], updatedAt: Date.now() }
          : chat
      )
    )
  }, [])

  /**
   * Stream one assistant reply into `chatId` and resolve when the stream ends.
   *
   * Extracted from `sendMessage` so editing a message and regenerating a reply reuse the
   * exact same retry/timeout/coalescing path instead of a second copy that could drift.
   */
  const streamAssistantReply = useCallback(
    async (chatId: string, history: HistoryEntry[], config: ConfigData): Promise<boolean> => {
      const providerConfig = resolveProviderConfig(config)
      const messages = [
        { role: 'system', content: config.systemPrompt },
        ...history,
      ]

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, assistantMessage], updatedAt: Date.now() }
            : chat
        )
      )

      let streamFailed = false
      const RETRYABLE_STREAM_ERROR = /\[kora:(rate_limit|server_error|network|timeout)\]/
      const stopped = () => stoppedStreamIdsRef.current.has(assistantMessage.id)

      const updateMessage = (content: string) => {
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((m) =>
                    m.id === assistantMessage.id ? { ...m, content } : m
                  ),
                }
              : chat
          )
        )
      }

      // One streaming attempt. Resolves with the accumulated text.
      const runStreamOnce = (canRetry: boolean): Promise<{ text: string; failed: boolean; retry: boolean }> =>
        new Promise((resolve) => {
          let acc = ''
          let settled = false
          let unsubscribe = () => {}
          let flushTimer: ReturnType<typeof setTimeout> | null = null
          let latestContent = ''

          // Coalesce token updates: paint at most once per RENDER_INTERVAL_MS.
          // Streaming models emit chunks far faster than the screen refreshes,
          // and every React update re-renders the message list and re-parses
          // the whole message markdown — the main cause of streaming lag.
          const queueRender = (content: string) => {
            latestContent = content
            if (flushTimer === null) {
              flushTimer = setTimeout(() => {
                flushTimer = null
                updateMessage(latestContent)
              }, CONFIG.stream.RENDER_INTERVAL_MS)
            }
          }
          const clearPendingRender = () => {
            if (flushTimer !== null) {
              clearTimeout(flushTimer)
              flushTimer = null
            }
          }

          const done = (value: string, failed = false, retry = false) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            clearPendingRender()
            // Always commit the final text, including the last token that
            // arrived inside a coalescing window.
            updateMessage(value)
            unsubscribe()
            activeStreamHandleRef.current = null
            stoppedStreamIdsRef.current.delete(assistantMessage.id)
            streamFinishersRef.current.delete(assistantMessage.id)
            resolve({ text: value, failed, retry })
          }
          streamFinishersRef.current.set(assistantMessage.id, () => done(acc))
          const timeout = setTimeout(() => {
            streamFailed = true
            const note = acc
              ? '\n\n⚠️ Stream timed out — partial response kept.'
              : 'Error: the model did not respond within 120 seconds.'
            done(acc + note, true)
          }, CONFIG.stream.TIMEOUT_MS)
          const handle = window.kora.ai.chatStream(
            messages,
            {
              provider: providerConfig.provider,
              model: providerConfig.model,
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              temperature: config.temperature,
            },
            (chunk: string) => {
              if (chunk === '[DONE]') {
                done(acc)
                return
              }
              if (chunk.startsWith('[ERROR]')) {
                if (stopped()) {
                  // user pressed stop — keep what we have, no error text
                  done(acc)
                  return
                }
                const rawErr = chunk.slice(7).trim()
                if (!acc && canRetry && RETRYABLE_STREAM_ERROR.test(rawErr)) {
                  done('', true, true)
                  return
                }
                streamFailed = true
                const friendly = rawErr.replace(/\[kora:\w+\]\s*/, '')
                const text = acc ? acc + `\n\n⚠️ Error: ${friendly}` : `Error: ${friendly}`
                done(text, true)
                return
              }

              acc += chunk
              queueRender(acc)
            }
          )
          unsubscribe = handle.unsubscribe
          activeStreamHandleRef.current = { chatId, messageId: assistantMessage.id, stop: handle.stop }
        })

      let streamContent = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await runStreamOnce(attempt === 0)
        streamContent = result.text
        streamFailed = result.failed
        if (result.retry && attempt === 0) {
          updateMessage('')
          continue
        }
        break
      }

      // Auto-execution from AI response DISABLED for security
      // Commands in AI responses are now shown as text only
      // User can manually copy and execute them if needed
      if (!streamFailed && !stopped() && streamContent) {
        const commands = extractCommands(streamContent)
        if (commands.length > 0) {
          const notice = '\n\n---\n**ℹ️ Commands detected (not auto-executed for security):**\n' +
            commands.map(cmd => `\`${cmd}\``).join('\n') +
            '\n\nYou can copy these commands and run them manually.'
          setChats((prev) =>
            prev.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map((m) =>
                      m.id === assistantMessage.id
                        ? { ...m, content: m.content + notice }
                        : m
                    ),
                  }
                : chat
            )
          )
        }
      }

      return streamFailed
    },
    []
  )

  /** Run a `!` command if `content` is one; returns true when it was handled. */
  const runCommandIfAny = useCallback(
    async (chatId: string, content: string, t: Translations): Promise<boolean> => {
      const cmdResult = await processCommand(content, t, false, pendingConfirmRef)
      if (!cmdResult.isCommand) return false
      appendAssistantMessage(chatId, cmdResult.output)
      return true
    },
    [appendAssistantMessage]
  )

  const sendMessage = useCallback(
    async (content: string, config: ConfigData, t: Translations) => {
      let chatId = activeChatId
      if (!chatId) {
        chatId = createChat()
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      }

      const currentChat = chats.find((c) => c.id === chatId)
      const priorHistory = (currentChat?.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, userMessage],
                title: chat.messages.length === 0 ? titleFromMessage(content) : chat.title,
                updatedAt: Date.now(),
              }
            : chat
        )
      )

      setIsLoading(true)

      try {
        if (await runCommandIfAny(chatId, content, t)) return

        await streamAssistantReply(
          chatId,
          [...priorHistory, { role: 'user', content }],
          config,
        )
      } catch (error) {
        console.error('Chat error:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [activeChatId, chats, createChat, runCommandIfAny, streamAssistantReply]
  )

  /**
   * Rewrite a user message and regenerate the answer after it.
   *
   * Everything below the edited message is dropped, which is the honest behavior: those
   * replies answered the old text. The edit is rejected while a stream is running so two
   * streams cannot interleave into the same chat.
   */
  const editAndResend = useCallback(
    async (messageId: string, content: string, config: ConfigData, t: Translations) => {
      if (!activeChatId || isLoading) return
      const trimmed = content.trim()
      if (!trimmed) return
      const chat = chats.find((c) => c.id === activeChatId)
      const index = chat?.messages.findIndex((m) => m.id === messageId) ?? -1
      if (!chat || index < 0 || chat.messages[index].role !== 'user') return

      const kept = chat.messages.slice(0, index)
      const edited: Message = { ...chat.messages[index], content: trimmed, timestamp: Date.now() }

      setChats((prev) =>
        prev.map((c) =>
          c.id === chat.id
            ? {
                ...c,
                messages: [...kept, edited],
                title: kept.length === 0 ? titleFromMessage(trimmed) : c.title,
                updatedAt: Date.now(),
              }
            : c
        )
      )

      setIsLoading(true)
      try {
        if (await runCommandIfAny(chat.id, trimmed, t)) return
        await streamAssistantReply(
          chat.id,
          [
            ...kept.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: trimmed },
          ],
          config,
        )
      } catch (error) {
        console.error('Chat edit error:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [activeChatId, chats, isLoading, runCommandIfAny, streamAssistantReply]
  )

  /** Replace the last assistant reply by re-running the prompt that produced it. */
  const regenerate = useCallback(
    async (config: ConfigData) => {
      if (!activeChatId || isLoading) return
      const chat = chats.find((c) => c.id === activeChatId)
      if (!chat) return
      const lastAssistant = [...chat.messages].reverse().find((m) => m.role === 'assistant')
      if (!lastAssistant) return
      const lastAssistantIndex = chat.messages.lastIndexOf(lastAssistant)
      const history = chat.messages.slice(0, lastAssistantIndex)

      setChats((prev) =>
        prev.map((c) =>
          c.id === chat.id
            ? { ...c, messages: history, updatedAt: Date.now() }
            : c
        )
      )

      setIsLoading(true)
      try {
        await streamAssistantReply(
          chat.id,
          history.map((m) => ({ role: m.role, content: m.content })),
          config,
        )
      } catch (error) {
        console.error('Chat regenerate error:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [activeChatId, chats, isLoading, streamAssistantReply]
  )

  const deleteChat = useCallback(
    (chatId: string) => {
      setChats((prev) => prev.filter((c) => c.id !== chatId))
      if (activeChatId === chatId) {
        setActiveChatId(null)
      }
    },
    [activeChatId]
  )

  const renameChat = useCallback((chatId: string, title: string) => {
    const trimmed = title.trim().slice(0, CONFIG.chat.MAX_TITLE_LENGTH)
    if (!trimmed) return
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? { ...chat, title: trimmed, updatedAt: Date.now() }
          : chat
      )
    )
  }, [])

  /** Pin/unpin a chat. Pinned chats sort to the top and survive history trimming. */
  const togglePin = useCallback((chatId: string) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, pinned: !chat.pinned } : chat
      )
    )
  }, [])

  const appendMessage = useCallback(
    (message: { role: 'user' | 'assistant' | 'system'; content: string }) => {
      const chatId = activeChatId
      if (!chatId) return
      const msg: Message = { ...message, id: crypto.randomUUID(), timestamp: Date.now() }
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, msg], updatedAt: Date.now() }
            : chat
        )
      )
    },
    [activeChatId]
  )

  return {
    chats,
    activeChat,
    activeChatId,
    setActiveChatId,
    createChat,
    sendMessage,
    appendMessage,
    deleteChat,
    renameChat,
    togglePin,
    editAndResend,
    regenerate,
    isLoading,
    stopGeneration,
  }
}
