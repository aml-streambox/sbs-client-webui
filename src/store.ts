import { SbsClientApi, defaultApiHost, defaultApiUrl, defaultInstanceId } from './api'
import type { AppState, InstanceSummary, PreviewProfile, PubSubEvent, SourceKind, V4L2Device } from './types'

const listeners = new Set<() => void>()
const instanceId = defaultInstanceId()

const state: AppState = {
  instanceId,
  instances: [],
  connected: false,
  connectionState: 'connecting',
  connectionMessage: 'Connecting to SBS...',
  auth: {
    checked: false,
    authenticated: false,
    auth_required: true,
    passwordless: false,
    setup_required: false,
  },
  previewStatus: 'idle',
  previewMessage: 'Disconnected',
  previewUrl: null,
  previewCatalog: {
    available_profiles: [],
    requestable_profiles: [],
  },
  selectedPreviewProfile: null,
  activeSceneId: null,
  canvas: null,
  pendingCanvas: null,
  canvasRestartRequired: false,
  scenes: {},
  transitions: {},
  sources: {},
  outputs: {},
  previewSceneId: null,
  transitionActive: false,
  transitionProgress: 1,
  transitionId: null,
  telemetry: {
    compositorFps: 0,
    contentFps: 0,
    framesRendered: 0,
    contentFrames: 0,
    bitrateKbps: 0,
    latencyMs: 0,
    cpuUsage: 0,
    gpuUsage: 0,
    pipelineSlow: false,
  },
  audio: {
    device: 'hw:0,2',
    master_volume: 1,
    master_left_gain: 1,
    master_right_gain: 1,
    master_eq_bands: Array.from({ length: 10 }, () => 0),
    master_mute: false,
    levels: {
      sources: {},
      master: {},
    },
  },
  lastSnapshot: null,
  commandHistory: [],
  selectedSceneItemId: null,
  selectedSourceId: null,
  editingSourceId: null,
}

const api = new SbsClientApi(defaultApiUrl(), instanceId)
let initialized = false
let webrtcPeerConnection: RTCPeerConnection | null = null
let webrtcPreviewStream: MediaStream | null = null
let webrtcRemoteDescSet = false
let webrtcIceBuffer: Array<{ sdpMLineIndex: number; candidate: string }> = []
let syncing = false
let pollTimer: number | null = null

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, timeoutMs)
    function done() {
      window.clearTimeout(timeout)
      pc.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }
    function onStateChange() {
      if (pc.iceGatheringState === 'complete') {
        done()
      }
    }
    pc.addEventListener('icegatheringstatechange', onStateChange)
  })
}

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function applyServerState(payload: any) {
  const prevActiveSceneId = state.activeSceneId
  state.activeSceneId = payload?.state?.active_scene_id ?? null
  state.previewSceneId = payload?.state?.preview_scene_id ?? null
  state.transitionActive = Boolean(payload?.state?.transition_active)
  state.transitionProgress = Number(payload?.state?.transition_progress ?? 1)
  state.transitionId = payload?.state?.transition_id ?? null
  state.scenes = payload?.scenes ?? {}
  state.transitions = payload?.transitions ?? {}
  state.sources = payload?.sources ?? {}
  state.outputs = payload?.output_groups ?? {}
  state.canvas = payload?.canvas ?? state.canvas
  state.pendingCanvas = payload?.pending_canvas ?? null
  state.canvasRestartRequired = Boolean(payload?.canvas_restart_required)
  state.previewCatalog = payload?.preview ?? state.previewCatalog
  state.audio = payload?.audio ?? state.audio
  if (state.selectedSourceId && !state.sources[state.selectedSourceId]) {
    state.selectedSourceId = null
    state.selectedSceneItemId = null
  }
  if (payload?.telemetry) {
    const t = payload.telemetry
    state.telemetry = {
      compositorFps: t.compositor_fps ?? state.telemetry.compositorFps,
      contentFps: t.content_fps ?? state.telemetry.contentFps,
      framesRendered: t.frames_rendered ?? state.telemetry.framesRendered,
      contentFrames: t.content_frames ?? state.telemetry.contentFrames,
      bitrateKbps: t.bitrate_kbps ?? state.telemetry.bitrateKbps,
      latencyMs: t.latency_ms ?? state.telemetry.latencyMs,
      cpuUsage: t.cpu_usage ?? state.telemetry.cpuUsage,
      gpuUsage: t.gpu_usage ?? state.telemetry.gpuUsage,
      pipelineSlow: t.pipeline_slow ?? state.telemetry.pipelineSlow,
    }
  }
  if (state.activeSceneId !== prevActiveSceneId) {
    state.selectedSceneItemId = null
  }
  if (state.selectedSceneItemId && state.activeSceneId) {
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const item = (scene?.items as any[])?.find((entry: any) => entry.id === state.selectedSceneItemId)
    state.selectedSourceId = item?.source_id ?? state.selectedSourceId
  }
}

