import { useState, useEffect } from 'react'
import type { SystemInfo, ProcessInfo } from '../types'

/**
 * System monitor data: CPU/RAM/disk snapshot plus a live process list.
 *
 * `getInfo` is fetched once (it is expensive — it shells out); the process list is polled
 * every 5 s while `enabled` is true. The `cancelled` flag guards against a response
 * landing after unmount, which would otherwise be a React state-update warning.
 */
export function useSystem(enabled: boolean = true) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])

  useEffect(() => {
    // Nothing to poll — the System panel is closed, so do not pay for the IPC calls.
    if (!enabled) return
    let cancelled = false

    /** One-shot snapshot of the machine's load. */
    const loadInfo = async () => {
      try {
        const data = await window.kora.system.getInfo()
        if (!cancelled) setInfo(data)
      } catch (error) {
        console.error('Failed to load system info:', error)
      }
    }

    /** Refresh the process table. Re-runs on the interval below. */
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

  /** Re-read the snapshot on demand (after the user ends a process, which frees RAM). */
  const reload = async () => {
    try {
      setInfo(await window.kora.system.getInfo())
    } catch (error) {
      console.error('Failed to load system info:', error)
    }
  }

  return { info, processes, reload }
}
