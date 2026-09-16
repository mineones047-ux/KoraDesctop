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

function isDangerousCommand(cmd: string): boolean {
  const trimmed = cmd.trim()
  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  if (name === 'clipboard' && trimmed.slice(11).trim().length > 0) return true
  return DANGEROUS_COMMANDS.has(name)
}

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
    const description = describeDangerousCommand(name, args)

    pendingConfirmRef.current = {
      type: name === 'shutdown' ? 'shutdown' : name === 'restart' ? 'restart' : 'command',
      args: [trimmed],
      description,
    }
    return {
      isCommand: true,
      output: `⚠️ **Confirmation required**\n\n${description}\n\nType \`!confirm\` to proceed or \`!deny\` to cancel.`,
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

  // Save chats to disk on changes
  const latestChatsRef = useRef<Chat[]>([])
  latestChatsRef.current = chats

  useEffect(() => {
    if (!chatsLoaded.current) return
    const timer = setTimeout(() => {
      window.kora.chats.save(chats).catch((err: unknown) => {
        console.error('Failed to save chats:', err)
      })
    }, CONFIG.chat.SAVE_DEBOUNCE_MS) // debounce
    return () => clearTimeout(timer)
  }, [chats])

  // Flush pending save when the window is closing
  useEffect(() => {
    const flush = () => {
      window.kora.chats.saveSync(latestChatsRef.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const activeChat = chats.find((c) => c.id === activeChatId)

  const createChat = useCallback(() => {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: 'New chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(newChat.id)
    return newChat.id
  }, [])



  const chatsRef = useRef<Chat[]>([])
  chatsRef.current = chats

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

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, userMessage],
                title: chat.messages.length === 0 ? content.slice(0, 30) : chat.title,
                updatedAt: Date.now(),
              }
            : chat
        )
      )

      setIsLoading(true)

      try {
        const cmdResult = await processCommand(content, t, false, pendingConfirmRef)

        if (cmdResult.isCommand) {
          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: cmdResult.output,
            timestamp: Date.now(),
          }

          setChats((prev) =>
            prev.map((chat) =>
              chat.id === chatId
                ? { ...chat, messages: [...chat.messages, assistantMessage], updatedAt: Date.now() }
                : chat
            )
          )
          return
        }

        const currentChat = chatsRef.current.find((c) => c.id === chatId)
        const providerConfig = resolveProviderConfig(config)

        const messages = [
          { role: 'system', content: config.systemPrompt },
          ...(currentChat?.messages || []).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user', content },
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
              ? {
                  ...chat,
                  messages: [...chat.messages, assistantMessage],
                  updatedAt: Date.now(),
                }
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
      } catch (error) {
        console.error('Chat error:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [activeChatId, createChat]
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
    isLoading,
    stopGeneration,
  }
}
