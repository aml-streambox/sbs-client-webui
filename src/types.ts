export type RpcId = number

export interface RpcRequest {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params?: Record<string, unknown>
}

export interface RpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: RpcId
  result?: T
  error?: { code: number; message: string }
}

export interface PubSubEvent {
  jsonrpc: '2.0'
  method: 'pubsub.event'
  params: {
    topic: string
    data: unknown
  }
}

export interface PreviewProfile {
  id: string
  kind: 'reuse' | 'fallback'
  transport: string
  codec: string
  container: string
  latency_class: string
  resolution: {
    width: number
    height: number
  }
  downscale_factor: number
  framerate: number
  hardware_decode_preferred: boolean
  requires_additional_encode: boolean
  available: boolean
  requestable: boolean
  active: boolean
  color_mode?: string
  reference_color?: boolean
  viewer_count: number
  stream_url: string
}

export interface SourceKindField {
  key: string
  label: string
  type: string
  default: string | number | boolean
  options?: string[]
  asset_kind?: 'image' | 'media' | 'font'
}

export interface SourceKind {
  id: string
  name: string
  summary: string
  pausable: boolean
  fields?: SourceKindField[]
}

export interface V4L2FrameInterval {
  type: string
  numerator?: number
  denominator?: number
  fps?: number
}

export interface V4L2Resolution {
  type: string
  width?: number
  height?: number
  min_width?: number
  min_height?: number
  max_width?: number
  max_height?: number
  frame_intervals?: V4L2FrameInterval[]
}

export interface V4L2Format {
  fourcc: string
  description: string
  media_type: string
  compressed: boolean
  zero_copy_expected: boolean
  software_decode_available: boolean
  hardware_decode_available: boolean
  resolutions: V4L2Resolution[]
}

export interface V4L2Device {
  id: string
  display_name: string
  name: string
  path: string
  driver: string
  bus_info: string
  streaming: boolean
  readwrite: boolean
  type_hints: string[]
  formats: V4L2Format[]
}

export interface ALSADevice {
  id: string
  card: number
  device_index: number
  card_id: string
  name: string
  display_name: string
  device: string
  hw_device: string
  usb_id?: string
  usb?: boolean
  type_hints?: string[]
}

export interface ALSAHDMIStatus {
  streambox_tv_active: boolean
  tvserver_active: boolean
  hdmitx_ready: boolean
  hdmitx_enabled: boolean
  hdmitx_passthrough: boolean
  hdmitx_mode: string
}

export interface InstanceSummary {
  instance_id: number
  name: string
  desired_running: boolean
  running: boolean
  pid: number
  api_port: number
  preview_port: number
}

export interface SourceFilter {
  id: string
  type: string
  enabled: boolean
  params?: Record<string, unknown>
}

export interface AppState {
  instanceId: number
  instances: InstanceSummary[]
  connected: boolean
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'error'
  connectionMessage: string
  auth: {
    checked: boolean
    authenticated: boolean
    auth_required: boolean
    passwordless: boolean
    setup_required: boolean
    username?: string
    message?: string
    api_keys?: Array<{ id: string; name: string; created_at?: string }>
  }
  previewStatus: 'idle' | 'connecting' | 'active' | 'error'
  previewMessage: string
  previewUrl: string | null
  previewCatalog: {
    available_profiles: PreviewProfile[]
    requestable_profiles: PreviewProfile[]
  }
  selectedPreviewProfile: PreviewProfile | null
  canvas: {
    width: number
    height: number
    fps_num: number
    fps_den: number
    pixel_format?: string
    colorimetry?: string
    color_mode: string
    background_color: string
  } | null
  pendingCanvas: {
    width: number
    height: number
    fps_num: number
    fps_den: number
    pixel_format?: string
    colorimetry?: string
    color_mode: string
    background_color: string
  } | null
  canvasRestartRequired: boolean
  activeSceneId: string | null
  previewSceneId: string | null
  transitionActive: boolean
  transitionProgress: number
  transitionId: string | null
  scenes: Record<string, { id: string; name: string; filters?: SourceFilter[] }>
  transitions: Record<string, { id: string; type: string; duration_ms: number; params?: Record<string, unknown> }>
  sources: Record<string, { id: string; name: string; type: string; state: string; enabled?: boolean; config?: Record<string, string>; filters?: SourceFilter[]; audio?: Record<string, unknown> }>
  outputs: Record<string, { id: string; name: string; state: string; encoder?: Record<string, string>; health?: Record<string, unknown> }>
  telemetry: {
    compositorFps: number
    contentFps: number
    framesRendered: number
    contentFrames: number
    bitrateKbps: number
    latencyMs: number
    cpuUsage: number
    gpuUsage: number
    pipelineSlow: boolean
  }
  audio: {
    device: string
    master_volume: number
    master_left_gain?: number
    master_right_gain?: number
    master_eq_bands?: number[]
    master_mute: boolean
    levels: {
      sources: Record<string, { level_db?: number; peak_db?: number; timestamp_us?: number; monitor?: boolean; active_in_scene?: boolean; effective_mute?: boolean }>
      master: { level_db?: number; peak_db?: number; timestamp_us?: number }
    }
  }
  lastSnapshot: null | {
    id: string
    format: string
    url: string
  }
  commandHistory: string[]
  selectedSceneItemId: string | null
  selectedSourceId: string | null
  editingSourceId: string | null
}
