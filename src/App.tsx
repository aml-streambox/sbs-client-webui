import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import Hls from 'hls.js'
import { addFilter, addSceneFilter, addSceneItem, applyCanvas, captureSnapshot, connectStore, createApiKey, createInstance, createOutput, createScene, createSource, deleteApiKey, describeSourceKind, discoverALSA, discoverV4L2, disableInstance, enableInstance, exportConfigBundle, getEncoderConfig, getPreviewEncoderConfig, getState, importConfigBundle, listApiKeys, listSourceKinds, loginApiKey, loginAuth, logoutAuth, refreshState, removeFilter, removeInstance, removeOutput, removeScene, removeSceneFilter, removeSceneItem, removeSource, reorderSceneItems, restartInstance, runCommand, selectSceneItem, selectSource, setActiveScene, setEditingSourceId, setMasterAudio, setPasswordlessAuth, setPreviewScene, setSceneItemAudio, setupAuth, startPreviewSession, subscribe, transitionToPreview, updateAuthCredentials, updateCanvas, updateEncoderConfig, updateFilter, updateInstance, updateOutput, updatePreviewEncoderConfig, updateSceneFilter, updateSceneItem, updateSceneItemTransform, updateSource, updateTransition, uploadSourceAsset } from './store'
import { LANGUAGE_OPTIONS, loadLanguage, saveLanguage, translate, type Language, type TranslationValues } from './i18n'

import type { ALSADevice, SourceKind, SourceKindField, V4L2Device, V4L2Format, V4L2FrameInterval, V4L2Resolution } from './types'

type DockRegion = 'left' | 'right' | 'bottom'
type DockPanel = 'scenes' | 'sources' | 'controls' | 'mixer' | 'transitions'
type WorkspaceMode = 'desktop' | 'tablet' | 'phone'
type PhoneSection = 'scenes' | 'sources' | 'audio' | 'outputs' | 'more'
type ResizeKey = 'leftWidth' | 'rightWidth' | 'bottomHeight' | 'leftTopRatio' | 'bottomLeftRatio'
type DockLayout = Record<DockRegion, DockPanel[]>
type AudioFilterType = 'channel_gain' | 'delay' | 'eq'

const DOCK_STORAGE_KEY = 'sbs-webui-dock-layout-v1'
const DOCK_SIZE_STORAGE_KEY = 'sbs-webui-dock-sizes-v1'
const DOCK_DRAG_MIME = 'application/x-sbs-dock-panel'
const VALID_DOCK_PANELS = new Set<DockPanel>(['scenes', 'sources', 'controls', 'mixer', 'transitions'])

const DEFAULT_DOCK_LAYOUT: DockLayout = {
  left: ['scenes', 'sources'],
  right: ['controls'],
  bottom: ['mixer', 'transitions'],
}

const PREVIEW_ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const DEFAULT_PREVIEW_DOWNSCALE_FACTOR = 6
const DEFAULT_PREVIEW_FRAMERATE = 60
const EQ_BAND_LABELS = ['31 Hz', '62 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz']
const FILE_OUTPUT_TYPES = ['ts', 'mkv', 'flv', 'mp4']

function previewEncoderAxis(canvasAxis: number, downscaleFactor: number): number {
  const factor = downscaleFactor > 0 ? downscaleFactor : DEFAULT_PREVIEW_DOWNSCALE_FACTOR
  const evenAxis = Math.max(2, Math.floor(canvasAxis / factor)) & ~1
  return Math.max(16, Math.ceil(evenAxis / 16) * 16)
}

function outputIndicatorClass(output: any): string {
  const healthStatus = String(output?.health?.status ?? '')
  const sinkType = output?.health?.sink_type ?? output?.encoder?.sink_type
  if (healthStatus === 'connected') return 'connected'
  if (healthStatus === 'degraded') return 'degraded'
  if (healthStatus === 'disconnected') return 'disconnected'
  if ((sinkType === 'rtmp' || sinkType === 'srt') && output?.state === 'running') return 'disconnected'
  if (output?.state === 'running') return 'connected'
  if (output?.state === 'error') return 'disconnected'
  return 'stopped'
}

function outputStatusLabel(output: any): string {
  const healthStatus = String(output?.health?.status ?? '')
  const sinkType = output?.health?.sink_type ?? output?.encoder?.sink_type
  if (healthStatus) return healthStatus
  if ((sinkType === 'rtmp' || sinkType === 'srt') && output?.state === 'running') return 'disconnected'
  return String(output?.state ?? '')
}

function outputStatusTitle(output: any): string {
  const sinkType = output?.health?.sink_type ?? output?.encoder?.sink_type
  const reason = output?.health?.reason
  return [sinkType, reason].filter(Boolean).join(': ')
}

function inferFileOutputType(path?: string): string {
  const ext = path?.split('.').pop()?.toLowerCase()
  return ext && FILE_OUTPUT_TYPES.includes(ext) ? ext : 'ts'
}

function workspaceModeForViewport(width: number, height: number, coarsePointer = false): WorkspaceMode {
  if (width < 700 || (coarsePointer && height <= 600)) return 'phone'
  if (width < 1100) return 'tablet'
  return 'desktop'
}

const DEFAULT_DOCK_SIZES = {
  leftWidth: 270,
  rightWidth: 240,
  bottomHeight: 220,
  leftTopRatio: 0.5,
  bottomLeftRatio: 1.4,
}

function normalizeDockLayout(input: unknown): DockLayout {
  const next: DockLayout = { left: [], right: [], bottom: [] }
  const addPanel = (region: DockRegion, panel: unknown) => {
    if (!VALID_DOCK_PANELS.has(panel as DockPanel)) return
    if (next.left.includes(panel as DockPanel) || next.right.includes(panel as DockPanel) || next.bottom.includes(panel as DockPanel)) return
    next[region].push(panel as DockPanel)
  }

  if (input && typeof input === 'object') {
    const parsed = input as Record<string, unknown>
    if (Array.isArray(parsed.left) || Array.isArray(parsed.right) || Array.isArray(parsed.bottom)) {
      for (const panel of (parsed.left as unknown[]) ?? []) addPanel('left', panel)
      for (const panel of (parsed.right as unknown[]) ?? []) addPanel('right', panel)
      for (const panel of (parsed.bottom as unknown[]) ?? []) addPanel('bottom', panel)
    } else {
      addPanel('left', parsed['left-top'])
      addPanel('left', parsed['left-bottom'])
      addPanel('right', parsed.right)
      addPanel('bottom', parsed['bottom-left'])
      addPanel('bottom', parsed['bottom-middle'])
    }
  }

  for (const panel of DEFAULT_DOCK_LAYOUT.left) addPanel('left', panel)
  for (const panel of DEFAULT_DOCK_LAYOUT.right) addPanel('right', panel)
  for (const panel of DEFAULT_DOCK_LAYOUT.bottom) addPanel('bottom', panel)
  return next
}

function loadDockLayout(): DockLayout {
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_DOCK_LAYOUT
    }
    return normalizeDockLayout(JSON.parse(raw))
  } catch {
    return DEFAULT_DOCK_LAYOUT
  }
}

