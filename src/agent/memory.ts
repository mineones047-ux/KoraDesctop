import { useCallback, useRef } from 'react'

export type MemoryEntry = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

type MemoryType = 'shortTerm' | 'longTerm' | 'working'

export interface MemoryBank {
  shortTerm: MemoryEntry[]
  longTerm: MemoryEntry[]
  working: MemoryEntry[]
}

const INITIAL_MEMORY_BANK: MemoryBank = {
  shortTerm: [],
  longTerm: [],
  working: [],
}

/**
 * Conversation memory for the agent. Entries live in refs because the agent
 * reads them synchronously while its async loop runs; React state here would
 * only add re-renders that nothing consumes.
 */
export function useMemory() {
  const bankRef = useRef<MemoryBank>(INITIAL_MEMORY_BANK)

  const addEntry = useCallback((entry: Omit<MemoryEntry, 'id' | 'timestamp'>): MemoryEntry => {
    const entryWithIdAndTimestamp: MemoryEntry = {
      id: crypto.randomUUID(),
      role: entry.role,
      content: entry.content,
      timestamp: Date.now(),
      metadata: entry.metadata,
    }

    const target: MemoryType = entry.role === 'user' ? 'shortTerm' : 'longTerm'
    bankRef.current = {
      ...bankRef.current,
      [target]: [
        ...bankRef.current[target].filter((e) => e.id !== entryWithIdAndTimestamp.id),
        entryWithIdAndTimestamp,
      ],
    }

    return entryWithIdAndTimestamp
  }, [])

  const getFullHistory = useCallback((): MemoryEntry[] => {
    // Merge all banks and sort chronologically. Entry routing splits messages
    // by role (user -> shortTerm, assistant -> longTerm), so concatenating the
    // banks directly would scramble the conversation order for the agent.
    return [
      ...bankRef.current.shortTerm,
      ...bankRef.current.longTerm,
      ...bankRef.current.working,
    ].sort((a, b) => a.timestamp - b.timestamp)
  }, [])

  return {
    addEntry,
    getFullHistory,
  }
}
