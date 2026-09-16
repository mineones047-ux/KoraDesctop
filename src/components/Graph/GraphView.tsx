import { useEffect, useRef, useState, useCallback } from 'react'
import type { ObsidianGraph, ObsidianNode } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

interface GraphViewProps {
  lang: Locale
  vaultPath: string
  graphLinkColor?: string
  graphNodeColor?: string
  onSendToChat: (text: string) => void
  onSetVault: (path: string) => void
}

const FOLDER_COLORS = [
  '#3b82f6', '#e05042', '#22c55e', '#a855f7',
  '#f59e0b', '#14b8a6', '#ec4899', '#84cc16',
  '#38bdf8', '#fb7185', '#a3e635', '#f472b6',
]

const MAX_CONTEXT = 4000

interface PhysNode {
  id: string
  title: string
  folder: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  links: number
}

function folderColor(folder: string): string {
  let hash = 0
  for (let i = 0; i < folder.length; i++) {
    hash = (hash * 31 + folder.charCodeAt(i)) >>> 0
  }
  return FOLDER_COLORS[hash % FOLDER_COLORS.length]
}

export function GraphView({ lang, vaultPath, graphLinkColor, graphNodeColor, onSendToChat, onSetVault }: GraphViewProps) {
  const t = useI18n(lang)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [graph, setGraph] = useState<ObsidianGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ node: ObsidianNode; content: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const physRef = useRef<PhysNode[]>([])
  const linksRef = useRef<{ a: PhysNode; b: PhysNode }[]>([])
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ mode: 'node' | 'pan' | null; index: number; startX: number; startY: number; viewX: number; viewY: number; moved: boolean }>({
    mode: null, index: -1, startX: 0, startY: 0, viewX: 0, viewY: 0, moved: false,
  })
  const hoverRef = useRef<number>(-1)
  const zoomTargetRef = useRef(1)
  const zoomAnchorRef = useRef({ mx: 0, my: 0, wx: 0, wy: 0 })
  const wakeRef = useRef(true)
  const asleepRef = useRef(false)

  const zoomBy = useCallback((factor: number) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const view = viewRef.current
    const mx = wrap.clientWidth / 2
    const my = wrap.clientHeight / 2
    zoomAnchorRef.current = { mx, my, wx: (mx - view.x) / view.scale, wy: (my - view.y) / view.scale }
    zoomTargetRef.current = Math.max(0.2, Math.min(3, zoomTargetRef.current * factor))
  }, [])

  /** Fit the whole graph into the viewport. */
  const fitView = useCallback(() => {
    const wrap = wrapRef.current
    const nodes = physRef.current
    if (!wrap || nodes.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const nd of nodes) {
      minX = Math.min(minX, nd.x - nd.r)
      minY = Math.min(minY, nd.y - nd.r)
      maxX = Math.max(maxX, nd.x + nd.r)
      maxY = Math.max(maxY, nd.y + nd.r)
    }
    const pad = 60
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    const scale = Math.max(0.2, Math.min(3, Math.min(w / (maxX - minX + pad), h / (maxY - minY + pad))))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    zoomTargetRef.current = scale
    viewRef.current = { x: w / 2 - cx * scale, y: h / 2 - cy * scale, scale }
    zoomAnchorRef.current = { mx: w / 2, my: h / 2, wx: cx, wy: cy }
  }, [])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await window.kora.obsidian.scan()
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setGraph(null)
      return
    }
    setGraph(result)
  }, [])

  useEffect(() => {
    loadGraph()
  }, [vaultPath, loadGraph])

  useEffect(() => {
    if (!graph) return
    const degree = new Map<string, number>()
    for (const l of graph.links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
    }
    const n = graph.nodes.length
    const nodes: PhysNode[] = graph.nodes.map((node, i) => {
      const deg = degree.get(node.id) ?? 0
      const angle = (i / Math.max(1, n)) * Math.PI * 2
      return {
        id: node.id,
        title: node.title,
        folder: node.folder,
        x: Math.cos(angle) * 320 + Math.random() * 40,
        y: Math.sin(angle) * 220 + Math.random() * 40,
        vx: 0,
        vy: 0,
        r: 6 + Math.min(8, deg * 1.5),
        links: deg,
      }
    })
    const byId = new Map(nodes.map((nd) => [nd.id, nd]))
    linksRef.current = graph.links
      .map((l) => ({ a: byId.get(l.source), b: byId.get(l.target) }))
      .filter((l): l is { a: PhysNode; b: PhysNode } => !!l.a && !!l.b)
    physRef.current = nodes
    const w = wrapRef.current?.clientWidth ?? window.innerWidth
    const h = wrapRef.current?.clientHeight ?? window.innerHeight
    viewRef.current = { x: w / 2, y: h / 2, scale: 1 }
    zoomTargetRef.current = 1
    zoomAnchorRef.current = { mx: w / 2, my: h / 2, wx: 0, wy: 0 }
    wakeRef.current = true
    asleepRef.current = false
    dragRef.current = { mode: null, index: -1, startX: 0, startY: 0, viewX: 0, viewY: 0, moved: false }
    hoverRef.current = -1
  }, [graph])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = wrap.clientWidth * dpr
      canvas.height = wrap.clientHeight * dpr
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const cssVar = (name: string) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      if (!v) return null
      const parts = v.split(/\s+/).map(Number)
      if (parts.length >= 3 && parts.every((p) => Number.isFinite(p))) {
        return `rgb(${parts[0]} ${parts[1]} ${parts[2]})`
      }
      return null
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const view = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.0012)
      // anchor the world point under the cursor, animate towards it smoothly
      zoomAnchorRef.current = {
        mx,
        my,
        wx: (mx - view.x) / view.scale,
        wy: (my - view.y) / view.scale,
      }
      zoomTargetRef.current = Math.max(0.2, Math.min(3, zoomTargetRef.current * factor))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    let sleepCounter = 0
    let lastFrame = performance.now()

    // Repulsion only acts within a 300px box, so bucket nodes into a uniform
    // grid (cell = 300px) once per frame and test each node only against its 8
    // neighbouring cells. Exactly equivalent to the naive O(n²) pairwise loop
    // (any pair with |dx|,|dy| ≤ 300 lands in the same or an adjacent cell) but
    // effectively O(n), which matters for large vaults (up to 5000 notes).
    const GRID_CELL = 300
    const GRID_OFFSET = 64
    const GRID_STRIDE = 256
    const grid = new Map<number, number[]>()

    const step = (now: number) => {
      // Normalize all physics to a 60 FPS timestep. Capping long frames prevents
      // a backgrounded window from making the graph jump when it becomes visible.
      const dt = Math.min(1.5, Math.max(0.35, (now - lastFrame) / (1000 / 60)))
      lastFrame = now
      const nodes = physRef.current
      const view = viewRef.current
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // smooth cursor-anchored zoom animation
      if (Math.abs(view.scale - zoomTargetRef.current) > 0.0015) {
        const a = zoomAnchorRef.current
        const ns = view.scale + (zoomTargetRef.current - view.scale) * (1 - Math.pow(0.78, dt))
        view.scale = ns
        view.x = a.mx - a.wx * ns
        view.y = a.my - a.wy * ns
      } else if (view.scale !== zoomTargetRef.current) {
        const a = zoomAnchorRef.current
        view.scale = zoomTargetRef.current
        view.x = a.mx - a.wx * view.scale
        view.y = a.my - a.wy * view.scale
      }

      if (nodes.length > 0) {
        const linkColor = graphLinkColor || (cssVar('--kora-accent') ?? '#3b82f6')
        const muted = cssVar('--kora-muted') ?? '#737373'
        const border = cssVar('--kora-border') ?? '#2a2a2a'
        const textColor = cssVar('--kora-text') ?? '#e5e5e5'
        const surface = cssVar('--kora-surface') ?? '#111111'

        // physics: sleep when the layout has settled, wake on interaction
        const awake = !asleepRef.current || wakeRef.current
        if (awake) {
          wakeRef.current = false
          // gravity to fixed world origin (independent of camera)
          // orphan nodes (no links) get stronger pull so they stay in view
          for (const a of nodes) {
            const g = a.links === 0 ? 0.004 : 0.0012
            a.vx += -a.x * g
            a.vy += -a.y * g
          }
          // repulsion: grid-accelerated (see grid setup above)
          grid.clear()
          for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i]
            const k =
              (Math.floor(a.x / GRID_CELL) + GRID_OFFSET) * GRID_STRIDE +
              (Math.floor(a.y / GRID_CELL) + GRID_OFFSET)
            const cell = grid.get(k)
            if (cell) cell.push(i)
            else grid.set(k, [i])
          }
          for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i]
            const cx = Math.floor(a.x / GRID_CELL)
            const cy = Math.floor(a.y / GRID_CELL)
            for (let ox = -1; ox <= 1; ox++) {
              for (let oy = -1; oy <= 1; oy++) {
                const cell = grid.get((cx + ox + GRID_OFFSET) * GRID_STRIDE + (cy + oy + GRID_OFFSET))
                if (!cell) continue
                for (const j of cell) {
                  if (j <= i) continue
                  const b = nodes[j]
                  const dx = b.x - a.x
                  const dy = b.y - a.y
                  if (dx > 300 || dx < -300 || dy > 300 || dy < -300) continue
                  const d2 = Math.max(1, dx * dx + dy * dy)
                  const f = Math.min(2, 9000 / d2)
                  const inv = 1 / Math.sqrt(d2)
                  const nx = dx * inv
                  const ny = dy * inv
                  a.vx -= nx * f
                  a.vy -= ny * f
                  b.vx += nx * f
                  b.vy += ny * f
                }
              }
            }
          }
          // springs
          for (const l of linksRef.current) {
            const dx = l.b.x - l.a.x
            const dy = l.b.y - l.a.y
            const d = Math.sqrt(dx * dx + dy * dy) || 1
            const f = (d - 150) * 0.012
            const nx = dx / d
            const ny = dy / d
            l.a.vx += nx * f
            l.a.vy += ny * f
            l.b.vx -= nx * f
            l.b.vy -= ny * f
          }
          // integrate + settle detection
          let maxSpeed = 0
          for (const a of nodes) {
            const damping = Math.pow(0.89, dt)
            a.vx *= damping
            a.vy *= damping
            let sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy)
            if (sp > 6) {
              a.vx = (a.vx / sp) * 6
              a.vy = (a.vy / sp) * 6
              sp = 6
            }
            if (sp > maxSpeed) maxSpeed = sp
            a.x += a.vx * dt
            a.y += a.vy * dt
            // hard world boundary: nothing drifts out of reach
            const dc = Math.sqrt(a.x * a.x + a.y * a.y)
            if (dc > 1400) {
              a.x = (a.x / dc) * 1400
              a.y = (a.y / dc) * 1400
              a.vx *= 0.5
              a.vy *= 0.5
            }
          }
          if (maxSpeed < 0.05) {
            sleepCounter++
            if (sleepCounter > 30) asleepRef.current = true
          } else {
            sleepCounter = 0
          }
        }

        // edges + nodes — drawn inside the same transform
        ctx.save()
        ctx.translate(view.x, view.y)
        ctx.scale(view.scale, view.scale)

        // edges
        const customLink = !!graphLinkColor
        ctx.lineWidth = (customLink ? 1.6 : 1) / view.scale
        ctx.strokeStyle = linkColor
        ctx.globalAlpha = customLink ? 0.55 : 0.18
        ctx.beginPath()
        for (const l of linksRef.current) {
          ctx.moveTo(l.a.x, l.a.y)
          ctx.lineTo(l.b.x, l.b.y)
        }
        ctx.stroke()
        ctx.globalAlpha = 1

        // nodes
        const customNode = !!graphNodeColor
        for (let i = 0; i < nodes.length; i++) {
          const nd = nodes[i]
          const hovered = hoverRef.current === i
          ctx.beginPath()
          ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2)
          ctx.fillStyle = customNode ? graphNodeColor! : folderColor(nd.folder)
          ctx.globalAlpha = hovered ? 1 : 0.85
          if (customLink) {
            ctx.shadowColor = linkColor
            ctx.shadowBlur = hovered ? 14 : 0
          }
          ctx.fill()
          ctx.shadowBlur = 0
          ctx.globalAlpha = 1
          ctx.strokeStyle = hovered ? textColor : customLink ? linkColor : border
          ctx.lineWidth = ((hovered ? 1.5 : 1) / view.scale) * (customLink && !hovered ? 2 : 1)
          ctx.stroke()

          if (hovered || (nd.links >= 4 && view.scale >= 0.6)) {
            const label = nd.title.length > 26 ? nd.title.slice(0, 26) + '…' : nd.title
            ctx.font = `${11 / view.scale}px Inter, sans-serif`
            const tw = ctx.measureText(label).width
            const lx = nd.x + nd.r + 5
            const ly = nd.y + 3
            if (hovered) {
              const pad = 4 / view.scale
              ctx.globalAlpha = 0.85
              ctx.fillStyle = surface
              ctx.fillRect(lx - pad, ly - 11 / view.scale, tw + pad * 2, 15 / view.scale)
              ctx.globalAlpha = 1
              ctx.fillStyle = textColor
            } else {
              ctx.fillStyle = muted
              ctx.globalAlpha = 0.55
            }
            ctx.fillText(label, lx, ly)
            ctx.globalAlpha = 1
          }
        }
        ctx.restore()

        // counter
        ctx.font = '12px Inter, sans-serif'
        ctx.fillStyle = muted
        ctx.fillText(`${nodes.length} ${t.graph.notes}`, 14, 22)
      }

      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('wheel', onWheel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lang, graphLinkColor, graphNodeColor])

  return (
    <div className="flex-1 flex flex-col h-full bg-kora-bg relative" ref={wrapRef}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-sm text-kora-muted animate-pulse">{t.graph.loading}</div>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-4">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="text-kora-warning">
            <rect x="4" y="4" width="32" height="32" rx="8" stroke="currentColor" strokeWidth="2" />
            <path d="M20 12v10M20 27v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="text-sm text-kora-muted max-w-xs text-center">{error}</p>
          {!vaultPath ? (
            <button
              onClick={async () => {
                const r = await window.kora.obsidian.pickVault()
                if (r.success && r.path) onSetVault(r.path)
              }}
              className="px-4 py-2 bg-kora-accent text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t.graph.pickVault}
            </button>
          ) : (
            <button
              onClick={loadGraph}
              className="px-4 py-2 bg-kora-card border border-kora-border rounded-full text-sm text-kora-text hover:border-kora-accent transition-colors"
            >
              {t.graph.retry}
            </button>
          )}
        </div>
      )}
      {!error && !loading && graph && (
        <>
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-default"
          onMouseDown={(e) => {
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            const view = viewRef.current
            const wx = (mx - view.x) / view.scale
            const wy = (my - view.y) / view.scale
            const nodes = physRef.current
            let hit = -1
            for (let i = nodes.length - 1; i >= 0; i--) {
              const nd = nodes[i]
              const dx = wx - nd.x
              const dy = wy - nd.y
              if (Math.sqrt(dx * dx + dy * dy) <= nd.r + 3) {
                hit = i
                break
              }
            }
            dragRef.current = {
              mode: hit >= 0 ? 'node' : 'pan',
              index: hit,
              startX: mx,
              startY: my,
              viewX: view.x,
              viewY: view.y,
              moved: false,
            }
            if (hit >= 0) hoverRef.current = hit
          }}
          onMouseMove={(e) => {
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            const drag = dragRef.current
            const view = viewRef.current
            if (drag.mode) {
              const dx = mx - drag.startX
              const dy = my - drag.startY
              if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
              if (drag.mode === 'pan') {
                view.x = drag.viewX + dx
                view.y = drag.viewY + dy
              } else {
                const nd = physRef.current[drag.index]
                if (nd) {
                  nd.x = (mx - drag.viewX) / view.scale
                  nd.y = (my - drag.viewY) / view.scale
                  nd.vx = 0
                  nd.vy = 0
                  wakeRef.current = true
                }
              }
            } else {
              const wx = (mx - view.x) / view.scale
              const wy = (my - view.y) / view.scale
              const nodes = physRef.current
              let hit = -1
              for (let i = nodes.length - 1; i >= 0; i--) {
                const nd = nodes[i]
                const dx = wx - nd.x
                const dy = wy - nd.y
                if (Math.sqrt(dx * dx + dy * dy) <= nd.r + 3) {
                  hit = i
                  break
                }
              }
              hoverRef.current = hit
              canvas.style.cursor = hit >= 0 ? 'pointer' : 'default'
            }
          }}
          onMouseUp={() => {
            const drag = dragRef.current
            if (drag.mode === 'node' && !drag.moved && drag.index >= 0) {
              const nd = physRef.current[drag.index]
              const node = graph?.nodes.find((gn) => gn.id === nd?.id)
              if (node) {
                setSelected(null)
                setPreviewLoading(true)
                setSent(false)
                window.kora.obsidian.readNote(node.id)
                  .then((r) => {
                    setPreviewLoading(false)
                    if (r.success && r.content !== undefined) {
                      setSelected({ node, content: r.content })
                    } else {
                      setSelected({ node, content: '' })
                    }
                  })
                  .catch(() => {
                    setPreviewLoading(false)
                    setSelected({ node, content: '' })
                  })
              }
            }
            if (drag.mode) {
              drag.mode = null
              canvasRef.current!.style.cursor = 'default'
            }
          }}
          onMouseLeave={() => {
            hoverRef.current = -1
          }}
        />
          <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
            {([
              { title: t.graph.zoomIn, action: () => zoomBy(1.3), icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14M7 5v4M5 7h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) },
              { title: t.graph.zoomOut, action: () => zoomBy(1 / 1.3), icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14M5 7h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) },
              { title: t.graph.fitView, action: fitView, icon: (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="8" cy="8" r="1.6" fill="currentColor" />
                </svg>
              ) },
            ]).map((btn) => (
              <button
                key={btn.title}
                type="button"
                onClick={btn.action}
                title={btn.title}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-kora-surface/90 backdrop-blur border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent transition-colors shadow-lg"
              >
                {btn.icon}
              </button>
            ))}
          </div>
        </>
      )}
      {!error && !loading && !graph && (
        <div className="flex-1 flex items-center justify-center text-sm text-kora-muted">
          {t.graph.empty}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={() => setSelected(null)}>
          <div className="w-full max-w-2xl bg-kora-surface border border-kora-border rounded-3xl shadow-2xl animate-slide-up max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-kora-border">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-kora-text truncate">{selected.node.title}</h3>
                <p className="text-xs text-kora-muted mt-0.5 truncate">{selected.node.path}</p>
                {selected.node.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selected.node.tags.slice(0, 8).map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-kora-card border border-kora-border text-kora-muted">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 min-h-[120px]">
              {previewLoading ? (
                <div className="text-sm text-kora-muted animate-pulse">{t.graph.loading}</div>
              ) : selected.content ? (
                <pre className="text-xs text-kora-text leading-relaxed whitespace-pre-wrap font-sans">{selected.content}</pre>
              ) : (
                <p className="text-sm text-kora-error">{t.graph.readError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-kora-border">
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-2.5 bg-kora-card border border-kora-border rounded-full text-sm text-kora-muted hover:text-kora-text transition-colors"
              >
                {t.graph.close}
              </button>
              {selected.content && (
                <button
                  onClick={() => {
                    const content = selected.content.length > MAX_CONTEXT
                      ? selected.content.slice(0, MAX_CONTEXT) + `\n\n[…${t.graph.truncated} ${MAX_CONTEXT}]`
                      : selected.content
                    onSendToChat(`📄 ${selected.node.title}\n${content}`)
                    setSent(true)
                  }}
                  className="px-4 py-2.5 bg-kora-accent text-white rounded-full text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {sent ? '✓' : t.graph.sendToChat}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