function saveDockLayout(layout: DockLayout) {
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
  const [language, setLanguage] = useState<Language>(() => loadLanguage())
  const t = (key: string, values?: TranslationValues) => translate(language, key, values)
  const [command, setCommand] = useState('scene set-active scene-main')
  const [status, setStatus] = useState('Ready')
  const [authUsername, setAuthUsername] = useState('admin')
  const [authPassword, setAuthPassword] = useState('')
  const [authApiKey, setAuthApiKey] = useState('')
  const [authMode, setAuthMode] = useState<'password' | 'api_key'>('password')
  const [setupMode, setSetupMode] = useState<'password' | 'passwordless'>('password')
  const [authBusy, setAuthBusy] = useState(false)
  const [newApiKeyName, setNewApiKeyName] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [instancePanelOpen, setInstancePanelOpen] = useState(false)
  const [sourceKinds, setSourceKinds] = useState<SourceKind[]>([])
  const [sourceCreateOpen, setSourceCreateOpen] = useState(false)
  const [sourceConfigOpen, setSourceConfigOpen] = useState(false)
  const [sourceCreateKind, setSourceCreateKind] = useState('videotestsrc')
  const [sourceCreateName, setSourceCreateName] = useState('')
  const [sourceCreateConfig, setSourceCreateConfig] = useState<Record<string, string>>({})
  const [v4l2Devices, setV4l2Devices] = useState<V4L2Device[]>([])
  const [v4l2DiscoveryStatus, setV4l2DiscoveryStatus] = useState('')
  const [alsaDevices, setAlsaDevices] = useState<ALSADevice[]>([])
  const [alsaDiscoveryStatus, setAlsaDiscoveryStatus] = useState('')
  const [assetUploadStatus, setAssetUploadStatus] = useState<Record<string, { state: 'reading' | 'uploading' | 'done' | 'error'; message: string }>>({})
  const [previewController, setPreviewController] = useState<{ stop: () => Promise<void> } | null>(null)
  const [dockLayout, setDockLayout] = useState<DockLayout>(() => loadDockLayout())
  const [dragPanel, setDragPanel] = useState<DockPanel | null>(null)
  const [dockSizes, setDockSizes] = useState(DEFAULT_DOCK_SIZES)
  const [activeResize, setActiveResize] = useState<ResizeKey | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null)
  const [sourceContextMenu, setSourceContextMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null)
  const [sceneContextMenu, setSceneContextMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null)
  const [audioContextMenu, setAudioContextMenu] = useState<{ x: number; y: number; sceneId: string; itemId: string; sourceId: string } | null>(null)
  const [audioFilterEditor, setAudioFilterEditor] = useState<{ type: AudioFilterType; sceneId: string; itemId: string; sourceId: string } | null>(null)
  const [masterAudioContextMenu, setMasterAudioContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [masterAudioFilterEditor, setMasterAudioFilterEditor] = useState<Extract<AudioFilterType, 'channel_gain' | 'eq'> | null>(null)
  const [sourceEditConfig, setSourceEditConfig] = useState<Record<string, string>>({})
  const [sourceEditName, setSourceEditName] = useState('')
  const [sourceEditEnabled, setSourceEditEnabled] = useState(true)
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null)
  const [filterTarget, setFilterTarget] = useState<{ kind: 'source' | 'scene'; id: string } | null>(null)
  const [filterAmountDrafts, setFilterAmountDrafts] = useState<Record<string, string>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'interface' | 'canvas' | 'encoder' | 'preview' | 'output' | 'auth' | 'config'>('canvas')
  const [settingsCanvas, setSettingsCanvas] = useState({ width: 1920, height: 1080, fps_num: 60, fps_den: 1, color_mode: 'sdr', background_color: '#000000' })
  const [editingOutputId, setEditingOutputId] = useState<string | null>(null)
  const [sharedEncoder, setSharedEncoder] = useState({ codec: 'h265', bitrate_kbps: '20000', keyframe_interval: '60', gop_preset: 'low_delay', enable_b_frames: false, rc_mode: '0' })
  const [editOutputTransport, setEditOutputTransport] = useState<Record<string, string>>({})
  const [previewEncoder, setPreviewEncoder] = useState({ downscale_factor: String(DEFAULT_PREVIEW_DOWNSCALE_FACTOR), width: '640', height: '368', framerate: String(DEFAULT_PREVIEW_FRAMERATE), bitrate_kbps: '2500' })
  const [authSettings, setAuthSettings] = useState({ passwordless: false, username: 'admin', password: '' })
  const [configImportText, setConfigImportText] = useState('')
  const [fadeDurationMs, setFadeDurationMs] = useState('2000')
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 })
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => typeof window === 'undefined' ? 'desktop' : workspaceModeForViewport(window.innerWidth, window.innerHeight, window.matchMedia('(pointer: coarse)').matches))
  const [phoneSection, setPhoneSection] = useState<PhoneSection>('scenes')

  const dragRef = useRef<{
    type: 'move' | 'resize'
    itemId: string
    startMouseX: number
    startMouseY: number
    startPositionX: number
    startPositionY: number
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
  const [sourceBoxesVisible, setSourceBoxesVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('sbs-source-boxes-visible') !== 'off'
  })
  const [previewStatusOverlayVisible, setPreviewStatusOverlayVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('sbs-preview-status-overlay-visible') !== 'off'
  })

  const DEFAULT_CANVAS_W = 1920
  const DEFAULT_CANVAS_H = 1080
  const MIN_SIZE = 32
  const SNAP_THRESHOLD = 20

  useEffect(() => {
    saveLanguage(language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  const canvasW = state.canvas?.width || DEFAULT_CANVAS_W
  const canvasH = state.canvas?.height || DEFAULT_CANVAS_H
  const targetFps = Math.round((state.canvas?.fps_num || 60) / Math.max(state.canvas?.fps_den || 1, 1))
  const liveFps = state.telemetry.contentFrames > 1
    ? state.telemetry.contentFps
    : state.telemetry.compositorFps
  const displayFps = Math.max(0, Math.round(liveFps || 0))
  const fpsWarn = state.telemetry.pipelineSlow || (targetFps > 0 && displayFps + 1 < targetFps)
  const fpsTitle = t('Content {content} fps, compositor {compositor} fps', { content: state.telemetry.contentFps.toFixed(1), compositor: state.telemetry.compositorFps.toFixed(1) })
  const headerStatus = !state.connected
    ? t(state.connectionMessage)
    : state.previewStatus !== 'idle'
      ? t(state.previewMessage)
      : t(status)
  const previewFitSize = (() => {
    const width = Math.max(0, previewViewport.width)
    const height = Math.max(0, previewViewport.height)
    if (width <= 0 || height <= 0) return null
    const aspect = canvasW / Math.max(canvasH, 1)
    let fitWidth = width
    let fitHeight = fitWidth / aspect
    if (fitHeight > height) {
      fitHeight = height
      fitWidth = fitHeight * aspect
    }
    return { width: fitWidth, height: fitHeight }
  })()
  const previewScreenStyle = previewFitSize
    ? {
        width: `${Math.round(previewFitSize.width * previewZoom)}px`,
        height: `${Math.round(previewFitSize.height * previewZoom)}px`,
      }
    : undefined
  const previewZoomLabel = `${Math.round(previewZoom * 100)}%`
  const leftDockEmpty = dockLayout.left.length === 0
  const rightDockEmpty = dockLayout.right.length === 0
  const bottomDockEmpty = dockLayout.bottom.length === 0
  const bottomDockCount = dockLayout.bottom.length
  const bottomDockColumns = `${bottomDockCount > 0 ? `repeat(${bottomDockCount}, minmax(180px, 1fr))` : ''}${dragPanel ? ' minmax(18px, 0.05fr)' : ''}`.trim() || 'none'

  function adjustPreviewZoom(direction: -1 | 1) {
    setPreviewZoom((current) => {
      if (direction > 0) {
        return PREVIEW_ZOOM_STEPS.find((step) => step > current + 0.001) ?? PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1]
      }
      return [...PREVIEW_ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? PREVIEW_ZOOM_STEPS[0]
    })
  }

  function handlePreviewWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    adjustPreviewZoom(event.deltaY < 0 ? 1 : -1)
  }

  function getPreviewRect() {
    const wrapper = previewWrapperRef.current
    if (!wrapper) return null
    const overlay = wrapper.querySelector('.source-overlay') as HTMLElement | null
    if (!overlay) return null
    const overlayRect = overlay.getBoundingClientRect()
    return { width: overlayRect.width, height: overlayRect.height, offsetX: 0, offsetY: 0 }
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

  function canvasToPreviewLocal(cx: number, cy: number, cw: number, ch: number) {
    if (!previewFitSize) return { x: 0, y: 0, w: 0, h: 0 }
    const previewWidth = Math.round(previewFitSize.width * previewZoom)
    const previewHeight = Math.round(previewFitSize.height * previewZoom)
    const sx = previewWidth / canvasW
    const sy = previewHeight / canvasH
    return {
      x: cx * sx,
      y: cy * sy,
      w: cw * sx,
      h: ch * sy,
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

  function updatePreviewDrag(clientX: number, clientY: number) {
    const drag = dragRef.current
    if (!drag) return
    const pr = getPreviewRect()
    if (!pr) return
    const dx = clientX - drag.startMouseX
    const dy = clientY - drag.startMouseY
    const sx = canvasW / pr.width
    const sy = canvasH / pr.height
    const bbox = document.querySelector(`.source-bbox[data-item-id="${drag.itemId}"]`) as HTMLElement | null
    if (drag.type === 'move') {
      let newPx = drag.startPositionX + dx * sx
      let newPy = drag.startPositionY + dy * sy
      const newW = drag.startWidth
      const newH = drag.startHeight
      const snapped = snapToCanvas(newPx, newPy, newW, newH)
      if (bbox) {
        const mapped = canvasToPreview(snapped.px, snapped.py, newW, newH)
        bbox.style.left = mapped.x + 'px'
        bbox.style.top = mapped.y + 'px'
      }
      dragRef.current = { ...drag, _newPx: snapped.px, _newPy: snapped.py } as any
      return
    }

    if (drag.type === 'resize' && drag.handle) {
      const h = drag.handle
      let newPx = drag.startPositionX
      let newPy = drag.startPositionY
      let newW = drag.startWidth
      let newH = drag.startHeight
      const dxC = dx * sx
      const dyC = dy * sy

      if (h.includes('e')) newW = Math.max(MIN_SIZE, drag.startWidth + dxC)
      if (h.includes('w')) { newW = Math.max(MIN_SIZE, drag.startWidth - dxC); newPx = drag.startPositionX + drag.startWidth - newW }
      if (h.includes('n')) { newH = Math.max(MIN_SIZE, drag.startHeight - dyC); newPy = drag.startPositionY + drag.startHeight - newH }
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
  }

  async function finishPreviewDrag() {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
    if (!scene) return
    const item = (scene.items as any[])?.find((it: any) => it.id === drag.itemId)
    if (!item) return
    if (drag.type === 'move') {
      const d = drag as any
      const newPx = d._newPx ?? drag.startPositionX
      const newPy = d._newPy ?? drag.startPositionY
      await updateSceneItemTransform(state.activeSceneId!, drag.itemId, {
        ...item.transform,
        position_x: Math.round(newPx),
        position_y: Math.round(newPy),
      }).catch(() => {})
    } else if (drag.type === 'resize') {
      const d = drag as any
      const newPx = d._newPx ?? drag.startPositionX
      const newPy = d._newPy ?? drag.startPositionY
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
  }

  useEffect(() => {
    connectStore()
      .then(() => setStatus(t('Connected to SBS')))
      .catch((error) => setStatus(t('Connection failed: {message}', { message: String(error) })))
  }, [])

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    setAuthBusy(true)
    setStatus(state.auth.setup_required ? t('Setting up SBS...') : t('Authenticating...'))
    try {
      if (state.auth.setup_required) {
        await setupAuth(authUsername.trim(), authPassword, setupMode === 'passwordless')
      } else if (authMode === 'api_key') {
        await loginApiKey(authApiKey.trim())
      } else {
        await loginAuth(authUsername.trim(), authPassword)
      }
      setAuthPassword('')
      setAuthApiKey('')
      setStatus(t('Authenticated'))
    } catch (error) {
      setStatus(t('Authentication failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleCreateApiKey() {
    setStatus(t('Creating API key...'))
    try {
      const key = await createApiKey(newApiKeyName.trim() || 'WebUI API Key')
      setNewApiKey(key.api_key)
      setNewApiKeyName('')
      setStatus(t('API key created'))
    } catch (error) {
      setStatus(t('API key creation failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  async function handleDeleteApiKey(id: string) {
    setStatus(t('Deleting API key...'))
    try {
      await deleteApiKey(id)
      setStatus(t('API key deleted'))
    } catch (error) {
      setStatus(t('API key deletion failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  function serializeConfig(bundle: Record<string, unknown>) {
    return `${JSON.stringify(bundle, null, 2)}\n`
  }

  function parseConfig(text: string) {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(t('Config import must be an object'))
    }
    return parsed as Record<string, unknown>
  }

  function downloadConfigFile(text: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `sbs-config-${stamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function handleExportConfig() {
    setStatus(t('Exporting JSON config...'))
    try {
      const bundle = await exportConfigBundle()
      downloadConfigFile(serializeConfig(bundle))
      setStatus(t('Config exported as JSON'))
    } catch (error) {
      setStatus(t('Config export failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  async function handleImportConfig() {
    setStatus(t('Importing JSON config...'))
    try {
      const bundle = parseConfig(configImportText)
      await importConfigBundle(bundle)
      setConfigImportText('')
      setStatus(t('Config imported and applied'))
    } catch (error) {
      setStatus(t('Config import failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  async function handleConfigFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setConfigImportText(await file.text())
    event.target.value = ''
  }

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
    const wrapperNode = previewWrapperRef.current
    if (!wrapperNode) return
    const wrapperElement: HTMLDivElement = wrapperNode

    function measurePreviewViewport() {
      const style = window.getComputedStyle(wrapperElement)
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      setPreviewViewport({
        width: Math.max(0, wrapperElement.clientWidth - paddingX),
        height: Math.max(0, wrapperElement.clientHeight - paddingY),
      })
    }

    measurePreviewViewport()
    const observer = new ResizeObserver(measurePreviewViewport)
    observer.observe(wrapperElement)
    window.addEventListener('resize', measurePreviewViewport)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measurePreviewViewport)
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen && !sourceCreateOpen && !sourceConfigOpen && !filtersOpen) return
    const dialogNode = document.querySelector<HTMLElement>('.settings-overlay .settings-dialog')
    if (!dialogNode) return
    const dialog: HTMLElement = dialogNode

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => !el.hasAttribute('disabled'))
    ;(focusables[0] ?? dialog).focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setSourceCreateOpen(false)
        setSourceConfigOpen(false)
        setFiltersOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => !el.hasAttribute('disabled'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [filtersOpen, settingsOpen, sourceConfigOpen, sourceCreateOpen])

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
    if (!audioContextMenu) return
    function onClickOutside(e: MouseEvent) {
      const menu = document.querySelector('.audio-context-menu')
      if (menu && menu.contains(e.target as Node)) return
      setAudioContextMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [audioContextMenu])

  useEffect(() => {
    if (!masterAudioContextMenu) return
    function onClickOutside(e: MouseEvent) {
      const menu = document.querySelector('.master-audio-context-menu')
      if (menu && menu.contains(e.target as Node)) return
      setMasterAudioContextMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [masterAudioContextMenu])

  useEffect(() => {
    setDockLayout(loadDockLayout())
    setDockSizes(loadDockSizes())
  }, [])

  useEffect(() => {
    function onResize() {
      setWorkspaceMode(workspaceModeForViewport(window.innerWidth, window.innerHeight, window.matchMedia('(pointer: coarse)').matches))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  function canvasPointFromClient(clientX: number, clientY: number) {
    const overlay = previewWrapperRef.current?.querySelector('.source-overlay') as HTMLElement | null
    if (!overlay) return null
    const rect = overlay.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((clientX - rect.left) / rect.width) * canvasW,
      y: ((clientY - rect.top) / rect.height) * canvasH,
    }
  }

  function sceneItemContainsCanvasPoint(item: any, point: { x: number; y: number }) {
    if (!item || item.visible === false) return false
    const transform = item.transform || {}
    const x = Number(transform.position_x ?? 0)
    const y = Number(transform.position_y ?? 0)
    const width = Number(transform.width ?? 640)
    const height = Number(transform.height ?? 360)
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false
    return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
  }

  function preferredContextItemId(clientX: number, clientY: number, fallbackItemId: string) {
    const selectedItem = state.selectedSceneItemId
      ? activeSceneItems.find((item: any) => item.id === state.selectedSceneItemId)
      : null
    const point = selectedItem ? canvasPointFromClient(clientX, clientY) : null
    if (selectedItem && point && sceneItemContainsCanvasPoint(selectedItem, point)) {
      return selectedItem.id
    }
    return fallbackItemId
  }

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

  function formatAudioVolume(value: unknown) {
    const volume = Number(value)
    if (!Number.isFinite(volume)) return '100%'
    return `${Math.round(volume * 100)}%`
  }

  function audioEqBands(audio: any) {
    const bands = Array.isArray(audio?.eq_bands) ? audio.eq_bands : []
    return Array.from({ length: 10 }, (_, index) => Number.isFinite(Number(bands[index])) ? Number(bands[index]) : 0)
  }

  function masterEqBands() {
    const bands = Array.isArray(state.audio.master_eq_bands) ? state.audio.master_eq_bands : []
    return Array.from({ length: 10 }, (_, index) => Number.isFinite(Number(bands[index])) ? Number(bands[index]) : 0)
  }

  function equalizerCurvePath(bands: number[], width = 360, height = 140) {
    const padX = 18
    const padY = 16
    const usableW = width - padX * 2
    const usableH = height - padY * 2
    const points = bands.map((band, index) => {
      const x = padX + (usableW * index) / Math.max(1, bands.length - 1)
      const y = padY + usableH / 2 - (Math.max(-12, Math.min(12, band)) / 12) * (usableH / 2)
      return { x, y }
    })
    if (points.length === 0) return ''
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
    return points.reduce((path, point, index) => {
      if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
      const prev = points[index - 1]
      const cx = ((prev.x + point.x) / 2).toFixed(2)
      return `${path} C ${cx} ${prev.y.toFixed(2)}, ${cx} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    }, '')
  }

  function renderEqualizerCurve(bands: number[]) {
    const width = 360
    const height = 140
    const padX = 18
    const padY = 16
    const usableW = width - padX * 2
    const usableH = height - padY * 2
    const centerY = padY + usableH / 2
    const path = equalizerCurvePath(bands, width, height)
    const areaPath = path ? `${path} L ${width - padX} ${centerY} L ${padX} ${centerY} Z` : ''
    const points = bands.map((band, index) => ({
      x: padX + (usableW * index) / Math.max(1, bands.length - 1),
      y: padY + usableH / 2 - (Math.max(-12, Math.min(12, band)) / 12) * (usableH / 2),
      band,
    }))

    return (
      <div className="audio-eq-curve-card" aria-label={t('Equalizer frequency response curve')}>
        <div className="audio-eq-curve-header">
          <strong>{t('Frequency Response')}</strong>
          <small>{t('Boosts rise above 0 dB, cuts dip below it.')}</small>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('Equalizer curve')}>
          <defs>
            <linearGradient id="eqCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#536ff0" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#536ff0" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line key={`h-${ratio}`} className={ratio === 0.5 ? 'eq-zero-line' : 'eq-grid-line'} x1={padX} x2={width - padX} y1={padY + usableH * ratio} y2={padY + usableH * ratio} />
          ))}
          {points.map((point, index) => (
            <line key={`v-${index}`} className="eq-grid-line" x1={point.x} x2={point.x} y1={padY} y2={height - padY} />
          ))}
          {areaPath && <path className="eq-curve-fill" d={areaPath} />}
          {path && <path className="eq-curve-stroke" d={path} />}
          {points.map((point, index) => (
            <g key={`p-${index}`}>
              <circle className="eq-curve-point" cx={point.x} cy={point.y} r="3.5" />
              <title>{`${EQ_BAND_LABELS[index]}: ${point.band} dB`}</title>
            </g>
          ))}
        </svg>
        <div className="audio-eq-curve-labels">
          <span>{EQ_BAND_LABELS[0]}</span>
          <span>{t('Frequency (Hz)')}</span>
          <span>{EQ_BAND_LABELS[EQ_BAND_LABELS.length - 1]}</span>
        </div>
      </div>
    )
  }

  function renderEqualizerFaders(
    bands: number[],
    disabled: boolean,
    onBandChange: (index: number, value: number) => void,
  ) {
    return (
      <div className="audio-eq-fader-bank" aria-label={t('Equalizer band controls')}>
        {bands.map((band, index) => (
          <label key={index} className="audio-eq-fader-strip">
            <span className="audio-eq-fader-value">{band > 0 ? `+${band}` : band} dB</span>
            <input
              className="audio-eq-fader"
              type="range"
              min="-12"
              max="12"
              step="1"
              value={band}
              disabled={disabled}
              aria-label={`${EQ_BAND_LABELS[index]} ${t('gain')}`}
              onChange={(event) => onBandChange(index, Number(event.target.value))}
            />
            <input
              className="audio-eq-number"
              type="number"
              min="-12"
              max="12"
              step="1"
              value={band}
              disabled={disabled}
              aria-label={`${EQ_BAND_LABELS[index]} ${t('gain dB')}`}
              onChange={(event) => onBandChange(index, Number(event.target.value))}
            />
            <span className="audio-eq-fader-label">{EQ_BAND_LABELS[index]}</span>
          </label>
        ))}
      </div>
    )
  }

  function audioStateForSource(source: any) {
    return source?.audio ?? { enabled: false, device: null, volume: 1, left_gain: 1, right_gain: 1, delay_ms: 0, eq_bands: audioEqBands(null), mute: false, monitor: false }
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
      {
        left_gain: Number(patch.left_gain ?? audio.left_gain ?? 1),
        right_gain: Number(patch.right_gain ?? audio.right_gain ?? 1),
        delay_ms: Number(patch.delay_ms ?? audio.delay_ms ?? 0),
        eq_bands: patch.eq_bands ?? audioEqBands(audio),
      },
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
      setStatus(t('Preview stopped'))
      return
    }

    const controller = await startPreviewSession()
    setPreviewController(controller)
  }

  async function handleCreateScene() {
    const name = window.prompt(t('Scene name'), `${t('Scene')} ${sceneEntries.length + 1}`)?.trim()
    if (!name) {
      return
    }
    await createScene(name)
    setStatus(t('Created scene: {name}', { name }))
  }

  async function handleOpenSourceCatalog() {
    try {
      const result = await listSourceKinds()
      setSourceKinds(result.kinds)
      setSourceCreateKind(result.kinds[0]?.id ?? 'videotestsrc')
      setSourceCreateName(`${t('Source')} ${sourceEntries.length + 1}`)
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

  function v4l2DeviceForConfig(config: Record<string, string>, devices = v4l2Devices) {
    const path = config.device || config.device_path
    return devices.find((device) => device.path === path) ?? null
  }

  function v4l2FormatForConfig(config: Record<string, string>, device = v4l2DeviceForConfig(config)) {
    if (!device) return null
    const fourcc = config.format || config.fourcc
    return device.formats.find((format) => format.fourcc === fourcc) ?? device.formats[0] ?? null
  }

  function v4l2DiscreteResolutions(format: V4L2Format | null) {
    return (format?.resolutions ?? []).filter((resolution) => resolution.width && resolution.height)
  }

  function v4l2ResolutionValue(resolution: V4L2Resolution) {
    return `${resolution.width ?? 0}x${resolution.height ?? 0}`
  }

  function v4l2IntervalValue(interval: V4L2FrameInterval) {
    if (interval.numerator && interval.denominator) {
      return `${interval.denominator}/${interval.numerator}`
    }
    return ''
  }

  function v4l2IntervalLabel(interval: V4L2FrameInterval) {
    if (interval.fps) {
      const fps = Math.abs(interval.fps - Math.round(interval.fps)) < 0.01 ? String(Math.round(interval.fps)) : interval.fps.toFixed(2)
      return `${fps} fps`
    }
    if (interval.numerator && interval.denominator) {
      return `${interval.denominator}/${interval.numerator} fps`
    }
    return interval.type
  }

  function applyV4L2Defaults(config: Record<string, string>, devices = v4l2Devices) {
    const next = { ...config }
    const device = v4l2DeviceForConfig(next, devices) ?? devices[0] ?? null
    if (device) {
      next.device = device.path
      next.device_path = device.path
      next.device_id = device.id
    } else if (!next.device_path) {
      next.device_path = next.device || '/dev/video0'
    }

    const format = v4l2FormatForConfig(next, device)
    if (format) {
      next.format = format.fourcc
      next.fourcc = format.fourcc
      const resolutions = v4l2DiscreteResolutions(format)
      const selectedResolution = resolutions.find((resolution) => (
        String(resolution.width) === next.width && String(resolution.height) === next.height
      )) ?? resolutions[0]
      if (selectedResolution?.width && selectedResolution.height) {
        next.width = String(selectedResolution.width)
        next.height = String(selectedResolution.height)
        const intervals = selectedResolution.frame_intervals ?? []
        const selectedInterval = intervals.find((interval) => v4l2IntervalValue(interval) === next.framerate) ?? intervals[0]
        const intervalValue = selectedInterval ? v4l2IntervalValue(selectedInterval) : ''
        if (intervalValue) next.framerate = intervalValue
      }
      if (!next.decode_mode) next.decode_mode = 'auto'
    }
    return next
  }

  async function loadV4L2Devices() {
    try {
      setV4l2DiscoveryStatus(t('Detecting V4L2 devices...'))
      const result = await discoverV4L2()
      const devices = result.devices ?? []
      setV4l2Devices(devices)
      setV4l2DiscoveryStatus(devices.length > 0 ? t(devices.length === 1 ? '{count} V4L2 device detected' : '{count} V4L2 devices detected', { count: devices.length }) : t('No V4L2 capture devices detected'))
      return devices
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setV4l2DiscoveryStatus(t('V4L2 discovery failed: {message}', { message }))
      return []
    }
  }

  function alsaDeviceForConfig(config: Record<string, string>, devices = alsaDevices) {
    const value = config.device || 'hw:0,2'
    return devices.find((device) => device.device === value || device.hw_device === value) ?? null
  }

  function applyALSADefaults(config: Record<string, string>, devices = alsaDevices) {
    const next = { ...config }
    const device = alsaDeviceForConfig(next, devices) ?? devices[0] ?? null
    if (device) {
      next.device = device.device
    } else if (!next.device) {
      next.device = 'hw:0,2'
    }
    return next
  }

  async function loadALSADevices() {
    try {
      setAlsaDiscoveryStatus(t('Detecting ALSA capture devices...'))
      const result = await discoverALSA()
      const devices = result.devices ?? []
      setAlsaDevices(devices)
      setAlsaDiscoveryStatus(devices.length > 0 ? t(devices.length === 1 ? '{count} ALSA capture device detected' : '{count} ALSA capture devices detected', { count: devices.length }) : t('No ALSA capture devices detected'))
      return devices
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAlsaDiscoveryStatus(t('ALSA discovery failed: {message}', { message }))
      return []
    }
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
      const devices = kind.id === 'v4l2src' ? await loadV4L2Devices() : v4l2Devices
      const audioDevices = kind.id === 'alsa_audio' ? await loadALSADevices() : alsaDevices
      setSourceCreateKind(kind.id)
      setSourceCreateName((name) => name || `${kind.name} ${sourceEntries.length + 1}`)
      setSourceCreateConfig(kind.id === 'v4l2src'
        ? applyV4L2Defaults(sourceKindDefaults(kind), devices)
        : kind.id === 'alsa_audio'
          ? applyALSADefaults(sourceKindDefaults(kind), audioDevices)
          : sourceKindDefaults(kind))
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
    if (kind?.id === 'v4l2src') {
      for (const [key, val] of Object.entries(sourceCreateConfig)) {
        if (val !== undefined && val !== '') config[key] = val
      }
    } else if (kind) {
      for (const field of kind.fields ?? []) {
        const val = sourceCreateConfig[field.key]
        if (val !== undefined && val !== '') {
          config[field.key] = val
        }
      }
    }
    try {
      await createSource(name, sourceCreateKind, Object.keys(config).length > 0 ? config : undefined)
      setStatus(t('Created source: {name}', { name }))
      setSourceConfigOpen(false)
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function openSourceEditor(source: any) {
    try {
      const kind = await loadSourceKind(source.type)
      const devices = kind.id === 'v4l2src' ? await loadV4L2Devices() : v4l2Devices
      const audioDevices = kind.id === 'alsa_audio' ? await loadALSADevices() : alsaDevices
      setEditingSourceId(source.id)
      setSourceEditName(source.name)
      setSourceEditEnabled(source.enabled !== false)
      const config = { ...sourceKindDefaults(kind), ...(source.config ?? {}) }
      setSourceEditConfig(kind.id === 'v4l2src'
        ? applyV4L2Defaults(config, devices)
        : kind.id === 'alsa_audio'
          ? applyALSADefaults(config, audioDevices)
          : config)
      setAssetUploadStatus({})
    } catch (error) {
      setStatus(String(error))
    }
  }

  async function handleRenameSource(sourceId: string, currentName: string) {
    const name = window.prompt(t('Source name'), currentName)?.trim()
    if (!name) return
    await updateSource(sourceId, { name })
    setStatus(t('Renamed source: {name}', { name }))
  }

  async function handleCreateOutput() {
    const name = window.prompt(t('Output name'), `${t('Output')} ${outputEntries.length + 1}`)?.trim()
    if (!name) {
      return
    }
    await createOutput(name)
    setStatus(t('Created output: {name}', { name }))
  }

  function switchToInstance(id: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('instance', String(id))
    window.location.href = url.toString()
  }

  async function handleCreateInstance() {
    const name = window.prompt(t('Instance name'), `${t('Instance')} ${state.instances.length}`)?.trim()
    if (!name) {
      return
    }
    const created = await createInstance(name)
    setStatus(t('Created instance: {name}', { name: created.name }))
  }

  async function handleRenameInstance() {
    if (!currentInstance) {
      return
    }
    const name = window.prompt(t('Instance name'), currentInstance.name)?.trim()
    if (!name) {
      return
    }
    const updated = await updateInstance(currentInstance.instance_id, { name })
    setStatus(t('Renamed instance: {name}', { name: updated.name }))
  }

  async function handleToggleInstanceEnabled() {
    if (!currentInstance) {
      return
    }
    const updated = currentInstance.desired_running
      ? await disableInstance(currentInstance.instance_id)
      : await enableInstance(currentInstance.instance_id)
    setStatus(t(updated.desired_running ? '{name} enabled' : '{name} disabled', { name: updated.name }))
  }

  async function handleDeleteInstance() {
    if (!currentInstance || currentInstance.instance_id === 0) {
      setStatus(t('Default instance cannot be deleted'))
      return
    }
    if (!window.confirm(t('Delete instance {name}?', { name: currentInstance.name }))) {
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
    if (!window.confirm(t('Restart instance {name}? This will briefly disconnect all clients.', { name: currentInstance.name }))) {
      return
    }
    setStatus(t('Restarting instance...'))
    try {
      await restartInstance(currentInstance.instance_id)
      setStatus(t('Instance restarted, reconnecting...'))
      await new Promise((r) => setTimeout(r, 2000))
      window.location.reload()
    } catch (error) {
      setStatus(t('Restart failed: {message}', { message: error instanceof Error ? error.message : String(error) }))
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
    if (filter.type === 'hdr_to_sdr_lut' || filter.type === 'sdr_to_hdr') {
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
    const fallback = filter.type === 'sdr_to_hdr'
      ? (key === 'saturation' ? 1.35 : key === 'brightness' ? -0.03 : 0)
      : (key === 'saturation' ? 1.42 : key === 'brightness' ? -0.02 : 0)
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

  function hdrFilterHelp(key: string) {
    if (key === 'saturation') return t('Color intensity after tone mapping; 100% is unchanged.')
    if (key === 'brightness') return t('Output brightness offset; 0% is neutral.')
    return t('Hue rotation in degrees; 0 deg is unchanged.')
  }

  function formatHdrFilterRange(key: string) {
    const range = hdrFilterParamRange(key)
    const min = key === 'hue' ? `${range.min} deg` : `${Math.round(range.min * 100)}%`
    const max = key === 'hue' ? `${range.max} deg` : `${Math.round(range.max * 100)}%`
    return `${min} to ${max}`
  }

  function renderHdrFilterSlider(filter: any, key: string, label: string) {
    const range = hdrFilterParamRange(key)
    const unit = key === 'hue' ? 'deg' : '%'
    return (
      <label className="filter-property-row">
        <div className="filter-label-block">
          <span>{label}</span>
          <small>{hdrFilterHelp(key)}</small>
        </div>
        <div className="filter-control-row">
          <input
            type="range"
            aria-label={`${filterDisplayName(filter.type)} ${key}`}
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
        <small className="filter-value">{t('Current: {current} - Range: {range}', { current: formatHdrFilterParam(filter, key), range: formatHdrFilterRange(key) })}</small>
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

  function filterAmountLabel(filter: any) {
    if (filter.type === 'brightness') return t('Brightness Offset')
    if (filter.type === 'contrast') return t('Contrast Multiplier')
    if (filter.type === 'sdr_to_hdr') return t('HDR Expansion')
    if (filter.type === 'lut' || filter.type === 'hdr_to_sdr_lut') return t('LUT Strength')
    if (filter.type === 'grayscale') return t('Grayscale Strength')
    return t('Effect Strength')
  }

  function filterAmountHelp(filter: any) {
    if (filter.type === 'brightness') return t('Adds or removes brightness; 0 is neutral.')
    if (filter.type === 'contrast') return t('Multiplies contrast; 1.00x is neutral.')
    if (filter.type === 'sdr_to_hdr') return t('Expands SDR luma and saturation before HDR10 output encoding.')
    if (filter.type === 'lut' || filter.type === 'hdr_to_sdr_lut') return t('Blends the LUT with the original image.')
    if (filter.type === 'grayscale') return t('0% keeps color, 100% is fully grayscale.')
    return t('Blend amount for this effect.')
  }

  function formatFilterAmountRange(filter: any) {
    const range = filterRangeConfig(filter)
    const min = { params: { amount: range.min }, type: filter.type }
    const max = { params: { amount: range.max }, type: filter.type }
    return `${formatFilterAmount(min)} to ${formatFilterAmount(max)}`
  }

  function filterDisplayName(type: string) {
    if (type === 'hdr_to_sdr_lut') {
      return t('HDR→SDR LUT')
    }
    if (type === 'sdr_to_hdr') return t('SDR→HDR')
    if (type === 'lut') return t('Apply LUT')
    if (type === 'color_correction') return t('Color Correction')
    if (type === 'luma_key') return t('Luma Key')
    if (type === 'chroma_key') return t('Chroma Key')
    if (type === 'grayscale') return t('Grayscale')
    if (type === 'brightness') return t('Brightness')
    if (type === 'contrast') return t('Contrast')
    if (type === 'crop') return t('Crop')
    if (type === 'mirror') return t('Mirror')
    if (type === 'flip') return t('Flip')
    if (type === 'rotation') return t('Rotation')
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
    if (key === 'degrees') return { min: -180, max: 180, step: 1, scale: 1 }
    if (key === 'min' || key === 'max' || key === 'similarity' || key === 'smoothness' || key === 'spill') {
      return { min: 0, max: 1, step: 0.01, scale: 100 }
    }
    if (key === 'top' || key === 'right' || key === 'bottom' || key === 'left') {
      return { min: 0, max: 0.95, step: 0.01, scale: 100 }
    }
    return { min: 0, max: 1, step: 0.01, scale: 100 }
  }

  function filterParamHelp(filter: any, key: string) {
    if (key === 'saturation') return t('Color intensity; 100% is unchanged.')
    if (key === 'brightness') return t('Brightness offset; 0% is neutral.')
    if (key === 'contrast') return t('Contrast multiplier; 1.00x is unchanged.')
    if (key === 'gamma') return t('Midtone curve; 1.00x is unchanged.')
    if (key === 'hue') return t('Hue rotation; 0 deg is unchanged.')
    if (key === 'degrees') return t('Rotates the source around its center.')
    if (key === 'top' || key === 'right' || key === 'bottom' || key === 'left') return t('Crops this edge before scaling the source.')
    if (filter.type === 'luma_key' && key === 'min') return t('Pixels darker than this become transparent.')
    if (filter.type === 'luma_key' && key === 'max') return t('Pixels brighter than this remain opaque.')
    if (key === 'similarity') return t('How close a color must be to the key color.')
    if (key === 'smoothness') return t('Softens the cutout edge to reduce harsh borders.')
    if (key === 'spill') return t('Suppresses leftover key color on edges.')
    return t('Adjusts this filter parameter.')
  }

  function formatFilterParamValue(key: string, value: number) {
    if (key === 'hue' || key === 'degrees') return `${Math.round(value)} deg`
    if (key === 'brightness') return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`
    if (key === 'contrast' || key === 'gamma') return `${value.toFixed(2)}x`
    return `${Math.round(value * 100)}%`
  }

  function formatFilterParamRange(key: string) {
    const range = filterParamRange(key)
    return `${formatFilterParamValue(key, range.min)} to ${formatFilterParamValue(key, range.max)}`
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
    if (filter.type === 'rotation') {
      return key === 'degrees' ? 90 : 0
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
    setStatus(t('Adjusted {filter}', { filter: filterDisplayName(filter.type) }))
  }

  async function handleCommitFilterColor(filter: any, color: string) {
    if (!effectiveFilterTarget) return
    const params = { ...(filter.params ?? {}), color }
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, params)
    }
    setStatus(t('Adjusted {filter}', { filter: filterDisplayName(filter.type) }))
  }

  function renderFilterParamSlider(filter: any, key: string, label: string) {
    const range = filterParamRange(key)
    const value = filterParamValue(filter, key, filterParamFallback(filter, key))
    const unit = key === 'hue' ? 'deg' : '%'
    return (
      <label className="filter-property-row">
        <div className="filter-label-block">
          <span>{label}</span>
          <small>{filterParamHelp(filter, key)}</small>
        </div>
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
        <small className="filter-value">{t('Current: {current} - Range: {range}', { current: formatFilterParamValue(key, value), range: formatFilterParamRange(key) })}</small>
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
    setStatus(t('Added {filter} filter', { filter: filterDisplayName(type) }))
  }

  async function handleRemoveSelectedFilter() {
    if (!effectiveFilterTarget || !selectedFilter) return
    if (effectiveFilterTarget.kind === 'scene') {
      await removeSceneFilter(effectiveFilterTarget.id, selectedFilter.id)
    } else {
      await removeFilter(effectiveFilterTarget.id, selectedFilter.id)
    }
    setStatus(t('Removed {filter}', { filter: filterDisplayName(selectedFilter.type) }))
  }

  async function handleToggleFilter(filter: any, enabled: boolean) {
    if (!effectiveFilterTarget) return
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, enabled, filter.params ?? { amount: defaultFilterAmount(filter) })
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, enabled, filter.params ?? { amount: defaultFilterAmount(filter) })
    }
    setStatus(t(enabled ? 'Enabled {filter}' : 'Disabled {filter}', { filter: filterDisplayName(filter.type) }))
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
    setStatus(t('Adjusted {filter}', { filter: filterDisplayName(filter.type) }))
  }

  async function handleCommitHdrFilterParam(filter: any, key: string, value: number) {
    if (!effectiveFilterTarget || !Number.isFinite(value)) return
    const nextValue = clampHdrFilterParam(key, value)
    if (effectiveFilterTarget.kind === 'scene') {
      await updateSceneFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), [key]: nextValue })
    } else {
      await updateFilter(effectiveFilterTarget.id, filter.id, filter.enabled, { ...(filter.params ?? {}), [key]: nextValue })
    }
    setStatus(t('Adjusted {filter}', { filter: filterDisplayName(filter.type) }))
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
      const message = t('File is larger than the 128 MB upload limit')
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'error', message } }))
      setStatus(message)
      return
    }
    try {
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'reading', message: t('Reading {name}...', { name: file.name }) } }))
      setStatus(t('Reading {name}...', { name: file.name }))
      const dataBase64 = await fileAsBase64(file)
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'uploading', message: t('Uploading {name}...', { name: file.name }) } }))
      setStatus(t('Uploading {name}...', { name: file.name }))
      const uploaded = await uploadSourceAsset(field.asset_kind, file.name, dataBase64)
      const value = field.key === 'uri' ? uploaded.uri : uploaded.path
      setConfig((prev) => ({ ...prev, [field.key]: value }))
      setAssetUploadStatus((prev) => ({
        ...prev,
        [statusKey]: { state: 'done', message: t('Uploaded {name} ({size} KB)', { name: uploaded.filename, size: Math.max(1, Math.round(uploaded.size / 1024)) }) },
      }))
      setStatus(t('Uploaded {name}', { name: uploaded.filename }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAssetUploadStatus((prev) => ({ ...prev, [statusKey]: { state: 'error', message: t('Upload failed: {message}', { message }) } }))
      setStatus(t('Upload failed: {message}', { message }))
    }
  }

  function renderV4L2ConfigControls(
    config: Record<string, string>,
    setConfig: Dispatch<SetStateAction<Record<string, string>>>,
  ) {
    const device = v4l2DeviceForConfig(config)
    const format = v4l2FormatForConfig(config, device)
    const resolutions = v4l2DiscreteResolutions(format)
    const selectedResolution = resolutions.find((resolution) => (
      String(resolution.width) === config.width && String(resolution.height) === config.height
    )) ?? resolutions[0]
    const intervals = selectedResolution?.frame_intervals ?? []
    const compressed = Boolean(format?.compressed)

    return (
      <>
        <div className="source-create-row">
          <label>{t('Detected Device')}</label>
          <select
            value={device?.path ?? ''}
            onChange={(event) => {
              const selected = v4l2Devices.find((entry) => entry.path === event.target.value)
              setConfig((prev) => applyV4L2Defaults({
                ...prev,
                device: selected?.path ?? '',
                device_path: selected?.path ?? prev.device_path ?? '/dev/video0',
                device_id: selected?.id ?? '',
                format: '',
                fourcc: '',
                width: '',
                height: '',
                framerate: '',
              }, selected ? [selected] : v4l2Devices))
            }}
          >
            <option value="">{t('Manual path')}</option>
            {v4l2Devices.map((entry) => (
              <option key={entry.id} value={entry.path}>{entry.display_name || entry.path} ({entry.path})</option>
            ))}
          </select>
        </div>
        <div className="source-create-row">
          <label>{t('Manual Path')}</label>
          <input
            value={config.device_path ?? config.device ?? '/dev/video0'}
            onChange={(event) => setConfig((prev) => ({
              ...prev,
              device: event.target.value,
              device_path: event.target.value,
              device_id: '',
            }))}
            placeholder="/dev/video0"
          />
        </div>
        <div className="source-create-row source-create-row-inline">
          <label>{t('Discovery')}</label>
          <div className="source-field-stack">
            <button type="button" onClick={() => loadV4L2Devices().then((devices) => setConfig((prev) => applyV4L2Defaults(prev, devices)))}>{t('Refresh Devices')}</button>
            <small className="source-field-hint">{v4l2DiscoveryStatus || t('Use refresh to query target V4L2 devices.')}</small>
          </div>
        </div>
        <div className="source-create-row">
          <label>{t('Format')}</label>
          <select
            value={format?.fourcc ?? ''}
            disabled={!device || (device.formats ?? []).length === 0}
            onChange={(event) => setConfig((prev) => applyV4L2Defaults({
              ...prev,
              format: event.target.value,
              fourcc: event.target.value,
              width: '',
              height: '',
              framerate: '',
            }))}
          >
            {!device && <option value="">{t('Select a detected device')}</option>}
            {device && (device.formats ?? []).length === 0 && <option value="">{t('No formats reported')}</option>}
            {(device?.formats ?? []).map((entry) => (
              <option key={entry.fourcc} value={entry.fourcc}>{entry.fourcc} · {entry.description || entry.media_type}</option>
            ))}
          </select>
        </div>
        <div className="source-create-row">
          <label>{t('Resolution')}</label>
          <select
            value={selectedResolution ? v4l2ResolutionValue(selectedResolution) : ''}
            disabled={resolutions.length === 0}
            onChange={(event) => {
              const [width, height] = event.target.value.split('x')
              setConfig((prev) => applyV4L2Defaults({ ...prev, width, height, framerate: '' }))
            }}
          >
            {resolutions.length === 0 && <option value="">{t('No discrete resolutions')}</option>}
            {resolutions.map((entry) => (
              <option key={v4l2ResolutionValue(entry)} value={v4l2ResolutionValue(entry)}>{entry.width} x {entry.height}</option>
            ))}
          </select>
        </div>
        <div className="source-create-row">
          <label>{t('Frame Rate')}</label>
          <select
            value={config.framerate ?? (intervals[0] ? v4l2IntervalValue(intervals[0]) : '')}
            disabled={intervals.length === 0}
            onChange={(event) => setConfig((prev) => ({ ...prev, framerate: event.target.value }))}
          >
            {intervals.length === 0 && <option value="">{t('No frame rates reported')}</option>}
            {intervals.map((entry, index) => {
              const value = v4l2IntervalValue(entry)
              return <option key={`${value}-${index}`} value={value}>{v4l2IntervalLabel(entry)}</option>
            })}
          </select>
        </div>
        <div className="source-create-row">
          <label>{t('Decode Mode')}</label>
          <select
            value={config.decode_mode ?? 'auto'}
            disabled={!compressed}
            onChange={(event) => setConfig((prev) => ({ ...prev, decode_mode: event.target.value }))}
          >
            <option value="auto">{t('Auto')}{compressed ? ` (${t('prefer hardware')})` : ` (${t('raw mode')})`}</option>
            <option value="hardware" disabled={!format?.hardware_decode_available}>{t('Hardware')}{format?.hardware_decode_available ? '' : ` ${t('unavailable')}`}</option>
            <option value="software" disabled={compressed && !format?.software_decode_available}>{t('Software')}{compressed && !format?.software_decode_available ? ` ${t('unavailable')}` : ''}</option>
          </select>
        </div>
      </>
    )
  }

  function renderALSAConfigControls(
    config: Record<string, string>,
    setConfig: Dispatch<SetStateAction<Record<string, string>>>,
  ) {
    const device = alsaDeviceForConfig(config)

    return (
      <>
        <div className="source-create-row">
          <label>{t('Detected Device')}</label>
          <select
            value={device?.device ?? ''}
            onChange={(event) => {
              const selected = alsaDevices.find((entry) => entry.device === event.target.value)
              setConfig((prev) => ({ ...prev, device: selected?.device ?? prev.device ?? 'hw:0,2' }))
            }}
          >
            <option value="">{t('Manual device')}</option>
            {alsaDevices.map((entry) => (
              <option key={entry.id} value={entry.device}>{entry.display_name || entry.device}</option>
            ))}
          </select>
        </div>
        <div className="source-create-row">
          <label>{t('Manual Device')}</label>
          <input
            value={config.device ?? 'hw:0,2'}
            onChange={(event) => setConfig((prev) => ({ ...prev, device: event.target.value }))}
            placeholder="hw:1,0 or plughw:C920,0"
          />
        </div>
        <div className="source-create-row source-create-row-inline">
          <label>{t('Discovery')}</label>
          <div className="source-field-stack">
            <button type="button" onClick={() => loadALSADevices().then((devices) => setConfig((prev) => applyALSADefaults(prev, devices)))}>{t('Refresh Devices')}</button>
            <small className="source-field-hint">{alsaDiscoveryStatus || t('Use refresh to query target ALSA capture devices.')}</small>
          </div>
        </div>
      </>
    )
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
            {t('Upload')}
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
          {uploadStatus?.message ?? t('Upload {kind} file, or paste a path/URI.', { kind: field.asset_kind })}
        </div>
      </div>
    )
  }

  function movePanel(targetRegion: DockRegion, targetIndex: number) {
    if (!dragPanel) {
      return
    }
    let sourceRegion: DockRegion | null = null
    let sourceIndex = -1
    for (const region of Object.keys(dockLayout) as DockRegion[]) {
      const index = dockLayout[region].indexOf(dragPanel)
      if (index >= 0) {
        sourceRegion = region
        sourceIndex = index
        break
      }
    }
    if (!sourceRegion || sourceIndex < 0) {
      return
    }
    const nextLayout: DockLayout = {
      left: [...dockLayout.left],
      right: [...dockLayout.right],
      bottom: [...dockLayout.bottom],
    }
    nextLayout[sourceRegion].splice(sourceIndex, 1)
    const adjustedIndex = sourceRegion === targetRegion && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex
    nextLayout[targetRegion].splice(Math.max(0, Math.min(adjustedIndex, nextLayout[targetRegion].length)), 0, dragPanel)
    setDockLayout(nextLayout)
    saveDockLayout(nextLayout)
  }

  function resetWorkspaceLayout() {
    setDockLayout(DEFAULT_DOCK_LAYOUT)
    setDockSizes(DEFAULT_DOCK_SIZES)
    saveDockLayout(DEFAULT_DOCK_LAYOUT)
    saveDockSizes(DEFAULT_DOCK_SIZES)
    setStatus(t('Workspace layout reset'))
  }

  async function openSettings() {
    let latestState = state
    try {
      await refreshState()
      latestState = getState()
    } catch (_) {}

    const canvasState = latestState.pendingCanvas || latestState.canvas
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
        keyframe_interval: String(cfg.keyframe_interval || cfg.gop_size || 60),
        gop_preset: cfg.gop_preset || (cfg.enable_b_frames ? 'b_frames' : 'low_delay'),
        enable_b_frames: Boolean(cfg.enable_b_frames),
        rc_mode: String(cfg.rc_mode ?? 0),
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
      file_path_mode: enc.file_path_mode || 'file',
      file_prefix: enc.file_prefix || 'stream',
      file_container: enc.file_container || inferFileOutputType(enc.file_path),
    })
    setSettingsTab('output')
    setSettingsOpen(true)
  }

  const selectedOutput = editingOutputId ? outputEntries.find((output: any) => output.id === editingOutputId) : null

  async function applySettings() {
    if (settingsTab === 'canvas') {
      await updateCanvas(canvasSettingsPatch()).then(() => applyCanvas()).then(() => {
        setStatus(t('Saved canvas settings applied with full reinitialization'))
        setSettingsOpen(false)
      }).catch((e) => setStatus(String(e)))
      return
    } else if (settingsTab === 'encoder') {
      await updateEncoderConfig({
        codec: sharedEncoder.codec,
        bitrate_kbps: Number(sharedEncoder.bitrate_kbps),
        keyframe_interval: Number(sharedEncoder.keyframe_interval),
        gop_preset: sharedEncoder.gop_preset,
        enable_b_frames: sharedEncoder.enable_b_frames,
        rc_mode: Number(sharedEncoder.rc_mode),
      }).then(() => setStatus(t('Encoder config updated'))).catch((e) => setStatus(String(e)))
    } else if (settingsTab === 'preview') {
      const wasActive = Boolean(previewController)
      try {
        if (previewController) {
          setStatus(t('Stopping preview before applying encoder settings...'))
          await previewController.stop()
          setPreviewController(null)
        }
        await updatePreviewEncoderConfig({
          downscale_factor: Number(previewEncoder.downscale_factor),
          framerate: Number(previewEncoder.framerate),
          bitrate_kbps: Number(previewEncoder.bitrate_kbps),
        })
        if (wasActive) {
          const controller = await startPreviewSession()
          setPreviewController(controller)
          setStatus(t('Preview encoder config updated and preview restarted'))
        } else {
          setStatus(t('Preview encoder config updated'))
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
        patch.file_path_mode = editOutputTransport.file_path_mode || 'file'
        patch.file_prefix = editOutputTransport.file_prefix || 'stream'
        patch.file_container = editOutputTransport.file_container || inferFileOutputType(editOutputTransport.file_path)
      }
      await updateOutput(editingOutputId, { encoder: patch }).then(() => setStatus(t('Output transport updated'))).catch((e) => setStatus(String(e)))
    } else if (settingsTab === 'auth') {
      try {
        if (authSettings.passwordless) {
          await setPasswordlessAuth(true)
          setStatus(t('Password authentication disabled'))
        } else {
          if (!authSettings.username.trim() || !authSettings.password) {
            setStatus(t('Username and new password are required'))
            return
          }
          await updateAuthCredentials(authSettings.username.trim(), authSettings.password)
          setAuthSettings((current) => ({ ...current, password: '' }))
          setStatus(t('Authentication credentials updated'))
        }
      } catch (e) {
        setStatus(String(e))
        return
      }
    }
    setSettingsOpen(false)
  }

  function canvasSettingsPatch() {
    const currentCanvas = state.pendingCanvas || state.canvas
    const patch: typeof settingsCanvas = { ...settingsCanvas }

    if (currentCanvas?.width === patch.width) {
      delete (patch as Partial<typeof settingsCanvas>).width
    }
    if (currentCanvas?.height === patch.height) {
      delete (patch as Partial<typeof settingsCanvas>).height
    }

    return patch
  }

  async function saveCanvasSettings() {
    await updateCanvas(canvasSettingsPatch()).then(() => setStatus(t('Canvas settings saved. Waiting for apply.'))).catch((e) => setStatus(String(e)))
  }

  function renderSettingsBody() {
    const sinkType = editOutputTransport.sink_type || 'srt'
    if (settingsTab === 'interface') {
      return (
        <>
          <div className="settings-section-title">{t('Interface')}</div>
          <div className="settings-row">
            <label>{t('Language')}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </>
      )
    }
    if (settingsTab === 'canvas') {
      return (
        <>
          <div className="settings-warning">{t('Canvas settings are saved first. Apply will fully reinitialize sources, compositor, and outputs.')}</div>
          {state.canvasRestartRequired && state.pendingCanvas && (
            <div className="settings-warning">{t('Settings changed, waiting for apply.')}</div>
          )}
          <div className="settings-section-title">{t('Video')}</div>
          <div className="settings-row">
            <label>{t('Resolution')}</label>
            <div className="settings-inline">
              <input type="number" value={settingsCanvas.width} onChange={(e) => setSettingsCanvas((s) => ({ ...s, width: Number(e.target.value) }))} />
              <span>x</span>
              <input type="number" value={settingsCanvas.height} onChange={(e) => setSettingsCanvas((s) => ({ ...s, height: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="settings-row">
            <label>{t('Framerate')}</label>
            <div className="settings-inline">
              <input type="number" value={settingsCanvas.fps_num} onChange={(e) => setSettingsCanvas((s) => ({ ...s, fps_num: Number(e.target.value) }))} />
              <span>/</span>
              <input type="number" value={settingsCanvas.fps_den} onChange={(e) => setSettingsCanvas((s) => ({ ...s, fps_den: Number(e.target.value) || 1 }))} style={{ width: 50 }} />
            </div>
          </div>
          <div className="settings-section-title">{t('Color')}</div>
          <div className="settings-row">
            <label>{t('Color Mode')}</label>
            <select value={settingsCanvas.color_mode} onChange={(e) => setSettingsCanvas((s) => ({ ...s, color_mode: e.target.value }))}>
              <option value="sdr">SDR</option>
              <option value="hdr10">HDR10</option>
            </select>
          </div>
          <div className="settings-row">
            <label>{t('Background')}</label>
            <input type="color" value={settingsCanvas.background_color} onChange={(e) => setSettingsCanvas((s) => ({ ...s, background_color: e.target.value }))} />
          </div>
        </>
      )
    }
    if (settingsTab === 'encoder') {
      return (
        <>
          <div className="settings-warning">{t('Shared encoder settings apply to all outputs. Changing will briefly restart the encoder pipeline.')}</div>
          <div className="settings-section-title">{t('Encoder')}</div>
          <div className="settings-row">
            <label>{t('Codec')}</label>
            <select value={sharedEncoder.codec} onChange={(e) => setSharedEncoder((s) => ({ ...s, codec: e.target.value }))}>
              <option value="h265">H.265 (HEVC)</option>
              <option value="h264">H.264 (AVC)</option>
            </select>
          </div>
          <div className="settings-row">
            <label>{t('Bitrate')}</label>
            <div className="settings-inline">
              <input type="number" value={sharedEncoder.bitrate_kbps} onChange={(e) => setSharedEncoder((s) => ({ ...s, bitrate_kbps: e.target.value }))} />
              <span>kbps</span>
            </div>
          </div>
          <div className="settings-row">
            <label>{t('GOP Preset')}</label>
            <select value={sharedEncoder.gop_preset} onChange={(e) => setSharedEncoder((s) => ({ ...s, gop_preset: e.target.value, enable_b_frames: e.target.value === 'b_frames' }))}>
              <option value="low_delay">{t('Low delay (IP only)')}</option>
              <option value="b_frames">{t('B-frames enabled')}</option>
            </select>
          </div>
          <div className="settings-row">
            <label>{t('Keyframe Interval')}</label>
            <div className="settings-inline">
              <input type="number" value={sharedEncoder.keyframe_interval} onChange={(e) => setSharedEncoder((s) => ({ ...s, keyframe_interval: e.target.value }))} />
              <span>frames</span>
            </div>
          </div>
          <div className="settings-row">
            <label>{t('Rate Control')}</label>
            <select value={sharedEncoder.rc_mode} onChange={(e) => setSharedEncoder((s) => ({ ...s, rc_mode: e.target.value }))}>
              <option value="0">VBR</option>
              <option value="1">CBR</option>
            </select>
          </div>
        </>
      )
    }
    if (settingsTab === 'preview') {
      const previewScale = Number(previewEncoder.downscale_factor) || DEFAULT_PREVIEW_DOWNSCALE_FACTOR
      const previewWidth = previewEncoderAxis(state.canvas?.width ?? DEFAULT_CANVAS_W, previewScale)
      const previewHeight = previewEncoderAxis(state.canvas?.height ?? DEFAULT_CANVAS_H, previewScale)
      return (
        <>
          <div className="settings-warning">{t('Preview encoder settings for WebRTC preview. If preview is active, Apply restarts it automatically.')}</div>
          <div className="settings-section-title">{t('Preview Encoder')}</div>
          <div className="settings-row">
            <label>{t('Resolution Scale')}</label>
            <div className="settings-inline">
              <select value={previewEncoder.downscale_factor} onChange={(e) => setPreviewEncoder((s) => ({ ...s, downscale_factor: e.target.value }))}>
                <option value="1">{t('1x original')}</option>
                <option value="2">{t('2x downscale')}</option>
                <option value="4">{t('4x downscale')}</option>
                <option value="5">{t('5x downscale')}</option>
                <option value="6">{t('6x downscale')}</option>
                <option value="8">{t('8x downscale')}</option>
              </select>
              <span>{previewWidth}x{previewHeight}</span>
            </div>
          </div>
          <div className="settings-row">
            <label>{t('Framerate')}</label>
            <div className="settings-inline">
              <input type="number" value={previewEncoder.framerate} onChange={(e) => setPreviewEncoder((s) => ({ ...s, framerate: e.target.value }))} />
              <span>fps</span>
            </div>
          </div>
          <div className="settings-row">
            <label>{t('Bitrate')}</label>
            <div className="settings-inline">
              <input type="number" value={previewEncoder.bitrate_kbps} onChange={(e) => setPreviewEncoder((s) => ({ ...s, bitrate_kbps: e.target.value }))} />
              <span>kbps</span>
            </div>
          </div>
        </>
      )
    }
    if (settingsTab === 'auth') {
      return (
        <>
          <div className="settings-warning">{t('Passwordless mode disables WebUI/API login checks. Use it only on trusted local networks.')}</div>
          <div className="settings-section-title">{t('Authentication')}</div>
          <div className="settings-row">
            <label>{t('Passwordless Mode')}</label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={authSettings.passwordless}
                onChange={(e) => setAuthSettings((s) => ({ ...s, passwordless: e.target.checked }))}
              />
              {t('Disable username/password login')}
            </label>
          </div>
          {!authSettings.passwordless && (
            <>
              <div className="settings-row">
                <label>{t('Username')}</label>
                <input value={authSettings.username} onChange={(e) => setAuthSettings((s) => ({ ...s, username: e.target.value }))} />
              </div>
              <div className="settings-row">
                <label>{t('New Password')}</label>
                <input type="password" value={authSettings.password} onChange={(e) => setAuthSettings((s) => ({ ...s, password: e.target.value }))} />
              </div>
              <div className="settings-empty">{t('Applying replaces the current username/password and signs this browser in with the new credentials.')}</div>
            </>
          )}
          <div className="settings-section-title">{t('API Keys')}</div>
          <div className="settings-row">
            <label>{t('Create Key')}</label>
            <div className="settings-inline auth-api-create">
              <input
                value={newApiKeyName}
                onChange={(e) => setNewApiKeyName(e.target.value)}
                placeholder={t('Key name')}
              />
              <button type="button" onClick={() => handleCreateApiKey()}>{t('Create')}</button>
              <button type="button" onClick={() => listApiKeys().catch((e) => setStatus(String(e)))}>{t('Refresh')}</button>
            </div>
          </div>
          {newApiKey && (
            <div className="settings-api-key-created">
              <span>{t('Copy this key now. It will not be shown again.')}</span>
              <code>{newApiKey}</code>
              <button type="button" onClick={() => setNewApiKey('')}>{t('Dismiss')}</button>
            </div>
          )}
          <div className="auth-key-list">
            {(state.auth.api_keys ?? []).length === 0 ? (
              <div className="settings-empty">{t('No API keys have been created.')}</div>
            ) : (state.auth.api_keys ?? []).map((key) => (
              <div className="auth-key-row" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <span>{key.created_at || key.id}</span>
                </div>
                <button type="button" onClick={() => handleDeleteApiKey(key.id)}>{t('Delete')}</button>
              </div>
            ))}
          </div>
        </>
      )
    }
    if (settingsTab === 'config') {
      return (
        <>
          <div className="settings-warning">{t('Import replaces the active SBS scenes, sources, outputs, canvas, and audio settings, then restarts affected runtime pipelines.')}</div>
          <div className="settings-section-title">{t('Export Configuration')}</div>
          <div className="settings-warning">{t('Exported configurations may include local paths and streaming credentials. Do not share them publicly.')}</div>
          <div className="settings-row">
            <label>{t('Download')}</label>
            <div className="settings-inline">
              <button type="button" onClick={() => handleExportConfig()}>{t('Export JSON')}</button>
            </div>
          </div>
          <div className="settings-section-title">{t('Import Configuration')}</div>
          <div className="settings-row">
            <label>{t('File')}</label>
            <input type="file" accept=".json,application/json" onChange={handleConfigFile} />
          </div>
          <textarea
            className="config-import-text"
            value={configImportText}
            onChange={(e) => setConfigImportText(e.target.value)}
            placeholder={t('Paste an SBS config bundle as JSON, or choose a JSON file above.')}
          />
          <div className="settings-inline">
            <button type="button" className="btn-primary" onClick={() => handleImportConfig()} disabled={!configImportText.trim()}>{t('Import and Apply')}</button>
            <button type="button" onClick={() => setConfigImportText('')} disabled={!configImportText}>{t('Clear')}</button>
          </div>
        </>
      )
    }
    // output tab
    return (
      <>
        <div className="settings-section-title">{t('Transport')}</div>
        <div className="settings-row">
          <label>{t('Output')}</label>
          <select
            value={editingOutputId || ''}
            onChange={(e) => {
              const output = outputEntries.find((entry: any) => entry.id === e.target.value)
              if (output) openOutputTransport(output)
            }}
          >
            <option value="" disabled>{t('Select output')}</option>
            {outputEntries.map((output: any) => (
              <option key={output.id} value={output.id}>{output.name || output.id}</option>
            ))}
          </select>
        </div>
        {selectedOutput ? (
          <>
            <div className="settings-row">
              <label>{t('Sink Type')}</label>
              <select value={sinkType} onChange={(e) => setEditOutputTransport((s) => ({ ...s, sink_type: e.target.value }))}>
                <option value="srt">SRT</option>
                <option value="rtmp">RTMP</option>
                <option value="file">{t('File')}</option>
                <option value="fakesink">{t('Fakesink')}</option>
              </select>
            </div>
            {sinkType === 'srt' && (
              <>
                <div className="settings-row">
                  <label>{t('SRT URI')}</label>
                  <input value={editOutputTransport.srt_uri || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, srt_uri: e.target.value }))} />
                </div>
                <div className="settings-row">
                  <label>{t('Latency')}</label>
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
                  <label>{t('RTMP URI')}</label>
                  <input value={editOutputTransport.rtmp_uri || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, rtmp_uri: e.target.value }))} />
                </div>
                <div className="settings-row">
                  <label>{t('Stream Key')}</label>
                  <input type="password" value={editOutputTransport.rtmp_passcode || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, rtmp_passcode: e.target.value }))} />
                </div>
              </>
            )}
            {sinkType === 'file' && (
              <>
                <div className="settings-row">
                  <label>{t('File Type')}</label>
                  <select value={editOutputTransport.file_container || 'ts'} onChange={(e) => setEditOutputTransport((s) => ({ ...s, file_container: e.target.value }))}>
                    <option value="ts">MPEG-TS (.ts)</option>
                    <option value="mkv">Matroska (.mkv)</option>
                    <option value="flv">Flash Video (.flv)</option>
                    <option value="mp4">MP4 (.mp4)</option>
                  </select>
                </div>
                <div className="settings-row">
                  <label>{t('Path Type')}</label>
                  <select value={editOutputTransport.file_path_mode || 'file'} onChange={(e) => setEditOutputTransport((s) => ({ ...s, file_path_mode: e.target.value }))}>
                    <option value="file">{t('File')}</option>
                    <option value="directory">{t('Directory')}</option>
                  </select>
                </div>
                <div className="settings-row">
                  <label>{(editOutputTransport.file_path_mode || 'file') === 'directory' ? t('Directory') : t('File Path')}</label>
                  <input value={editOutputTransport.file_path || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, file_path: e.target.value }))} />
                </div>
                {(editOutputTransport.file_path_mode || 'file') === 'directory' && (
                  <div className="settings-row">
                    <label>{t('Filename Prefix')}</label>
                    <input value={editOutputTransport.file_prefix || ''} onChange={(e) => setEditOutputTransport((s) => ({ ...s, file_prefix: e.target.value }))} />
                  </div>
                )}
                {(editOutputTransport.file_path_mode || 'file') === 'directory' && (
                  <div className="settings-hint">{t('Files are written as prefix-date.suffix, for example {prefix}-YYYYMMDD-HHMMSS.{suffix}.', { prefix: editOutputTransport.file_prefix || 'stream', suffix: editOutputTransport.file_container || 'ts' })}</div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="settings-empty">{t('Select an output to edit its transport settings.')}</div>
        )}
      </>
    )
  }

  function renderSettingsDialog() {
    if (!settingsOpen) return null
    return (
      <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
        <div className="settings-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>{t('Settings')}</h2>
            <button onClick={() => setSettingsOpen(false)}>X</button>
          </div>
          <div className="settings-content">
            <nav className="settings-sidebar">
              <button className={settingsTab === 'interface' ? 'active' : ''} onClick={() => setSettingsTab('interface')}>{t('Interface')}</button>
              <button className={settingsTab === 'canvas' ? 'active' : ''} onClick={() => setSettingsTab('canvas')}>{t('Video')}</button>
              <button className={settingsTab === 'encoder' ? 'active' : ''} onClick={() => {
                getEncoderConfig().then((cfg: any) => {
                  setSharedEncoder({
                    codec: cfg.codec || 'h265',
                    bitrate_kbps: String(cfg.bitrate_kbps || 20000),
                    keyframe_interval: String(cfg.keyframe_interval || cfg.gop_size || 60),
                    gop_preset: cfg.gop_preset || (cfg.enable_b_frames ? 'b_frames' : 'low_delay'),
                    enable_b_frames: Boolean(cfg.enable_b_frames),
                    rc_mode: String(cfg.rc_mode ?? 0),
                  })
                }).catch(() => {})
                setSettingsTab('encoder')
              }}>{t('Encoder')}</button>
              <button className={settingsTab === 'preview' ? 'active' : ''} onClick={() => {
                getPreviewEncoderConfig().then((cfg: any) => {
                  setPreviewEncoder({
                    width: String(cfg.width || 1280),
                    height: String(cfg.height || 720),
                    downscale_factor: String(cfg.downscale_factor || DEFAULT_PREVIEW_DOWNSCALE_FACTOR),
                    framerate: String(cfg.framerate || DEFAULT_PREVIEW_FRAMERATE),
                    bitrate_kbps: String(cfg.bitrate_kbps || 2500),
                  })
                }).catch(() => {})
                setSettingsTab('preview')
              }}>{t('Preview')}</button>
              <button className={settingsTab === 'output' ? 'active' : ''} onClick={() => setSettingsTab('output')}>{t('Output')}</button>
              <button className={settingsTab === 'auth' ? 'active' : ''} onClick={() => {
                setAuthSettings({
                  passwordless: state.auth.passwordless,
                  username: state.auth.username || authUsername || 'admin',
                  password: '',
                })
                setSettingsTab('auth')
              }}>{t('Auth')}</button>
              <button className={settingsTab === 'config' ? 'active' : ''} onClick={() => setSettingsTab('config')}>{t('Config')}</button>
            </nav>
            <div className="settings-body">
              {renderSettingsBody()}
            </div>
          </div>
          <div className="settings-footer">
            {settingsTab === 'interface' ? (
              <button className="btn-primary" onClick={() => setSettingsOpen(false)}>{t('Close')}</button>
            ) : (
              <button onClick={() => setSettingsOpen(false)}>{t('Cancel')}</button>
            )}
            {settingsTab === 'interface' || settingsTab === 'config' ? null : settingsTab === 'canvas' ? (
              <>
                <button onClick={() => saveCanvasSettings()}>{t('Save')}</button>
                <button className="btn-primary" onClick={() => applySettings()}>{t('Apply')}</button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => applySettings()}>{t('Apply')}</button>
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
        <div className="settings-dialog source-picker-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>{t('Choose Source Type')}</h2>
            <button onClick={() => setSourceCreateOpen(false)}>X</button>
          </div>
          <div className="source-picker-body">
            <div className="source-picker-title">{t('Select the kind of source to add, then configure it in the next step.')}</div>
            <div className="source-kind-grid">
              {sourceKinds.map((kind) => (
                <button key={kind.id} className="source-kind-card" onClick={() => handleSelectSourceKind(kind.id)}>
                  <strong>{kind.name}</strong>
                  <span>{kind.summary}</span>
                  <small>{kind.pausable ? t('Pausable when inactive') : t('Live source stays running')}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="settings-footer">
            <button onClick={() => setSourceCreateOpen(false)}>{t('Cancel')}</button>
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
        <div className="settings-dialog source-config-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>{t('Create {name}', { name: kind.name })}</h2>
            <button onClick={() => setSourceConfigOpen(false)}>X</button>
          </div>
          <div className="settings-body source-config-body">
            <div className="source-config-summary">
              <strong>{kind.name}</strong>
              <span>{kind.summary}</span>
              <small>{kind.pausable ? t('Can pause when inactive') : t('Live source remains running when inactive')}</small>
            </div>
            <div className="source-create-row">
              <label>{t('Name')}</label>
              <input value={sourceCreateName} onChange={(event) => setSourceCreateName(event.target.value)} />
            </div>
            {kind.id === 'v4l2src' ? renderV4L2ConfigControls(sourceCreateConfig, setSourceCreateConfig) : kind.id === 'alsa_audio' ? renderALSAConfigControls(sourceCreateConfig, setSourceCreateConfig) : (kind.fields ?? []).map((field) => (
              <div key={field.key} className="source-create-row">
                <label>{field.label}</label>
                {renderSourceFieldInput(field, sourceCreateConfig, setSourceCreateConfig)}
              </div>
            ))}
          </div>
          <div className="settings-footer">
            <button onClick={() => { setSourceConfigOpen(false); setSourceCreateOpen(true) }}>{t('Back')}</button>
            <button onClick={() => setSourceConfigOpen(false)}>{t('Cancel')}</button>
            <button className="btn-primary" onClick={() => handleCreateSourceFromCatalog().catch((error) => setStatus(String(error)))}>{t('Create Source')}</button>
          </div>
        </div>
      </div>
    )
  }

  function renderFilterEditor() {
    if (!effectiveFilterTarget || (effectiveFilterTarget.kind === 'scene' ? !activeFilterScene : !activeFilterSource)) {
      return <div className="history-list">{t('No scene or source selected to edit filters.')}</div>
    }

    const targetName = effectiveFilterTarget.kind === 'scene'
      ? (activeFilterScene?.name ?? activeFilterScene?.id)
      : (activeFilterSource?.name ?? activeFilterSource?.id)

    return (
      <>
        <div className="filter-target list-item row-item">
          <div>
            <span>{effectiveFilterTarget.kind === 'scene' ? t('Target Scene') : t('Target Source')}</span>
            <small>{targetName}</small>
          </div>
        </div>
        <div className="filter-editor">
          <div className="filter-list-pane">
            <div className="filter-section-title">{t('Effect Filters')}</div>
            <div className="filter-list" role="listbox" aria-label={t('Effect Filters')}>
              {activeFilters.length === 0 ? (
                <div className="filter-empty">{t('No filters applied.')}</div>
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
                  <small>{filter.enabled ? t('On') : t('Off')}</small>
                </button>
              ))}
            </div>
            <div className="filter-toolbar">
              <select
                aria-label={t('Add effect filter')}
                value=""
                onChange={(event) => {
                  const type = event.target.value
                  event.currentTarget.value = ''
                  handleAddFilterType(type).catch((error) => setStatus(String(error)))
                }}
              >
                <option value="">{t('+ Add')}</option>
                <option value="grayscale">{t('Grayscale')}</option>
                <option value="brightness">{t('Brightness')}</option>
                <option value="contrast">{t('Contrast')}</option>
                <option value="color_correction">{t('Color Correction')}</option>
                <option value="luma_key">{t('Luma Key')}</option>
                <option value="chroma_key">{t('Chroma Key')}</option>
                <option value="crop">{t('Crop')}</option>
                <option value="mirror">{t('Mirror')}</option>
                <option value="flip">{t('Flip')}</option>
                <option value="rotation">{t('Rotation')}</option>
                <option value="lut">{t('Apply LUT')}</option>
                <option value="hdr_to_sdr_lut">{t('HDR→SDR LUT')}</option>
                <option value="sdr_to_hdr">{t('SDR→HDR')}</option>
              </select>
              <button
                aria-label={t('Remove selected filter')}
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
                    {t('Enabled')}
                  </label>
                </div>
                {selectedFilter.type === 'color_correction' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'saturation', t('Saturation'))}
                    {renderFilterParamSlider(selectedFilter, 'brightness', t('Brightness'))}
                    {renderFilterParamSlider(selectedFilter, 'contrast', t('Contrast'))}
                    {renderFilterParamSlider(selectedFilter, 'gamma', t('Gamma'))}
                    {renderFilterParamSlider(selectedFilter, 'hue', t('Hue'))}
                  </>
                ) : selectedFilter.type === 'luma_key' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'min', t('Minimum Luma'))}
                    {renderFilterParamSlider(selectedFilter, 'max', t('Maximum Luma'))}
                    {renderFilterParamSlider(selectedFilter, 'smoothness', t('Smoothness'))}
                  </>
                ) : selectedFilter.type === 'chroma_key' ? (
                  <>
                    <label className="filter-property-row">
                      <span>{t('Key Color')}</span>
                      <div className="filter-control-row">
                        <input
                          type="color"
                          aria-label={t('Chroma key color')}
                          value={String(selectedFilter.params?.color ?? '#00ff00')}
                          onChange={(event) => handleCommitFilterColor(selectedFilter, event.target.value).catch((error) => setStatus(String(error)))}
                        />
                      </div>
                    </label>
                    {renderFilterParamSlider(selectedFilter, 'similarity', t('Similarity'))}
                    {renderFilterParamSlider(selectedFilter, 'smoothness', t('Smoothness'))}
                    {renderFilterParamSlider(selectedFilter, 'spill', t('Spill Reduction'))}
                  </>
                ) : selectedFilter.type === 'crop' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'top', t('Top'))}
                    {renderFilterParamSlider(selectedFilter, 'right', t('Right'))}
                    {renderFilterParamSlider(selectedFilter, 'bottom', t('Bottom'))}
                    {renderFilterParamSlider(selectedFilter, 'left', t('Left'))}
                  </>
                ) : selectedFilter.type === 'rotation' ? (
                  <>
                    {renderFilterParamSlider(selectedFilter, 'degrees', t('Degrees'))}
                  </>
                ) : selectedFilter.type === 'mirror' || selectedFilter.type === 'flip' ? (
                  <div className="filter-empty properties-empty">
                    {selectedFilter.type === 'mirror' ? t('Mirrors the source horizontally while enabled.') : t('Flips the source vertically while enabled.')}
                  </div>
                ) : (
                  <label className="filter-property-row">
                    <div className="filter-label-block">
                      <span>{filterAmountLabel(selectedFilter)}</span>
                      <small>{filterAmountHelp(selectedFilter)}</small>
                    </div>
                    <div className="filter-control-row">
                      <input
                        type="range"
                        aria-label={filterAmountLabel(selectedFilter)}
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
                        aria-label={`${filterAmountLabel(selectedFilter)} value`}
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
                    <small className="filter-value">{t('Current: {current} - Range: {range}', { current: formatFilterAmount(selectedFilter), range: formatFilterAmountRange(selectedFilter) })}</small>
                  </label>
                )}
                {(selectedFilter.type === 'hdr_to_sdr_lut' || selectedFilter.type === 'sdr_to_hdr') && (
                  <>
                    {renderHdrFilterSlider(selectedFilter, 'saturation', t('Saturation'))}
                    {renderHdrFilterSlider(selectedFilter, 'brightness', t('Brightness'))}
                    {renderHdrFilterSlider(selectedFilter, 'hue', t('Hue'))}
                    {selectedFilter.type === 'hdr_to_sdr_lut' && (
                      <label className="filter-property-row">
                        <span>{t('Path')}</span>
                        <input
                          value={String(selectedFilter.params?.path ?? '')}
                          placeholder={t('Built-in HDR→SDR LUT')}
                          onChange={(event) => {
                            if (!effectiveFilterTarget) return
                            const params = { ...(selectedFilter.params ?? {}), amount: defaultFilterAmount(selectedFilter), path: event.target.value }
                            const update = effectiveFilterTarget.kind === 'scene'
                              ? updateSceneFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                              : updateFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                            update.then(() => setStatus(t('Updated LUT path'))).catch((error) => setStatus(String(error)))
                          }}
                        />
                      </label>
                    )}
                  </>
                )}
                {selectedFilter.type === 'lut' && (
                  <label className="filter-property-row">
                    <span>{t('Path')}</span>
                    <input
                      value={String(selectedFilter.params?.path ?? '')}
                      placeholder="/path/to/filter.cube"
                      onChange={(event) => {
                        if (!effectiveFilterTarget) return
                        const params = { ...(selectedFilter.params ?? {}), amount: defaultFilterAmount(selectedFilter), path: event.target.value }
                        const update = effectiveFilterTarget.kind === 'scene'
                          ? updateSceneFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                          : updateFilter(effectiveFilterTarget.id, selectedFilter.id, selectedFilter.enabled, params)
                        update.then(() => setStatus(t('Updated LUT path'))).catch((error) => setStatus(String(error)))
                      }}
                    />
                  </label>
                )}
              </>
            ) : (
              <div className="filter-empty properties-empty">{t('Select or add an effect filter.')}</div>
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
        <div className="settings-dialog filters-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>{t('Effect Filters')}</h2>
            <button onClick={() => setFiltersOpen(false)}>X</button>
          </div>
          <div className="settings-content">
            <nav className="settings-sidebar filters-source-sidebar" aria-label={t('Filter source selection')}>
              <div className="ctx-group-label">{t('Scenes')}</div>
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
              <div className="ctx-group-label">{t('Sources')}</div>
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
            <button className="btn-primary" onClick={() => setFiltersOpen(false)}>{t('Close')}</button>
          </div>
        </div>
      </div>
    )
  }

  function renderAudioFilterDialog() {
    if (!audioFilterEditor) return null
    const scene = (state.scenes as Record<string, any>)[audioFilterEditor.sceneId]
    const item = (scene?.items as any[])?.find((entry: any) => entry.id === audioFilterEditor.itemId)
    const source = (state.sources as Record<string, any>)[audioFilterEditor.sourceId]
    if (!item || !source) return null

    const audio = audioStateForSceneItem(item, source)
    const enabled = audio.enabled !== false
    const eqBands = audioEqBands(audio)
    const device = audio.device || source.audio?.device || 'hw:0,2'
    const setAudio = (patch: Record<string, unknown>) => updateSceneItemAudio(audioFilterEditor.sceneId, item, source, { device, ...patch })
    const title = audioFilterEditor.type === 'channel_gain'
      ? t('Audio Filter: Channel Gain')
      : audioFilterEditor.type === 'delay'
        ? t('Audio Filter: Delay')
        : t('Audio Filter: Equalizer')

    return (
      <div className="settings-overlay" onClick={() => setAudioFilterEditor(null)}>
        <div className="settings-dialog audio-filter-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>{title}</h2>
            <button onClick={() => setAudioFilterEditor(null)}>X</button>
          </div>
          <div className="settings-body audio-filter-body">
            <div className="source-config-summary">
              <strong>{source.name}</strong>
              <span>{device}</span>
              <small>{enabled ? t('Audio filter is active') : t('Enable audio on this strip to hear filter changes')}</small>
            </div>
            {audioFilterEditor.type === 'channel_gain' && (
              <>
                <label className="filter-property-row">
                  <div className="filter-label-block"><span>{t('Left Channel Gain')}</span><small>{t('0% mutes left, 100% is unchanged, 200% is +6 dB.')}</small></div>
                  <div className="filter-control-row">
                    <input type="range" min="0" max="2" step="0.05" value={Number(audio.left_gain ?? 1)} disabled={!enabled} onChange={(event) => setAudio({ left_gain: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                    <span className="filter-unit">{formatAudioVolume(audio.left_gain ?? 1)}</span>
                  </div>
                </label>
                <label className="filter-property-row">
                  <div className="filter-label-block"><span>{t('Right Channel Gain')}</span><small>{t('0% mutes right, 100% is unchanged, 200% is +6 dB.')}</small></div>
                  <div className="filter-control-row">
                    <input type="range" min="0" max="2" step="0.05" value={Number(audio.right_gain ?? 1)} disabled={!enabled} onChange={(event) => setAudio({ right_gain: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                    <span className="filter-unit">{formatAudioVolume(audio.right_gain ?? 1)}</span>
                  </div>
                </label>
              </>
            )}
            {audioFilterEditor.type === 'delay' && (
              <label className="filter-property-row">
                <div className="filter-label-block"><span>{t('Audio Delay')}</span><small>{t('Delays this source before mixing, useful for HDMI/video sync.')}</small></div>
                <div className="filter-control-row">
                  <input type="range" min="0" max="5000" step="10" value={Number(audio.delay_ms ?? 0)} disabled={!enabled} onChange={(event) => setAudio({ delay_ms: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                  <input className="filter-number-input" type="number" min="0" max="5000" step="10" value={Number(audio.delay_ms ?? 0)} disabled={!enabled} onChange={(event) => setAudio({ delay_ms: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                  <span className="filter-unit">ms</span>
                </div>
              </label>
            )}
            {audioFilterEditor.type === 'eq' && (
              <>
                {renderEqualizerCurve(eqBands)}
                {renderEqualizerFaders(eqBands, !enabled, (index, value) => {
                  const next = [...eqBands]
                  next[index] = Math.max(-12, Math.min(12, value))
                  setAudio({ eq_bands: next }).catch((error) => setStatus(String(error)))
                })}
              </>
            )}
          </div>
          <div className="settings-footer">
            <button onClick={() => setAudioFilterEditor(null)}>{t('Close')}</button>
          </div>
        </div>
      </div>
    )
  }

  function renderMasterAudioFilterDialog() {
    if (!masterAudioFilterEditor) return null

    const eqBands = masterEqBands()
    const leftGain = Number(state.audio.master_left_gain ?? 1)
    const rightGain = Number(state.audio.master_right_gain ?? 1)
    const setMasterFilter = (patch: Record<string, unknown>) => setMasterAudio(state.audio.master_volume, state.audio.master_mute, {
      left_gain: state.audio.master_left_gain ?? 1,
      right_gain: state.audio.master_right_gain ?? 1,
      eq_bands: eqBands,
      ...patch,
    })
    const title = masterAudioFilterEditor === 'channel_gain'
      ? t('Global Audio Filter: Channel Gain')
      : t('Global Audio Filter: Equalizer')

    return (
      <div className="settings-overlay" onClick={() => setMasterAudioFilterEditor(null)}>
        <div className="settings-dialog audio-filter-dialog" role="dialog" aria-modal="true" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="settings-header">
            <h2>{title}</h2>
            <button onClick={() => setMasterAudioFilterEditor(null)}>X</button>
          </div>
          <div className="settings-body audio-filter-body">
            <div className="source-config-summary">
              <strong>{t('Master Output')}</strong>
              <span>{t('Global program audio')}</span>
              <small>{t('Applies after all scene sources are mixed.')}</small>
            </div>
            {masterAudioFilterEditor === 'channel_gain' && (
              <>
                <label className="filter-property-row">
                  <div className="filter-label-block"><span>{t('Left Channel Gain')}</span><small>{t('0% mutes left, 100% is unchanged, 200% is +6 dB.')}</small></div>
                  <div className="filter-control-row">
                    <input type="range" min="0" max="2" step="0.05" value={leftGain} onChange={(event) => setMasterFilter({ left_gain: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                    <span className="filter-unit">{formatAudioVolume(leftGain)}</span>
                  </div>
                </label>
                <label className="filter-property-row">
                  <div className="filter-label-block"><span>{t('Right Channel Gain')}</span><small>{t('0% mutes right, 100% is unchanged, 200% is +6 dB.')}</small></div>
                  <div className="filter-control-row">
                    <input type="range" min="0" max="2" step="0.05" value={rightGain} onChange={(event) => setMasterFilter({ right_gain: Number(event.target.value) }).catch((error) => setStatus(String(error)))} />
                    <span className="filter-unit">{formatAudioVolume(rightGain)}</span>
                  </div>
                </label>
              </>
            )}
            {masterAudioFilterEditor === 'eq' && (
              <>
                {renderEqualizerCurve(eqBands)}
                {renderEqualizerFaders(eqBands, false, (index, value) => {
                  const next = [...eqBands]
                  next[index] = Math.max(-12, Math.min(12, value))
                  setMasterFilter({ eq_bands: next }).catch((error) => setStatus(String(error)))
                })}
              </>
            )}
          </div>
          <div className="settings-footer">
            <button onClick={() => setMasterAudioFilterEditor(null)}>{t('Close')}</button>
          </div>
        </div>
      </div>
    )
  }

  function renderDock(panel: DockPanel) {
    if (panel === 'scenes') {
      return (
        <>
          <div className="panel-title-row"><h2>{t('Scenes')}</h2><button onClick={() => handleCreateScene().catch((error) => setStatus(String(error)))}>{t('+ Scene')}</button></div>
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
                  onClick={() => setActiveScene(scene.id, 'trans-fade').then(() => setStatus(t('Active scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))}
                >
                  <span>{scene.name}</span>
                  <small>{scene.id}{scene.id === state.previewSceneId && scene.id !== state.activeSceneId ? ` · ${t('preview')}` : ''}</small>
                </button>
                <button onClick={() => setPreviewScene(scene.id).then(() => setStatus(t('Preview scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))} disabled={scene.id === state.previewSceneId}>
                  {t('Preview')}
                </button>
                <button onClick={() => removeScene(scene.id).then(() => setStatus(t('Removed scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))} disabled={sceneEntries.length <= 1}>
                  {t('Delete')}
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
          <div className="panel-title-row"><h2>{t('Sources')}</h2><button onClick={() => handleOpenSourceCatalog().catch((error) => setStatus(String(error)))}>{t('+ Source')}</button></div>
          <div className="list-panel compact">
            {sourcePanelEntries.map((source) => {
              if (state.editingSourceId === source.id) {
                return (
                  <div key={source.id} className="source-edit-form">
                    <div className="source-create-row">
                      <label>{t('Name')}</label>
                      <input value={sourceEditName} onChange={(e) => setSourceEditName(e.target.value)} />
                    </div>
                    <div className="source-create-row">
                      <label>{t('Enabled')}</label>
                      <input type="checkbox" checked={sourceEditEnabled} onChange={(e) => setSourceEditEnabled(e.target.checked)} />
                    </div>
                    {(() => {
                      const src = source as any
                      const kindId = src.type
                      const kind = sourceKinds.find((k) => k.id === kindId)
                      if (!kind) return null
                      if (kind.id === 'v4l2src') return renderV4L2ConfigControls(sourceEditConfig, setSourceEditConfig)
                      if (kind.id === 'alsa_audio') return renderALSAConfigControls(sourceEditConfig, setSourceEditConfig)
                      if ((kind.fields ?? []).length === 0) return null
                      return (kind.fields ?? []).map((field) => (
                        <div key={field.key} className="source-create-row">
                          <label>{field.label}</label>
                          {renderSourceFieldInput(field, sourceEditConfig, setSourceEditConfig)}
                        </div>
                      ))
                    })()}
                    {(source as any).state === 'running' && (
                      <div className="source-edit-notice">{t('Changes to config may require restarting the source to take effect')}</div>
                    )}
                    <div className="button-row">
                      <button onClick={async () => {
                        const patch: Record<string, unknown> = { name: sourceEditName, enabled: sourceEditEnabled }
                        if (Object.keys(sourceEditConfig).length > 0) patch.config = sourceEditConfig
                        await updateSource(source.id, patch as any).catch((e) => setStatus(String(e)))
                        setEditingSourceId(null)
                        setStatus(t('Updated source: {name}', { name: sourceEditName }))
                      }}>{t('Save')}</button>
                      <button onClick={() => setEditingSourceId(null)}>{t('Cancel')}</button>
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
                    <button className="visibility-btn" title={sceneItemForSource ? (sourceVisibleInScene ? t('Hide in scene') : t('Show in scene')) : t('Add to scene')} onClick={async () => {
                      if (!state.activeSceneId) return
                      if (sceneItemForSource) {
                        await updateSceneItem(state.activeSceneId, sceneItemForSource.id, { visible: !sourceVisibleInScene }).catch((e) => setStatus(String(e)))
                        selectSource(source.id)
                      } else {
                        await addSceneItem(state.activeSceneId, source.id).catch((e) => setStatus(String(e)))
                      }
                    }}>
                      {sceneItemForSource ? (sourceVisibleInScene ? t('Hide') : t('Show')) : t('Add')}
                    </button>
                    <button className="source-order-btn" title={t('Move layer up')} disabled={!sceneItemForSource} onClick={() => moveSourceInActiveScene(source.id, 'up').catch((error) => setStatus(String(error)))}>
                      {t('Up')}
                    </button>
                    <button className="source-order-btn" title={t('Move layer down')} disabled={!sceneItemForSource} onClick={() => moveSourceInActiveScene(source.id, 'down').catch((error) => setStatus(String(error)))}>
                      {t('Down')}
                    </button>
                    <button onClick={() => {
                      openSourceEditor(source).catch((error) => setStatus(String(error)))
                    }}>
                      {t('Edit')}
                    </button>
                    <button onClick={() => handleRenameSource(source.id, source.name).catch((error) => setStatus(String(error)))}>
                      {t('Rename')}
                    </button>
                    <button onClick={() => removeSource(source.id).then(() => setStatus(t('Removed source: {name}', { name: source.name }))).catch((error) => setStatus(String(error)))}>
                      {t('Delete')}
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
          <div className="panel-title-row"><h2>{t('Controls')}</h2></div>
            <div className="control-column">
              <button onClick={() => handleCreateOutput().catch((error) => setStatus(String(error)))}>{t('+ Output')}</button>
              {outputEntries.map((output: any) => {
                return (
                  <div key={output.id} className="output-card">
                    <div className="output-card-header">
                      <span className={`output-state-dot ${outputIndicatorClass(output)}`} title={outputStatusTitle(output)} />
                      <strong>{output.name || output.id}</strong>
                      <small>{outputStatusLabel(output)}</small>
                    </div>
                    <div className="button-row compact-row">
                      <button onClick={() => runCommand(`output ${output.state === 'running' ? 'stop' : 'start'} ${output.id}`).then(() => setStatus(t('{id} toggled', { id: output.id }))).catch((error) => setStatus(String(error)))}>
                        {output.state === 'running' ? t('Stop') : t('Start')}
                      </button>
                      <button onClick={() => openOutputTransport(output)}>
                        {t('Settings')}
                      </button>
                      <button onClick={() => removeOutput(output.id).then(() => setStatus(t('Removed output: {name}', { name: output.name }))).catch((error) => setStatus(String(error)))}>
                        {t('Delete')}
                      </button>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => refreshState().then(() => setStatus(t('State refreshed'))).catch((error) => setStatus(String(error)))}>{t('Refresh State')}</button>
              <button onClick={() => resetWorkspaceLayout()}>{t('Reset Layout')}</button>
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
          <div className="panel-title-row"><h2>{t('Audio Mixer')}</h2><small>{state.audio.device || 'hw:0,2'}</small></div>
          <div className="audio-mixer-panel">
            <div className="audio-device-summary">
              <div>
                <strong>{activeScene?.name ?? t('Active Scene')} {t('Mixer')}</strong>
                <small>{audioInfo.backend ?? t('audio')} · {t('scene-scoped controls')} · {state.audio.device || 'hw:0,2'}</small>
              </div>
              <div className="audio-summary-actions">
                <button className={previewPlaybackEnabled ? 'active' : ''} onClick={() => setPreviewPlaybackEnabled((enabled) => !enabled)}>
                  {previewPlaybackEnabled ? t('Preview audio on') : t('Preview audio off')}
                </button>
                <span className={audioInfo.hifi?.available ? 'audio-status-pill live' : 'audio-status-pill'}>
                  {audioInfo.hifi?.available ? t('HiFi bridge ready') : t('Audio bridge unknown')}
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
                const volumeValue = Number(audio.volume ?? 1)
                const setAudio = (patch: Record<string, unknown>) => updateSceneItemAudio(state.activeSceneId || '', item, source, patch)
                return (
                  <div
                    key={item.id}
                    className={`obs-audio-strip ${enabled ? 'enabled' : 'disabled'} ${muted ? 'muted' : ''}`}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setAudioContextMenu({ x: event.clientX, y: event.clientY, sceneId: state.activeSceneId || '', itemId: item.id, sourceId: source.id })
                    }}
                    title={t('Right-click for audio filters')}
                  >
                    <div className="obs-audio-scope">{active ? t('Active') : t('Scene')}</div>
                    <button className="obs-audio-name" title={source.name} onClick={() => selectSceneItem(item.id)}>
                      {source.name}
                    </button>
                    <div className="obs-audio-db">{formatAudioDb(meter.level_db)}</div>
                    <div className="obs-volume-value" title={t('Volume gain: 100% is unchanged; 200% is +6 dB gain.')}>{formatAudioVolume(volumeValue)}</div>
                    <div className="obs-audio-body">
                      <input
                        className="obs-volume-fader"
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={volumeValue}
                        onChange={(event) => setAudio({ volume: Number(event.target.value), enabled: true, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(t('Audio updated: {name}', { name: source.name }))).catch((error) => setStatus(String(error)))}
                        aria-label={`${source.name} volume, ${formatAudioVolume(volumeValue)}`}
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
                      <button className={enabled ? 'active' : ''} onClick={() => setAudio({ enabled: !enabled, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(t(enabled ? 'Audio off: {name}' : 'Audio on: {name}', { name: source.name }))).catch((error) => setStatus(String(error)))}>{enabled ? t('On') : t('Off')}</button>
                      <button className={!muted ? 'active' : ''} disabled={!enabled} onClick={() => setAudio({ mute: !audio.mute, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(t(audio.mute ? 'Audio unmuted: {name}' : 'Audio muted: {name}', { name: source.name }))).catch((error) => setStatus(String(error)))}>{audio.mute ? t('Muted') : t('Mute')}</button>
                      <button className={audio.monitor ? 'active' : ''} disabled={!enabled} onClick={() => setAudio({ monitor: !audio.monitor, device: audio.device || source.audio?.device || 'hw:0,2' }).then(() => setStatus(t(audio.monitor ? 'Preview playback off: {name}' : 'Preview playback on: {name}', { name: source.name }))).catch((error) => setStatus(String(error)))}>{audio.monitor ? t('Preview') : t('No Prev')}</button>
                    </div>
                    <div className="obs-audio-filter-hint">{t('Filters: right-click')}</div>
                  </div>
                )
              })}
              <div
                className={`obs-audio-strip master-channel ${state.audio.master_mute ? 'muted' : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMasterAudioContextMenu({ x: event.clientX, y: event.clientY })
                }}
                title={t('Right-click for global audio filters')}
              >
                <div className="obs-audio-scope">{t('Global')}</div>
                <div className="obs-audio-name static">{t('Master')}</div>
                <div className="obs-audio-db">{formatAudioDb(masterLevel.level_db)}</div>
                <div className="obs-volume-value" title={t('Master volume: 100% is unchanged; 200% is +6 dB gain.')}>{formatAudioVolume(state.audio.master_volume)}</div>
                <div className="obs-audio-body">
                  <input
                    className="obs-volume-fader"
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={state.audio.master_volume}
                    onChange={(event) => setMasterAudio(Number(event.target.value), state.audio.master_mute, { left_gain: state.audio.master_left_gain ?? 1, right_gain: state.audio.master_right_gain ?? 1, eq_bands: masterEqBands() }).then(() => setStatus(t('Master audio updated'))).catch((error) => setStatus(String(error)))}
                    aria-label={`Master volume, ${formatAudioVolume(state.audio.master_volume)}`}
                  />
                  <div className="obs-meter-wrap">
                    <div className="obs-meter-track" aria-label={t('Master audio level')}>
                      <div className="obs-meter-fill" style={{ height: `${masterLevelPct}%` }} />
                      <div className="obs-meter-peak" style={{ bottom: `${masterPeakPct}%` }} />
                    </div>
                    <div className="obs-meter-scale"><span>0</span><span>-6</span><span>-12</span><span>-18</span><span>-24</span><span>-30</span><span>-36</span><span>-42</span><span>-48</span><span>-54</span><span>-60</span></div>
                  </div>
                </div>
                <div className="obs-audio-buttons">
                  <button className={!state.audio.master_mute ? 'active' : ''} onClick={() => setMasterAudio(state.audio.master_volume, !state.audio.master_mute, { left_gain: state.audio.master_left_gain ?? 1, right_gain: state.audio.master_right_gain ?? 1, eq_bands: masterEqBands() }).then(() => setStatus(t('Master mute toggled'))).catch((error) => setStatus(String(error)))}>
                    {state.audio.master_mute ? t('Muted') : t('Mute')}
                  </button>
                </div>
                <div className="obs-audio-filter-hint">{t('Filters: right-click')}</div>
              </div>
            </div>
          </div>
        </>
      )
    }

    if (panel === 'transitions') {
      return (
        <>
          <div className="panel-title-row"><h2>{t('Scene Transition')}</h2></div>
          <div className="transition-box">
            <div className="transition-pill">{t('Fade')}</div>
            <label className="source-create-row">
              <span>{t('Duration')}</span>
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
                onClick={() => updateTransition('trans-fade', Math.max(0, Number(fadeDurationMs) || 0)).then(() => setStatus(t('Fade duration: {ms} ms', { ms: Math.max(0, Number(fadeDurationMs) || 0) }))).catch((error) => setStatus(String(error)))}
            >
              {t('Apply Fade Duration')}
            </button>
            <small>{t('Program: {name}', { name: activeScene?.name ?? t('None') })}</small>
            <small>{t('Preview: {name}', { name: previewScene?.name ?? t('None') })}</small>
            {state.transitionActive && (
              <small>{t('Transitioning: {percent}%', { percent: Math.round(state.transitionProgress * 100) })}</small>
            )}
            <div className="button-row compact-row">
              <button
                disabled={!state.previewSceneId || state.previewSceneId === state.activeSceneId}
                onClick={() => transitionToPreview('trans-fade').then(() => setStatus(t('Transitioned to preview'))).catch((error) => setStatus(String(error)))}
              >
                {t('Transition')}
              </button>
              <button
                disabled={!state.previewSceneId || state.previewSceneId === state.activeSceneId}
                onClick={() => state.previewSceneId && setActiveScene(state.previewSceneId, 'trans-cut').then(() => setStatus(t('Cut to preview'))).catch((error) => setStatus(String(error)))}
              >
                {t('Cut')}
              </button>
            </div>
          </div>
        </>
      )
    }

    return null
  }

  function panelForPhoneSection(section: PhoneSection): DockPanel | null {
    if (section === 'scenes') return 'scenes'
    if (section === 'sources') return 'sources'
    if (section === 'audio') return 'mixer'
    if (section === 'outputs') return 'controls'
    return null
  }

  function phoneSectionLabel(section: PhoneSection) {
    if (section === 'scenes') return t('Scenes')
    if (section === 'sources') return t('Sources')
    if (section === 'audio') return t('Audio')
    if (section === 'outputs') return t('Outputs')
    return t('More')
  }

  function renderAdaptiveSection() {
    const panel = panelForPhoneSection(phoneSection)
    if (panel) {
      return renderDock(panel)
    }
    return (
      <>
        <div className="panel-title-row"><h2>{t('More')}</h2></div>
        <div className="control-column adaptive-more-panel">
          <button onClick={() => openSettings()}>{t('Settings')}</button>
          <button onClick={() => refreshState().then(() => setStatus(t('State refreshed'))).catch((error) => setStatus(String(error)))}>{t('Refresh State')}</button>
          <button onClick={() => resetWorkspaceLayout()}>{t('Reset Desktop Layout')}</button>
          <div className="adaptive-more-group">
            {renderDock('transitions')}
          </div>
        </div>
      </>
    )
  }

  function renderSectionNav(className: string) {
    const sections: PhoneSection[] = ['scenes', 'sources', 'audio', 'outputs', 'more']
    return (
      <nav className={className} aria-label={t('Workspace sections')}>
        {sections.map((section) => (
          <button
            key={section}
            type="button"
            aria-current={phoneSection === section ? 'page' : undefined}
            className={phoneSection === section ? 'active' : ''}
            onClick={() => setPhoneSection(section)}
          >
            {phoneSectionLabel(section)}
          </button>
        ))}
      </nav>
    )
  }

  function renderPhoneBottomNav() {
    return renderSectionNav('phone-bottom-nav')
  }

  function renderDockPanel(panel: DockPanel, region: DockRegion, index: number) {
    return (
      <section
        key={panel}
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
          movePanel(region, index)
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
        >{t('Drag')}</div>
        {renderDock(panel)}
      </section>
    )
  }

  function renderDockRegion(region: DockRegion) {
    const panels = dockLayout[region]
    const showTail = Boolean(dragPanel) && region === 'bottom'
    return (
      <>
        {panels.map((panel, index) => renderDockPanel(panel, region, index))}
        {showTail ? <div
          className={`dock-drop-tail ${panels.length === 0 ? 'empty' : ''}`}
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
            movePanel(region, panels.length)
            setDragPanel(null)
          }}
        /> : null}
      </>
    )
  }

  function renderEmptyDockDropTarget(region: DockRegion) {
    if (!dragPanel || dockLayout[region].length > 0) {
      return null
    }
    return (
      <div
        className={`empty-dock-drop-target ${region}`}
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
          movePanel(region, 0)
          setDragPanel(null)
        }}
      />
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
                setStatus(t('Preview: network error, retrying...'))
                hls?.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                setStatus(t('Preview: media error, recovering...'))
                hls?.recoverMediaError()
                break
              default:
                setStatus(t('Preview: fatal error ({details})', { details: data.details }))
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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('sbs-source-boxes-visible', sourceBoxesVisible ? 'on' : 'off')
    }
  }, [sourceBoxesVisible])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('sbs-preview-status-overlay-visible', previewStatusOverlayVisible ? 'on' : 'off')
    }
  }, [previewStatusOverlayVisible])

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
        runCommand(`scene set-active ${scene.id}`).then(() => setStatus(t('Active scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))
        return
      }

      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        togglePreview().catch((error) => setStatus(String(error)))
        return
      }

      if ((event.key === 's' || event.key === 'S') && event.shiftKey) {
        event.preventDefault()
        captureSnapshot().then((snapshot) => setStatus(t('Snapshot captured: {id}', { id: snapshot.id }))).catch((error) => setStatus(String(error)))
        return
      }

      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        refreshState().then(() => setStatus(t('State refreshed'))).catch((error) => setStatus(String(error)))
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

  if (state.connected && state.auth.checked && state.auth.setup_required && !state.auth.authenticated) {
    return (
      <div className="auth-shell setup-shell">
        <form className="auth-card setup-card" onSubmit={submitAuth}>
          <div className="auth-brand">
            <strong>{t('First Boot Setup')}</strong>
            <span>{t('Initialize this SBS server before using the studio.')}</span>
          </div>
          <label>
            {t('Language')}
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="auth-tabs">
            <button type="button" className={setupMode === 'password' ? 'active' : ''} onClick={() => setSetupMode('password')}>{t('Username / Password')}</button>
            <button type="button" className={setupMode === 'passwordless' ? 'active' : ''} onClick={() => setSetupMode('passwordless')}>{t('Passwordless')}</button>
          </div>
          {setupMode === 'password' ? (
            <>
              <label>
                {t('Username')}
                <input value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} autoComplete="username" required />
              </label>
              <label>
                {t('Password')}
                <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" autoComplete="new-password" required />
              </label>
              <p className="auth-hint subtle">{t('Use a username and password when this device is reachable from shared or untrusted networks.')}</p>
            </>
          ) : (
            <div className="setup-passwordless-note">
              <strong>{t('Passwordless Mode')}</strong>
              <span>{t('Anyone who can reach this WebUI or API can control SBS. Use only on trusted local networks.')}</span>
            </div>
          )}
          <button className="primary" disabled={authBusy} type="submit">
            {authBusy ? t('Working...') : setupMode === 'passwordless' ? t('Enable Passwordless Mode') : t('Create Account')}
          </button>
          <p className="auth-hint">{t(status)}</p>
        </form>
      </div>
    )
  }

  if (state.connected && state.auth.checked && state.auth.auth_required && !state.auth.authenticated) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={submitAuth}>
          <div className="auth-brand">
            <strong>SBS Studio</strong>
            <span>{t('Sign in to continue')}</span>
          </div>
          <label>
            {t('Language')}
            <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="auth-tabs">
            <button type="button" className={authMode === 'password' ? 'active' : ''} onClick={() => setAuthMode('password')}>{t('Password')}</button>
            <button type="button" className={authMode === 'api_key' ? 'active' : ''} onClick={() => setAuthMode('api_key')}>{t('API Key')}</button>
          </div>
          {authMode === 'password' ? (
            <>
              <label>
                {t('Username')}
                <input value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} autoComplete="username" required />
              </label>
              <label>
                {t('Password')}
                <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} type="password" autoComplete="current-password" required />
              </label>
            </>
          ) : (
            <label>
              {t('API Key')}
              <input value={authApiKey} onChange={(event) => setAuthApiKey(event.target.value)} type="password" autoComplete="off" required />
            </label>
          )}
          <button className="primary" disabled={authBusy} type="submit">
            {authBusy ? t('Working...') : t('Sign In')}
          </button>
          <p className="auth-hint">{t(status)}</p>
          <p className="auth-hint subtle">{t('Delete the server auth config file to reset credentials, or set it to passwordless mode for trusted local deployments.')}</p>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell" data-workspace-mode={workspaceMode}>
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
              <span className="instance-trigger-label">{t('Instance')}</span>
              <span className="instance-trigger-name">{currentInstance?.name ?? t('Unknown')}</span>
              <span className={`instance-trigger-status ${currentInstance?.running ? 'running' : 'stopped'}`} />
            </button>
            {instancePanelOpen && (
              <div id="instance-panel" className="instance-panel">
                <div className="instance-panel-header">
                  <span>{t('Instances')}</span>
                  <button className="instance-panel-create" onClick={() => handleCreateInstance().catch((error) => setStatus(String(error)))}>{t('+ New')}</button>
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
                    <button onClick={() => handleRenameInstance().catch((error) => setStatus(String(error)))}>{t('Rename')}</button>
                    <button onClick={() => handleRestartInstance().catch((error) => setStatus(String(error)))}>{t('Restart')}</button>
                    <button onClick={() => handleToggleInstanceEnabled().catch((error) => setStatus(String(error)))}>
                      {currentInstance.desired_running ? t('Disable') : t('Enable')}
                    </button>
                    <button
                      onClick={() => handleDeleteInstance().catch((error) => setStatus(String(error)))}
                      disabled={currentInstance.instance_id === 0}
                      className="instance-delete-btn"
                    >
                      {t('Delete')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="obs-stat">{t('Inst')} {state.instanceId}</span>
          <span className={`obs-stat ${state.connectionState === 'error' ? 'warn' : ''}`}>{t('API')} {state.connectionState}</span>
          <span className={`obs-stat ${fpsWarn ? 'warn' : ''}`} title={fpsTitle}>{t('FPS')} {displayFps}/{targetFps}</span>
          <span className="obs-stat">{t('Bitrate')} {Math.round(state.telemetry.bitrateKbps)} kbps</span>
          <span className="obs-stat">{t('Latency')} {Math.round(state.telemetry.latencyMs)} ms</span>
          {state.auth.auth_required && state.auth.authenticated && (
            <div className="api-key-tools">
              <button onClick={() => { logoutAuth(); setStatus(t('Signed out')) }}>{t('Sign Out')}</button>
            </div>
          )}
          <button className="settings-btn" onClick={() => openSettings()}>{t('Settings')}</button>
        </div>
      </header>
      <main
        className="obs-layout"
        style={{
          ['--obs-left-width' as string]: leftDockEmpty ? '0px' : `${dockSizes.leftWidth}px`,
          ['--obs-left-split-width' as string]: leftDockEmpty ? '0px' : '4px',
          ['--obs-right-width' as string]: rightDockEmpty ? '0px' : `${dockSizes.rightWidth}px`,
          ['--obs-right-split-width' as string]: rightDockEmpty ? '0px' : '4px',
          ['--obs-bottom-height' as string]: bottomDockEmpty ? '0px' : `${dockSizes.bottomHeight}px`,
          ['--obs-bottom-split-height' as string]: bottomDockEmpty ? '0px' : '4px',
          ['--obs-left-top-ratio' as string]: `${dockSizes.leftTopRatio}fr`,
          ['--obs-left-bottom-ratio' as string]: `${1 - dockSizes.leftTopRatio}fr`,
          ['--obs-bottom-left-ratio' as string]: `${dockSizes.bottomLeftRatio}fr`,
          ['--obs-bottom-right-ratio' as string]: `1fr`,
          ['--obs-bottom-columns' as string]: bottomDockColumns,
        }}
        data-left-empty={leftDockEmpty ? 'true' : 'false'}
        data-right-empty={rightDockEmpty ? 'true' : 'false'}
        data-bottom-empty={bottomDockEmpty ? 'true' : 'false'}
      >
        <aside className="obs-left-stack">
          {renderDockRegion('left')}
        </aside>

        <div className="resize-handle vertical left-edge" onMouseDown={() => setActiveResize('leftWidth')} />

        <section className="obs-center-stage">
          <div className="obs-stage-toolbar">
            <div className="obs-stage-left">
              <div className="obs-stage-title">{t('Program')}</div>
              <div className="preview-zoom-controls" aria-label={t('Preview zoom controls')}>
                <button aria-label={t('Zoom out preview')} onClick={() => adjustPreviewZoom(-1)} disabled={previewZoom <= PREVIEW_ZOOM_STEPS[0]}>−</button>
                <span className="preview-zoom-value" aria-label={t('Preview zoom')}>{previewZoomLabel}</span>
                <button aria-label={t('Zoom in preview')} onClick={() => adjustPreviewZoom(1)} disabled={previewZoom >= PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1]}>+</button>
                <button aria-label={t('Fit preview to window')} onClick={() => setPreviewZoom(1)}>{t('Fit')}</button>
                <button className={sourceBoxesVisible ? 'active' : ''} aria-label={t('Toggle transform guides')} onClick={() => setSourceBoxesVisible((visible) => !visible)}>{sourceBoxesVisible ? t('Guides On') : t('Guides Off')}</button>
                <button className={previewStatusOverlayVisible ? 'active' : ''} aria-label={t('Toggle preview status overlay')} onClick={() => setPreviewStatusOverlayVisible((visible) => !visible)}>{previewStatusOverlayVisible ? t('Status On') : t('Status Off')}</button>
              </div>
            </div>
            <div className="button-row">
              <button
                onClick={() => togglePreview().catch((error) => setStatus(String(error)))}
              >
                {previewController ? t('Stop Preview') : t('Start Preview')}
              </button>
              <button onClick={() => captureSnapshot().then((snapshot) => setStatus(t('Snapshot captured: {id}', { id: snapshot.id }))).catch((error) => setStatus(String(error)))}>
                {t('Snapshot')}
              </button>
            </div>
          </div>

          <div
            className="obs-preview-wrapper panel"
            ref={previewWrapperRef}
            onWheel={handlePreviewWheel}
            onMouseMove={(event) => updatePreviewDrag(event.clientX, event.clientY)}
            onMouseUp={() => { finishPreviewDrag().catch(() => {}) }}
            onMouseLeave={() => { finishPreviewDrag().catch(() => {}) }}
          >
            <div className="preview-screen obs-preview-screen" style={previewScreenStyle}>
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
                      startPositionX: item.transform?.position_x ?? 0,
                      startPositionY: item.transform?.position_y ?? 0,
                      startWidth: item.transform?.width ?? 640,
                      startHeight: item.transform?.height ?? 360,
                    }
                    e.preventDefault()
                  } else {
                    selectSceneItem(null)
                    setContextMenu(null)
                  }
                }}
                onMouseMove={(e) => updatePreviewDrag(e.clientX, e.clientY)}
                onMouseUp={() => { finishPreviewDrag().catch(() => {}) }}
                onContextMenu={(e) => {
                  const target = e.target as HTMLElement
                  const bbox = target.closest('.source-bbox') as HTMLElement | null
                  if (bbox) {
                    e.preventDefault()
                    const itemId = preferredContextItemId(e.clientX, e.clientY, bbox.dataset.itemId!)
                    selectSceneItem(itemId)
                    setContextMenu({ x: e.clientX, y: e.clientY, itemId })
                  }
                }}
                onTouchStart={(e) => {
                  const target = e.target as HTMLElement
                  if (target.classList.contains('resize-handle')) return
                  const bbox = target.closest('.source-bbox') as HTMLElement | null
                  if (bbox) {
                    const touch = e.touches[0]
                    const itemId = preferredContextItemId(touch.clientX, touch.clientY, bbox.dataset.itemId!)
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
                  if (!sourceBoxesVisible) return null
                  const scene = state.activeSceneId ? (state.scenes as Record<string, any>)[state.activeSceneId] : null
                  if (!scene?.items) return null
                  return (scene.items as any[]).map((item: any) => {
                    if (item.visible === false) return null
                    const t = item.transform || {}
                    const mapped = canvasToPreviewLocal(t.position_x || 0, t.position_y || 0, t.width || 640, t.height || 360)
                    const isSelected = state.selectedSceneItemId === item.id
                    const isOffCanvas = (t.position_x || 0) < 0 || (t.position_y || 0) < 0 ||
                      (t.position_x || 0) + (t.width || 640) > canvasW ||
                      (t.position_y || 0) + (t.height || 360) > canvasH
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
      startPositionX: item.transform?.position_x ?? 0,
      startPositionY: item.transform?.position_y ?? 0,
      startWidth: item.transform?.width ?? 640,
      startHeight: item.transform?.height ?? 360,
      handle,
    }
    e.preventDefault()
  }

  return (
                      <div
                        key={item.id}
                        className={`source-bbox ${isSelected ? 'source-bbox--selected' : ''} ${isOffCanvas ? 'source-bbox--offcanvas' : ''}`}
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
              {previewStatusOverlayVisible && (
                <div className="preview-overlay">
                  <strong>{state.previewStatus.toUpperCase()}</strong>
                  <span>{t(state.previewMessage)}</span>
                  {state.selectedPreviewProfile ? (
                    <span>{state.selectedPreviewProfile.id} · {state.selectedPreviewProfile.codec.toUpperCase()} · {state.selectedPreviewProfile.transport.toUpperCase()}</span>
                  ) : null}
                  {state.lastSnapshot ? (
                    <a href={state.lastSnapshot.url} target="_blank" rel="noreferrer">{t('Open Snapshot')}</a>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {contextMenu && (
            <div
              className="preview-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ctx-group-label">{t('Transform')}</div>
              <button onClick={async () => { await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { position_x: 0, position_y: 0, width: 640, height: 360 }).catch(() => {}); setContextMenu(null) }}>{t('Reset Transform')}</button>
              <button onClick={async () => { await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { position_x: 0, position_y: 0, width: canvasW, height: canvasH }).catch(() => {}); setContextMenu(null) }}>{t('Fit to Screen')}</button>
              <button onClick={async () => {
                const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                const item = (scene?.items as any[])?.find((i: any) => i.id === contextMenu.itemId)
                if (item?.transform) {
                  const t = item.transform
                  await updateSceneItemTransform(state.activeSceneId!, contextMenu.itemId, { ...t, position_x: Math.round((canvasW - (t.width || 640)) / 2), position_y: Math.round((canvasH - (t.height || 360)) / 2) }).catch(() => {})
                }
                setContextMenu(null)
              }}>{t('Center on Canvas')}</button>
              <div className="ctx-separator" />
              <div className="ctx-group-label">{t('Order')}</div>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'top').catch(() => {}); setContextMenu(null) }}>{t('Move to Top')}</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'up').catch(() => {}); setContextMenu(null) }}>{t('Move Up')}</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'down').catch(() => {}); setContextMenu(null) }}>{t('Move Down')}</button>
              <button onClick={async () => { await moveSceneItem(contextMenu.itemId, 'bottom').catch(() => {}); setContextMenu(null) }}>{t('Move to Bottom')}</button>
              <div className="ctx-separator" />
              <button onClick={async () => {
                const scene = (state.scenes as Record<string, any>)[state.activeSceneId!]
                const item = (scene?.items as any[])?.find((i: any) => i.id === contextMenu.itemId)
                if (item) await updateSceneItem(state.activeSceneId!, contextMenu.itemId, { visible: item.visible === false }).catch(() => {})
                setContextMenu(null)
              }}>{t('Toggle Visibility')}</button>
              <button onClick={async () => { await removeSceneItem(state.activeSceneId!, contextMenu.itemId).catch(() => {}); selectSceneItem(null); setContextMenu(null) }}>{t('Delete')}</button>
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
                <div className="ctx-group-label">{t('Source')}</div>
                <button onClick={() => openSourceFilters(source.id)}>{t('Effect Filters...')}</button>
                <div className="ctx-separator" />
                <button onClick={() => {
                  openSourceEditor(source).catch((error) => setStatus(String(error)))
                  setSourceContextMenu(null)
                }}>{t('Edit Source')}</button>
                <button onClick={() => {
                  setSourceContextMenu(null)
                  handleRenameSource(source.id, source.name).catch((error) => setStatus(String(error)))
                }}>{t('Rename')}</button>
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
                <div className="ctx-group-label">{t('Scene')}</div>
                <button onClick={() => openSceneFilters(scene.id)}>{t('Effect Filters...')}</button>
                <div className="ctx-separator" />
                <button onClick={() => {
                  setSceneContextMenu(null)
                  runCommand(`scene set-active ${scene.id}`).then(() => setStatus(t('Active scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))
                }}>{t('Make Active')}</button>
                <button onClick={() => {
                  setSceneContextMenu(null)
                  removeScene(scene.id).then(() => setStatus(t('Removed scene: {name}', { name: scene.name }))).catch((error) => setStatus(String(error)))
                }} disabled={sceneEntries.length <= 1}>{t('Delete')}</button>
              </div>
            )
          })()}

          {audioContextMenu && (() => {
            const source = (state.sources as Record<string, any>)[audioContextMenu.sourceId]
            if (!source) return null
            const openAudioFilter = (type: AudioFilterType) => {
              setAudioFilterEditor({ type, sceneId: audioContextMenu.sceneId, itemId: audioContextMenu.itemId, sourceId: audioContextMenu.sourceId })
              setAudioContextMenu(null)
            }
            return (
              <div
                className="preview-context-menu audio-context-menu"
                style={{ left: audioContextMenu.x, top: audioContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ctx-group-label">{t('Audio Filters')}</div>
                <button onClick={() => openAudioFilter('channel_gain')}>{t('Channel Gain')}</button>
                <button onClick={() => openAudioFilter('delay')}>{t('Delay')}</button>
                <button onClick={() => openAudioFilter('eq')}>{t('Equalizer')}</button>
                <div className="ctx-separator" />
                <div className="ctx-menu-note">{source.name}</div>
              </div>
            )
          })()}

          {masterAudioContextMenu && (
            <div
              className="preview-context-menu master-audio-context-menu"
              style={{ left: masterAudioContextMenu.x, top: masterAudioContextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="ctx-group-label">{t('Global Audio Filters')}</div>
              <button onClick={() => { setMasterAudioFilterEditor('channel_gain'); setMasterAudioContextMenu(null) }}>{t('Channel Gain')}</button>
              <button onClick={() => { setMasterAudioFilterEditor('eq'); setMasterAudioContextMenu(null) }}>{t('Equalizer')}</button>
              <div className="ctx-separator" />
              <div className="ctx-menu-note">{t('Master Output')}</div>
            </div>
          )}
        </section>

        {workspaceMode !== 'desktop' && (
          <section
            className="panel adaptive-panel-shell"
            role="region"
            aria-label={`${phoneSectionLabel(phoneSection)} ${t('workspace panel')}`}
          >
            <div className="adaptive-panel-grip" aria-hidden="true" />
            {workspaceMode === 'tablet' && renderSectionNav('tablet-section-nav')}
            {renderAdaptiveSection()}
          </section>
        )}

        <div className="resize-handle vertical right-edge" onMouseDown={() => setActiveResize('rightWidth')} />

        <aside className="obs-right-controls">{renderDockRegion('right')}</aside>

        <section className="obs-bottom-row">
          {renderDockRegion('bottom')}
        </section>

        <div className="resize-handle horizontal bottom-edge" onMouseDown={() => setActiveResize('bottomHeight')} />
        {renderEmptyDockDropTarget('left')}
        {renderEmptyDockDropTarget('right')}
        {renderEmptyDockDropTarget('bottom')}
      </main>

      <footer className="obs-statusbar">
        <div className="obs-status-items">
          <span>{t('CPU')} {Math.round(state.telemetry.cpuUsage)}%</span>
          <span>{t('GPU')} {Math.round(state.telemetry.gpuUsage)}%</span>
          <span>{t('FPS')} {displayFps}/{targetFps}</span>
          <span>{t('Latency')} {Math.round(state.telemetry.latencyMs)} ms</span>
          <span>{fpsWarn ? t('Pipeline Slow') : t('Pipeline Stable')}</span>
          <span>{t('Shortcuts: 1-9 scenes, P preview, Shift+S snapshot, R refresh')}</span>
        </div>
        <div className="command-row obs-cli-row">
          <input value={command} onChange={(event) => setCommand(event.target.value)} />
          <button onClick={() => runCommand(command).then(() => setStatus(t('Executed: {command}', { command }))).catch((error) => setStatus(String(error)))}>{t('Run')}</button>
        </div>
      </footer>

      {workspaceMode === 'phone' && renderPhoneBottomNav()}

      {renderSettingsDialog()}
      {renderSourcePickerDialog()}
      {renderSourceConfigDialog()}
      {renderFiltersDialog()}
      {renderAudioFilterDialog()}
      {renderMasterAudioFilterDialog()}
    </div>
  )
}
