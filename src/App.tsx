import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import Hls from 'hls.js'
import { addFilter, addSceneFilter, addSceneItem, applyCanvas, captureSnapshot, connectStore, createInstance, createOutput, createScene, createSource, describeSourceKind, disableInstance, enableInstance, getEncoderConfig, getPreviewEncoderConfig, getState, listSourceKinds, refreshState, removeFilter, removeInstance, removeOutput, removeScene, removeSceneFilter, removeSceneItem, removeSource, reorderSceneItems, restartInstance, runCommand, selectSceneItem, selectSource, setActiveScene, setEditingSourceId, setMasterAudio, setPreviewScene, setSceneItemAudio, startPreviewSession, subscribe, transitionToPreview, updateCanvas, updateEncoderConfig, updateFilter, updateInstance, updateOutput, updatePreviewEncoderConfig, updateSceneFilter, updateSceneItem, updateSceneItemTransform, updateSource, updateTransition, uploadSourceAsset } from './store'

import type { SourceKind, SourceKindField } from './types'

type DockSlot = 'left-top' | 'left-bottom' | 'right' | 'bottom-left' | 'bottom-middle'
type DockPanel = 'scenes' | 'sources' | 'controls' | 'mixer' | 'transitions'
type ResizeKey = 'leftWidth' | 'rightWidth' | 'bottomHeight' | 'leftTopRatio' | 'bottomLeftRatio'

const DOCK_STORAGE_KEY = 'sbs-webui-dock-layout-v1'
const DOCK_SIZE_STORAGE_KEY = 'sbs-webui-dock-sizes-v1'
const DOCK_DRAG_MIME = 'application/x-sbs-dock-panel'
const VALID_DOCK_PANELS = new Set<DockPanel>(['scenes', 'sources', 'controls', 'mixer', 'transitions'])

const DEFAULT_DOCK_LAYOUT: Record<DockSlot, DockPanel> = {
  'left-top': 'scenes',
  'left-bottom': 'sources',
  'right': 'controls',
  'bottom-left': 'mixer',
  'bottom-middle': 'transitions',
}

const DEFAULT_DOCK_SIZES = {
  leftWidth: 270,
  rightWidth: 240,
  bottomHeight: 220,
  leftTopRatio: 0.5,
  bottomLeftRatio: 1.4,
}

function loadDockLayout(): Record<DockSlot, DockPanel> {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_DOCK_LAYOUT
    }
    const parsed = JSON.parse(raw) as Partial<Record<DockSlot, string>>
    const next = { ...DEFAULT_DOCK_LAYOUT }
    for (const slot of Object.keys(DEFAULT_DOCK_LAYOUT) as DockSlot[]) {
      const panel = parsed[slot]
      if (panel && VALID_DOCK_PANELS.has(panel as DockPanel)) {
        next[slot] = panel as DockPanel
      }
    }
    return next
  } catch {
    return DEFAULT_DOCK_LAYOUT
  }
}

function saveDockLayout(layout: Record<DockSlot, DockPanel>) {
  window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(layout))
}

function loadDockSizes() {
  try {
    const raw = window.localStorage.getItem(DOCK_SIZE_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_DOCK_SIZES
    }
    return { ...DEFAULT_DOCK_SIZES, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_DOCK_SIZES
  }
}

function saveDockSizes(sizes: typeof DEFAULT_DOCK_SIZES) {
  window.localStorage.setItem(DOCK_SIZE_STORAGE_KEY, JSON.stringify(sizes))
}

function useAppState() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const unsubscribe = subscribe(() => setTick((value) => value + 1))
    return () => {
      unsubscribe()
    }
  }, [])
  return useMemo(() => getState(), [tick])
}