async function refreshInstances() {
  const payload = await api.rpc<{ instances: InstanceSummary[] }>('instance.list')
  state.instances = Array.isArray(payload.instances)
    ? [...payload.instances].sort((a, b) => a.instance_id - b.instance_id)
    : []
  emit()
  return state.instances
}

function looksPlayableInBrowser(profile: PreviewProfile): boolean {
  if (profile.transport === 'hls') {
    return true
  }
  if (profile.transport === 'webrtc') {
    return true
  }
  return false
}

function prefersHardwareDecode(profile: PreviewProfile): boolean {
  return profile.hardware_decode_preferred
}

function choosePreviewProfile(catalog: AppState['previewCatalog']): PreviewProfile | null {
  const available = catalog.available_profiles.filter((profile) => prefersHardwareDecode(profile) && looksPlayableInBrowser(profile))
  if (available.length > 0) {
    return available[0]
  }
  const fallback = catalog.requestable_profiles.find((profile) => profile.codec === 'h264' && looksPlayableInBrowser(profile))
  return fallback ?? null
}

function resolvePreviewUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      parsed.hostname = defaultApiHost()
    }
    return parsed.toString()
  } catch {
    return url
  }
}

async function refreshPreviewCatalog() {
  const catalog = await api.rpc<AppState['previewCatalog']>('preview.listProfiles')
  state.previewCatalog = catalog
  emit()
  return catalog
}

async function ensureFallbackIfNeeded(profile: PreviewProfile): Promise<PreviewProfile> {
  if (!profile.requestable) {
    return profile
  }
  /* For WebRTC profiles, skip ensureProfile — the preview.webrtc.start
   * RPC will create the pipeline.  Calling ensureProfile here would create
   * a pipeline that webrtc.start immediately tears down and recreates,
   * which can break the Amlogic HW encoder (resource not fully released). */
  if (profile.transport === 'webrtc') {
    return profile
  }
  return api.rpc<PreviewProfile>('preview.ensureProfile', { profile_id: profile.id })
}

function onEvent(event: PubSubEvent) {
  if (event.params.topic === 'telemetry.runtime') {
    const data = event.params.data as any
    state.telemetry = {
      compositorFps: data.compositor_fps ?? 0,
      contentFps: data.content_fps ?? 0,
      framesRendered: data.frames_rendered ?? 0,
      contentFrames: data.content_frames ?? 0,
      bitrateKbps: data.bitrate_kbps ?? 0,
      latencyMs: data.latency_ms ?? 0,
      cpuUsage: data.cpu_usage ?? 0,
      gpuUsage: data.gpu_usage ?? 0,
      pipelineSlow: Boolean(data.pipeline_slow),
    }
  }

  if (event.params.topic === 'audio.level') {
    state.audio = {
      ...state.audio,
      levels: event.params.data as any,
    }
  }

  if (event.params.topic === 'audio.source.updated') {
    const source = event.params.data as any
    if (source?.id) {
      state.sources = {
        ...state.sources,
        [source.id]: source,
      }
    }
  }

  if (event.params.topic === 'audio.master.updated') {
    state.audio = event.params.data as any
  }

  if (event.params.topic.startsWith('scene.') || event.params.topic.startsWith('source.') || event.params.topic.startsWith('output.') || event.params.topic.startsWith('filter.')) {
    refreshState().catch(() => undefined)
  }

  if (event.params.topic.startsWith('preview.profile.')) {
    refreshPreviewCatalog().catch(() => undefined)
    state.previewMessage = String(event.params.topic)
  }

  if (event.params.topic === 'preview.webrtc.ice') {
    const data = event.params.data as { sdpMLineIndex: number; candidate: string }
    if (webrtcPeerConnection && data.candidate) {
      if (!webrtcRemoteDescSet) {
        webrtcIceBuffer.push(data)
      } else {
        webrtcPeerConnection.addIceCandidate(new RTCIceCandidate({
          sdpMLineIndex: data.sdpMLineIndex,
          candidate: data.candidate,
        })).catch(() => undefined)
      }
    }
  }
  emit()
}

