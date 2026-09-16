import { useState, useCallback, useRef, useEffect } from 'react'

interface SpeechRecognitionHook {
  isListening: boolean
  isSupported: boolean
  interimText: string
  startListening: (lang?: string) => void
  stopListening: () => void
  error: string | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult
  length: number
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative
  length: number
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent {
  error: string
  message: string
}

export function useSpeechRecognition(onResult: (text: string) => void, onInterim?: (text: string) => void): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const finalTranscriptRef = useRef('')

  const isSupported = !!(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  )

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // already stopped
      }
      recognitionRef.current = null
    }
    setIsListening(false)
    setInterimText('')
    setError(null)
  }, [])

  const startListening = useCallback((lang: string = 'en-US') => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser')
      return
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }

    finalTranscriptRef.current = ''

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognitionClass()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }

      if (final) {
        finalTranscriptRef.current += final
        onInterim?.(finalTranscriptRef.current + interim)
        setInterimText(finalTranscriptRef.current + interim)
      } else {
        const combined = finalTranscriptRef.current + interim
        onInterim?.(combined)
        setInterimText(combined)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error, event.message)
      if (event.error === 'no-speech') return
      if (event.error === 'aborted') return
      setError(event.error + ': ' + event.message)
      setIsListening(false)
      recognitionRef.current = null
    }

    recognition.onend = () => {
      const finalText = finalTranscriptRef.current.trim()
      if (finalText) {
        onResult(finalText)
      }
      setIsListening(false)
      setInterimText('')
      recognitionRef.current = null
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
      setIsListening(true)
      setError(null)
      setInterimText('')
    } catch (err) {
      setError('Failed to start recording')
      setIsListening(false)
    }
  }, [isSupported, onResult, onInterim])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }
    }
  }, [])

  return {
    isListening,
    isSupported,
    interimText,
    startListening,
    stopListening,
    error,
  }
}
