import { useState, useCallback, useRef, useEffect } from 'react'
import { normalizeForSpeech, splitForSpeech, speechWordsForVoice } from '../lib/tts-speech'

let currentAudio: HTMLAudioElement | null = null

interface SynthResult {
  success: boolean
  audio?: string
  error?: string
}

export function useTTS() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('kora-tts-volume')
    return saved ? parseFloat(saved) : 1.0
  })
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('kora-tts-muted') === 'true'
  })
  const volumeRef = useRef(volume)
  const mutedRef = useRef(isMuted)
  // generation counter: any speak/stop invalidates all in-flight work of older calls
  const genRef = useRef(0)
  const playingIdRef = useRef<string | null>(null)

  useEffect(() => {
    volumeRef.current = volume
    localStorage.setItem('kora-tts-volume', volume.toString())
  }, [volume])

  useEffect(() => {
    mutedRef.current = isMuted
    localStorage.setItem('kora-tts-muted', isMuted.toString())
    if (currentAudio) {
      currentAudio.muted = isMuted
    }
  }, [isMuted])

  const resetState = useCallback(() => {
    setIsPlaying(false)
    setPlayingId(null)
    playingIdRef.current = null
  }, [])

  /** Stop playback and cancel every queued synthesis. */
  const stop = useCallback(() => {
    genRef.current++
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    resetState()
  }, [resetState])

  const speak = useCallback(
    async (text: string, voice: string, messageId: string) => {
      // clicking the currently spoken message toggles it off
      if (playingIdRef.current === messageId) {
        stop()
        return
      }

      // cancel whatever is playing/synthesizing
      genRef.current++
      const gen = genRef.current
      if (currentAudio) {
        currentAudio.pause()
        currentAudio = null
      }

      const clean = normalizeForSpeech(text, speechWordsForVoice(voice))
      const chunks = splitForSpeech(clean)
      if (chunks.length === 0) return

      setIsPlaying(true)
      setPlayingId(messageId)
      playingIdRef.current = messageId

      const stale = () => gen !== genRef.current

      const synthesizeChunk = async (chunk: string): Promise<SynthResult> => {
        try {
          return await window.kora.tts.synthesize(chunk, voice)
        } catch (err) {
          console.error('TTS synthesis failed:', err)
          return { success: false, error: String(err) }
        }
      }

      /** Play one MP3 blob; resolves when it ends, errors or is stopped. */
      const playChunk = (base64: string): Promise<void> =>
        new Promise((resolve) => {
          try {
            const audioBlob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
              type: 'audio/mpeg',
            })
            const url = URL.createObjectURL(audioBlob)
            const audio = new Audio(url)
            currentAudio = audio
            audio.volume = volumeRef.current
            audio.muted = mutedRef.current
            const cleanup = () => {
              URL.revokeObjectURL(url)
              if (currentAudio === audio) currentAudio = null
            }
            audio.onended = () => {
              cleanup()
              resolve()
            }
            audio.onerror = () => {
              cleanup()
              resolve()
            }
            audio.play().catch(() => {
              cleanup()
              resolve()
            })
          } catch {
            resolve()
          }
        })

      try {
        let prefetch: Promise<SynthResult> | null = chunks.length ? synthesizeChunk(chunks[0]) : null

        for (let i = 0; i < chunks.length; i++) {
          const res = prefetch ? await prefetch : null
          prefetch = i + 1 < chunks.length ? synthesizeChunk(chunks[i + 1]) : null

          if (stale()) return
          if (!res || !res.success || !res.audio) {
            console.error('TTS failed:', res?.error)
            resetState()
            return
          }
          await playChunk(res.audio)
          if (stale()) return
        }

        if (!stale()) resetState()
      } catch (error) {
        console.error('TTS error:', error)
        if (!stale()) resetState()
      }
    },
    [stop, resetState],
  )

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  const changeVolume = useCallback((newVolume: number) => {
    setVolume(newVolume)
    if (currentAudio) {
      currentAudio.volume = newVolume
    }
  }, [])

  return { speak, stop, isPlaying, playingId, volume, isMuted, toggleMute, changeVolume }
}