async function syncAfterConnect() {
  if (syncing) {
    return
  }

  syncing = true
  try {
    await refreshInstances()
    await refreshState()
    await refreshPreviewCatalog()
    try {
      await api.rpc('pubsub.subscribe', {
        topics: ['telemetry.runtime', 'audio.*', 'scene.*', 'source.*', 'output.*', 'filter.*', 'preview.profile.*', 'preview.webrtc.*'],
      })
    } catch {
      // pubsub.subscribe may fail when proxied through controller; non-fatal
    }
  } catch (error) {
    state.connectionMessage = `Sync failed: ${error instanceof Error ? error.message : String(error)}`
    emit()
  } finally {
    syncing = false
  }
}

type AuthStatus = AppState['auth'] & { token?: string }

function applyAuthStatus(payload: AuthStatus, authenticated?: boolean) {
  if (payload.token) {
    api.setAuthToken(payload.token)
  }
  state.auth = {
    checked: true,
    authenticated: authenticated ?? Boolean(payload.passwordless || payload.token || !payload.auth_required),
    auth_required: Boolean(payload.auth_required),
    passwordless: Boolean(payload.passwordless),
    setup_required: Boolean(payload.setup_required),
    username: payload.username,
    message: payload.message,
    api_keys: payload.api_keys ?? state.auth.api_keys ?? [],
  }
}

async function refreshAuthStatus() {
  const status = await api.rpc<AuthStatus>('auth.status')
  applyAuthStatus(status, !status.auth_required || status.passwordless || api.hasAuthToken())
  return status
}

