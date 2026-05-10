import type { PubSubEvent, RpcRequest, RpcResponse } from './types'

type EventHandler = (event: PubSubEvent) => void
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error'
type ConnectionHandler = (state: ConnectionState, detail: string) => void

const PUBLIC_AUTH_METHODS = new Set(['auth.status', 'auth.setup', 'auth.login', 'auth.loginApiKey'])

export class SbsClientApi {
  private socket: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private eventHandlers = new Set<EventHandler>()
  private connectionHandlers = new Set<ConnectionHandler>()
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private hasConnected = false
  private shouldReconnect = true
  private authToken: string | null = typeof window === 'undefined' ? null : window.localStorage.getItem('sbs-auth-token')

  constructor(private readonly url: string, private readonly instanceId: number) {}

  connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.shouldReconnect = true
    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false
      this.openSocket(
        () => {
          if (settled) {
            return
          }
          settled = true
          resolve()
        },
        (error) => {
          if (settled) {
            return
          }
          settled = true
          this.connectPromise = null
          reject(error)
        },
      )
    })

    return this.connectPromise
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onConnectionState(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('not connected')
    }

    const id = this.nextId++
    /* Direct instance API mode: if URL points to /ws (not /api/v1/ws),
     * the server is an instance API and doesn't support instance.call routing. */
    const isDirectInstance = !this.url.includes('/api/v1/ws')

    const authParams = this.authToken && !PUBLIC_AUTH_METHODS.has(method)
      ? { ...(params ?? {}), auth_token: this.authToken }
      : params

    const request: RpcRequest = method.startsWith('instance.') || method.startsWith('auth.') || isDirectInstance
      ? { jsonrpc: '2.0', id, method, params: authParams }
      : {
          jsonrpc: '2.0',
          id,
          method: 'instance.call',
          params: {
            instance_id: this.instanceId,
            method,
            params: authParams,
            auth_token: this.authToken ?? undefined,
          },
        }

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.socket!.send(JSON.stringify(request))
    })
  }

  setAuthToken(token: string | null): void {
    this.authToken = token
    if (token) {
      window.localStorage.setItem('sbs-auth-token', token)
    } else {
      window.localStorage.removeItem('sbs-auth-token')
    }
  }

  hasAuthToken(): boolean {
    return Boolean(this.authToken)
  }

  private handleMessage(raw: string): void {
    const payload = JSON.parse(raw) as RpcResponse | PubSubEvent
    if ('method' in payload && payload.method === 'pubsub.event') {
      for (const handler of this.eventHandlers) {
        handler(payload)
      }
      return
    }

    const response = payload as RpcResponse
    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message))
      return
    }
    pending.resolve(response.result)
  }

  private openSocket(resolve?: () => void, reject?: (reason?: unknown) => void): void {
    this.clearReconnectTimer()
    const socket = new WebSocket(this.url)
    this.socket = socket
    this.emitConnectionState(this.hasConnected ? 'reconnecting' : 'connecting', this.hasConnected ? 'Reconnecting to SBS...' : 'Connecting to SBS...')

    socket.onopen = () => {
      this.socket = socket
      this.reconnectAttempt = 0
      this.hasConnected = true
      this.connectPromise = Promise.resolve()
      this.emitConnectionState('connected', 'Connected to SBS')
      resolve?.()
    }

    socket.onerror = (event) => {
      const detail = event instanceof Event ? 'Connection failed' : String(event)
      this.emitConnectionState('error', detail)
      reject?.(event)
    }

    socket.onmessage = (message) => this.handleMessage(String(message.data))
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null
      }
      for (const [, pending] of this.pending) {
        pending.reject(new Error('socket closed'))
      }
      this.pending.clear()
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return
    }

    const delay = Math.min(5000, 500 * Math.max(1, 2 ** this.reconnectAttempt))
    this.reconnectAttempt += 1
    this.emitConnectionState('reconnecting', `Reconnecting in ${Math.round(delay / 100) / 10}s`) 
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private emitConnectionState(state: ConnectionState, detail: string): void {
    for (const handler of this.connectionHandlers) {
      handler(state, detail)
    }
  }
}

function configuredApiUrl(): string | undefined {
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SBS_API_URL
}

function configuredInstanceId(): string | undefined {
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SBS_INSTANCE_ID
}

export function defaultApiUrl(): string {
  const configured = configuredApiUrl()
  if (configured) {
    return configured
  }
  const host = window.location.hostname || '127.0.0.1'
  const port = Number(window.location.port)
  if (Number.isFinite(port) && port > 0 && port !== 10086) {
    return `ws://${host}:${Math.max(1, port - 1)}/api`
  }
  return `ws://${host}:10086/api/v1/ws`
}

export function defaultInstanceId(): number {
  const configured = configuredInstanceId()
  if (configured && /^\d+$/.test(configured)) {
    return Number(configured)
  }
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('instance')
  return raw && /^\d+$/.test(raw) ? Number(raw) : 0
}

export function defaultApiHost(): string {
  return new URL(defaultApiUrl()).hostname
}
