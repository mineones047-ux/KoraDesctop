/**
 * App shell: composes the whole UI and owns the top-level state wiring.
 *
 * Flow: Sidebar/ChatWindow/InputBar -> useUnifiedChat.sendMessage ->
 * (useChat | useReActAgent) depending on `needsAgent()` — see docs/PROJECT_HANDOFF.md §4.1.
 *
 * The callbacks passed down to memoised children (handleSend/handleSpeak/
 * handleStartListening/handleToggleTTS) are wrapped in useCallback on purpose:
 * without stable identities React.memo on MessageBubble/InputBar would
 * re-render on every streamed token (see §11).
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useUnifiedChat } from './hooks/useUnifiedChat'
import { resolveShortcut } from './lib/shortcuts'
import { useConfig } from './hooks/useConfig'
import { useSystem } from './hooks/useSystem'
import { useTTS } from './hooks/useTTS'
import { useI18n } from './hooks/useI18n'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useWhisperSTT } from './hooks/useWhisperSTT'
import { TitleBar } from './components/Layout/TitleBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ChatWindow } from './components/Chat/ChatWindow'
import { Settings } from './components/Settings/Settings'
import { SystemMonitor } from './components/System/SystemMonitor'
import { AgentDisplay } from './components/Agent/AgentDisplay'
import { GraphView } from './components/Graph/GraphView'

/**
 * BCP-47 tags for the Web Speech API, keyed by app language.
 *
 * A map rather than a chain of ternaries: every new language has to be added here, and
 * forgetting is silent — the recogniser would quietly transcribe Chinese speech using an
 * English model, producing plausible-looking garbage.
 */
const RECOGNITION_LOCALE: Record<string, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  zh: 'zh-CN',
}