export async function connectStore() {
  if (initialized) {
    return
  }
  initialized = true
  api.onEvent(onEvent)
  api.onConnectionState((connectionState, detail) => {
    state.connectionState = connectionState
    state.connectionMessage = `${detail} (instance ${instanceId})`
    state.connected = connectionState === 'connected'
    if (connectionState === 'connected') {
      state.previewMessage = state.previewStatus === 'active' ? state.previewMessage : 'Connected'
      void refreshAuthStatus().then((auth) => {
        if (!auth.auth_required || auth.passwordless || state.auth.authenticated) {
          if (pollTimer === null) {
            pollTimer = window.setInterval(() => {
              refreshState().catch(() => undefined)
            }, 1000)
          }
          listApiKeys().catch(() => undefined)
          void syncAfterConnect()
        }
      }).catch((error) => {
        state.auth = { ...state.auth, checked: true, message: error instanceof Error ? error.message : String(error) }
        emit()
      })
    } else if (connectionState === 'reconnecting') {
      state.previewMessage = 'Control connection lost; reconnecting'
    } else if (connectionState === 'error') {
      state.previewMessage = detail
    }
    if (!state.connected && pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
    emit()
  })

  await api.connect()
}

export async function setupAuth(username: string, password: string) {
  const result = await api.rpc<AuthStatus>('auth.setup', { username, password })
  applyAuthStatus(result, true)
  await syncAfterConnect()
  await listApiKeys()
}

export async function loginAuth(username: string, password: string) {
  const result = await api.rpc<AuthStatus>('auth.login', { username, password })
  applyAuthStatus(result, true)
  await syncAfterConnect()
  await listApiKeys()
}

export async function loginApiKey(apiKey: string) {
  const result = await api.rpc<AuthStatus>('auth.loginApiKey', { api_key: apiKey })
  applyAuthStatus(result, true)
  await syncAfterConnect()
  await listApiKeys()
}

export async function createApiKey(name: string) {
  const key = await api.rpc<{ id: string; name: string; created_at: string; api_key: string }>('auth.createApiKey', { name })
  await listApiKeys()
  return key
}

export async function listApiKeys() {
  const result = await api.rpc<{ api_keys: Array<{ id: string; name: string; created_at?: string }> }>('auth.listApiKeys')
  state.auth = { ...state.auth, api_keys: result.api_keys ?? [] }
  emit()
  return state.auth.api_keys
}

export async function deleteApiKey(id: string) {
  await api.rpc('auth.deleteApiKey', { id })
  await listApiKeys()
}

export async function updateAuthCredentials(username: string, password: string) {
  const result = await api.rpc<AuthStatus>('auth.updateCredentials', { username, password })
  applyAuthStatus(result, true)
  return result
}

export async function setPasswordlessAuth(enabled: boolean) {
  const result = await api.rpc<AuthStatus>('auth.setPasswordless', { enabled })
  applyAuthStatus(result, !result.auth_required || result.passwordless || api.hasAuthToken())
  return result
}

export function logoutAuth() {
  api.setAuthToken(null)
  state.auth = { ...state.auth, authenticated: false }
  emit()
}

export async function refreshState() {
  const payload = await api.rpc<any>('system.getState')
  applyServerState(payload)
  emit()
}

export async function exportConfigBundle() {
  return api.rpc<Record<string, unknown>>('config.export')
}

export async function importConfigBundle(bundle: Record<string, unknown>) {
  const result = await api.rpc<{ ok: boolean }>('config.import', bundle)
  await refreshState()
  return result
}

export async function createInstance(name: string) {
  const result = await api.rpc<InstanceSummary>('instance.create', { name })
  await refreshInstances()
  return result
}

export async function updateInstance(instanceId: number, patch: { name?: string; enabled?: boolean }) {
  const result = await api.rpc<InstanceSummary>('instance.update', { instance_id: instanceId, ...patch })
  await refreshInstances()
  return result
}

export async function enableInstance(instanceId: number) {
  const result = await api.rpc<InstanceSummary>('instance.enable', { instance_id: instanceId })
  await refreshInstances()
  return result
}

export async function disableInstance(instanceId: number) {
  const result = await api.rpc<InstanceSummary>('instance.disable', { instance_id: instanceId })
  await refreshInstances()
  return result
}

export async function removeInstance(instanceId: number) {
  const result = await api.rpc<{ ok: boolean }>('instance.remove', { instance_id: instanceId })
  await refreshInstances()
  return result
}

export async function restartInstance(targetInstanceId: number) {
  const result = await api.rpc<InstanceSummary>('instance.restart', { instance_id: targetInstanceId })
  await refreshInstances()
  return result
}

export async function runCommand(command: string) {
  state.commandHistory.unshift(command)
  state.commandHistory = state.commandHistory.slice(0, 20)
  emit()
  return api.rpc('command.execute', { command })
}

export async function createScene(name: string) {
  const id = `scene-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || Date.now()}`
  return api.rpc('scene.create', { id, name })
}

export async function removeScene(id: string) {
  return api.rpc('scene.remove', { id })
}

export async function setActiveScene(sceneId: string, transitionId = 'trans-fade') {
  const result = await api.rpc('scene.setActive', { scene_id: sceneId, transition_id: transitionId })
  await refreshState()
  return result
}

export async function setPreviewScene(sceneId: string) {
  const result = await api.rpc('scene.setPreview', { scene_id: sceneId })
  await refreshState()
  return result
}

export async function transitionToPreview(transitionId = 'trans-fade') {
  const result = await api.rpc('scene.transitionToPreview', { transition_id: transitionId })
  await refreshState()
  return result
}

export async function updateTransition(transitionId: string, durationMs: number) {
  const result = await api.rpc('scene.transition.update', { transition_id: transitionId, duration_ms: durationMs })
  await refreshState()
  return result
}

export async function createSource(name: string, type: string, config?: Record<string, string>) {
  const id = `source-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || Date.now()}`
  const params: Record<string, unknown> = { id, name, type }
  if (config) {
    params.config = config
  }
  return api.rpc('source.create', params)
}

export async function updateSource(sourceId: string, patch: { name?: string; config?: Record<string, string>; enabled?: boolean }) {
  return api.rpc('source.update', { id: sourceId, ...patch })
}

export async function removeSource(id: string) {
  return api.rpc('source.remove', { id })
}

export async function listSourceKinds() {
  return api.rpc<{ kinds: SourceKind[] }>('source.listKinds')
}

export async function describeSourceKind(kind: string) {
  return api.rpc<{ kind: SourceKind }>('source.describeKind', { kind })
}

export async function discoverV4L2() {
  return api.rpc<{ devices: V4L2Device[] }>('source.discoverV4L2')
}

export async function uploadSourceAsset(assetKind: 'image' | 'media' | 'font', filename: string, dataBase64: string) {
  return api.rpc<{ asset_kind: string; filename: string; path: string; uri: string; size: number }>('source.uploadAsset', {
    asset_kind: assetKind,
    filename,
    data_base64: dataBase64,
  })
}

export async function createOutput(name: string, encoder?: Record<string, unknown>) {
  const id = `output-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || Date.now()}`
  return api.rpc('output.create', { id, name, encoder })
}

export async function removeOutput(id: string) {
  return api.rpc('output.remove', { id })
}

export async function updateOutput(id: string, patch: { name?: string; encoder?: Record<string, unknown> }) {
  return api.rpc('output.update', { id, ...patch })
}

export async function getEncoderConfig() {
  return api.rpc('encoder.getConfig', {})
}

export async function updateEncoderConfig(config: { codec?: string; bitrate_kbps?: number; gop_size?: number; keyframe_interval?: number; gop_preset?: string; enable_b_frames?: boolean; rc_mode?: number }) {
  return api.rpc('encoder.updateConfig', config)
}

export async function getPreviewEncoderConfig(profileId?: string) {
  return api.rpc('preview.getEncoderConfig', { profile_id: profileId || 'preview-h264-webrtc' })
}

export async function updatePreviewEncoderConfig(config: { downscale_factor?: number; framerate?: number; bitrate_kbps?: number }, profileId?: string) {
  return api.rpc('preview.updateEncoderConfig', { profile_id: profileId || 'preview-h264-webrtc', ...config })
}

export async function updateCanvas(canvas: { width?: number; height?: number; fps_num?: number; fps_den?: number; color_mode?: string; background_color?: string }) {
  const result = await api.rpc('canvas.update', { canvas })
  await refreshState()
  return result
}

export async function applyCanvas() {
  const result = await api.rpc('canvas.apply', {})
  await refreshState()
  return result
}

export async function reorderSceneItems(sceneId: string, itemOrder: string[]) {
  return api.rpc('scene.item.reorder', {
    scene_id: sceneId,
    item_order: itemOrder,
  })
}

function defaultFilterParams(type: string) {
  return type === 'brightness'
    ? { amount: 0.15 }
    : type === 'contrast'
      ? { amount: 1.15 }
      : type === 'hdr_to_sdr_lut'
        ? { amount: 1.0, path: '', saturation: 1.42, brightness: -0.02, hue: 0 }
        : { amount: 1.0 }
}

export async function addFilter(sourceId: string, type: string, id = `${type}-${Date.now()}`) {
  return api.rpc('filter.add', {
    source_id: sourceId,
    id,
    type,
    enabled: true,
    params: defaultFilterParams(type),
  })
}

export async function addSceneFilter(sceneId: string, type: string, id = `${type}-${Date.now()}`) {
  return api.rpc('filter.add', {
    scene_id: sceneId,
    id,
    type,
    enabled: true,
    params: defaultFilterParams(type),
  })
}

export async function updateFilter(sourceId: string, filterId: string, enabled: boolean, params: Record<string, unknown>) {
  return api.rpc('filter.update', {
    source_id: sourceId,
    filter_id: filterId,
    enabled,
    params,
  })
}

export async function updateSceneFilter(sceneId: string, filterId: string, enabled: boolean, params: Record<string, unknown>) {
  return api.rpc('filter.update', {
    scene_id: sceneId,
    filter_id: filterId,
    enabled,
    params,
  })
}

export async function removeFilter(sourceId: string, filterId: string) {
  return api.rpc('filter.remove', {
    source_id: sourceId,
    filter_id: filterId,
  })
}

export async function removeSceneFilter(sceneId: string, filterId: string) {
  return api.rpc('filter.remove', {
    scene_id: sceneId,
    filter_id: filterId,
  })
}

export async function startPreviewSession() {
  state.previewStatus = 'connecting'
  state.previewMessage = 'Selecting best preview profile'
  emit()

  const catalog = await refreshPreviewCatalog()
  const selected = choosePreviewProfile(catalog)
  if (!selected) {
    state.previewStatus = 'error'
    state.previewMessage = 'No suitable preview profile available'
    emit()
    throw new Error('No suitable preview profile available')
  }

  const profile = await ensureFallbackIfNeeded(selected)
  state.selectedPreviewProfile = profile

  if (profile.transport === 'webrtc') {
    return startWebrtcPreview(profile)
  }

  if (profile.requires_additional_encode) {
    state.previewStatus = 'connecting'
    state.previewMessage = `Starting ${profile.id} encoder...`
    emit()
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  state.previewUrl = profile.stream_url ? resolvePreviewUrl(profile.stream_url) : null
  state.previewStatus = 'active'
  state.previewMessage = `Using ${profile.id}`
  emit()

  return {
    profileId: profile.id,
    stop: async () => {
      await api.rpc('preview.releaseProfile', { profile_id: profile.id })
      state.previewUrl = null
      state.selectedPreviewProfile = null
      state.previewStatus = 'idle'
      state.previewMessage = 'Preview stopped'
      emit()
    },
  }
}

async function startWebrtcPreview(profile: PreviewProfile) {
  state.previewStatus = 'connecting'
  state.previewMessage = 'Starting WebRTC preview...'
  emit()

  try {
    // Request SDP offer from server
    const offerResult = await api.rpc<{ profile_id: string; type: string; sdp: string; iceCandidates?: Array<{ sdpMLineIndex: number; candidate: string }> }>(
      'preview.webrtc.start',
      { profile_id: profile.id }
    )

    const pc = new RTCPeerConnection({})
    webrtcPeerConnection = pc;

    webrtcPreviewStream = new MediaStream()

    pc.ontrack = (event) => {
      const video = document.getElementById('preview-video') as HTMLVideoElement | null
      if (!webrtcPreviewStream) {
        webrtcPreviewStream = new MediaStream()
      }
      if (!webrtcPreviewStream.getTracks().some((track) => track.id === event.track.id)) {
        webrtcPreviewStream.addTrack(event.track)
      }
      if (video) {
        video.srcObject = webrtcPreviewStream
        video.autoplay = true
        video.playsInline = true
        video.muted = false
        video.volume = 1
        video.play().catch((error) => {
          state.previewMessage = `WebRTC ready; click preview to play audio (${error instanceof Error ? error.message : 'autoplay blocked'})`
          emit()
        })
        state.previewStatus = 'active'
        state.previewMessage = `WebRTC ${profile.id}`
        emit()
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        api.rpc('preview.webrtc.ice', {
          profile_id: profile.id,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          candidate: event.candidate.candidate,
        }).catch(() => undefined)
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        state.previewStatus = 'active'
        state.previewMessage = `WebRTC connected`
        emit()
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        state.previewStatus = 'error'
        state.previewMessage = `WebRTC ${pc.iceConnectionState}`
        emit()
      }
    }

    webrtcRemoteDescSet = false
    webrtcIceBuffer = []
    await pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: offerResult.sdp,
    }))
    webrtcRemoteDescSet = true

    if (offerResult.iceCandidates) {
      for (const ice of offerResult.iceCandidates) {
        pc.addIceCandidate(new RTCIceCandidate({
          sdpMLineIndex: ice.sdpMLineIndex,
          candidate: ice.candidate,
        })).catch(() => undefined)
      }
    }
    for (const ice of webrtcIceBuffer) {
      pc.addIceCandidate(new RTCIceCandidate({
        sdpMLineIndex: ice.sdpMLineIndex,
        candidate: ice.candidate,
      })).catch(() => undefined)
    }
    webrtcIceBuffer = []

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceGatheringComplete(pc)

    await api.rpc('preview.webrtc.answer', {
      profile_id: profile.id,
      sdp: pc.localDescription?.sdp ?? answer.sdp,
    })

    /* Don't overwrite status if ontrack / oniceconnectionstatechange
     * already set it to 'active' (can happen before the answer RPC
     * response arrives). */
    if (state.previewStatus === 'connecting') {
      state.previewMessage = 'WebRTC negotiating...'
      emit()
    }

    return {
      profileId: profile.id,
      stop: async () => {
        if (webrtcPeerConnection === pc) {
          webrtcPeerConnection = null
        }
        if (webrtcPreviewStream) {
          for (const track of webrtcPreviewStream.getTracks()) {
            track.stop()
          }
          webrtcPreviewStream = null
        }
        pc.close()
        const video = document.getElementById('preview-video') as HTMLVideoElement | null
        if (video) {
          video.srcObject = null
        }
        await api.rpc('preview.releaseProfile', { profile_id: profile.id }).catch(() => undefined)
        state.previewUrl = null
        state.selectedPreviewProfile = null
        state.previewStatus = 'idle'
        state.previewMessage = 'Preview stopped'
        emit()
      },
    }
  } catch (error) {
    state.previewStatus = 'error'
    state.previewMessage = `WebRTC error: ${error instanceof Error ? error.message : String(error)}`
    emit()
    throw error
  }
}