export default function App() {
  const state = useAppState()
  const [command, setCommand] = useState('scene set-active scene-main')
  const [status, setStatus] = useState('Ready')
  const [instancePanelOpen, setInstancePanelOpen] = useState(false)
  const [sourceKinds, setSourceKinds] = useState<SourceKind[]>([])
  const [sourceCreateOpen, setSourceCreateOpen] = useState(false)
  const [sourceConfigOpen, setSourceConfigOpen] = useState(false)
  const [sourceCreateKind, setSourceCreateKind] = useState('videotestsrc')
  const [sourceCreateName, setSourceCreateName] = useState('')
  const [sourceCreateConfig, setSourceCreateConfig] = useState<Record<string, string>>({})
  const [assetUploadStatus, setAssetUploadStatus] = useState<Record<string, { state: 'reading' | 'uploading' | 'done' | 'error'; message: string }>>({})
  const [previewController, setPreviewController] = useState<{ stop: () => Promise<void> } | null>(null)
  const [dockLayout, setDockLayout] = useState<Record<DockSlot, DockPanel>>(DEFAULT_DOCK_LAYOUT)
  const [dragPanel, setDragPanel] = useState<DockPanel | null>(null)
  const [dockSizes, setDockSizes] = useState(DEFAULT_DOCK_SIZES)
  const [activeResize, setActiveResize] = useState<ResizeKey | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null)
  const [sourceContextMenu, setSourceContextMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null)
  const [sceneContextMenu, setSceneContextMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null)
  const [sourceEditConfig, setSourceEditConfig] = useState<Record<string, string>>({})
  const [sourceEditName, setSourceEditName] = useState('')
  const [sourceEditEnabled, setSourceEditEnabled] = useState(true)
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null)
  const [filterTarget, setFilterTarget] = useState<{ kind: 'source' | 'scene'; id: string } | null>(null)
  const [filterAmountDrafts, setFilterAmountDrafts] = useState<Record<string, string>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'canvas' | 'encoder' | 'preview' | 'output'>('canvas')
  const [settingsCanvas, setSettingsCanvas] = useState({ width: 1920, height: 1080, fps_num: 60, fps_den: 1, color_mode: 'sdr', background_color: '#000000' })
  const [editingOutputId, setEditingOutputId] = useState<string | null>(null)
  const [editEncoder, setEditEncoder] = useState<Record<string, string>>({})
  const [sharedEncoder, setSharedEncoder] = useState({ codec: 'h265', bitrate_kbps: '20000', gop_size: '60' })
  const [editOutputTransport, setEditOutputTransport] = useState<Record<string, string>>({})
  const [previewEncoder, setPreviewEncoder] = useState({ width: '1280', height: '720', framerate: '30', bitrate_kbps: '2500' })
  const [fadeDurationMs, setFadeDurationMs] = useState('2000')

  const dragRef = useRef<{
    type: 'move' | 'resize'
    itemId: string
    startMouseX: number
    startMouseY: number
    startPositonX: number
    startPositonY: number
    startWidth: number
    startHeight: number
    handle?: string
  } | null>(null)
  const longPressRef = useRef<{ timer: number; itemId: string; x: number; y: number } | null>(null)
  const previewWrapperRef = useRef<HTMLDivElement | null>(null)
  const [previewPlaybackEnabled, setPreviewPlaybackEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('sbs-preview-audio-playback') !== 'off'
  })

  const DEFAULT_CANVAS_W = 1920
  const DEFAULT_CANVAS_H = 1080
  const MIN_SIZE = 32
  const SNAP_THRESHOLD = 20

  const canvasW = state.canvas?.width || DEFAULT_CANVAS_W
  const canvasH = state.canvas?.height || DEFAULT_CANVAS_H
  const targetFps = Math.round((state.canvas?.fps_num || 60) / Math.max(state.canvas?.fps_den || 1, 1))
  const liveFps = state.telemetry.contentFrames > 1
    ? state.telemetry.contentFps
    : state.telemetry.compositorFps
  const displayFps = Math.max(0, Math.round(liveFps || 0))
  const fpsWarn = state.telemetry.pipelineSlow || (targetFps > 0 && displayFps + 1 < targetFps)
  const fpsTitle = `Content ${state.telemetry.contentFps.toFixed(1)} fps, compositor ${state.telemetry.compositorFps.toFixed(1)} fps`
  const headerStatus = !state.connected
    ? state.connectionMessage
    : state.previewStatus !== 'idle'
      ? state.previewMessage
      : status

  function getPreviewRect() {
    const wrapper = previewWrapperRef.current
    if (!wrapper) return null
    const video = wrapper.querySelector('video') as HTMLVideoElement | null
    const overlay = wrapper.querySelector('.source-overlay') as HTMLElement | null
    if (!video || !overlay) return null
    const overlayRect = overlay.getBoundingClientRect()
    const elW = overlayRect.width
    const elH = overlayRect.height
    const vW = video.videoWidth || canvasW
    const vH = video.videoHeight || canvasH
    const elAspect = elW / elH
    const vAspect = vW / vH
    let contentW: number, contentH: number, offsetX: number, offsetY: number
    if (vAspect > elAspect) {
      contentW = elW
      contentH = elW / vAspect
      offsetX = 0
      offsetY = (elH - contentH) / 2
    } else {
      contentH = elH
      contentW = elH * vAspect
      offsetX = (elW - contentW) / 2
      offsetY = 0
    }
    return { width: contentW, height: contentH, offsetX, offsetY }
  }

  function canvasToPreview(cx: number, cy: number, cw: number, ch: number) {
    const pr = getPreviewRect()
    if (!pr) return { x: 0, y: 0, w: 0, h: 0 }
    const sx = pr.width / canvasW
    const sy = pr.height / canvasH
    return {
      x: pr.offsetX + cx * sx,
      y: pr.offsetY + cy * sy,
      w: cw * sx,
      h: ch * sy,
    }
  }

  function previewToCanvas(px: number, py: number, _ch = 0) {
    const pr = getPreviewRect()
    if (!pr) return { x: 0, y: 0 }
    const localX = px - pr.offsetX
    const localY = py - pr.offsetY
    return {
      x: Math.round(localX / pr.width * canvasW),
      y: Math.round(localY / pr.height * canvasH),
    }
  }

  function snapToCanvas(px: number, py: number, w: number, h: number) {
    let snappedPx = px
    let snappedPy = py
    let snappedW = w
    let snappedH = h
    if (Math.abs(px) < SNAP_THRESHOLD) snappedPx = 0
    if (Math.abs(py) < SNAP_THRESHOLD) snappedPy = 0
    if (Math.abs(px + w - canvasW) < SNAP_THRESHOLD) snappedPx = canvasW - w
    if (Math.abs(py + h - canvasH) < SNAP_THRESHOLD) snappedPy = canvasH - h
    if (Math.abs(px + w / 2 - canvasW / 2) < SNAP_THRESHOLD) snappedPx = canvasW / 2 - w / 2
    if (Math.abs(py + h / 2 - canvasH / 2) < SNAP_THRESHOLD) snappedPy = canvasH / 2 - h / 2
    return { px: snappedPx, py: snappedPy, w: snappedW, h: snappedH }
  }

  useEffect(() => {
    connectStore()
      .then(() => setStatus('Connected to SBS'))
      .catch((error) => setStatus(`Connection failed: ${String(error)}`))
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    function onClickOutside(e: MouseEvent) {
      const menu = document.querySelector('.preview-context-menu')
      if (menu && menu.contains(e.target as Node)) return
      setContextMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [contextMenu])

  useEffect(() => {
    if (!sourceContextMenu) return
    function onClickOutside(e: MouseEvent) {
      const menu = document.querySelector('.source-context-menu')
      if (menu && menu.contains(e.target as Node)) return
      setSourceContextMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [sourceContextMenu])

  useEffect(() => {
    if (!sceneContextMenu) return
    function onClickOutside(e: MouseEvent) {
      const menu = document.querySelector('.scene-context-menu')
      if (menu && menu.contains(e.target as Node)) return
      setSceneContextMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [sceneContextMenu])

  useEffect(() => {
    setDockLayout(loadDockLayout())
    setDockSizes(loadDockSizes())
  }, [])

  useEffect(() => {
    if (instancePanelOpen) {
      return
    }
  }, [state.instanceId, instancePanelOpen])

  useEffect(() => {
    if (!instancePanelOpen) return
    function onClickOutside(event: MouseEvent) {
      const panel = document.getElementById('instance-panel')
      const trigger = document.getElementById('instance-trigger')
      if (panel && !panel.contains(event.target as Node) && trigger && !trigger.contains(event.target as Node)) {
        setInstancePanelOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [instancePanelOpen])

  useEffect(() => {
    if (!activeResize) {
      return
    }

    function onMove(event: MouseEvent) {
      setDockSizes((current) => {
        const next = { ...current }
        if (activeResize === 'leftWidth') {
          next.leftWidth = Math.min(420, Math.max(180, event.clientX - 8))
        } else if (activeResize === 'rightWidth') {
          next.rightWidth = Math.min(360, Math.max(180, window.innerWidth - event.clientX - 8))
        } else if (activeResize === 'bottomHeight') {
          next.bottomHeight = Math.min(320, Math.max(160, window.innerHeight - event.clientY - 46))
        } else if (activeResize === 'leftTopRatio') {
          const containerHeight = window.innerHeight - current.bottomHeight - 78
          const value = Math.min(0.8, Math.max(0.2, (event.clientY - 54) / Math.max(containerHeight, 1)))
          next.leftTopRatio = value
        } else if (activeResize === 'bottomLeftRatio') {
          const total = current.bottomLeftRatio + 1
          const value = Math.min(2.2, Math.max(0.7, (event.clientX / Math.max(window.innerWidth, 1)) * total))
          next.bottomLeftRatio = value
        }
        return next
      })
    }

    function onUp() {
      setDockSizes((current) => {
        saveDockSizes(current)
        return current
      })
      setActiveResize(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [activeResize])

  const sceneEntries = Object.values(state.scenes)
  const sourceEntries = Object.values(state.sources)
  const outputEntries = Object.values(state.outputs)
  const currentInstance = state.instances.find((instance) => instance.instance_id === state.instanceId) ?? null
  const activeScene = state.activeSceneId ? (state.scenes as Record<string, any>)[state.activeSceneId] : null
  const previewScene = state.previewSceneId ? (state.scenes as Record<string, any>)[state.previewSceneId] : null

  useEffect(() => {
    setFadeDurationMs(String(state.transitions['trans-fade']?.duration_ms ?? 2000))
  }, [state.transitions['trans-fade']?.duration_ms])
  const activeSceneItems = ((activeScene?.items ?? []) as any[])
  const activeSceneItemsBottomToTop = [...activeSceneItems].sort((a: any, b: any) => (a.z_order ?? 0) - (b.z_order ?? 0))
  const activeSceneItemsTopToBottom = [...activeSceneItemsBottomToTop].reverse()
  const sourceEntriesById = new Map(sourceEntries.map((source: any) => [source.id, source]))
  const sourcePanelEntries = (() => {
    const seen = new Set<string>()
    const entries: any[] = []
    for (const item of activeSceneItemsTopToBottom) {
      const source = sourceEntriesById.get(item.source_id)
      if (!source || seen.has(source.id)) continue
      seen.add(source.id)
      entries.push(source)
    }
    for (const source of sourceEntries as any[]) {
      if (seen.has(source.id)) continue
      entries.push(source)
    }
    return entries
  })()
  const selectedSceneItem = state.selectedSceneItemId ? activeSceneItems.find((item: any) => item.id === state.selectedSceneItemId) : null
  const activeSourceId = state.selectedSourceId ?? selectedSceneItem?.source_id ?? activeSceneItemsTopToBottom[0]?.source_id ?? sourceEntries[0]?.id ?? null
  const activeSource = activeSourceId ? (state.sources as Record<string, any>)[activeSourceId] : null
  const effectiveFilterTarget = filterTarget ?? (activeSourceId ? { kind: 'source' as const, id: activeSourceId } : null)
  const activeFilterScene = effectiveFilterTarget?.kind === 'scene' ? (state.scenes as Record<string, any>)[effectiveFilterTarget.id] : null
  const activeFilterSource = effectiveFilterTarget?.kind === 'source' ? (state.sources as Record<string, any>)[effectiveFilterTarget.id] : activeSource
  const activeFilters = effectiveFilterTarget?.kind === 'scene'
    ? (activeFilterScene?.filters ?? [])
    : (activeFilterSource?.filters ?? [])
  const activeFilterIds = `${effectiveFilterTarget?.kind ?? 'none'}:${effectiveFilterTarget?.id ?? ''}:${activeFilters.map((filter: any) => filter.id).join('|')}`
  const selectedFilter = activeFilters.find((filter: any) => filter.id === selectedFilterId) ?? activeFilters[0] ?? null

  function audioMeterPercent(value: unknown) {
    const db = Number(value)
    if (!Number.isFinite(db) || db <= -90) return 0
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  }

  function formatAudioDb(value: unknown) {
    const db = Number(value)
    if (!Number.isFinite(db) || db <= -90) return '-inf dB'
    return `${db.toFixed(1)} dB`
  }

  function audioStateForSource(source: any) {
    return source?.audio ?? { enabled: false, device: null, volume: 1, mute: false, monitor: false }
  }

  function audioStateForSceneItem(item: any, source: any) {
    return item?.audio ?? audioStateForSource(source)
  }

  async function updateSceneItemAudio(sceneId: string, item: any, source: any, patch: Record<string, unknown>) {
    const audio = audioStateForSceneItem(item, source)
    await setSceneItemAudio(
      sceneId,
      item.id,
      Number(patch.volume ?? audio.volume ?? 1),
      Boolean(patch.mute ?? audio.mute ?? false),
      Boolean(patch.monitor ?? audio.monitor ?? false),
      String(patch.device ?? audio.device ?? source?.audio?.device ?? 'hw:0,2'),
      Boolean(patch.enabled ?? audio.enabled ?? true),
    )
  }

  useEffect(() => {
    if (activeFilters.length === 0) {
      if (selectedFilterId !== null) {
        setSelectedFilterId(null)
      }
      return
    }
    if (!selectedFilterId || !activeFilters.some((filter: any) => filter.id === selectedFilterId)) {
      setSelectedFilterId(activeFilters[0].id)
    }
  }, [activeFilterIds, activeFilters, selectedFilterId])

  useEffect(() => {
    setFilterAmountDrafts((prev) => {
      const valid = new Set(activeFilters.map((filter: any) => filter.id))
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => valid.has(id)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [activeFilterIds, activeFilters])

  async function moveSceneItem(itemId: string, mode: 'top' | 'up' | 'down' | 'bottom') {
    if (!state.activeSceneId) return
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const items = [...(scene?.items ?? [])].sort((a: any, b: any) => (a.z_order ?? 0) - (b.z_order ?? 0))
    const index = items.findIndex((item: any) => item.id === itemId)
    if (index < 0) return

    let next = [...items]
    const [item] = next.splice(index, 1)

    if (mode === 'top') {
      next.push(item)
    } else if (mode === 'bottom') {
      next.unshift(item)
    } else if (mode === 'up') {
      next.splice(Math.min(index + 1, next.length), 0, item)
    } else {
      next.splice(Math.max(index - 1, 0), 0, item)
    }

    await reorderSceneItems(state.activeSceneId, next.map((entry: any) => entry.id))
    await refreshState().catch(() => undefined)
  }

  async function moveSourceInActiveScene(sourceId: string, mode: 'up' | 'down') {
    if (!state.activeSceneId) return
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const item = (scene?.items as any[])?.find((entry: any) => entry.source_id === sourceId)
    if (!item) return
    await moveSceneItem(item.id, mode)
  }

  async function togglePreview() {
    if (previewController) {
      await previewController.stop()
      setPreviewController(null)
      setStatus('Preview stopped')
      return
    }

    const controller = await startPreviewSession()
    setPreviewController(controller)
  }

  async function handleCreateScene() {
    const name = window.prompt('Scene name', `Scene ${sceneEntries.length + 1}`)?.trim()
    if (!name) {
      return
    }
    await createScene(name)
    setStatus(`Created scene: ${name}`)
  }

  async function handleOpenSourceCatalog() {
    try {
      const result = await listSourceKinds()
      setSourceKinds(result.kinds)
      setSourceCreateKind(result.kinds[0]?.id ?? 'videotestsrc')
      setSourceCreateName(`Source ${sourceEntries.length + 1}`)
      setSourceCreateConfig({})
      setAssetUploadStatus({})
      setSourceCreateOpen(true)
      setSourceConfigOpen(false)
    } catch (error) {
      setStatus(String(error))
    }
  }

  function sourceKindDefaults(kind: SourceKind) {
    const config: Record<string, string> = {}
    for (const field of kind.fields ?? []) {
      config[field.key] = String(field.default ?? '')
    }
    return config
  }

  function rememberSourceKind(kind: SourceKind) {
    setSourceKinds((prev) => {
      const next = prev.filter((entry) => entry.id !== kind.id)
      next.push(kind)
      return next
    })
  }

  async function loadSourceKind(kindId: string) {
    const cached = sourceKinds.find((kind) => kind.id === kindId && Array.isArray(kind.fields))
    if (cached) {
      return cached
    }
    const result = await describeSourceKind(kindId)
    rememberSourceKind(result.kind)
    return result.kind
  }

  async function handleSelectSourceKind(kindId: string) {
    try {
      const kind = await loadSourceKind(kindId)
      setSourceCreateKind(kind.id)
      setSourceCreateName((name) => name || `${kind.name} ${sourceEntries.length + 1}`)
      setSourceCreateConfig(sourceKindDefaults(kind))
      setAssetUploadStatus({})
      setSourceCreateOpen(false)
      setSourceConfigOpen(true)
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function handleCreateSourceFromCatalog() {
    const name = sourceCreateName.trim()
    if (!name) return
    const kind = sourceKinds.find((k) => k.id === sourceCreateKind)
    const config: Record<string, string> = {}
    if (kind) {
      for (const field of kind.fields ?? []) {
        const val = sourceCreateConfig[field.key]
        if (val !== undefined && val !== '') {
          config[field.key] = val
        }
      }
    }
    try {
      await createSource(name, sourceCreateKind, Object.keys(config).length > 0 ? config : undefined)
      setStatus(`Created source: ${name}`)
      setSourceConfigOpen(false)
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function openSourceEditor(source: any) {
    try {
      const kind = await loadSourceKind(source.type)
      setEditingSourceId(source.id)
      setSourceEditName(source.name)
      setSourceEditEnabled(source.enabled !== false)
      setSourceEditConfig({ ...sourceKindDefaults(kind), ...(source.config ?? {}) })
      setAssetUploadStatus({})
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function handleRenameSource(sourceId: string, currentName: string) {
    const name = window.prompt('Source name', currentName)?.trim()
    if (!name) return
    await updateSource(sourceId, { name })
    setStatus(`Renamed source: ${name}`)
  }

  async function handleUpdateSourceConfig(sourceId: string, config: Record<string, string>) {
    await updateSource(sourceId, { config })
    setStatus(`Updated source config: ${sourceId}`)
  }

  async function handleCreateOutput() {
    const name = window.prompt('Output name', `Output ${outputEntries.length + 1}`)?.trim()
    if (!name) {
      return
    }
    await createOutput(name)
    setStatus(`Created output: ${name}`)
  }

  function switchToInstance(id: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('instance', String(id))
    window.location.href = url.toString()
  }

  async function handleCreateInstance() {
    const name = window.prompt('Instance name', `Instance ${state.instances.length}`)?.trim()
    if (!name) {
      return
    }
    const created = await createInstance(name)
    setStatus(`Created instance: ${created.name}`)
  }

  async function handleRenameInstance() {
    if (!currentInstance) {
      return
    }
    const name = window.prompt('Instance name', currentInstance.name)?.trim()
    if (!name) {
      return
    }
    const updated = await updateInstance(currentInstance.instance_id, { name })
    setStatus(`Renamed instance: ${updated.name}`)
  }

  async function handleToggleInstanceEnabled() {
    if (!currentInstance) {
      return
    }
    const updated = currentInstance.desired_running
      ? await disableInstance(currentInstance.instance_id)
      : await enableInstance(currentInstance.instance_id)
    setStatus(`${updated.name} ${updated.desired_running ? 'enabled' : 'disabled'}`)
  }

  async function handleDeleteInstance() {
    if (!currentInstance || currentInstance.instance_id === 0) {
      setStatus('Default instance cannot be deleted')
      return
    }
    if (!window.confirm(`Delete instance ${currentInstance.name}?`)) {
      return
    }
    await removeInstance(currentInstance.instance_id)
    setInstancePanelOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.set('instance', '0')
    window.location.href = url.toString()
  }

  async function handleRestartInstance() {
    if (!currentInstance) return
    if (!window.confirm(`Restart instance ${currentInstance.name}? This will briefly disconnect all clients.`)) {
      return
    }
    setStatus('Restarting instance...')
    try {
      await restartInstance(currentInstance.instance_id)
      setStatus('Instance restarted — reconnecting...')
      await new Promise((r) => setTimeout(r, 2000))
      window.location.reload()
    } catch (error) {
      setStatus(`Restart failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function defaultFilterAmount(filter: any) {
    if (filter.type === 'brightness') {
      return Number(filter.params?.amount ?? 0.15)
    }
    if (filter.type === 'contrast') {
      return Number(filter.params?.amount ?? 1.15)
    }
    return Number(filter.params?.amount ?? 1)
  }

  function filterRangeConfig(filter: any) {
    if (filter.type === 'brightness') {
      return { min: -0.5, max: 0.5, step: 0.05 }
    }
    if (filter.type === 'contrast') {
      return { min: 0.5, max: 2.0, step: 0.05 }
    }
    if (filter.type === 'hdr_to_sdr_lut') {
      return { min: 0, max: 2, step: 0.05 }
    }
    return { min: 0, max: 1, step: 0.1 }
  }

  function filterAmountPrecision(filter: any) {
    const step = String(filterDisplayRangeConfig(filter).step)
    const decimal = step.split('.')[1]
    return decimal ? decimal.length : 0
  }

  function filterAmountScale(filter: any) {
    return filter.type === 'brightness' || filter.type === 'contrast' ? 1 : 100
  }

  function filterDisplayRangeConfig(filter: any) {
    const range = filterRangeConfig(filter)
    const scale = filterAmountScale(filter)
    return { min: range.min * scale, max: range.max * scale, step: range.step * scale }
  }

  function formatFilterAmountInput(filter: any, amount = defaultFilterAmount(filter)) {
    return (amount * filterAmountScale(filter)).toFixed(filterAmountPrecision(filter))
  }

  function clampFilterAmount(filter: any, amount: number) {
    const range = filterRangeConfig(filter)
    return Math.min(range.max, Math.max(range.min, amount))
  }

  function hdrFilterParam(filter: any, key: string) {
    const fallback = key === 'saturation' ? 1.42 : key === 'brightness' ? -0.02 : 0
    const value = Number(filter.params?.[key] ?? fallback)
    return Number.isFinite(value) ? value : fallback
  }

  function hdrFilterParamRange(key: string) {
    if (key === 'saturation') return { min: 0.5, max: 2.5, step: 0.05, scale: 100 }
    if (key === 'brightness') return { min: -0.2, max: 0.2, step: 0.01, scale: 100 }
    return { min: -45, max: 45, step: 1, scale: 1 }
  }

  function clampHdrFilterParam(key: string, value: number) {
    const range = hdrFilterParamRange(key)
    return Math.min(range.max, Math.max(range.min, value))
  }

  function formatHdrFilterParam(filter: any, key: string) {
    const value = hdrFilterParam(filter, key)
    if (key === 'saturation') return `${Math.round(value * 100)}%`
    if (key === 'brightness') return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`
    return `${Math.round(value)} deg`
  }

  function renderHdrFilterSlider(filter: any, key: string, label: string) {
    const range = hdrFilterParamRange(key)
    const unit = key === 'hue' ? 'deg' : '%'
    return (
      <label className="filter-property-row">
        <span>{label}</span>
        <div className="filter-control-row">
          <input
            type="range"
            aria-label={`HDR to SDR ${key}`}
            draggable={false}
            min={range.min * range.scale}
            max={range.max * range.scale}
            step={range.step * range.scale}
            value={hdrFilterParam(filter, key) * range.scale}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
            onChange={(event) => handleCommitHdrFilterParam(filter, key, Number(event.target.value) / range.scale).catch((error) => setStatus(String(error)))}
          />
          <span className="filter-unit">{unit}</span>
        </div>
        <small className="filter-value">{formatHdrFilterParam(filter, key)}</small>
      </label>
    )
  }

  function filterAmountUnit(filter: any) {
    if (filter.type === 'contrast') return 'x'
    if (filter.type === 'brightness') return ''
    return '%'
  }

  function formatFilterAmount(filter: any) {
    const amount = defaultFilterAmount(filter)
    if (filter.type === 'brightness') {
      return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`
    }
    if (filter.type === 'contrast') {
      return `${amount.toFixed(2)}x`
    }
    return `${Math.round(amount * 100)}%`
  }

  function filterDisplayName(type: string) {
    if (type === 'hdr_to_sdr_lut') {
      return 'HDR→SDR LUT'
    }
    if (type === 'lut') return 'Apply LUT'
    if (type === 'color_correction') return 'Color Correction'
    if (type === 'luma_key') return 'Luma Key'
    if (type === 'chroma_key') return 'Chroma Key'
    if (type === 'grayscale') return 'Grayscale'
    if (type === 'brightness') return 'Brightness'
    if (type === 'contrast') return 'Contrast'
    return type
  }

  function filterParamValue(filter: any, key: string, fallback: number) {
    const value = Number(filter.params?.[key] ?? fallback)
    return Number.isFinite(value) ? value : fallback
  }

  function filterParamRange(key: string) {
    if (key === 'saturation') return { min: 0, max: 3, step: 0.05, scale: 100 }
    if (key === 'brightness') return { min: -1, max: 1, step: 0.02, scale: 100 }
    if (key === 'contrast') return { min: 0, max: 4, step: 0.05, scale: 100 }
    if (key === 'gamma') return { min: 0.1, max: 4, step: 0.05, scale: 100 }
    if (key === 'hue') return { min: -180, max: 180, step: 1, scale: 1 }
    if (key === 'min' || key === 'max' || key === 'similarity' || key === 'smoothness' || key === 'spill') {
      return { min: 0, max: 1, step: 0.01, scale: 100 }
    }
    return { min: 0, max: 1, step: 0.01, scale: 100 }
  }

  function filterParamFallback(filter: any, key: string) {
    if (filter.type === 'color_correction') {
      if (key === 'saturation' || key === 'contrast' || key === 'gamma') return 1
      return 0
    }
    if (filter.type === 'luma_key') {
      if (key === 'max') return 1
      if (key === 'smoothness') return 0.08
      return 0
    }
    if (filter.type === 'chroma_key') {
      if (key === 'similarity') return 0.25
      if (key === 'smoothness') return 0.08
      return 0
    }
    return 0
  }

  async function handleCommitFilterParam(filter: any, key: string, value: number) {
    if (!effectiveFilterTarget || !Number.isFinite(value)) return
    const range = filterParamRange(key)
    const nextValue = Math.min(range.max, Math.max(range.min, value))
    const params = { ...(filter.params ?? {}), [key]: nextValue }
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    }
    setStatus(`Adjusted ${filterDisplayName(filter.type)}`)
  }

  async function handleCommitFilterColor(filter: any, color: string) {
    if (!effectiveFilterTarget) return
    const params = { ...(filter.params ?? {}), color }
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    }
    setStatus(`Adjusted ${filterDisplayName(filter.type)}`)
  }

  function renderFilterParamSlider(filter: any, key: string, label: string) {
    const range = filterParamRange(key)
    const value = filterParamValue(filter, key, filterParamFallback(filter, key))
    const unit = key === 'hue' ? 'deg' : '%'
    return (
      <label className="filter-property-row">
        <span>{label}</span>
        <div className="filter-control-row">
          <input
            type="range"
            aria-label={`${filter.type} ${key}`}
            draggable={false}
            min={range.min * range.scale}
            max={range.max * range.scale}
            step={range.step * range.scale}
            value={value * range.scale}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
            onChange={(event) => handleCommitFilterParam(filter, key, Number(event.target.value) / range.scale).catch((error) => setStatus(String(error)))}
          />
          <span className="filter-unit">{unit}</span>
        </div>
        <small className="filter-value">{key === 'hue' ? `${Math.round(value)} deg` : `${Math.round(value * 100)}%`}</small>
      </label>
    )
  }

  async function handleAddFilterType(type: string) {
    if (!effectiveFilterTarget || !type) return
    const id = `${type}-${Date.now()}`
    setSelectedFilterId(id)
    if (effectiveFilterTarget.kind === 'scene') {
      await addSceneFilter(effectiveFilterTarget.id, type, id)
    } else {
      await addFilter(effectiveFilterTarget.id, type, id)
    }
    setStatus(`Added ${filterDisplayName(type)} filter`)
  }

  async function handleRemoveSelectedFilter() {
    if (!effectiveFilterTarget || !selectedFilter) return
    if (effectiveFilterTarget.kind === 'scene') {
      await removeSceneFilter(effectiveFilterTarget.id, selectedFilter.id)
    } else {
      await removeFilter(effectiveFilterTarget.id, selectedFilter.id)
    }
    setStatus(`Removed ${filterDisplayName(selectedFilter.type)}`)
  }

  async function handleToggleFilter(filter: any, enabled: boolean) {
    if (!effectiveFilterTarget) return
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, enabled, filter.params ?? { amount: defaultFilterAmount(filter) })
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, enabled, filter.params ?? { amount: defaultFilterAmount(filter) })
    }
    setStatus(`${enabled ? 'Enabled' : 'Disabled'} ${filterDisplayName(filter.type)}`)
  }

  function openSourceFilters(sourceId: string) {
    selectSource(sourceId)
    setFilterTarget({ kind: 'source', id: sourceId })
    setSelectedFilterId(null)
    setSourceContextMenu(null)
    setFiltersOpen(true)
  }

  function openSceneFilters(sceneId: string) {
    setFilterTarget({ kind: 'scene', id: sceneId })
    setSelectedFilterId(null)
    setSceneContextMenu(null)
    setFiltersOpen(true)
  }

  async function handleCommitFilterAmount(filter: any, amount: number) {
    if (!effectiveFilterTarget || !Number.isFinite(amount)) return
    const nextAmount = clampFilterAmount(filter, amount)
    setFilterAmountDrafts((prev) => ({ ...prev, [filter.id]: formatFilterAmountInput(filter, nextAmount) }))
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), amount: nextAmount })
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), amount: nextAmount })
    }
    setStatus(`Adjusted ${filterDisplayName(filter.type)}`)
  }

  async function handleCommitHdrFilterParam(filter: any, key: string, value: number) {
    if (!effectiveFilterTarget || !Number.isFinite(value)) return
    const nextValue = clampHdrFilterParam(key, value)
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), [key]: nextValue })
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), [key]: nextValue })
    }
    setStatus(`Adjusted ${filterDisplayName(filter.type)}`)
  }

  function handleFilterAmountDraft(filter: any, value: string) {
    setFilterAmountDrafts((prev) => ({ ...prev, [filter.id]: value }))
  }

  function commitFilterAmountDraft(filter: any) {
    const value = filterAmountDrafts[filter.id] ?? formatFilterAmountInput(filter)
    const displayAmount = Number(value)
    if (!Number.isFinite(displayAmount)) {
      setFilterAmountDrafts((prev) => {
        const next = { ...prev }
        delete next[filter.id]
        return next
      })
      return
    }
    handleCommitFilterAmount(filter, displayAmount / filterAmountScale(filter)).catch((error) => setStatus(String(error)))
  }

  function fieldDefaultValue(field: SourceKindField) {
    return String(field.default ?? '')
  }

  function fieldInputValue(config: Record<string, string>, field: SourceKindField) {
    return config[field.key] ?? fieldDefaultValue(field)
  }

  function fileAsBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const value = String(reader.result ?? '')
        const comma = value.indexOf(',')
        resolve(comma >= 0 ? value.slice(comma + 1) : value)
      }
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))
      reader.readAsDataURL(file)
    })
  }

  async function handleSourceAssetUpload(
    field: SourceKindField,
    file: File,
    setConfig: Dispatch<SetStateAction<Record<string, string>>>,
  ) {
    if (!field.asset_kind) return
    const statusKey = `${field.asset_kind}:${field.key}`
    if (file.size > 128 * 1024 * 1024) {
      const message = 'File is larger than the 128 MB upload limit'
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'error', message } }))
      setStatus(message)
      return
    }
    try {
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'reading', message: `Reading ${file.name}...` } }))
      setStatus(`Reading ${file.name}...`)
      const dataBase64 = await fileAsBase64(file)
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'uploading', message: `Uploading ${file.name}...` } }))
      setStatus(`Uploading ${file.name}...`)
      const uploaded = await uploadSourceAsset(field.asset_kind, file.name, dataBase64)
      const value = field.key === 'uri' ? uploaded.uri : uploaded.path
      setConfig((prev) => ({ ...prev, [field.key]: value }))
      setAssetUploadStatus((prev) => ({
        ...prev,
        [statusKey]: { state: 'done', message: `Uploaded ${uploaded.filename} (${Math.max(1, Math.round(uploaded.size / 1024))} KB)` },
      }))
      setStatus(`Uploaded ${uploaded.filename}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'error', message: `Upload failed: ${message}` } }))
      setStatus(`Upload failed: ${message}`)
    }
  }

  function renderSourceFieldInput(
    field: SourceKindField,
    config: Record<string, string>,
    setConfig: Dispatch<SetStateAction<Record<string, string>>>,
  ) {
    if (field.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={fieldInputValue(config, field) === 'true'}
          onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.checked ? 'true' : 'false' }))}
        />
      )
    }
    if (field.type === 'select' && field.options) {
      return (
        <select
          value={fieldInputValue(config, field)}
          onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
        >
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }
    const textInput = field.key === 'text' ? (
      <textarea
        value={fieldInputValue(config, field)}
        onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
        placeholder={fieldDefaultValue(field)}
        rows={3}
      />
    ) : (
      <input
        type={field.key === 'text_color' ? 'text' : 'text'}
        value={fieldInputValue(config, field)}
        onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
        placeholder={fieldDefaultValue(field)}
      />
    )
    if (!field.asset_kind) {
      return textInput
    }
    const accept = field.asset_kind === 'image'
      ? 'image/*'
      : field.asset_kind === 'font'
        ? '.ttf,.otf,.woff,.woff2,font/*'
        : 'audio/*,video/*,.mkv,.mp4,.mov,.webm,.ts,.m2ts,.mp3,.wav,.flac,.aac'
    const uploadStatus = assetUploadStatus[`${field.asset_kind}:${field.key}`]
    return (
      <div className="asset-field-wrap">
        <div className="asset-field-control">
          {textInput}
          <label className="asset-upload-button">
            Upload
            <input
              type="file"
              accept={accept}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) {
                  handleSourceAssetUpload(field, file, setConfig)
                }
              }}
            />
          </label>
        </div>
        <div className={`asset-field-status ${uploadStatus?.state ?? ''}`} aria-live="polite">
          {uploadStatus?.message ?? `Upload ${field.asset_kind} file, or paste a path/URI.`}
        </div>
      </div>
    )
  }

  function movePanel(targetSlot: DockSlot) {
    if (!dragPanel) {
      return
    }
    const currentSlot = (Object.keys(dockLayout) as DockSlot[]).find((slot) => dockLayout[slot] === dragPanel)
    if (!currentSlot || currentSlot === targetSlot) {
      return
    }
    const nextLayout = {
      ...dockLayout,
      [currentSlot]: dockLayout[targetSlot],
      [targetSlot]: dragPanel,
    }
    setDockLayout(nextLayout)
    saveDockLayout(nextLayout)
  }

  function resetWorkspaceLayout() {
    setDockLayout(DEFAULT_DOCK_LAYOUT)
    setDockSizes(DEFAULT_DOCK_SIZES)
    saveDockLayout(DEFAULT_DOCK_LAYOUT)
    saveDockSizes(DEFAULT_DOCK_SIZES)
    setStatus('Workspace layout reset')
  }

  function openSettings() {
    const canvasState = state.pendingCanvas || state.canvas
    if (canvasState) {
      setSettingsCanvas({
        width: canvasState.width || 1920,
        height: canvasState.height || 1080,
        fps_num: canvasState.fps_num || 60,
        fps_den: canvasState.fps_den || 1,
        color_mode: canvasState.color_mode || 'sdr',
        background_color: canvasState.background_color || '#000000',
      })
    }
    getEncoderConfig().then((cfg: any) => {
      setSharedEncoder({
        codec: cfg.codec || 'h265',
        bitrate_kbps: String(cfg.bitrate_kbps || 20000),
        gop_size: String(cfg.gop_size || 60),
      })
    }).catch(() => {})
    setSettingsTab('canvas')
    setSettingsOpen(true)
  }

  function openOutputTransport(output: any) {
    const enc = output.encoder || {}
    setEditingOutputId(output.id)
    setEditOutputTransport({
      sink_type: enc.sink_type || 'srt',
      srt_uri: enc.srt_uri || 'srt://:8888',
      srt_latency_ms: String(enc.srt_latency_ms || 600),
      rtmp_uri: enc.rtmp_uri || 'rtmp://127.0.0.1:1935/live/stream',
      rtmp_passcode: enc.rtmp_passcode || '',
      file_path: enc.file_path || '/tmp/stream.ts',
    })
    setSettingsTab('output')
    setSettingsOpen(true)
  }

  const selectedOutput = editingOutputId ? outputEntries.find((output: any) => output.id === editingOutputId) : null

  async function applySettings() {
    if (settingsTab === 'canvas') {
      await applyCanvas().then(() => {
        setStatus('Saved canvas settings applied with full reinitialization')
        setSettingsOpen(false)
      }).catch((e) => setStatus(String(e)))
      return
    } else if (settingsTab === 'encoder') {
      await updateEncoderConfig({
        codec: sharedEncoder.codec,
        bitrate_kbps: Number(sharedEncoder.bitrate_kbps),
        gop_size: Number(sharedEncoder.gop_size),
      }).then(() => setStatus('Encoder config updated')).catch((e) => setStatus(String(e)))
    } else if (settingsTab === 'preview') {
      const wasActive = Boolean(previewController)
      try {
        if (previewController) {
          setStatus('Stopping preview before applying encoder settings...')
          await previewController.stop()
          setPreviewController(null)
        }
        await updatePreviewEncoderConfig({
          width: Number(previewEncoder.width),
          height: Number(previewEncoder.height),
          framerate: Number(previewEncoder.framerate),
          bitrate_kbps: Number(previewEncoder.bitrate_kbps),
        })
        if (wasActive) {
          const controller = await startPreviewSession()
          setPreviewController(controller)
          setStatus('Preview encoder config updated and preview restarted')
        } else {
          setStatus('Preview encoder config updated')
        }
      } catch (e) {
        setStatus(String(e))
        return
      }
    } else if (settingsTab === 'output' && editingOutputId) {
      const sinkType = editOutputTransport.sink_type || 'srt'
      const patch: Record<string, unknown> = { sink_type: sinkType }
      if (sinkType === 'srt') {
        patch.srt_uri = editOutputTransport.srt_uri
        patch.srt_latency_ms = Number(editOutputTransport.srt_latency_ms)
      } else if (sinkType === 'rtmp') {
        patch.rtmp_uri = editOutputTransport.rtmp_uri
        patch.rtmp_passcode = editOutputTransport.rtmp_passcode
      } else if (sinkType === 'file') {
        patch.file_path = editOutputTransport.file_path
      }
      await updateOutput(editingOutputId, { encoder: patch }).then(() => setStatus('Output transport updated')).catch((e) => setStatus(String(e)))
    }
    setSettingsOpen(false)
  }

  async function saveCanvasSettings() {
    await updateCanvas(settingsCanvas).then(() => setStatus('Canvas settings saved. Waiting for apply.')).catch((e) => setStatus(String(e)))
  }

  function renderSettingsBody() {
    const sinkType = editOutputTransport.sink_type || 'srt'
    if (settingsTab === 'canvas') {
      return (
        <>
          <div className="settings-warning">Canvas settings are saved first. Apply will fully reinitialize sources, compositor, and outputs.</div>
          {state.canvasRestartRequired && state.pendingCanvas && (
            <div className="settings-warning">Settings changed, waiting for apply.</div>
          )}
          <div className="settings-section-title">Video</div>
          <div className="settings-row">
            <label>Resolution</label>
            <div className="settings-inline">
              <input type="number" value={settingsCanvas.width} onChange={(e) => setSettingsCanvas((s) => ({ ...s, width: Number(e.target.value) }))} />
              <span>x</span>
              <input type="number" value={settingsCanvas.height} onChange={(e) => setSettingsCanvas((s) => ({ ...s, height: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="settings-row">
            <label>Framerate</label>
            <div className="settings-inline">
              <input type="number" value={settingsCanvas.fps_num} onChange={(e) => setSettingsCanvas((s) => ({ ...s, fps_num: Number(e.target.value) }))} />
              <span>/</span>
              <input type="number" value={settingsCanvas.fps_den} onChange={(e) => setSettingsCanvas((s) => ({ ...s, fps_den: Number(e.target.value) || 1 }))} style={{ width: 50 }} />
            </div>
          </div>
          <div className="settings-section-title">Color</div>
          <div className="settings-row">
            <label>Color Mode</label>
            <select value={settingsCanvas.color_mode} onChange={(e) => setSettingsCanvas((s) => ({ ...s, color_mode: e.target.value }))}>
              <option value="sdr">SDR</option>
              <option value="hdr10">HDR10</option>
            </select>
          </div>
          <div className="settings-row">
            <label>Background</label>
            <input type="color" value={settingsCanvas.background_color} onChange={(e) => setSettingsCanvas((s) => ({ ...s, background_color: e.target.value }))} />
          </div>
        </>
      )
    }
    if (settingsTab === 'encoder') {
      return (
        <>
          <div className="settings-warning">Shared encoder settings apply to all outputs. Changing will briefly restart the encoder pipeline.</div>
          <div className="settings-section-title">Encoder</div>
          <div className="settings-row">
            <label>Codec</label>
            <select value={sharedEncoder.codec} onChange={(e) => setSharedEncoder((s) => ({ ...s, codec: e.target.value }))}>
              <option value="h265">H.265 (HEVC)</option>
              <option value="h264">H.264 (AVC)</option>
            </select>
          </div>
          <div className="settings-row">
            <label>Bitrate</label>
            <div className="settings-inline">
              <input type="number" value={sharedEncoder.bitrate_kbps} onChange={(e) => setSharedEncoder((s) => ({ ...s, bitrate_kbps: e.target.value }))} />
              <span>kbps</span>
            </div>
          </div>
          <div className="settings-row">
            <label>GOP Size</label>
            <div className="settings-inline">
              <input type="number" value={sharedEncoder.gop_size} onChange={(e) => setSharedEncoder((s) => ({ ...s, gop_size: e.target.value }))} />
              <span>frames</span>
            </div>
          </div>
        </>
      )
    }
    if (settingsTab === 'preview') {
      return (
        <>
          <div className="settings-warning">Preview encoder settings for WebRTC preview. If preview is active, Apply restarts it automatically.</div>
          <div className="settings-section-title">Preview Encoder</div>
          <div className="settings-row">
            <label>Resolution</label>
            <div className="settings-inline">
              <input type="number" value={previewEncoder.width} onChange={(e) => setPreviewEncoder((s) => ({ ...s, width: e.target.value }))} />
              <span>x</span>
              <input type="number" value={previewEncoder.height} onChange={(e) => setPreviewEncoder((s) => ({ ...s, height: e.target.value }))} />
            </div>
          </div>
          <div className="settings-row">
            <label>Framerate</label>
            <div className="settings-inline">
              <input type="number" value={previewEncoder.framerate} onChange={(e) => setPreviewEncoder((s) => ({ ...s, framerate: e.target.value }))} />
              <span>fps</span>
            </div>
          </div>
          <div className="settings-row">
            <label>Bitrate</label>
            <div className="settings-inline">
              <input type="number" value={previewEncoder.bitrate_kbps} onChange={(e) => setPreviewEncoder((s) => ({ ...s, bitrate_kbps: e.target.value }))} />
              <span>kbps</span>
            </div>
          </div>
        </>
      )
    }
    // output tab
    return (
      <>
        <div className="settings-section-title">Transport</div>
        <div className="settings-row">
          <label>Output</label>
          <select
            value={editingOutputId || ''}
            onChange={(e) => {
              const output = outputEntries.find((entry: any) => entry.id === e.target.value)
              if (output) openOutputTransport(output)
            }}
          >
            <option value="" disabled>Select output</option>
            {outputEntries.map((output: any) => (
              <option key={output.id} value={output.id}>{output.name || output.id}</option>
            ))}
          </select>
        </div>
        {selectedOutput ? (
          <>
            <div className="settings-row">
              <label>Sink Type</label>
              <select value={sinkType} onChange={(e) => setEditOutputTransport((s) => ({ ...s, sink_type: e.target.value }))}>
                <option value="srt">SRT</option>
                <option value="rtmp">RTMP</option>
                <option value="file">File</option>
                <option value="fakesink">Fakesink</option>
              </select>
            </div>
            {sinkType === 'srt' && (
              <>
                <div className="settings-row">
                  <label>SRT URI</label>
                  <input value={editOutputTransport.srt_uri || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, srt_uri: e.target.value }))} />
                </div>
                <div className="settings-row">
                  <label>Latency</label>
                  <div className="settings-inline">
                    <input type="number" value={editOutputTransport.srt_latency_ms || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, srt_latency_ms: e.target.value }))} />
                    <span>ms</span>
                  </div>
                </div>
              </>
            )}
            {sinkType === 'rtmp' && (
              <>
                <div className="settings-row">
                  <label>RTMP URI</label>
                  <input value={editOutputTransport.rtmp_uri || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, rtmp_uri: e.target.value }))} />
                </div>
                <div className="settings-row">
                  <label>Passcode</label>
                  <input type="password" value={editOutputTransport.rtmp_passcode || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, rtmp_passcode: e.target.value }))} />
                </div>
              </>
            )}
            {sinkType === 'file' && (
              <div className="settings-row">
                <label>File Path</label>
                <input value={editOutputTransport.file_path || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, file_path: e.target.value }))} />
              </div>
            )}
          </>
        ) : (
          <div className="settings-empty">Select an output to edit its transport settings.</div>
        )}
      </>
    )
  }

  function renderSettingsDialog() {
    if (!settingsOpen) return null
    return (
      <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
        <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>Settings</h2>
            <button onClick={() => setSettingsOpen(false)}>X</button>
          </div>
          <div className="settings-content">
            <nav className="settings-sidebar">
              <button className={settingsTab === 'canvas' ? 'active' : ''} onClick={() => setSettingsTab('canvas')}>Video</button>
              <button className={settingsTab === 'encoder' ? 'active' : ''} onClick={() => {
                getEncoderConfig().then((cfg: any) => {
                  setSharedEncoder({
                    codec: cfg.codec || 'h265',
                    bitrate_kbps: String(cfg.bitrate_kbps || 20000),
                    gop_size: String(cfg.gop_size || 60),
                  })
                }).catch(() => {})
                setSettingsTab('encoder')
              }}>Encoder</button>
              <button className={settingsTab === 'preview' ? 'active' : ''} onClick={() => {
                getPreviewEncoderConfig().then((cfg: any) => {
                  setPreviewEncoder({
                    width: String(cfg.width || 1280),
                    height: String(cfg.height || 720),
                    framerate: String(cfg.framerate || 30),
                    bitrate_kbps: String(cfg.bitrate_kbps || 2500),
                  })
                }).catch(() => {})
                setSettingsTab('preview')
              }}>Preview</button>
              <button className={settingsTab === 'output' ? 'active' : ''} onClick={() => setSettingsTab('output')}>Output</button>
            </nav>
            <div className="settings-body">
              {renderSettingsBody()}
            </div>
          </div>
          <div className="settings-footer">
            <button onClick={() => setSettingsOpen(false)}>Cancel</button>
            {settingsTab === 'canvas' ? (
              <>
                <button onClick={() => saveCanvasSettings()}>Save</button>
                <button className="btn-primary" onClick={() => applySettings()} disabled={!state.canvasRestartRequired}>Apply</button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => applySettings()}>Apply</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  function renderSourcePickerDialog() {
    if (!sourceCreateOpen) return null
    return (
      <div className="settings-overlay" onClick={() => setSourceCreateOpen(false)}>
        <div className="settings-dialog source-picker-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>Choose Source Type</h2>
            <button onClick={() => setSourceCreateOpen(false)}>X</button>
          </div>
          <div className="source-picker-body">
            <div className="source-picker-title">Select the kind of source to add, then configure it in the next step.</div>
            <div className="source-kind-grid">
              {sourceKinds.map((kind) => (
                <button key={kind.id} className="source-kind-card" onClick={() => handleSelectSourceKind(kind.id)}>
                  <strong>{kind.name}</strong>
                  <span>{kind.summary}</span>
                  <small>{kind.pausable ? 'Pausable when inactive' : 'Live source stays running'}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="settings-footer">
            <button onClick={() => setSourceCreateOpen(false)}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  function renderSourceConfigDialog() {
    if (!sourceConfigOpen) return null
    const kind = sourceKinds.find((entry) => entry.id === sourceCreateKind)
    if (!kind) return null
    return (
      <div className="settings-overlay" onClick={() => setSourceConfigOpen(false)}>
        <div className="settings-dialog source-config-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>Create {kind.name}</h2>
            <button onClick={() => setSourceConfigOpen(false)}>X</button>
          </div>
          <div className="settings-body source-config-body">
            <div className="source-config-summary">
              <strong>{kind.name}</strong>
              <span>{kind.summary}</span>
              <small>{kind.pausable ? 'Can pause when inactive' : 'Live source remains running when inactive'}</small>
            </div>
            <div className="source-create-row">
              <label>Name</label>
              <input value={sourceCreateName} onChange={(event) => setSourceCreateName(event.target.value)} />
            </div>
            {(kind.fields ?? []).map((field) => (
              <div key={field.key} className="source-create-row">
                <label>{field.label}</label>
                {renderSourceFieldInput(field, sourceCreateConfig, setSourceCreateConfig)}
              </div>
            ))}
          </div>
          <div className="settings-footer">
            <button onClick={() => { setSourceConfigOpen(false); setSourceCreateOpen(true) }}>Back</button>
            <button onClick={() => setSourceConfigOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => handleCreateSourceFromCatalog().catch((error) => setStatus(String(error)))}>Create Source</button>
          </div>
        </div>
      </div>
    )
  }

  function renderFilterEditor() {
    if (!effectiveFilterTarget || (effectiveFilterTarget.kind === 'scene' ? !activeFilterScene : !activeFilterSource)) {
      return <div className="history-list">No scene or source selected to edit filters.</div>
    }

    const targetName = effectiveFilterTarget.kind === 'scene'
      ? (activeFilterScene?.name ?? activeFilterScene?.id)
      : (activeFilterSource?.name ?? activeFilterSource?.id)

    return (
      <>
        <div className="filter-target list-item row-item">
          <div>
            <span>{effectiveFilterTarget.kind === 'scene' ? 'Target Scene' : 'Target Source'}</span>
            <small>{targetName}</small>
          </div>
        </div>
        <div className="filter-editor">
          <div className="filter-list-pane">
            <div className="filter-section-title">Effect Filters</div>
            <div className="filter-list" role="listbox" aria-label="Effect Filters">
              {activeFilters.length === 0 ? (
                <div className="filter-empty">No filters applied.</div>
              ) : activeFilters.map((filter: any) => (
                <button
                  key={filter.id}
                  type="button"
                  role="option"
                  aria-selected={selectedFilter?.id === filter.id}
                  className={`filter-list-row ${selectedFilter?.id === filter.id ? 'active' : ''} ${filter.enabled ? '' : 'disabled'}`}
                  onClick={() => setSelectedFilterId(filter.id)}
                >
                  <span>{filterDisplayName(filter.type)}</span>
                  <small>{filter.enabled ? 'On' : 'Off'}</small>
                </button>
              ))}
            </div>
            <div className="filter-toolbar">
              <select
                aria-label="Add effect filter"
                value=""
                onChange={(event) => {
                  const type = event.target.value
                  event.currentTarget.value = ''
                  handleAddFilterType(type).catch((error) => setStatus(String(error)))
                }}
              >
                <option value="">+ Add</option>
                <option value="grayscale">Grayscale</option>
                <option value="brightness">Brightness</option>
                <option value="contrast">Contrast</option>
                <option value="color_correction">Color Correction</option>
                <option value="luma_key">Luma Key</option>
                <option value="chroma_key">Chroma Key</option>
                <option value="lut">Apply LUT</option>
                <option value="hdr_to_sdr_lut">HDR→SDR LUT</option>
              </select>
              <button
                aria-label="Remove selected filter"
                disabled={!selectedFilter}
                onClick={() => handleRemoveSelectedFilter().catch((error) => setStatus(String(error)))}
              >−</button>
            </div>
          </div>
          <div className="filter-properties">
            {selectedFilter ? (
              <>
                <div className="filter-properties-header">
                  <strong>{filterDisplayName(selectedFilter.type)}</strong>
                  <label className="filter-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={selectedFilter.enabled}
                      onChange={(event) => handleToggleFilter(selectedFilter, event.target.checked).catch((error) => setStatus(String(error)))}
                    />
                    Enabled
                  </label>
                </div>
                {selectedFilter.type === 'color_correction' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'saturation', 'Saturation')}
                    {renderFilterParamSlider(selectedFilter, 'brightness', 'Brightness')}
                    {renderFilterParamSlider(selectedFilter, 'contrast', 'Contrast')}
                    {renderFilterParamSlider(selectedFilter, 'gamma', 'Gamma')}
                    {renderFilterParamSlider(selectedFilter, 'hue', 'Hue')}
                  </>
                ) : selectedFilter.type === 'luma_key' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'min', 'Minimum Luma')}
                    {renderFilterParamSlider(selectedFilter, 'max', 'Maximum Luma')}
                    {renderFilterParamSlider(selectedFilter, 'smoothness', 'Smoothness')}
                  </>
                ) : selectedFilter.type === 'chroma_key' ? (
                  <>
                    <label className="filter-property-row">
                      <span>Key Color</span>
                      <div className="filter-control-row">
                        <input
                          type="color"
                          aria-label="Chroma key color"
                          value={String(selectedFilter.params?.color ?? '#00ff00')}
                          onChange={(event) => handleCommitFilterColor(selectedFilter, event.target.value).catch((error) => setStatus(String(error)))}
                        />
                      </div>
                    </label>
                    {renderFilterParamSlider(selectedFilter, 'similarity', 'Similarity')}
                    {renderFilterParamSlider(selectedFilter, 'smoothness', 'Smoothness')}
                    {renderFilterParamSlider(selectedFilter, 'spill', 'Spill Reduction')}
                  </>
                ) : (
                  <label className="filter-property-row">
                    <span>Amount</span>
                    <div className="filter-control-row">
                      <input
                        type="range"
                        aria-label={`${selectedFilter.type} amount`}
                        draggable={false}
                        min={filterDisplayRangeConfig(selectedFilter).min}
                        max={filterDisplayRangeConfig(selectedFilter).max}
                        step={filterDisplayRangeConfig(selectedFilter).step}
                        value={defaultFilterAmount(selectedFilter) * filterAmountScale(selectedFilter)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onDragStart={(event) => event.preventDefault()}
                        onChange={(event) => {
                          const displayAmount = Number(event.target.value)
                          handleFilterAmountDraft(selectedFilter, displayAmount.toFixed(filterAmountPrecision(selectedFilter)))
                          handleCommitFilterAmount(selectedFilter, displayAmount / filterAmountScale(selectedFilter)).catch((error) => setStatus(String(error)))
                        }}
                      />
                      <input
                        className="filter-number-input"
                        type="number"
                        aria-label={`${selectedFilter.type} amount value`}
                        draggable={false}
                        min={filterDisplayRangeConfig(selectedFilter).min}
                        max={filterDisplayRangeConfig(selectedFilter).max}
                        step={filterDisplayRangeConfig(selectedFilter).step}
                        value={filterAmountDrafts[selectedFilter.id] ?? formatFilterAmountInput(selectedFilter)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onDragStart={(event) => event.preventDefault()}
                        onChange={(event) => handleFilterAmountDraft(selectedFilter, event.target.value)}
                        onBlur={() => commitFilterAmountDraft(selectedFilter)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur()
                          }
                        }}
                      />
                      <span className="filter-unit">{filterAmountUnit(selectedFilter)}</span>
                    </div>
                    <small className="filter-value">{formatFilterAmount(selectedFilter)}</small>
                  </label>
                )}
                {selectedFilter.type === 'hdr_to_sdr_lut' && (
                  <>
                    {renderHdrFilterSlider(selectedFilter, 'saturation', 'Saturation')}
                    {renderHdrFilterSlider(selectedFilter, 'brightness', 'Brightness')}
                    {renderHdrFilterSlider(selectedFilter, 'hue', 'Hue')}
                    <label className="filter-property-row">
                      <span>Path</span>
                      <input
                        value={String(selectedFilter.params?.path ?? '')}
                        placeholder="Built-in HDR→SDR LUT"
                        onChange={(event) => {
                          if (!effectiveFilterTarget) return
                          const params = { ...(selectedFilter.params ?? {}), amount: defaultFilterAmount(selectedFilter), path: event.target.value }
                          const update = effectiveFilterTarget.kind === 'scene'
                            ? updateSceneFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                            : updateFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                          update.then(() => setStatus('Updated LUT path')).catch((error) => setStatus(String(error)))
                        }}
                      />
                    </label>
                  </>
                )}
                {selectedFilter.type === 'lut' && (
                  <label className="filter-property-row">
                    <span>Path</span>
                    <input
                      value={String(selectedFilter.params?.path ?? '')}
                      placeholder="/path/to/filter.cube"
                      onChange={(event) => {
                        if (!effectiveFilterTarget) return
                        const params = { ...(selectedFilter.params ?? {}), amount: defaultFilterAmount(selectedFilter), path: event.target.value }
                        const update = effectiveFilterTarget.kind === 'scene'
                          ? updateSceneFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                          : updateFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                        update.then(() => setStatus('Updated LUT path')).catch((error) => setStatus(String(error)))
                      }}
                    />
                  </label>
                )}
              </>
            ) : (
              <div className="filter-empty properties-empty">Select or add an effect filter.</div>
            )}
          </div>
        </div>
      </>
    )
  }

  function renderFiltersDialog() {
    if (!filtersOpen) return null
    return (
      <div className="settings-overlay" onClick={() => setFiltersOpen(false)}>
        <div className="settings-dialog filters-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>Effect Filters</h2>
            <button onClick={() => setFiltersOpen(false)}>X</button>
          </div>
          <div className="settings-content">
            <nav className="settings-sidebar filters-source-sidebar" aria-label="Filter source selection">
              <div className="ctx-group-label">Scenes</div>
              {sceneEntries.map((scene) => (
                <button
                  key={scene.id}
                  className={effectiveFilterTarget?.kind === 'scene' && effectiveFilterTarget.id === scene.id ? 'active' : ''}
                  onClick={() => {
                    setFilterTarget({ kind: 'scene', id: scene.id })
                    setSelectedFilterId(null)
                  }}
                >
                  {scene.name}
                </button>
              ))}
              <div className="ctx-group-label">Sources</div>
              {sourceEntries.map((source) => (
                <button
                  key={source.id}
                  className={effectiveFilterTarget?.kind !== 'scene' && activeFilterSource?.id === source.id ? 'active' : ''}
                  onClick={() => {
                    setFilterTarget({ kind: 'source', id: source.id })
                    selectSource(source.id)
                    setSelectedFilterId(null)
                  }}
                >
                  {source.name}
                </button>
              ))}
            </nav>
            <div className="settings-body filters-body">
              {renderFilterEditor()}
            </div>
          </div>
          <div className="settings-footer">
            <button className="btn-primary" onClick={() => setFiltersOpen(false)}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  function renderDock(panel: DockPanel) {
    if (panel === 'scenes') {
      return (
        <>
          <div className="panel-title-row"><h2>Scenes</h2><button onClick={() => handleCreateScene().catch((error) => setStatus(String(error)))}>+ Scene</button></div>
          <div className="list-panel compact">
            {sceneEntries.map((scene) => (
              <div
                key={scene.id}
                className={`list-item row-item ${scene.id === state.activeSceneId ? 'active' : ''} ${scene.id === state.previewSceneId ? 'preview' : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setSceneContextMenu({ x: event.clientX, y: event.clientY, sceneId: scene.id })
                }}
              >
                <button
                  className={scene.id === state.activeSceneId ? 'list-item-action active' : 'list-item-action'}
                  onClick={() => setActiveScene(scene.id, 'trans-fade').then(() => setStatus(`Active scene: ${scene.name}`)).catch((error) => setStatus(String(error)))}
                >
                  <span>{scene.name}</span>
                  <small>{scene.id}{scene.id === state.previewSceneId && scene.id !== state.activeSceneId ? ' · preview' : ''}</small>
                </button>
                <button onClick={() => setPreviewScene(scene.id).then(() => setStatus(`Preview scene: ${scene.name}`)).catch((error) => setStatus(String(error)))} disabled={scene.id === state.previewSceneId}>
                  Preview
                </button>
                <button onClick={() => removeScene(scene.id).then(() => setStatus(`Removed scene: ${scene.name}`)).catch((error) => setStatus(String(error)))} disabled={sceneEntries.length <= 1}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )
    }

    if (panel === 'sources') {
      return (
        <>
          <div className="panel-title-row"><h2>Sources</h2><button onClick={() => handleOpenSourceCatalog().catch((error) => setStatus(String(error)))}>+ Source</button></div>
          <div className="list-panel compact">
            {sourcePanelEntries.map((source) => {
              if (state.editingSourceId === source.id) {
                return (
                  <div key={source.id} className="source-edit-form">
                    <div className="source-create-row">
                      <label>Name</label>
                      <input value={sourceEditName} onChange={(e) => setSourceEditName(e.target.value)} />
                    </div>
                    <div className="source-create-row">
                      <label>Enabled</label>
                      <input type="checkbox" checked={sourceEditEnabled} onChange={(e) => setSourceEditEnabled(e.target.checked)} />
                    </div>
                    {(() => {
                      const src = source as any
                      const kindId = src.type
                      const kind = sourceKinds.find((k) => k.id === kindId)
                      if (!kind || (kind.fields ?? []).length === 0) return null
                      return (kind.fields ?? []).map((field) => (
                        <div key={field.key} className="source-create-row">
                          <label>{field.label}</label>
                          {renderSourceFieldInput(field, sourceEditConfig, setSourceEditConfig)}
                        </div>
                      ))
                    })()}
                    {(source as any).state === 'running' && (
                      <div className="source-edit-notice">Changes to config may require restarting the source to take effect</div>
                    )}
                    <div className="button-row">
                      <button onClick={async () => {
                        const patch: Record<string, unknown> = { name: sourceEditName, enabled: sourceEditEnabled }
                        if (Object.keys(sourceEditConfig).length > 0) patch.config = sourceEditConfig
                        await updateSource(source.id, patch as any).catch((e) => setStatus(String(e)))
                        setEditingSourceId(null)
                        setStatus(`Updated source: ${sourceEditName}`)
                      }}>Save</button>
                      <button onClick={() => setEditingSourceId(null)}>Cancel</button>
                    </div>
                  </div>
                )
              }
              const activeScene = state.activeSceneId ? (state.scenes as Record<string, any>)[state.activeSceneId] : null
              const sceneItemForSource = (activeScene?.items as any[])?.find((it: any) => it.source_id === source.id)
              const sourceVisibleInScene = sceneItemForSource?.visible !== false
              return (
                <div
                  key={source.id}
                  className={`list-item source-item ${activeSourceId === source.id ? 'active' : ''} ${!sceneItemForSource ? 'source-not-in-scene' : ''} ${sceneItemForSource && !sourceVisibleInScene ? 'source-hidden-in-scene' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    selectSource(source.id)
                    setSourceContextMenu({ x: event.clientX, y: event.clientY, sourceId: source.id })
                  }}
                >
                  <div className="source-item-header source-item-selectable" onClick={() => {
                    selectSource(source.id)
                  }}>
                    <span>{source.name}</span>
                    <small>{(source as any).type} · {source.state}</small>
                  </div>
                  <div className="button-row compact-row">
                    <button className="visibility-btn" title={sceneItemForSource ? (sourceVisibleInScene ? 'Hide in scene' : 'Show in scene') : 'Add to scene'} onClick={async () => {
                      if (!state.activeSceneId) return
                      if (sceneItemForSource) {
                        await updateSceneItem(state.activeSceneId, sceneItemForSource.id, { visible: !sourceVisibleInScene }).catch((e) => setStatus(String(e)))
                        selectSource(source.id)
                      } else {
                        await addSceneItem(state.activeSceneId, source.id).catch((e) => setStatus(String(e)))
                      }
                    }}>
                      {sceneItemForSource ? (sourceVisibleInScene ? 'Hide' : 'Show') : 'Add'}
                    </button>
                    <button className="source-order-btn" title="Move layer up" disabled={!sceneItemForSource} onClick={() => moveSourceInActiveScene(source.id, 'up').catch((error) => setStatus(String(error)))}>
                      Up
                    </button>
                    <button className="source-order-btn" title="Move layer down" disabled={!sceneItemForSource} onClick={() => moveSourceInActiveScene(source.id, 'down').catch((error) => setStatus(String(error)))}>
                      Down
                    </button>
                    <button onClick={() => {
                      openSourceEditor(source).catch((error) => setStatus(String(error)))
                    }}>
                      Edit
                    </button>
                    <button onClick={() => handleRenameSource(source.id, source.name).catch((error) => setStatus(String(error)))}>
                      Rename
                    </button>
                    <button onClick={() => removeSource(source.id).then(() => setStatus(`Removed source: ${source.name}`)).catch((error) => setStatus(String(error)))}>
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )
    }

    if (panel === 'controls') {
      return (
        <>
          <div className="panel-title-row"><h2>Controls</h2></div>
            <div className="control-column">
              <button onClick={() => handleCreateOutput().catch((error) => setStatus(String(error)))}>+ Output</button>
              {outputEntries.map((output: any) => {
                return (
                  <div key={output.id} className="output-card">
                    <div className="output-card-header">
                      <span className={`output-state-dot ${output.state === 'running' ? 'running' : 'stopped'}`} />
                      <strong>{output.name || output.id}</strong>
                      <small>{output.state}</small>
                    </div>
                    <div className="button-row compact-row">
                      <button onClick={() => runCommand(`output ${output.state === 'running' ? 'stop' : 'start'} ${output.id}`).then(() => setStatus(`${output.id} toggled`)).catch((error) => setStatus(String(error)))}>
                        {output.state === 'running' ? 'Stop' : 'Start'}
                      </button>
                      <button onClick={() => openOutputTransport(output)}>
                        Settings
                      </button>
                      <button onClick={() => removeOutput(output.id).then(() => setStatus(`Removed output: ${output.name}`)).catch((error) => setStatus(String(error)))}>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => refreshState().then(() => setStatus('State refreshed')).catch((error) => setStatus(String(error)))}>Refresh State</button>
              <button onClick={() => resetWorkspaceLayout()}>Reset Layout</button>
            </div>
          </>
        )
    }

    if (panel === 'mixer') {
      const audioInfo = state.audio as any
      const masterLevel = state.audio.levels.master ?? {}
      const masterLevelPct = audioMeterPercent(masterLevel.level_db)
      const masterPeakPct = audioMeterPercent(masterLevel.peak_db)
      const activeScene = state.activeSceneId ? (state.scenes as Record<string, any>)[state.activeSceneId] : null
      const mixerEntries = (activeSceneItemsTopToBottom.length > 0 ? activeSceneItemsTopToBottom : activeSceneItems).map((item: any) => ({
        item,
        source: (state.sources as Record<string, any>)[item.source_id],
      })).filter((entry: any) => entry.source)
      return (
        <>
          <div className="panel-title-row"><h2>Audio Mixer</h2><small>{state.audio.device || 'hw:0,2'}</small></div>
          <div className="audio-mixer-panel">
            <div className="audio-device-summary">
              <div>
                <strong>{activeScene?.name ?? 'Active Scene'} Mixer</strong>
                <small>{audioInfo.backend ?? 'audio'} · scene-scoped controls · {state.audio.device || 'hw:0,2'}</small>
              </div>
              <div className="audio-summary-actions">
                <button className={previewPlaybackEnabled ? 'active' : ''} onClick={() => setPreviewPlaybackEnabled((enabled) => !enabled)}>
                  Preview audio {previewPlaybackEnabled ? 'on' : 'off'}
                </button>
                <span className={audioInfo.hifi?.available ? 'audio-status-pill live' : 'audio-status-pill'}>
                  {audioInfo.hifi?.available ? 'HiFi bridge ready' : 'Audio bridge unknown'}
                </span>
              </div>
            </div>
            <div className="obs-audio-mixer">
              {mixerEntries.map(({ item, source }: any) => {
                const audio = audioStateForSceneItem(item, source)
                const meter = state.audio.levels.sources[source.id] ?? {}
                const levelPct = audioMeterPercent(meter.level_db)
                const peakPct = audioMeterPercent(meter.peak_db)
                const enabled = audio.enabled !== false
                const muted = Boolean(audio.mute || meter.effective_mute)
                const active = Boolean(meter.active_in_scene)
                const setAudio = (patch: Record<string, unknown>) => updateSceneItemAudio(state.activeSceneId || '', item, source, patch)
                return (
                  <div key={item.id} className={`obs-audio-strip ${enabled ? 'enabled' : 'disabled'} ${muted ? 'muted' : ''}`}>
                    <div className="obs-audio-scope">{active ? 'Active' : 'Scene'}</div>
                    <button className="obs-audio-name" title={source.name} onClick={() => selectSceneItem(item.id)}>
                      {source.name}
                    </button>
                    <div className="obs-audio-db">{formatAudioDb(meter.level_db)}</div>
                    <div className="obs-audio-body">
                      <input
                        className="obs-volume-fader"
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={Number(audio.volume ?? 1)}
                        onChange={(event) => setAudio({ volume: Number(event.target.value), enabled: true, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(`Audio updated: ${source.name}`)).catch((error) => setStatus(String(error)))}
                        aria-label={`${source.name} volume`}
                      />
                      <div className="obs-meter-wrap">
                        <div className="obs-meter-track" aria-label={`${source.name} audio level`}>
                          <div className="obs-meter-fill" style={{ height: `${levelPct}%` }} />
                          <div className="obs-meter-peak" style={{ bottom: `${peakPct}%` }} />
                        </div>
                        <div className="obs-meter-scale"><span>0</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-30</span><span>-36</span><span>-42</span><span>-48</span><span>-54</span><span>-60</span></div>
                      </div>
                    </div>
                    <div className="obs-audio-buttons">
                      <button className={enabled ? 'active' : ''} onClick={() => setAudio({ enabled: !enabled, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(`Audio ${enabled ? 'off' : 'on'}: ${source.name}`)).catch((error) => setStatus(String(error)))}>{enabled ? 'On' : 'Off'}</button>
                      <button className={!muted ? 'active' : ''} disabled={!enabled} onClick={() => setAudio({ mute: !audio.mute, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(`Audio ${audio.mute ? 'unmuted' : 'muted'}: ${source.name}`)).catch((error) => setStatus(String(error)))}>{audio.mute ? 'Muted' : 'Mute'}</button>
                      <button className={audio.monitor ? 'active' : ''} disabled={!enabled} onClick={() => setAudio({ monitor: !audio.monitor, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(`Preview playback ${audio.monitor ? 'off' : 'on'}: ${source.name}`)).catch((error) => setStatus(String(error)))}>{audio.monitor ? 'Preview' : 'No Prev'}</button>
                    </div>
                  </div>
                )
              })}
              <div className={`obs-audio-strip master-channel ${state.audio.master_mute ? 'muted' : ''}`}>
                <div className="obs-audio-scope">Global</div>
                <div className="obs-audio-name static">Master</div>
                <div className="obs-audio-db">{formatAudioDb(masterLevel.level_db)}</div>
                <div className="obs-audio-body">
                  <input
                    className="obs-volume-fader"
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={state.audio.master_volume}
                    onChange={(event) => setMasterAudio(Number(event.target.value), state.audio.master_mute).then(() => setStatus('Master audio updated')).catch((error) => setStatus(String(error)))}
                    aria-label="Master volume"
                  />
                  <div className="obs-meter-wrap">
                    <div className="obs-meter-track" aria-label="Master audio level">
                      <div className="obs-meter-fill" style={{ height: `${masterLevelPct}%` }} />
                      <div className="obs-meter-peak" style={{ bottom: `${masterPeakPct}%` }} />
                    </div>
                    <div className="obs-meter-scale"><span>0</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-30</span><span>-36</span><span>-42</span><span>-48</span><span>-54</span><span>-60</span></div>
                  </div>
                </div>
                <div className="obs-audio-buttons">
                  <button className={!state.audio.master_mute ? 'active' : ''} onClick={() => setMasterAudio(state.audio.master_volume, !state.audio.master_mute).then(() => setStatus('Master mute toggled')).catch((error) => setStatus(String(error)))}>
                    {state.audio.master_mute ? 'Muted' : 'Mute'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )
    }

    if (panel === 'transitions') {
      return (
        <>
          <div className="panel-title-row"><h2>Scene Transition</h2></div>
          <div className="transition-box">
            <div className="transition-pill">Fade</div>
            <label className="source-create-row">
              <span>Duration</span>
              <input
                type="number"
                min="0"
                max="10000"
                step="100"
                value={fadeDurationMs}
                onChange={(event) => setFadeDurationMs(event.target.value)}
              />
            </label>
            <button
              onClick={() => updateTransition('trans-fade', Math.max(0, Number(fadeDurationMs) || 0)).then(() => setStatus(`Fade duration: ${Math.max(0, Number(fadeDurationMs) || 0)} ms`)).catch((error) => setStatus(String(error)))}
            >
              Apply Fade Duration
            </button>
            <small>Program: {activeScene?.name ?? 'None'}</small>
            <small>Preview: {previewScene?.name ?? 'None'}</small>
            {state.transitionActive && (
              <small>Transitioning: {Math.round(state.transitionProgress * 100)}%</small>
            )}
            <div className="button-row compact-row">
              <button
                disabled={!state.previewSceneId || state.previewSceneId === state.activeSceneId}
                onClick={() => transitionToPreview('trans-fade').then(() => setStatus('Transitioned to preview')).catch((error) => setStatus(String(error)))}
              >
                Transition
              </button>
              <button
                disabled={!state.previewSceneId || state.previewSceneId === state.activeSceneId}
                onClick={() => state.previewSceneId && setActiveScene(state.previewSceneId, 'trans-cut').then(() => setStatus('Cut to preview')).catch((error) => setStatus(String(error)))}
              >
                Cut
              </button>
            </div>
          </div>
        </>
      )
    }

    return null
  }

  function renderDockSlot(slot: DockSlot) {
    const panel = dockLayout[slot]
    return (
      <section
        className="panel obs-dock draggable-dock"
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes(DOCK_DRAG_MIME)) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          if (!Array.from(event.dataTransfer.types).includes(DOCK_DRAG_MIME)) {
            setDragPanel(null)
            return
          }
          event.preventDefault()
          movePanel(slot)
          setDragPanel(null)
        }}
        data-panel={panel}
      >
        <div
          className="dock-handle"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData(DOCK_DRAG_MIME, panel)
            setDragPanel(panel)
          }}
          onDragEnd={() => setDragPanel(null)}
        >Drag</div>
        {renderDock(panel)}
      </section>
    )
  }

  useEffect(() => {
    const video = document.getElementById('preview-video') as HTMLVideoElement | null
    if (!video) {
      return
    }

    /* When using WebRTC, the video srcObject is managed by the store's
     * RTCPeerConnection ontrack handler. Don't touch the element here. */
    if (state.selectedPreviewProfile?.transport === 'webrtc') {
      return
    }

    let hls: Hls | null = null
    if (state.previewUrl) {
      if (state.previewUrl.endsWith('.m3u8') && Hls.isSupported()) {
        hls = new Hls({
          lowLatencyMode: false,
          liveSyncDurationCount: 3,
          liveBackBufferLength: 0,
          maxBufferLength: 10,
          maxMaxBufferLength: 30,
          liveDurationInfinity: true,
        })
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setStatus(`Preview: network error, retrying...`)
                hls?.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                setStatus(`Preview: media error, recovering...`)
                hls?.recoverMediaError()
                break
              default:
                setStatus(`Preview: fatal error (${data.details})`)
                hls?.destroy()
                break
            }
          }
        })
        hls.loadSource(state.previewUrl)
        hls.attachMedia(video)
      } else {
        video.src = state.previewUrl
      }
    } else {
      video.removeAttribute('src')
      video.load()
    }
    return () => {
      if (hls) {
        hls.destroy()
      }
    }
  }, [state.previewUrl, state.selectedPreviewProfile?.transport])

  useEffect(() => {
    const video = document.getElementById('preview-video') as HTMLVideoElement | null
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('sbs-preview-audio-playback', previewPlaybackEnabled ? 'on' : 'off')
    }
    if (video) {
      video.muted = !previewPlaybackEnabled
      video.volume = previewPlaybackEnabled ? 1 : 0
    }
  }, [previewPlaybackEnabled, state.previewUrl])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return
      }

      if (event.key >= '1' && event.key <= '9') {
        const scene = sceneEntries[Number(event.key) - 1]
        if (!scene) {
          return
        }
        event.preventDefault()
        runCommand(`scene set-active ${scene.id}`).then(() => setStatus(`Active scene: ${scene.name}`)).catch((error) => setStatus(String(error)))
        return
      }

      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        togglePreview().catch((error) => setStatus(String(error)))
        return
      }

      if ((event.key === 's' || event.key === 'S') && event.shiftKey) {
        event.preventDefault()
        captureSnapshot().then((snapshot) => setStatus(`Snapshot captured: ${snapshot.id}`)).catch((error) => setStatus(String(error)))
        return
      }

      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        refreshState().then(() => setStatus('State refreshed')).catch((error) => setStatus(String(error)))
      }

      if (event.key === 'Escape') {
        setContextMenu(null)
        setSourceContextMenu(null)
        setSceneContextMenu(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewController, sceneEntries])

  return (
    <div className="app-shell">
      <header className="obs-topbar">
        <div className="obs-brand">
          <strong>SBS Studio</strong>
          <span>{headerStatus}</span>
        </div>
        <div className="obs-top-actions">
          <div className="instance-dropdown">
            <button
              id="instance-trigger"
              className={`instance-trigger ${instancePanelOpen ? 'active' : ''}`}
              onClick={() => setInstancePanelOpen((v) => !v)}
            >
              <span className="instance-trigger-label">Instance</span>
              <span className="instance-trigger-name">{currentInstance?.name ?? 'Unknown'}</span>
              <span className={`instance-trigger-status ${currentInstance?.running ? 'running' : 'stopped'}`} />
            </button>
            {instancePanelOpen && (
              <div id="instance-panel" className="instance-panel">
                <div className="instance-panel-header">
                  <span>Instances</span>
                  <button className="instance-panel-create" onClick={() => handleCreateInstance().catch((error) => setStatus(String(error)))}>+ New</button>
                </div>
                <div className="instance-panel-list">
                  {state.instances.map((inst) => (
                    <button
                      key={inst.instance_id}
                      className={`instance-panel-item ${inst.instance_id === state.instanceId ? 'selected' : ''} ${!inst.running ? 'disabled' : ''}`}
                      onClick={() => { setInstancePanelOpen(false); switchToInstance(inst.instance_id) }}
                    >
                      <span className={`instance-status-dot ${inst.running ? 'running' : 'stopped'}`} />
                      <span className="instance-panel-item-name">{inst.name}</span>
                      <small className="instance-panel-item-id">#{inst.instance_id}</small>
                    </button>
                  ))}
                </div>
                {currentInstance && (
                  <div className="instance-panel-actions">
                    <button onClick={() => handleRenameInstance().catch((error) => setStatus(String(error)))}>Rename</button>
                    <button onClick={() => handleRestartInstance().catch((error) => setStatus(String(error)))}>Restart</button>
                    <button onClick={() => handleToggleInstanceEnabled().catch((error) => setStatus(String(error)))}>
                      {currentInstance.desired_running ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDeleteInstance().catch((error) => setStatus(String(error)))}
                      disabled={currentInstance.instance_id === 0}
                      className="instance-delete-btn"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="obs-stat">Inst {state.instanceId}</span>
          <span className={`obs-stat ${state.connectionState === 'error' ? 'warn' : ''}`}>API {state.connectionState}</span>
          <span className={`obs-stat ${fpsWarn ? 'warn' : ''}`} title={fpsTitle}>FPS {displayFps}/{targetFps}</span>
          <span className="obs-stat">Bitrate {Math.round(state.telemetry.bitrateKbps)} kbps</span>
          <span className="obs-stat">Latency {Math.round(state.telemetry.latencyMs)} ms</span>
          <button className="settings-btn" onClick={() => openSettings()}>Settings</button>
        </div>
      </header>

      <main
        className="obs-layout"
        style={{
          ['--obs-left-width' as string]: `${dockSizes.leftWidth}px`,
          ['--obs-right-width' as string]: `${dockSizes.rightWidth}px`,
          ['--obs-bottom-height' as string]: `${dockSizes.bottomHeight}px`,
          ['--obs-left-top-ratio' as string]: `${dockSizes.leftTopRatio}fr`,
          ['--obs-left-bottom-ratio' as string]: `${1 - dockSizes.leftTopRatio}fr`,
          ['--obs-bottom-left-ratio' as string]: `${dockSizes.bottomLeftRatio}fr`,
          ['--obs-bottom-right-ratio' as string]: `1fr`,
        }}
      >
        <aside className="obs-left-stack">
          {renderDockSlot('left-top')}
          <div className="resize-handle horizontal" onMouseDown={() => setActiveResize('leftTopRatio')} />
          {renderDockSlot('left-bottom')}
        </aside>

        <div className="resize-handle vertical left-edge" onMouseDown={() => setActiveResize('leftWidth')} />

        <section className="obs-center-stage">
          <div className="obs-stage-toolbar">
            <div className="obs-stage-title">Program</div>
            <div className="button-row">
              <button
                onClick={() => togglePreview().catch((error) => setStatus(String(error)))}
              >
                {previewController ? 'Stop Preview' : 'Start Preview'}
              </button>
              <button onClick={() => captureSnapshot().then((snapshot) => setStatus(`Snapshot captured: ${snapshot.id}`)).catch((error) => setStatus(String(error)))}>
                Snapshot
              </button>
            </div>
          </div>

          <div className="obs-preview-wrapper panel" ref={previewWrapperRef}>
            <div className="preview-screen obs-preview-screen">
              <video id="preview-video" autoPlay playsInline />
              <div
                className="source-overlay"
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  const target = e.target as HTMLElement
                  if (target.classList.contains('resize-handle')) return
                  if (target.classList.contains('source-bbox')) {
                    const itemId = target.dataset.itemId!
                    selectSceneItem(itemId)
                    const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                    if (!scene) return
                    const item = (scene.items as any[])?.find((it: any) => it.id === itemId)
                    if (!item) return
                    dragRef.current = {
                      type: 'move',
                      itemId,
                      startMouseX: e.clientX,
                      startMouseY: e.clientY,
                      startPositonX: item.transform?.position_x ?? 0,
                      startPositonY: item.transform?.position_y ?? 0,
                      startWidth: item.transform?.width ?? 640,
                      startHeight: item.transform?.height ?? 360,
                    }
                    e.preventDefault()
                  } else {
                    selectSceneItem(null)
                    setContextMenu(null)
                  }
                }}
                onMouseMove={(e) => {
                  const drag = dragRef.current
                  if (!drag) return
                  const pr = getPreviewRect()
                  if (!pr) return
                  const dx = e.clientX - drag.startMouseX
                  const dy = e.clientY - drag.startMouseY
                  const sx = canvasW / pr.width
                  const sy = canvasH / pr.height
                  const bbox = document.querySelector(`.source-bbox[data-item-id="${drag.itemId}"]`) as HTMLElement | null
                  if (drag.type === 'move') {
                    let newPx = drag.startPositonX + dx * sx
                    let newPy = drag.startPositonY + dy * sy
                    let newW = drag.startWidth
                    let newH = drag.startHeight
                    const snapped = snapToCanvas(newPx, newPy, newW, newH)
                    if (bbox) {
                      const mapped = canvasToPreview(snapped.px, snapped.py, newW, newH)
                      bbox.style.left = mapped.x + 'px'
                      bbox.style.top = mapped.y + 'px'
                    }
                    dragRef.current = { ...drag, _newPx: snapped.px, _newPy: snapped.py } as any
                  } else if (drag.type === 'resize' && drag.handle) {
                    const h = drag.handle
                    let newPx = drag.startPositonX
                    let newPy = drag.startPositonY
                    let newW = drag.startWidth
                    let newH = drag.startHeight
                    const dxC = dx * sx
                    const dyC = dy * sy

                    if (h.includes('e')) newW = Math.max(MIN_SIZE, drag.startWidth + dxC)
                    if (h.includes('w')) { newW = Math.max(MIN_SIZE, drag.startWidth - dxC); newPx = drag.startPositonX + drag.startWidth - newW }
                    if (h.includes('n')) { newH = Math.max(MIN_SIZE, drag.startHeight - dyC); newPy = drag.startPositonY + drag.startHeight - newH }
                    if (h.includes('s')) newH = Math.max(MIN_SIZE, drag.startHeight + dyC)

                    const snapped = snapToCanvas(newPx, newPy, newW, newH)
                    if (bbox) {
                      const mapped = canvasToPreview(snapped.px, snapped.py, snapped.w, snapped.h)
                      bbox.style.left = mapped.x + 'px'
                      bbox.style.top = mapped.y + 'px'
                      bbox.style.width = mapped.w + 'px'
                      bbox.style.height = mapped.h + 'px'
                    }
                    dragRef.current = { ...drag, _newPx: snapped.px, _newPy: snapped.py, _newW: snapped.w, _newH: snapped.h } as any
                  }
                }}
                onMouseUp={async () => {
                  const drag = dragRef.current
                  if (!drag) return
                  dragRef.current = null
                  const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                  if (!scene) return
                  const item = (scene.items as any[])?.find((it: any) => it.id === drag.itemId)
                  if (!item) return
                  if (drag.type === 'move') {
                    const d = drag as any
                    const newPx = d._newPx ?? drag.startPositonX
                    const newPy = d._newPy ?? drag.startPositonY
                    await updateSceneItemTransform(state.activeSceneId!, drag.itemId, {
                      ...item.transform,
                      position_x: Math.round(newPx),
                      position_y: Math.round(newPy),
                    }).catch(() => {})
                  } else if (drag.type === 'resize') {
                    const d = drag as any
                    const newPx = d._newPx ?? drag.startPositonX
                    const newPy = d._newPy ?? drag.startPositonY
                    const newW = d._newW ?? drag.startWidth
                    const newH = d._newH ?? drag.startHeight
                    await updateSceneItemTransform(state.activeSceneId!, drag.itemId, {
                      ...item.transform,
                      position_x: Math.round(newPx),
                      position_y: Math.round(newPy),
                      width: Math.round(newW),
                      height: Math.round(newH),
                    }).catch(() => {})
                  }
                }}
                onContextMenu={(e) => {
                  const target = e.target as HTMLElement
                  const bbox = target.closest('.source-bbox') as HTMLElement | null
                  if (bbox) {
                    e.preventDefault()
                    const itemId = bbox.dataset.itemId!
                    selectSceneItem(itemId)
                    setContextMenu({ x: e.clientX, y: e.clientY, itemId })
                  }
                }}
                onTouchStart={(e) => {
                  const target = e.target as HTMLElement
                  if (target.classList.contains('resize-handle')) return
                  const bbox = target.closest('.source-bbox') as HTMLElement | null
                  if (bbox) {
                    const itemId = bbox.dataset.itemId!
                    const touch = e.touches[0]
                     longPressRef.current = { timer: window.setTimeout(() => {
                       selectSceneItem(itemId)
                       setContextMenu({ x: touch.clientX, y: touch.clientY, itemId })
                       longPressRef.current = null
                     }, 500), itemId, x: touch.clientX, y: touch.clientY }
                  }
                }}
                onTouchMove={() => {
                  if (longPressRef.current) {
                    clearTimeout(longPressRef.current.timer)
                    longPressRef.current = null
                  }
                }}
                onTouchEnd={() => {
                  if (longPressRef.current) {
                    clearTimeout(longPressRef.current.timer)
                    longPressRef.current = null
                  }
                }}
              >
                {(() => {
                  const scene = state.activeSceneId ? (state.scenes as Record<string, any>)[state.activeSceneId] : null
                  if (!scene?.items) return null
                  return (scene.items as any[]).map((item: any) => {
                    if (!item.visible) return null
                    const t = item.transform || {}
                    const mapped = canvasToPreview(t.position_x || 0, t.position_y || 0, t.width || 640, t.height || 360)
                    const isSelected = state.selectedSceneItemId === item.id
  function startResize(e: React.MouseEvent, handle: string) {
    if (!state.selectedSceneItemId || !state.activeSceneId) return
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const item = (scene?.items as any[])?.find((it: any) => it.id === state.selectedSceneItemId)
    if (!item) return
    dragRef.current = {
      type: 'resize',
      itemId: state.selectedSceneItemId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPositonX: item.transform?.position_x ?? 0,
      startPositonY: item.transform?.position_y ?? 0,
      startWidth: item.transform?.width ?? 640,
      startHeight: item.transform?.height ?? 360,
      handle,
    }
    e.preventDefault()
  }

  return (
                      <div
                        key={item.id}
                        className={`source-bbox ${isSelected ? 'source-bbox--selected' : ''}`}
                        data-item-id={item.id}
                        style={{ left: mapped.x, top: mapped.y, width: mapped.w, height: mapped.h }}
                      >
                        {isSelected && (
                          <>
                            <div className="bbox-rh rh-nw" data-dir="nw" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'nw') }} />
                            <div className="bbox-rh rh-n" data-dir="n" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'n') }} />
                            <div className="bbox-rh rh-ne" data-dir="ne" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'ne') }} />
                            <div className="bbox-rh rh-e" data-dir="e" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'e') }} />
                            <div className="bbox-rh rh-se" data-dir="se" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'se') }} />
                            <div className="bbox-rh rh-s" data-dir="s" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 's') }} />
                            <div className="bbox-rh rh-sw" data-dir="sw" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'sw') }} />
                            <div className="bbox-rh rh-w" data-dir="w" onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'w') }} />
                          </>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
              <div className="preview-overlay">
                <strong>{state.previewStatus.toUpperCase()}</strong>
                <span>{state.previewMessage}</span>
                {state.selectedPreviewProfile ? (
                  <span>{state.selectedPreviewProfile.id} · {state.selectedPreviewProfile.codec.toUpperCase()} · {state.selectedPreviewProfile.transport.toUpperCase()}</span>
                ) : null}
                {state.lastSnapshot ? (
                  <a href={state.lastSnapshot.url} target="_blank" rel="noreferrer">Open Snapshot</a>
                ) : null}
              </div>
            </div>
          </div>

          {contextMenu && (
            <div
              className="preview-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ctx-group-label">Transform</div>
              <button onClick={async () => { await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { position_x: 0, position_y: 0, width: 640, height: 360 }).catch(() => {}); setContextMenu(null) }}>Reset Transform</button>
              <button onClick={async () => { await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { position_x: 0, position_y: 0, width: canvasW, height: canvasH }).catch(() => {}); setContextMenu(null) }}>Fit to Screen</button>
              <button onClick={async () => {
                const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                const item = (scene?.items as any[])?.find((i: any) => i.id === contextMenu.itemId)
                if (item?.transform) {
                  const t = item.transform
                  await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { ...t, position_x: Math.round((canvasW - (t.width || 640)) / 2), position_y: Math.round((canvasH - (t.height || 360)) / 2) }).catch(() => {})
                }
                setContextMenu(null)
              }}>Center on Canvas</button>
              <div className="ctx-separator" />
              <div className="ctx-group-label">Order</div>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'top').catch(() => {}); setContextMenu(null) }}>Move to Top</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'up').catch(() => {}); setContextMenu(null) }}>Move Up</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'down').catch(() => {}); setContextMenu(null) }}>Move Down</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'bottom').catch(() => {}); setContextMenu(null) }}>Move to Bottom</button>
              <div className="ctx-separator" />
              <button onClick={async () => {
                const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                const item = (scene?.items as any[])?.find((i: any) => i.id === contextMenu.itemId)
                if (item) await updateSceneItem(state.activeSceneId!, contextMenu.itemId, { visible: !item.visible }).catch(() => {})
                setContextMenu(null)
              }}>Toggle Visibility</button>
              <button onClick={async () => { await removeSceneItem(state.activeSceneId!, contextMenu.itemId).catch(() => {}); selectSceneItem(null); setContextMenu(null) }}>Delete</button>
            </div>
          )}

          {sourceContextMenu && (() => {
            const source = (state.sources as Record<string, any>)[sourceContextMenu.sourceId]
            if (!source) return null
            return (
              <div
                className="preview-context-menu source-context-menu"
                style={{ left: sourceContextMenu.x, top: sourceContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ctx-group-label">Source</div>
                <button onClick={() => openSourceFilters(source.id)}>Effect Filters...</button>
                <div className="ctx-separator" />
                <button onClick={() => {
                  openSourceEditor(source).catch((error) => setStatus(String(error)))
                  setSourceContextMenu(null)
                }}>Edit Source</button>
                <button onClick={() => {
                  setSourceContextMenu(null)
                  handleRenameSource(source.id, source.name).catch((error) => setStatus(String(error)))
                }}>Rename</button>
              </div>
            )
          })()}

          {sceneContextMenu && (() => {
            const scene = (state.scenes as Record<string, any>)[sceneContextMenu.sceneId]
            if (!scene) return null
            return (
              <div
                className="preview-context-menu scene-context-menu"
                style={{ left: sceneContextMenu.x, top: sceneContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ctx-group-label">Scene</div>
                <button onClick={() => openSceneFilters(scene.id)}>Effect Filters...</button>
                <div className="ctx-separator" />
                <button onClick={() => {
                  setSceneContextMenu(null)
                  runCommand(`scene set-active ${scene.id}`).then(() => setStatus(`Active scene: ${scene.name}`)).catch((error) => setStatus(String(error)))
                }}>Make Active</button>
                <button onClick={() => {
                  setSceneContextMenu(null)
                  removeScene(scene.id).then(() => setStatus(`Removed scene: ${scene.name}`)).catch((error) => setStatus(String(error)))
                }} disabled={sceneEntries.length <= 1}>Delete</button>
              </div>
            )
          })()}
        </section>

        <div className="resize-handle vertical right-edge" onMouseDown={() => setActiveResize('rightWidth')} />

        <aside className="obs-right-controls">{renderDockSlot('right')}</aside>

        <section className="obs-bottom-row">
          {renderDockSlot('bottom-left')}
          <div className="resize-handle vertical bottom-split-one" onMouseDown={() => setActiveResize('bottomLeftRatio')} />
          {renderDockSlot('bottom-middle')}
        </section>

        <div className="resize-handle horizontal bottom-edge" onMouseDown={() => setActiveResize('bottomHeight')} />
      </main>

      <footer className="obs-statusbar">
        <div className="obs-status-items">
          <span>CPU {Math.round(state.telemetry.cpuUsage)}%</span>
          <span>GPU {Math.round(state.telemetry.gpuUsage)}%</span>
          <span>FPS {displayFps}/{targetFps}</span>
          <span>Latency {Math.round(state.telemetry.latencyMs)} ms</span>
          <span>{fpsWarn ? 'Pipeline Slow' : 'Pipeline Stable'}</span>
          <span>Shortcuts: 1-9 scenes, P preview, Shift+S snapshot, R refresh</span>
        </div>
        <div className="command-row obs-cli-row">
          <input value={command} onChange={(event) => setCommand(event.target.value)} />
          <button onClick={() => runCommand(command).then(() => setStatus(`Executed: ${command}`)).catch((error) => setStatus(String(error)))}>Run</button>
        </div>
      </footer>

      {renderSettingsDialog()}
      {renderSourcePickerDialog()}
      {renderSourceConfigDialog()}
      {renderFiltersDialog()}
    </div>
  )
}
