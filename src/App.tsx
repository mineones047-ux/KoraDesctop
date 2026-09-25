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
import { useState, useCallback } from 'react'
import { useUnifiedChat } from './hooks/useUnifiedChat'
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
    () => voiceEngine.startListening(config.language === 'ru' ? 'ru-RU' : 'en-US'),
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