export async function captureSnapshot() {
  const snapshot = await api.rpc<{ id: string; format: string; url: string }>('snapshot.capture', { format: 'jpeg' })
  state.lastSnapshot = {
    id: snapshot.id,
    format: snapshot.format,
    url: resolvePreviewUrl(snapshot.url),
  }
  emit()
  return state.lastSnapshot
}

export async function setSourceAudio(sourceId: string, volume: number, mute: boolean, monitor: boolean, device = 'hw:0,2', enabled = true, extra: Record<string, unknown> = {}) {
  const result = await api.rpc<any>('audio.setSource', { source_id: sourceId, volume, mute, monitor, device, enabled, ...extra })
  state.sources = {
    ...state.sources,
    [sourceId]: result,
  }
  emit()
  return result
}

export async function setSceneItemAudio(sceneId: string, itemId: string, volume: number, mute: boolean, monitor: boolean, device = 'hw:0,2', enabled = true, extra: Record<string, unknown> = {}) {
  const result = await api.rpc<any>('audio.setSceneItem', { scene_id: sceneId, item_id: itemId, volume, mute, monitor, device, enabled, ...extra })
  state.scenes = {
    ...state.scenes,
    [sceneId]: result,
  }
  emit()
  return result
}

export async function setMasterAudio(volume: number, mute: boolean, extra: Record<string, unknown> = {}) {
  const result = await api.rpc<any>('audio.setMaster', { volume, mute, ...extra })
  state.audio = result
  emit()
  return result
}