function App() {
  const { chats, activeChat, activeChatId, setActiveChatId, createChat, sendMessage, deleteChat, renameChat, isLoading, stopGeneration } = useUnifiedChat()
  const { config, updateConfig } = useConfig()
  const [showSettings, setShowSettings] = useState(false)
  const [showSystem, setShowSystem] = useState(false)
  const { info, processes } = useSystem(showSystem)
  const [showAgent, setShowAgent] = useState(false)
  const { speak, stop, playingId, volume, isMuted, toggleMute, changeVolume } = useTTS()
  const [view, setView] = useState<'chat' | 'graph'>('chat')

  const t = useI18n(config.language)

  // Keyboard shortcuts (`Ctrl/Cmd+N`, `Ctrl/Cmd+K`, `Escape`) — the decision logic is
  // pure and lives in lib/shortcuts.ts, this is only the wiring: which layer a key
  // closes and which actions the app already exposes.
  const chatSearchRef = useRef<HTMLInputElement>(null)
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const focusedRequest = useRef(0)
  const openLayers = Number(showSettings) + Number(showSystem) + Number(showAgent)

  const closeTopLayer = useCallback(() => {
    // Topmost first: the agent panel renders above the monitors, which render above
    // settings — the same order the JSX below stacks them in.
    if (showAgent) setShowAgent(false)
    else if (showSystem) setShowSystem(false)
    else if (showSettings) setShowSettings(false)
  }, [showAgent, showSystem, showSettings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, { openLayers })
      if (!action) return
      event.preventDefault()
      if (action === 'newChat') {
        createChat()
        setView('chat')
      } else if (action === 'focusChatSearch') {
        setSearchFocusRequest((n) => n + 1)
      } else {
        closeTopLayer()
      }
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [openLayers, createChat, closeTopLayer])

  // The search field only exists in the chat view, so the focus has to wait for the
  // render that follows a switch away from the graph. The ref guard keeps the effect
  // from re-stealing focus on an unrelated re-render.
  useEffect(() => {
    if (searchFocusRequest === 0 || focusedRequest.current === searchFocusRequest) return
    if (view !== 'chat') {
      setView('chat')
      return
    }
    focusedRequest.current = searchFocusRequest
    chatSearchRef.current?.focus()
    chatSearchRef.current?.select()
  }, [searchFocusRequest, view])

  // `<html lang>` is a static `en` in index.html; keep it in step with the UI so that
  // screen readers, spell-check and CJK line-breaking behave like the language shown.
  useEffect(() => {
    document.documentElement.lang = config.language
  }, [config.language])

  // Speech recognition
  const [speechInterim, setSpeechInterim] = useState('')

  const handleSpeechResult = useCallback((text: string) => {
    sendMessage(text, config, t)
    setSpeechInterim('')
  }, [sendMessage, config, t])

  const handleSpeechInterim = useCallback((_text: string) => {
    setSpeechInterim(_text)
  }, [])

  const speech = useSpeechRecognition(handleSpeechResult, handleSpeechInterim)
  // ROADMAP Phase 0: local whisper.cpp STT is an alternative engine. Both hooks
  // stay mounted (rules of hooks); the config decides which drives the mic.
  const whisperSpeech = useWhisperSTT(handleSpeechResult, handleSpeechInterim)
  const voiceEngine = config.sttEngine === 'whisper' ? whisperSpeech : speech

  const lastAssistantMessage = activeChat?.messages
    .filter((m) => m.role === 'assistant')
    .slice(-1)[0]

  const handleToggleTTS = useCallback(() => {
    if (playingId) {
      stop()
    } else if (lastAssistantMessage) {
      speak(lastAssistantMessage.content, config.ttsVoice, lastAssistantMessage.id)
    }
  }, [playingId, stop, lastAssistantMessage, speak, config.ttsVoice])

  // Stable identity so memoized MessageBubble instances skip re-rendering while
  // another message streams token-by-token.
  const handleSpeak = useCallback(
    (text: string, id: string) => speak(text, config.ttsVoice, id),
    [speak, config.ttsVoice]
  )

  // Stable identities for the chat input so InputBar can be memoized and skip
  // re-rendering on every streamed token.
  const handleSend = useCallback(
    (msg: string) => sendMessage(msg, config, t),
    [sendMessage, config, t]
  )

  const handleStartListening = useCallback(
    // Match the app language to a BCP-47 tag the recogniser accepts. Falling through to
  // `en-US` for Chinese would mean dictation is transcribed in the wrong language.
  () => voiceEngine.startListening(RECOGNITION_LOCALE[config.language] ?? 'en-US'),
    [voiceEngine.startListening, config.language]
  )

  return (
    <div className="h-screen flex flex-col bg-kora-bg text-kora-text" data-theme={config.theme}>
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          lang={config.language}
          chats={chats}
          activeChatId={activeChatId}
          view={view}
          onSelectChat={(id) => {
            setActiveChatId(id)
            setView('chat')
          }}
          onCreateChat={() => {
            createChat()
            setView('chat')
          }}
          onDeleteChat={deleteChat}
          onRenameChat={renameChat}
          onOpenSettings={() => setShowSettings(true)}
          onOpenSystem={() => setShowSystem(true)}
          onOpenAgent={() => setShowAgent(true)}
          onOpenGraph={() => setView('graph')}
          onOpenChat={() => setView('chat')}
          searchInputRef={chatSearchRef}
        />

        {view === 'graph' ? (
          <GraphView
            lang={config.language}
            vaultPath={config.obsidianVaultPath}
            graphLinkColor={config.graphLinkColor}
            graphNodeColor={config.graphNodeColor}
            onSendToChat={handleSend}
            onSetVault={(path) => updateConfig('obsidianVaultPath', path)}
          />
        ) : (
          <ChatWindow
            lang={config.language}
            messages={activeChat?.messages || []}
            onSend={handleSend}
            isLoading={isLoading}
            onSpeak={handleSpeak}
            onStop={stop}
            ttsPlayingId={playingId}
            onToggleTTS={handleToggleTTS}
            isSpeaking={!!playingId}
            volume={volume}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            onVolumeChange={changeVolume}
            isListening={voiceEngine.isListening}
            isSpeechSupported={voiceEngine.isSupported}
            onStartListening={handleStartListening}
            onStopListening={voiceEngine.stopListening}
            speechInterim={voiceEngine.isListening ? speechInterim : ''}
            onStopGenerate={stopGeneration}
          />
        )}
      </div>

      {showSettings && (
        <Settings
          lang={config.language}
          config={config}
          onUpdate={updateConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showSystem && (
        <SystemMonitor
          lang={config.language}
          info={info}
          processes={processes}
          onClose={() => setShowSystem(false)}
        />
      )}

      <AgentDisplay
        lang={config.language}
        config={config}
        show={showAgent}
        onClose={() => setShowAgent(false)}
      />
    </div>
  )
}

export default App