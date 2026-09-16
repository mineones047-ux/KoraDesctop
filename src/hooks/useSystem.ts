import { useState, useEffect } from 'react'
import type { SystemInfo, ProcessInfo } from '../types'

export function useSystem(enabled: boolean = true) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const loadInfo = async () => {
      try {
        const data = await window.kora.system.getInfo()
        if (!cancelled) setInfo(data)
      } catch (error) {
        console.error('Failed to load system info:', error)
      }
    }

    const loadProcesses = async () => {
      try {
        const data = await window.kora.system.getProcesses()
        if (!cancelled) setProcesses(data)
      } catch (error) {
        console.error('Failed to load system processes:', error)
      }
    }

    loadInfo()
    loadProcesses()
    const interval = setInterval(loadProcesses, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [enabled])

  const reload = async () => {
    try {
      setInfo(await window.kora.system.getInfo())
    } catch (error) {
      console.error('Failed to load system info:', error)
    }
  }

  return { info, processes, reload }
}