export function selectSceneItem(id: string | null) {
  state.selectedSceneItemId = id
  if (id && state.activeSceneId) {
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const item = (scene?.items as any[])?.find((entry: any) => entry.id === id)
    state.selectedSourceId = item?.source_id ?? state.selectedSourceId
  } else if (!id) {
    state.selectedSourceId = null
  }
  emit()
}

export function selectSource(id: string | null) {
  state.selectedSourceId = id
  state.selectedSceneItemId = null
  if (id && state.activeSceneId) {
    const scene = (state.scenes as Record<string, any>)[state.activeSceneId]
    const item = (scene?.items as any[])?.find((entry: any) => entry.source_id === id)
    state.selectedSceneItemId = item?.id ?? null
  }
  emit()
}

export async function updateSceneItemTransform(sceneId: string, itemId: string, transform: Record<string, unknown>) {
  return api.rpc('scene.item.update', { scene_id: sceneId, item_id: itemId, transform })
}

export async function updateSceneItem(sceneId: string, itemId: string, patch: Record<string, unknown>) {
  return api.rpc('scene.item.update', { scene_id: sceneId, item_id: itemId, ...patch })
}

export async function addSceneItem(sceneId: string, sourceId: string) {
  const id = `item-${sourceId}-${Date.now()}`
  return api.rpc('scene.item.add', {
    scene_id: sceneId,
    id,
    source_id: sourceId,
    visible: true,
    z_order: 0,
  })
}

export async function removeSceneItem(sceneId: string, itemId: string) {
  return api.rpc('scene.item.remove', { scene_id: sceneId, item_id: itemId })
}

export function setEditingSourceId(id: string | null) {
  state.editingSourceId = id
  emit()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState() {
  return state
}
