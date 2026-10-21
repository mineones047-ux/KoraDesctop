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
  'flex-1 bg-kora-surface border border-kora-border rounded-full px-4 py-2 text-sm text-kora-text placeholder-kora-muted/60 focus:outline-none focus:border-kora-accent transition-colors'
const btnCls =
  'px-4 py-2 rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed'
const primaryBtn = `${btnCls} bg-kora-accent text-white hover:opacity-90`
const ghostBtn = `${btnCls} border border-kora-border text-kora-text hover:border-kora-accent`
const chipCls = 'px-2 py-0.5 rounded-full bg-kora-surface border border-kora-border text-[10px] text-kora-muted'

/**
 * The "Local AI" tab: browse Hugging Face GGUFs, download them (persisted in
 * `~/.kora/models/`), fetch the llama.cpp engine once, then start a server and
 * hand the chat over to it. Every bar comes from `localai:progress` events.
 */
export function LocalModels({ lang, onUpdate }: LocalModelsProps) {
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
  }

  const downloadFile = async (repoId: string, file: string) => {
    const key = `${repoId}/${file}`
    setError(null)
    setModelJobs((prev) => ({ ...prev, [key]: { received: 0, total: 0, state: 'running' } }))
    try {
      const r = await window.kora.localAI.download(repoId, file)
      if (!r.success && r.error && r.error !== 'canceled') setError(r.error)
    } catch (err) {
      const message = (err as Error).message
      if (message !== 'canceled') setError(message)
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

  const rec = profile?.recommendation ?? null
  const isFitting = (paramsB: number | null): boolean =>
    paramsB != null && rec != null && paramsB <= rec.maxParamsB
  const isRecommended = (paramsB: number | null): boolean =>
    paramsB != null && rec != null && paramsB <= rec.maxParamsB && paramsB >= Math.max(1, Math.floor(rec.maxParamsB / 2))

  const filesForOpen = openRepo ? filesByRepo[openRepo] ?? null : null

  return (
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

      {/* ---- Hugging Face search ---- */}
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
                          return (
                            <div key={file.path} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-kora-text truncate">{file.path.split('/').pop()}</span>
                                <span className={chipCls}>{file.quant}</span>
                                <span className={chipCls}>{fmtSize(file.sizeBytes)}</span>
                                {file.recommended ? (
                                  <span className="text-[10px] text-kora-accent">{t.localAI.recommended}</span>
                                ) : isFitting(file.paramsB) ? (
                                  <span className="text-[10px] text-kora-muted">{t.localAI.fits}</span>
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
                                    className="text-[10px] text-red-300 hover:text-red-200"
                                    onClick={() => void window.kora.localAI.cancel(entry.id, file.path)}
                                  >
                                    {t.localAI.cancel}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className={`${ghostBtn} !px-3 shrink-0`}
                                  disabled={job?.state === 'done'}
                                  onClick={() => void downloadFile(entry.id, file.path)}
                                >
                                  {job?.state === 'done' ? '✓' : t.localAI.download}
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
}
