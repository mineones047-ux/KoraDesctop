import { useCallback, useEffect, useState } from 'react'
import type {
  ConfigData,
  DownloadedModel,
  EngineStatusInfo,
  HfGgufFile,
  HfModelEntry,
  LocalAIProgress,
  LocalAIRecommendation,
  PcProfileInfo,
} from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

interface LocalModelsProps {
  lang: Locale
  onUpdate: (key: keyof ConfigData, value: unknown) => void
  /** Float as its own window above the settings panel instead of inline content. */
  floating?: boolean
  onClose?: () => void
}

const fmtSize = (bytes: number): string => {
  if (!bytes || !isFinite(bytes)) return '—'
  const gb = bytes / 2 ** 30
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 2 ** 20))} MB`
}

const fmtBar = (received: number, total: number): string =>
  total > 0 ? `${Math.round((received / total) * 100)}%` : fmtSize(received)

const fill = (template: string, token: string, value: string): string =>
  template.replace(`{${token}}`, value)

const cardCls = 'bg-kora-card border border-kora-border rounded-2xl p-4'
const labelCls = 'block text-sm font-medium text-kora-text mb-1'
const mutedCls = 'text-xs text-kora-muted'
const inputCls =
  'flex-1 bg-kora-surface border border-kora-border rounded-full px-4 py-2 text-sm text-kora-text placeholder-kora-muted/60 focus:border-kora-accent transition-colors'
const btnCls =
  'px-4 py-2 rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed'
const primaryBtn = `${btnCls} bg-kora-accent text-white hover:opacity-90`
const ghostBtn = `${btnCls} border border-kora-border text-kora-text hover:border-kora-accent`
const chipCls = 'px-2 py-0.5 rounded-full bg-kora-surface border border-kora-border text-[10px] text-kora-muted'

/** Curated whisper.cpp models: recognition (STT) on the same PC profile as the LLMs. */
const STT_MODELS = [
  { file: 'ggml-tiny.bin', label: 'Tiny', sizeBytes: 82e6, note: 'fastest, ~1 GB RAM' },
  { file: 'ggml-base.bin', label: 'Base', sizeBytes: 148e6, note: 'better accuracy, ~1 GB RAM' },
  { file: 'ggml-small.bin', label: 'Small', sizeBytes: 488e6, note: 'most accurate, ~2 GB RAM' },
]

/**
 * The "Local AI" tab: browse Hugging Face GGUFs, download them (persisted in
 * `~/.kora/models/`), fetch the llama.cpp engine once, then start a server and
 * hand the chat over to it. Every bar comes from `localai:progress` events.
 */
export function LocalModels({ lang, onUpdate, floating, onClose }: LocalModelsProps) {
  const t = useI18n(lang)

  const [profile, setProfile] = useState<{ profile: PcProfileInfo; recommendation: LocalAIRecommendation } | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<HfModelEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [openRepo, setOpenRepo] = useState<string | null>(null)
  const [filesByRepo, setFilesByRepo] = useState<Record<string, HfGgufFile[]>>({})
  const [filesError, setFilesError] = useState<string | null>(null)

  const [modelJobs, setModelJobs] = useState<Record<string, { received: number; total: number; state: string }>>({})
  const [engineJob, setEngineJob] = useState<{ received: number; total: number } | null>(null)

  const [models, setModels] = useState<DownloadedModel[]>([])
  const [engine, setEngine] = useState<EngineStatusInfo | null>(null)
  const [engineInstalling, setEngineInstalling] = useState(false)
  const [startingKey, setStartingKey] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  /** Path the currently active whisper model points at (from the saved config). */
  const [whisperModelPath, setWhisperModelPath] = useState<string | null>(null)
  /** llama.cpp launch knobs, read from the saved config. */
  const [llamaCfg, setLlamaCfg] = useState<{ gpu: number | null; ctx: number | null }>({ gpu: -1, ctx: 4096 })
  /** Disk scan results (models that already live somewhere on this PC). */
  const [diskModels, setDiskModels] = useState<{ path: string; sizeBytes: number }[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [autoStartKey, setAutoStartKey] = useState('')
  const [autoSttKey, setAutoSttKey] = useState('')
  /** Bytes already on disk per file (paused or interrupted downloads). */
  const [partials, setPartials] = useState<Record<string, number>>({})

  const refreshModels = useCallback(() => {
    window.kora.localAI
      .list()
      .then((r) => setModels(r.models))
      .catch(() => {})
  }, [])

  const refreshEngine = useCallback(() => {
    window.kora.localAI
      .engineStatus()
      .then((r) => setEngine(r.status))
      .catch(() => {})
  }, [])

  const runSearch = useCallback(async (q: string) => {
    setSearching(true)
    setError(null)
    try {
      const r = await window.kora.localAI.search(q)
      if (r.success) {
        setResults(r.models)
      } else {
        setResults([])
        setError(fill(t.localAI.searchError, 'error', r.error ?? ''))
      }
    } catch (err) {
      setResults([])
      setError(fill(t.localAI.searchError, 'error', (err as Error).message))
    } finally {
      setSearching(false)
    }
  }, [t.localAI.searchError])

  useEffect(() => {
    window.kora.localAI
      .profile()
      .then(setProfile)
      .catch(() => {})
    window.kora.config
      .get()
      .then((c) => {
        setWhisperModelPath(typeof c.whisperModel === 'string' ? c.whisperModel : null)
        setLlamaCfg({
          gpu: typeof c.llamacppGpuLayers === 'number' ? c.llamacppGpuLayers : -1,
          ctx: typeof c.llamacppCtxSize === 'number' ? c.llamacppCtxSize : 4096,
        })
        setAutoStartKey(typeof c.autoStartChatModel === 'string' ? c.autoStartChatModel : '')
        setAutoSttKey(typeof c.autoStartSttModel === 'string' ? c.autoStartSttModel : '')
      })
      .catch(() => {})
    refreshModels()
    refreshEngine()
    void runSearch('') // first paint shows the most-downloaded GGUFs, not an empty box
  }, [refreshModels, refreshEngine, runSearch])

  useEffect(() => {
    const unsubscribe = window.kora.localAI.onProgress((p: LocalAIProgress) => {
      if (p.kind === 'model' && p.key) {
        setModelJobs((prev) => ({
          ...prev,
          [p.key as string]: { received: p.received ?? 0, total: p.total ?? 0, state: p.state },
        }))
        if (p.state === 'done') refreshModels()
        if (p.state === 'error' && p.error) setError(p.error)
      } else if (p.kind === 'engine') {
        if (p.state === 'running') {
          setEngineJob({ received: p.received ?? 0, total: p.total ?? 0 })
        } else {
          setEngineJob(null)
          refreshEngine()
          if (p.state === 'error' && p.error) setError(p.error)
        }
      } else if (p.kind === 'server') {
        setNotice(
          p.state === 'stopped'
            ? t.localAI.serverStopped
            : fill(t.localAI.serverExited, 'code', String(p.exitCode ?? '?')),
        )
        refreshEngine()
      }
    })
    return unsubscribe
  }, [refreshEngine, t.localAI.serverStopped, t.localAI.serverExited])

  const toggleFiles = async (repoId: string) => {
    if (openRepo === repoId) {
      setOpenRepo(null)
      return
    }
    setOpenRepo(repoId)
    if (filesByRepo[repoId]) return
    setFilesError(null)
    try {
      const r = await window.kora.localAI.files(repoId)
      if (r.success) {
        setFilesByRepo((prev) => ({ ...prev, [repoId]: r.files }))
      } else {
        setFilesError(fill(t.localAI.filesError, 'error', r.error ?? ''))
        setFilesByRepo((prev) => ({ ...prev, [repoId]: [] }))
      }
    } catch (err) {
      setFilesError(fill(t.localAI.filesError, 'error', (err as Error).message))
    }
    // Paused/interrupted downloads: their bytes are still on disk, so the row
    // can offer "Resume" instead of starting the file from zero.
    try {
      const p = await window.kora.localAI.partials(repoId)
      if (p.success) {
        setPartials((prev) => {
          const next = { ...prev }
          for (const item of p.partials) next[item.file] = item.bytes
          return next
        })
      }
    } catch {
      /* partials are a nicety — a failure must not break the file list */
    }
  }

  const downloadFile = async (repoId: string, file: string) => {
    const key = `${repoId}/${file}`
    setError(null)
    // Resuming keeps the bytes already on disk: the bar continues where it
    // stopped instead of jumping back to zero.
    setModelJobs((prev) => ({
      ...prev,
      [key]: { received: prev[key]?.received ?? 0, total: prev[key]?.total ?? 0, state: 'running' },
    }))
    try {
      const r = await window.kora.localAI.download(repoId, file)
      if (!r.success && r.error && r.error !== 'paused' && r.error !== 'canceled') setError(r.error)
    } catch (err) {
      const message = (err as Error).message
      if (message !== 'paused' && message !== 'canceled') setError(message)
    } finally {
      refreshModels()
    }
  }

  const startModel = async (m: DownloadedModel) => {
    const key = `${m.repoId}/${m.file}`
    setStartingKey(key)
    setError(null)
    setNotice(null)
    try {
      const r = await window.kora.localAI.start(m.repoId, m.file)
      if (!r.success) {
        setError(r.error === 'ENGINE_MISSING' ? t.localAI.engineMissingErr : r.error ?? '')
      } else {
        // Same write path every other Settings control uses, so the renderer's
        // config state (and the chat header) flips over with the server.
        onUpdate('provider', 'llamacpp')
        if (r.modelId) onUpdate('selectedModel', r.modelId)
        setNotice(fill(t.localAI.modelLoaded, 'name', m.file))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setStartingKey(null)
      refreshEngine()
    }
  }

  const stopServer = async () => {
    try {
      await window.kora.localAI.stop()
    } finally {
      refreshEngine()
    }
  }

  const installEngine = async () => {
    setEngineInstalling(true)
    setError(null)
    try {
      const r = await window.kora.localAI.downloadEngine()
      if (!r.success) setError(r.error ?? '')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setEngineInstalling(false)
      refreshEngine()
    }
  }

  const removeModel = async (m: DownloadedModel) => {
    const key = `${m.repoId}/${m.file}`
    if (confirmDelete !== key) {
      setConfirmDelete(key)
      return
    }
    setConfirmDelete(null)
    try {
      const r = await window.kora.localAI.remove(m.repoId, m.file)
      if (!r.success && r.error) setError(r.error)
    } finally {
      refreshModels()
    }
  }

  const scanDisks = async () => {
    setScanning(true)
    setError(null)
    try {
      const r = await window.kora.localAI.scanDisks()
      if (r.success) setDiskModels(r.found)
      else setError(r.error ?? '')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const serveDiskModel = async (modelPath: string) => {
    setError(null)
    try {
      const r = await window.kora.localAI.startExternal(modelPath)
      if (r.success) {
        onUpdate('provider', 'llamacpp')
        if (r.modelId) onUpdate('selectedModel', r.modelId)
        setNotice(t.localAI.modelLoaded.replace('{name}', modelPath.split(/[\\/]/).pop() ?? modelPath))
        refreshEngine()
      } else if (r.error) setError(r.error)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const rec = profile?.recommendation ?? null
  const isFitting = (paramsB: number | null): boolean =>
    paramsB != null && rec != null && paramsB <= rec.maxParamsB
  const isRecommended = (paramsB: number | null): boolean =>
    paramsB != null && rec != null && paramsB <= rec.maxParamsB && paramsB >= Math.max(1, Math.floor(rec.maxParamsB / 2))

  /** 2 GB is held back for the OS + KV-cache/context. */
  const availableBytes = profile ? Math.max(0, profile.profile.ramGb - 2) * 2 ** 30 : null
  /** true = fits, false = does not, null = size or profile unknown. */
  const fitsBySize = (size: number): boolean | null =>
    size <= 0 || availableBytes == null ? null : size <= availableBytes
  const [category, setCategory] = useState<'text' | 'audio'>('text')
  const [sttBusy, setSttBusy] = useState<string | null>(null)

  const downloadStt = async (file: string) => {
    setSttBusy(file)
    setError(null)
    setModelJobs((prev) => ({ ...prev, [`whisper:${file}`]: { received: 0, total: 0, state: 'running' } }))
    try {
      const r = await window.kora.localAI.downloadStt(file)
      if (r.success && r.path) {
        // Point dictation straight at the downloaded model and switch the engine,
        // same immediate-persist convention the rest of Settings follows.
        onUpdate('whisperModel', r.path)
        onUpdate('sttEngine', 'whisper')
        setWhisperModelPath(r.path)
        setNotice(t.localAI.modelLoaded.replace('{name}', file))
      } else if (r.error) {
        setError(r.error)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSttBusy(null)
    }
  }

  const filesForOpen = openRepo ? filesByRepo[openRepo] ?? null : null

  /** The whole tab body: inline inside Settings, or as its own floating window. */
  const content = (
    <div className="space-y-5">
      {/* ---- PC profile: the basis of every recommendation below ---- */}
      <div className={cardCls}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <span className={labelCls}>{t.localAI.title}</span>
            <p className={mutedCls}>{t.localAI.desc}</p>
          </div>                {profile && (
            <div className="text-right">
              <span className="text-xs text-kora-muted">
                {t.localAI.yourPc}: {profile.profile.ramGb} GB · {profile.profile.cpuCores} {t.system.cores}
                {profile.profile.vramGb != null
                  ? ` · ${fill(t.localAI.gpuVram, 'vram', String(profile.profile.vramGb))}`
                  : ''}
              </span>
              <p className="text-xs text-kora-accent mt-0.5">
                {fill(t.localAI.recommendation, 'params', String(rec!.maxParamsB)).replace('{quant}', rec!.quant)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ---- Text vs Audio: LLM downloads vs speech models ---- */}
      <div className="flex gap-1 bg-kora-card border border-kora-border rounded-xl p-1">
        {([
          { id: 'text' as const, label: t.localAI.categoryText },
          { id: 'audio' as const, label: t.localAI.categoryAudio },
        ]).map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              category === c.id ? 'bg-kora-accent-soft text-kora-text' : 'text-kora-muted hover:text-kora-text'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="rounded-xl border border-kora-accent/40 bg-kora-accent/10 px-4 py-2.5 text-xs text-kora-text">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* ---- Hugging Face search (text models) ---- */}
      {category === 'text' && (
      <div>
        <label className={labelCls}>{t.localAI.searchTitle}</label>
        <div className="flex gap-2 mb-3">
          <input
            className={inputCls}
            value={query}
            placeholder={t.localAI.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch(query)}
          />
          <button className={primaryBtn} disabled={searching} onClick={() => void runSearch(query)}>
            {searching ? t.localAI.searching : t.localAI.search}
          </button>
        </div>

        {results.length === 0 && !searching ? (
          <p className={mutedCls}>{t.localAI.noResults}</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {results.map((entry) => (
              <div key={entry.id} className="border border-kora-border rounded-xl p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <button
                    className="text-sm text-kora-text font-medium hover:text-kora-accent transition-colors text-left"
                    onClick={() => void toggleFiles(entry.id)}
                  >
                    {entry.id}
                  </button>
                  <div className="flex items-center gap-2 flex-wrap">
                    {entry.paramsB != null && <span className={chipCls}>{entry.paramsB}B</span>}
                    <span className={chipCls}>
                      {fill(t.localAI.downloads, 'n', String(entry.downloads))}
                    </span>
                    {isRecommended(entry.paramsB) ? (
                      <span className="text-[10px] text-kora-accent">{t.localAI.recommended}</span>
                    ) : isFitting(entry.paramsB) ? (
                      <span className="text-[10px] text-kora-muted">{t.localAI.fits}</span>
                    ) : null}
                  </div>
                </div>

                {openRepo === entry.id && (
                  <div className="mt-3 border-t border-kora-border pt-3">
                    <p className={`${mutedCls} mb-2`}>{t.localAI.files}</p>
                    {filesError && <p className="text-xs text-red-300 mb-2">{filesError}</p>}
                    {filesForOpen === null ? (
                      <p className={mutedCls}>{t.localAI.searching}</p>
                    ) : filesForOpen.length === 0 ? (
                      <p className={mutedCls}>{t.localAI.noResults}</p>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {filesForOpen.map((file) => {
                          const key = `${entry.id}/${file.path}`
                          const job = modelJobs[key]
                          const fit = fitsBySize(file.sizeBytes)
                          const partialBytes = partials[file.path] ?? 0
                          return (
                            <div key={file.path} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-kora-text truncate">{file.path.split('/').pop()}</span>
                                <span className={chipCls}>{file.quant}</span>
                                <span className={chipCls}>{fmtSize(file.sizeBytes)}</span>
                                {file.recommended ? (
                                  <span className="text-[10px] text-kora-accent">{t.localAI.recommended}</span>
                                ) : fit === false ? (
                                  <span className="text-[10px] text-red-300">{fill(t.localAI.notFits, 'size', fmtSize(file.sizeBytes))}</span>
                                ) : fit ? (
                                  <span className="text-[10px] text-green-400">✓ {t.localAI.fits}</span>
                                ) : null}
                              </div>
                              {job && job.state === 'running' ? (
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="w-24 h-1.5 bg-kora-surface rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-kora-accent transition-all"
                                      style={{
                                        width: job.total > 0 ? `${Math.min(100, (job.received / job.total) * 100)}%` : '40%',
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-kora-muted w-10 text-right">
                                    {fmtBar(job.received, job.total)}
                                  </span>
                                  <button
                                    className="text-[10px] text-amber-300 hover:text-amber-200"
                                    onClick={() => void window.kora.localAI.pause(entry.id, file.path)}
                                  >
                                    {t.localAI.pause}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className={`${ghostBtn} !px-3 shrink-0`}
                                  disabled={job?.state === 'done'}
                                  title={partialBytes > 0 ? t.localAI.resumeHint : undefined}
                                  onClick={() => void downloadFile(entry.id, file.path)}
                                >
                                  {job?.state === 'done'
                                    ? '✓'
                                    : partialBytes > 0
                                      ? `${t.localAI.resume} ${fmtSize(partialBytes)}`
                                      : t.localAI.download}
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ---- Speech recognition (STT) models ---- */}
      {category === 'audio' && (
        <div>
          <span className={labelCls}>{t.localAI.audioTitle}</span>
          <p className={mutedCls}>{t.localAI.audioDesc}</p>
          <div className="space-y-2 mt-3">
            {STT_MODELS.map((m) => {
              const key = `whisper:${m.file}`
              const job = modelJobs[key]
              const fit = fitsBySize(m.sizeBytes)
              return (
                <div key={m.file} className="border border-kora-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-kora-text">whisper {m.label} <span className={chipCls}>{fmtSize(m.sizeBytes)}</span></p>
                    <p className={mutedCls}>
                      {m.note}
                      {' · '}
                      {fit === false
                        ? fill(t.localAI.notFits, 'size', fmtSize(m.sizeBytes))
                        : whisperModelPath?.endsWith(m.file) ? t.localAI.audioActive : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className={`${ghostBtn} !px-3 ${autoSttKey === m.file ? '!border-kora-accent !text-kora-accent' : ''}`}
                      title={t.localAI.autoStartStt}
                      onClick={() => {
                        const next = autoSttKey === m.file ? '' : m.file
                        onUpdate('autoStartSttModel', next)
                        setAutoSttKey(next)
                      }}
                    >
                      {autoSttKey === m.file ? '⭐ ' : '☆ '}{t.localAI.autoStartStt}
                    </button>
                    <button
                      className={primaryBtn}
                      disabled={sttBusy === m.file || job?.state === 'running' || whisperModelPath?.endsWith(m.file) === true}
                      onClick={() => void downloadStt(m.file)}
                    >
                      {job?.state === 'running'
                        ? `${fmtBar(job.received ?? 0, job.total ?? 0)}`
                        : whisperModelPath?.endsWith(m.file) ? t.localAI.audioActive : t.localAI.audioUse}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className={mutedCls + ' mt-3'}>
            {t.localAI.whisperBinaryNote}
          </p>
          <p className={mutedCls + ' mt-1.5'}>
            {t.localAI.audioTtsNote}
          </p>
        </div>
      )}

      {/* ---- llama.cpp engine ---- */}
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className={labelCls}>{t.localAI.engineTitle}</span>
            <p className={mutedCls}>{t.localAI.engineDesc}</p>
            {engine?.installed && engine.binaryPath && (
              <p className="text-[10px] text-kora-muted mt-1 truncate" title={engine.binaryPath}>
                {engine.binaryPath}
              </p>
            )}
            {engine?.installed && !engine.running && (
              <p className="text-[10px] text-kora-muted">{t.localAI.engineReady}</p>
            )}
            {engine?.running && (
              <p className="text-[10px] text-green-400">
                {engine.external
                  ? fill(t.localAI.externalServer, 'port', String(engine.port ?? 8080))
                  : fill(t.localAI.running, 'port', String(engine.port ?? 8080))}
              </p>
            )}
            {engine && !engine.installed && !engineJob && (
              <p className="text-[10px] text-amber-400">{t.localAI.engineMissing}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {engineJob ? (
              <>
                <div className="w-32 h-1.5 bg-kora-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-kora-accent transition-all"
                    style={{
                      width: engineJob.total > 0 ? `${Math.min(100, (engineJob.received / engineJob.total) * 100)}%` : '40%',
                    }}
                  />
                </div>
                <span className="text-[10px] text-kora-muted">{fmtBar(engineJob.received, engineJob.total)}</span>
              </>
            ) : engine?.running ? (
              <button className={ghostBtn} onClick={() => void stopServer()}>
                {t.localAI.stop}
              </button>
            ) : engine?.installed ? null : (
              <button className={primaryBtn} disabled={engineInstalling} onClick={() => void installEngine()}>
                {engineInstalling || engineJob ? t.localAI.engineInstalling : t.localAI.engineInstall}
              </button>
            )}
          </div>
        </div>

        {/* llama-server launch knobs (config llamacppGpuLayers / llamacppCtxSize). */}
        <div className="flex gap-4 flex-wrap mt-4 pt-3 border-t border-kora-border">
          <label className="text-xs text-kora-muted">
            <span className="block mb-1">{t.localAI.engineGpu}</span>
            <input
              type="number"
              min={-1}
              max={999}
              value={llamaCfg.gpu ?? -1}
              onChange={(e) => {
                const g = Number(e.target.value)
                setLlamaCfg((c) => ({ ...c, gpu: g }))
                onUpdate('llamacppGpuLayers', g)
              }}
              className="w-24 bg-kora-surface border border-kora-border rounded-lg px-2 py-1.5 text-xs text-kora-text"
            />
            <span className="block mt-1 text-[10px]">{t.localAI.engineGpuHint}</span>
          </label>
          <label className="text-xs text-kora-muted">
            <span className="block mb-1">{t.localAI.engineCtx}</span>
            <input
              type="number"
              min={256}
              max={131072}
              step={256}
              value={llamaCfg.ctx ?? 4096}
              onChange={(e) => {
                const c = Number(e.target.value)
                setLlamaCfg((s) => ({ ...s, ctx: c }))
                onUpdate('llamacppCtxSize', c)
              }}
              className="w-28 bg-kora-surface border border-kora-border rounded-lg px-2 py-1.5 text-xs text-kora-text"
            />
          </label>
        </div>
      </div>

      {/* ---- Models already on this PC ---- */}
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className={labelCls}>{t.localAI.diskTitle}</span>
            <p className={mutedCls}>{t.localAI.diskDesc}</p>
          </div>
          <button className={ghostBtn} disabled={scanning} onClick={() => void scanDisks()}>
            {scanning ? t.localAI.diskSearching : t.localAI.diskScan}
          </button>
        </div>
        {diskModels && (
          diskModels.length === 0 ? (
            <p className={mutedCls + ' mt-3'}>{t.localAI.diskNone}</p>
          ) : (
            <div className="space-y-1.5 mt-3 max-h-40 overflow-y-auto">
              {diskModels.map((d) => (
                <div key={d.path} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-kora-text truncate" title={d.path}>{d.path}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={chipCls}>{fmtSize(d.sizeBytes)}</span>
                    <button className={`${ghostBtn} !px-3`} onClick={() => void serveDiskModel(d.path)}>
                      {t.localAI.diskUse}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ---- Downloaded, persisted models ---- */}
      <div>
        <span className={labelCls}>{t.localAI.modelsTitle}</span>
        {models.length === 0 ? (
          <p className={mutedCls}>{t.localAI.noModels}</p>
        ) : (
          <div className="space-y-2">
            {models.map((m) => {
              const key = `${m.repoId}/${m.file}`
              const busy = startingKey === key
              return (
                <div key={key} className="border border-kora-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-kora-text truncate">{m.file.split('/').pop()}</p>
                    <p className={mutedCls}>
                      {m.repoId} · {m.quant} · {fmtSize(m.sizeBytes)}
                      {m.paramsB != null ? ` · ${m.paramsB}B` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Auto-load: this exact model is served at app launch. */}
                    <button
                      className={`${ghostBtn} !px-3 ${autoStartKey === key ? '!border-kora-accent !text-kora-accent' : ''}`}
                      title={t.localAI.autoStartChat}
                      onClick={() => {
                        const next = autoStartKey === key ? '' : key
                        onUpdate('autoStartChatModel', next)
                        setAutoStartKey(next)
                      }}
                    >
                      {autoStartKey === key ? '⭐ ' : '☆ '}{t.localAI.autoStartChat}
                    </button>
                    <button
                      className={primaryBtn}
                      disabled={busy}
                      onClick={() => void startModel(m)}
                    >
                      {busy ? t.localAI.starting : t.localAI.start}
                    </button>
                    <button
                      className={`${ghostBtn} !text-red-300`}
                      onClick={() => void removeModel(m)}
                    >
                      {confirmDelete === key ? t.localAI.deleteSure : t.localAI.delete}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  if (!floating) return content
  // The Local AI window floats above the whole settings panel, exactly like the
  // LM Studio layout: opened from a tab, closed without losing the tab state.
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[760px] max-w-[95vw] max-h-[90vh] bg-kora-surface border border-kora-border rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-kora-border">
          <div>
            <h2 className="text-lg font-semibold text-kora-text">{t.localAI.title}</h2>
            <p className="text-xs text-kora-muted">{t.localAI.desc}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
          >×
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{content}</div>
      </div>
    </div>
  )
}
