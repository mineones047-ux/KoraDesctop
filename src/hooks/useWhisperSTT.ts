import { useState, useCallback, useRef, useEffect } from 'react'
import { downmixToMono, resampleLinear, encodeWav16Mono } from '../lib/wav'

interface WhisperSTTHook {
  isListening: boolean
  isSupported: boolean
  interimText: string
  isTranscribing: boolean
  startListening: (lang?: string) => void
  stopListening: () => void
  error: string | null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(binary)
}

async function decodeToAudioBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctor: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctor()
  try {
    return await ctx.decodeAudioData(data)
  } finally {
    void ctx.close()
  }
}

/**
 * Local STT via whisper.cpp (ROADMAP Phase 0).
 *
 * Records the mic with MediaRecorder, decodes the blob with the Web Audio API,
 * converts it to 16 kHz mono WAV (see lib/wav.ts) and hands it to the main
 * process, which runs the user-configured whisper-cli offline. Mirrors the
 * `useSpeechRecognition` surface so App switches engines transparently.
 */
export function useWhisperSTT(
  onResult: (text: string) => void,
  onInterim?: (text: string) => void,
): WhisperSTTHook {
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const langRef = useRef('auto')

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    setIsListening(false)
    setIsTranscribing(true)
    try {
      recorder.stop()
    } catch {
      // already stopped
    }
    recorderRef.current = null
  }, [])

  const startListening = useCallback(
    async (lang: string = 'en-US') => {
      if (!isSupported) {
        setError('Microphone access is not available in this webview')
        return
      }
      langRef.current = lang
      setError(null)
      onInterim?.('')

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        chunksRef.current = []

        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }
        recorder.onerror = () => {
          setError('Recording failed')
          setIsListening(false)
          setIsTranscribing(false)
          releaseStream()
        }
        recorder.onstop = async () => {
          const chunks = chunksRef.current
          chunksRef.current = []
          releaseStream()
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size === 0) {
            setIsTranscribing(false)
            return
          }
          try {
            const decoded = await decodeToAudioBuffer(await blob.arrayBuffer())
            const mono = downmixToMono(
              Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)),
            )
            const pcm16k = resampleLinear(mono, decoded.sampleRate, 16000)
            const wav = new Uint8Array(encodeWav16Mono(pcm16k, 16000))
            const result = await window.kora.stt.transcribe(bytesToBase64(wav), langRef.current)
            if (result.success && result.text) {
              onResult(result.text.trim())
            } else if (!result.success) {
              setError(result.error || 'Transcription failed')
            }
          } catch (err) {
            setError((err as Error).message || 'Transcription failed')
          } finally {
            setIsTranscribing(false)
          }
        }

        recorder.start()
        recorderRef.current = recorder
        setIsListening(true)
      } catch (err) {
        setError((err as Error).message || 'Microphone permission denied')
        setIsListening(false)
        releaseStream()
      }
    },
    [isSupported, onResult, onInterim, releaseStream],
  )

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop()
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // interimText stays empty for whisper (transcription happens after stopping),
  // but the field keeps the hook interface-compatible with Web Speech.
  return {
    isListening,
    isSupported,
    interimText: '',
    isTranscribing,
    startListening,
    stopListening,
    error,
  }
}
