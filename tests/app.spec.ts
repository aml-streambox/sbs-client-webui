import { expect, test, type Page } from '@playwright/test'

const FILTER_STRESS_COUNT = 160

async function installMockSocket(page: Page, scenario = 'default') {
  await page.addInitScript((arg: { scenario: string; filterStressCount: number }) => {
    const sockets = []
    const promptResponses = []
    const state = {
      scenes: {
        'scene-main': { id: 'scene-main', name: 'Main', items: [{ id: 'item-default', source_id: 'default-src', visible: true, z_order: 0, filters: [], transform: { position_x: 0, position_y: 0, width: 640, height: 360, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0, rotation_deg: 0, flip_horizontal: false, flip_vertical: false, bounds_type: 'stretch', alignment: 'center', opacity: 1 } }] },
        'scene-alt': { id: 'scene-alt', name: 'Alt', items: [] },
      },
      sources: {
        'default-src': { id: 'default-src', name: 'Camera', type: 'videotestsrc', state: 'running', filters: [] },
      },
      output_groups: {
        'default-out': { id: 'default-out', name: 'Program SRT', state: 'running' },
      },
      state: {
        active_scene_id: 'scene-main',
      },
      preview: {
        available_profiles: [
          {
            id: 'program-hevc-srt',
            kind: 'reuse',
            transport: 'srt',
            codec: 'h265',
            container: 'mpegts',
            latency_class: 'low',
            resolution: { width: 3840, height: 2160 },
            framerate: 50,
            hardware_decode_preferred: true,
            requires_additional_encode: false,
            available: true,
            requestable: false,
            active: true,
            viewer_count: 0,
            stream_url: 'srt://localhost:8888',
          },
        ],
        requestable_profiles: [
          {
            id: 'preview-h264-720p30',
            kind: 'fallback',
            transport: 'hls',
            codec: 'h264',
            container: 'cmaf',
            latency_class: 'medium',
            resolution: { width: 1280, height: 720 },
            framerate: 30,
            hardware_decode_preferred: true,
            requires_additional_encode: true,
            available: false,
            requestable: true,
            active: false,
            viewer_count: 0,
            stream_url: 'http://localhost:10086/preview/preview-h264-720p30.m3u8',
          },
        ],
      },
      preview_encoder: {
        auto_downscale: true,
        downscale_factor: 2,
        framerate: 30,
        bitrate_kbps: 2500,
      },
      instances: [
        {
          instance_id: 0,
          name: 'Default',
          desired_running: true,
          running: true,
          pid: 1234,
          api_port: 10100,
          preview_port: 10101,
        },
      ],
      audio: {
        device: 'hw:0,2',
        master_volume: 1,
        master_mute: false,
        levels: {
          sources: {
            'default-src': { level_db: -18, peak_db: -8 },
          },
          master: { level_db: -12, peak_db: -6 },
        },
      },
    }

    const sourceKinds = [
      {
        id: 'videotestsrc', name: 'Test Pattern', summary: 'GStreamer video test source', pausable: true,
        fields: [{ key: 'pattern', label: 'Pattern', type: 'select', default: 'smpte', options: ['smpte', 'ball', 'snow', 'pinwheel'] }],
      },
      {
        id: 'vfmcap', name: 'VFM Capture', summary: 'Direct libvfmcap HDMI capture passthrough', pausable: false,
        fields: [{ key: 'output_format', label: 'Output Format', type: 'select', default: 'raw', options: ['raw'] }],
      },
      {
        id: 'v4l2src', name: 'V4L2 Device', summary: 'Linux V4L2 video capture device', pausable: false,
        fields: [{ key: 'device_path', label: 'Device Path', type: 'string', default: '/dev/video0' }],
      },
      {
        id: 'image', name: 'Image', summary: 'Static image source from a local path or URI', pausable: true,
        fields: [
          { key: 'path', label: 'Path or URI', type: 'string', default: '/tmp/sbs-static-test.png', asset_kind: 'image' },
          { key: 'loop', label: 'Loop', type: 'boolean', default: true },
        ],
      },
      {
        id: 'uridecodebin', name: 'URI Decode', summary: 'Decode local or remote media URI', pausable: true,
        fields: [
          { key: 'uri', label: 'URI', type: 'string', default: 'file:///tmp/sbs-static-test.mp4', asset_kind: 'media' },
          { key: 'loop', label: 'Loop', type: 'boolean', default: true },
        ],
      },
      { id: 'text', name: 'Text', summary: 'Generated text overlay source', pausable: true, fields: [
        { key: 'text', label: 'Text', type: 'string', default: 'LIVE' },
        { key: 'font_path', label: 'Font File', type: 'string', default: '', asset_kind: 'font' },
      ] },
    ]

    if (arg.scenario === 'design-stress') {
      const long = 'Legal Long Name With Spaces Slashes - underscores_1234567890'
      state.canvas = { width: 3840, height: 2160, fps_num: 60, fps_den: 1, color_mode: 'hdr10', background_color: '#123456' }
      state.instances = Array.from({ length: 6 }, (_, i) => ({
        instance_id: i,
        name: `${long} Instance ${i}`,
        desired_running: i !== 4,
        running: i !== 4,
        pid: 2200 + i,
        api_port: 10100 + i * 2,
        preview_port: 10101 + i * 2,
      }))
      state.sources = Object.fromEntries(Array.from({ length: 24 }, (_, i) => {
        const kind = sourceKinds[i % sourceKinds.length]
        const id = `legal-source-${String(i).padStart(2, '0')}`
        return [id, {
          id,
          name: `${long} Source ${String(i).padStart(2, '0')}`,
          type: kind.id,
          state: i % 5 === 0 ? 'disabled' : i % 7 === 0 ? 'starting' : 'running',
          enabled: i % 5 !== 0,
          config: Object.fromEntries(kind.fields.map((field) => [field.key, String(field.default)])),
          filters: [],
        }]
      }))
      const stressItems = Array.from({ length: 16 }, (_, i) => ({
        id: `legal-item-${String(i).padStart(2, '0')}`,
        source_id: `legal-source-${String(i % 12).padStart(2, '0')}`,
        visible: true,
        z_order: i,
        filters: [
          { id: `flt-${i}-brightness`, type: 'brightness', enabled: i % 2 === 0, params: { amount: i % 2 === 0 ? 0.5 : -0.5 } },
          { id: `flt-${i}-contrast`, type: 'contrast', enabled: true, params: { amount: i % 3 === 0 ? 2 : 0.5 } },
        ],
        transform: {
          position_x: (i % 4) * 960,
          position_y: Math.floor(i / 4) * 540,
          width: i === 14 ? 32 : 960,
          height: i === 15 ? 32 : 540,
          crop_top: 0,
          crop_bottom: 0,
          crop_left: 0,
          crop_right: 0,
          rotation_deg: [0, 90, 180, 270][i % 4],
          flip_horizontal: i % 2 === 0,
          flip_vertical: i % 3 === 0,
          bounds_type: 'stretch',
          alignment: 'center',
          opacity: i % 4 === 0 ? 0 : 1,
        },
      }))
      state.scenes = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
        const id = `legal-scene-${String(i).padStart(2, '0')}`
        return [id, { id, name: `${long} Scene ${String(i).padStart(2, '0')}`, items: i === 0 ? stressItems : [] }]
      }))
      state.output_groups = Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
        const id = `legal-output-${String(i).padStart(2, '0')}`
        return [id, { id, name: `${long} Output ${String(i).padStart(2, '0')}`, state: i % 2 === 0 ? 'running' : 'disabled' }]
      }))
      state.state.active_scene_id = 'legal-scene-00'
      state.audio.levels.sources = Object.fromEntries(Object.keys(state.sources).map((id, i) => [id, { level_db: -60 + (i % 12) * 5, peak_db: -40 + (i % 8) * 4 }]))
      state.audio.levels.master = { level_db: -3, peak_db: 0 }
    }

    if (arg.scenario === 'filter-stress') {
      const filterTypes = ['grayscale', 'brightness', 'contrast', 'hdr_to_sdr_lut']
      state.sources['default-src'].filters = Array.from({ length: arg.filterStressCount }, (_, i) => {
        const type = filterTypes[i % filterTypes.length]
        return {
          id: `${type}-stress-${i}`,
          type,
          enabled: i % 11 !== 0,
          params: type === 'brightness'
            ? { amount: ((i % 9) - 4) / 20 }
            : type === 'contrast'
              ? { amount: 0.8 + (i % 8) / 10 }
              : type === 'hdr_to_sdr_lut'
                ? { amount: 1, path: '' }
                : { amount: 1 },
        }
      })
    }

    if (arg.scenario === 'output-health') {
      state.output_groups = {
        'rtmp-good': { id: 'rtmp-good', name: 'RTMP Good', state: 'running', encoder: { sink_type: 'rtmp' } },
        'rtmp-loss': { id: 'rtmp-loss', name: 'RTMP Loss', state: 'running', encoder: { sink_type: 'rtmp' } },
        'rtmp-down': { id: 'rtmp-down', name: 'RTMP Down', state: 'running', encoder: { sink_type: 'rtmp' } },
        'srt-down': { id: 'srt-down', name: 'SRT Down', state: 'running', encoder: { sink_type: 'srt' } },
      }
      ;(state as any).output_health = {
        'rtmp-good': { sink_type: 'rtmp', status: 'connected', connected: true, degraded: false, reason: 'RTMP sink streaming', packets_sent: 2000, packets_dropped: 0, packet_drop_rate: 0 },
        'rtmp-loss': { sink_type: 'rtmp', status: 'degraded', connected: true, degraded: true, reason: 'RTMP sink warnings detected', packets_sent: 8000, packets_dropped: 100, packet_drop_rate: 0.012345 },
        'rtmp-down': { sink_type: 'rtmp', status: 'disconnected', connected: false, degraded: false, reason: 'RTMP endpoint unreachable', packets_sent: 5, packets_dropped: 0, packet_drop_rate: 0 },
        'srt-down': { sink_type: 'srt', status: 'disconnected', connected: false, degraded: false, reason: 'waiting for SRT caller', packets_sent: 0, packets_dropped: 0, packet_drop_rate: 0 },
      }
    }

    const stateResponse = () => ({
      ...state,
      output_health: (state as any).output_health,
    })

    class MockWebSocket {
      static OPEN = 1
      readyState = 1
      onopen = null
      onmessage = null
      onerror = null
      onclose = null

      constructor() {
        sockets.push(this)
        queueMicrotask(() => {
          this.onopen?.(new Event('open'))
        })
      }

      send(raw) {
        const request = JSON.parse(raw)
        const method = request.method === 'instance.call' ? request.params?.method : request.method
        const requestParams = request.method === 'instance.call' ? request.params?.params ?? {} : request.params ?? {}
        const respond = (payload) => {
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify(payload) })
          })
        }
        const publish = (topic, data) => {
          queueMicrotask(() => {
            this.onmessage?.({
              data: JSON.stringify({
                jsonrpc: '2.0',
                method: 'pubsub.event',
                params: { topic, data },
              }),
            })
          })
        }

        if (method === 'system.getState') {
          respond({ jsonrpc: '2.0', id: request.id, result: stateResponse() })
          return
        }

        if (method === 'source.listKinds') {
          respond({
            jsonrpc: '2.0', id: request.id, result: { kinds: sourceKinds.map(({ fields, ...kind }) => kind) },
          })
          return
        }

        if (method === 'source.describeKind') {
          const kind = sourceKinds.find((entry) => entry.id === requestParams.kind)
          respond({
            jsonrpc: '2.0', id: request.id, result: { kind },
          })
          return
        }

        if (method === 'source.uploadAsset') {
          const filename = String(requestParams.filename ?? 'upload.bin').replace(/[^a-zA-Z0-9._-]+/g, '_')
          const assetKind = requestParams.asset_kind ?? 'media'
          const path = `/var/lib/sbs/instances/0/assets/${assetKind}/mock-${filename}`
          respond({
            jsonrpc: '2.0', id: request.id, result: {
              asset_kind: assetKind,
              filename,
              path,
              uri: `file://${path}`,
              size: String(requestParams.data_base64 ?? '').length,
            },
          })
          return
        }

        if (method === 'instance.list') {
          respond({ jsonrpc: '2.0', id: request.id, result: { instances: state.instances } })
          return
        }

        if (method === 'instance.create') {
          const instance = {
            instance_id: state.instances.length,
            name: requestParams.name,
            desired_running: true,
            running: true,
            pid: 1200 + state.instances.length,
            api_port: 10100 + state.instances.length * 2,
            preview_port: 10101 + state.instances.length * 2,
          }
          state.instances.push(instance)
          respond({ jsonrpc: '2.0', id: request.id, result: instance })
          return
        }

        if (method === 'instance.update' || method === 'instance.enable' || method === 'instance.disable') {
          const instance = state.instances.find((entry) => entry.instance_id === requestParams.instance_id)
          if (instance) {
            if (requestParams.name) {
              instance.name = requestParams.name
            }
            if (method === 'instance.enable') {
              instance.desired_running = true
            } else if (method === 'instance.disable') {
              instance.desired_running = false
            } else if (typeof requestParams.enabled === 'boolean') {
              instance.desired_running = requestParams.enabled
            }
          }
          respond({ jsonrpc: '2.0', id: request.id, result: instance ?? {} })
          return
        }

        if (method === 'instance.remove') {
          state.instances = state.instances.filter((entry) => entry.instance_id !== requestParams.instance_id)
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'command.execute') {
          const command = requestParams?.command ?? ''
          if (command === 'scene set-active scene-alt') {
            state.state.active_scene_id = 'scene-alt'
            publish('scene.changed', { active_scene_id: 'scene-alt' })
          }
          if (command === 'source stop default-src') {
            state.sources['default-src'].state = 'disabled'
            publish('source.status', state.sources['default-src'])
          }
          if (command === 'output stop default-out') {
            state.output_groups['default-out'].state = 'disabled'
            publish('output.status', state.output_groups['default-out'])
          }
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'scene.create') {
          const scene = { id: requestParams.id, name: requestParams.name, items: [] }
          state.scenes[scene.id] = scene
          publish('scene.created', scene)
          respond({ jsonrpc: '2.0', id: request.id, result: scene })
          return
        }

        if (method === 'scene.setActive') {
          state.state.active_scene_id = requestParams.scene_id
          publish('scene.changed', { active_scene_id: requestParams.scene_id })
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'scene.remove') {
          delete state.scenes[requestParams.id]
          if (state.state.active_scene_id === requestParams.id) {
            state.state.active_scene_id = Object.keys(state.scenes)[0] ?? null
          }
          publish('scene.removed', { id: requestParams.id })
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'source.create') {
          const source = { id: requestParams.id, name: requestParams.name, type: requestParams.type, state: 'disabled', config: requestParams.config ?? {}, filters: [] }
          state.sources[source.id] = source
          publish('source.created', source)
          respond({ jsonrpc: '2.0', id: request.id, result: source })
          return
        }

        if (method === 'source.update') {
          const source = state.sources[requestParams.id]
          if (source) {
            if (requestParams.name) source.name = requestParams.name
            if (requestParams.config) source.config = requestParams.config
          }
          publish('source.updated', source)
          respond({ jsonrpc: '2.0', id: request.id, result: source ?? {} })
          return
        }

        if (method === 'source.remove') {
          delete state.sources[requestParams.id]
          publish('source.removed', { id: requestParams.id })
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'output.create') {
          const output = { id: requestParams.id, name: requestParams.name, state: 'disabled' }
          state.output_groups[output.id] = output
          publish('output.created', output)
          respond({ jsonrpc: '2.0', id: request.id, result: output })
          return
        }

        if (method === 'output.remove') {
          delete state.output_groups[requestParams.id]
          publish('output.removed', { id: requestParams.id })
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'filter.add') {
          const source = state.sources[requestParams.source_id]
          const filter = {
            id: requestParams.id,
            type: requestParams.type,
            enabled: true,
            params: requestParams.params ?? {},
          }
          if (source) source.filters.push(filter)
          publish('filter.added', source)
          respond({ jsonrpc: '2.0', id: request.id, result: source ?? {} })
          return
        }

        if (method === 'filter.update') {
          const source = state.sources[requestParams.source_id]
          const filter = source?.filters.find((entry) => entry.id === requestParams.filter_id)
          if (filter) {
            filter.enabled = requestParams.enabled
            filter.params = requestParams.params ?? filter.params
          }
          publish('filter.updated', source)
          respond({ jsonrpc: '2.0', id: request.id, result: source ?? {} })
          return
        }

        if (method === 'filter.remove') {
          const source = state.sources[requestParams.source_id]
          if (source) source.filters = source.filters.filter((entry) => entry.id !== requestParams.filter_id)
          publish('filter.removed', source)
          respond({ jsonrpc: '2.0', id: request.id, result: source ?? {} })
          return
        }

        if (method === 'snapshot.capture') {
          respond({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              id: 'snap-1',
              format: 'jpeg',
              url: '/snapshots/snap-1.jpg',
            },
          })
          return
        }

        if (method === 'audio.setSource') {
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'audio.setMaster') {
          state.audio.master_volume = requestParams.volume
          state.audio.master_mute = requestParams.mute
          respond({ jsonrpc: '2.0', id: request.id, result: state.audio })
          return
        }

        if (method === 'preview.listProfiles') {
          respond({
            jsonrpc: '2.0',
            id: request.id,
            result: state.preview,
          })
          return
        }

        if (method === 'preview.ensureProfile') {
          const profile = {
            ...state.preview.requestable_profiles[0],
            available: true,
            active: true,
            viewer_count: 1,
          }
          state.preview.requestable_profiles[0] = profile
          publish('preview.profile.active', profile)
          respond({ jsonrpc: '2.0', id: request.id, result: profile })
          return
        }

        if (method === 'preview.releaseProfile') {
          const profile = {
            ...state.preview.requestable_profiles[0],
            available: false,
            active: false,
            viewer_count: 0,
          }
          state.preview.requestable_profiles[0] = profile
          publish('preview.profile.released', profile)
          respond({ jsonrpc: '2.0', id: request.id, result: profile })
          return
        }

        if (method === 'preview.getStatus') {
          respond({ jsonrpc: '2.0', id: request.id, result: { catalog: state.preview, telemetry: {} } })
          return
        }

        if (method === 'preview.getEncoderConfig') {
          respond({ jsonrpc: '2.0', id: request.id, result: state.preview_encoder })
          return
        }

        if (method === 'preview.updateEncoderConfig') {
          state.preview_encoder = {
            ...state.preview_encoder,
            auto_downscale: requestParams.auto_downscale ?? state.preview_encoder.auto_downscale,
            downscale_factor: requestParams.downscale_factor ?? state.preview_encoder.downscale_factor,
            framerate: requestParams.framerate ?? state.preview_encoder.framerate,
            bitrate_kbps: requestParams.bitrate_kbps ?? state.preview_encoder.bitrate_kbps,
          }
          respond({ jsonrpc: '2.0', id: request.id, result: state.preview_encoder })
          return
        }

        if (method === 'scene.item.update') {
          const scene = state.scenes[requestParams.scene_id]
          if (scene) {
            const item = scene.items.find((i: any) => i.id === requestParams.item_id)
            if (item) {
              if (requestParams.transform) Object.assign(item.transform, requestParams.transform)
              if (requestParams.visible !== undefined) item.visible = requestParams.visible
              if (requestParams.z_order !== undefined) item.z_order = requestParams.z_order
            }
          }
          publish('scene.item.updated', { scene_id: requestParams.scene_id, item_id: requestParams.item_id })
          respond({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
          return
        }

        if (method === 'scene.item.add') {
          const scene = state.scenes[requestParams.scene_id]
          if (scene) {
            const item = { id: requestParams.id || `item-${Date.now()}`, source_id: requestParams.source_id, visible: true, z_order: 0, filters: [], transform: { position_x: 0, position_y: 0, width: 640, height: 360, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0, rotation_deg: 0, flip_horizontal: false, flip_vertical: false, bounds_type: 'stretch', alignment: 'center', opacity: 1 } }
            scene.items.push(item)
            publish('scene.item.added', item)
            respond({ jsonrpc: '2.0', id: request.id, result: item })
          } else {
            respond({ jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'Scene not found' } })
          }
          return
        }

        respond({ jsonrpc: '2.0', id: request.id, result: {} })
      }

      close() {
        this.onclose?.(new CloseEvent('close'))
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    })

    Object.defineProperty(window, 'prompt', {
      configurable: true,
      writable: true,
      value: () => promptResponses.shift() ?? null,
    })

    Object.defineProperty(window, '__mockSockets', {
      configurable: true,
      writable: true,
      value: sockets,
    })

    Object.defineProperty(window, '__setPromptResponses', {
      configurable: true,
      writable: true,
      value: (responses) => {
        promptResponses.splice(0, promptResponses.length, ...responses)
      },
    })
  }, { scenario, filterStressCount: FILTER_STRESS_COUNT })
}

test('renders OBS-like workspace chrome', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await expect(page.getByText('SBS Studio')).toBeVisible()
  await expect(page.getByText('Program', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Controls' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Audio Mixer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Main' })).toBeVisible()
  await expect(page.getByText('Camera').first()).toBeVisible()
})

test('accepts direct command entry', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  const input = page.getByRole('textbox')
  await input.fill('scene set-active scene-main')
  await expect(input).toHaveValue('scene set-active scene-main')
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible()
})

test('updates scene state from command and pubsub', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Alt' }).click()
  await expect(page.getByRole('button', { name: 'Alt' })).toHaveClass(/active/)
})

test('zooms preview canvas from toolbar controls', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  const preview = page.locator('.preview-screen')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((el: HTMLElement) => el.style.width)).not.toBe('')
  const zoomValue = page.getByLabel('Preview zoom', { exact: true })
  await expect(zoomValue).toHaveText('100%')
  const fitBox = await preview.boundingBox()
  expect(fitBox).not.toBeNull()

  await page.getByRole('button', { name: 'Zoom in preview' }).click()
  await expect(zoomValue).toHaveText('125%')
  const zoomedBox = await preview.boundingBox()
  expect(zoomedBox).not.toBeNull()
  expect(zoomedBox!.width).toBeGreaterThan(fitBox!.width)

  await page.getByRole('button', { name: 'Fit preview to window' }).click()
  await expect(zoomValue).toHaveText('100%')
})

test('fits aligned preview video to canvas overlay bounds', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await expect(page.locator('.preview-screen')).toBeVisible()
  const fit = await page.evaluate(async () => {
    const video = document.querySelector<HTMLVideoElement>('#preview-video')
    const overlay = document.querySelector<HTMLElement>('.source-overlay')
    if (!video || !overlay) return { ok: false, reason: 'missing preview nodes' }

    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 368
    const ctx = canvas.getContext('2d')
    ctx!.fillStyle = '#00ff00'
    ctx!.fillRect(0, 0, canvas.width, canvas.height)
    video.srcObject = canvas.captureStream(30)
    await video.play()
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve()
      else video.addEventListener('loadedmetadata', () => resolve(), { once: true })
    })

    const videoRect = video.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const style = window.getComputedStyle(video)
    const renderedRect = style.objectFit === 'fill'
      ? videoRect
      : (() => {
          const videoAspect = video.videoWidth / video.videoHeight
          const boxAspect = videoRect.width / videoRect.height
          if (videoAspect > boxAspect) {
            const height = videoRect.width / videoAspect
            const top = videoRect.top + (videoRect.height - height) / 2
            return { left: videoRect.left, right: videoRect.right, top, bottom: top + height, width: videoRect.width, height }
          }
          const width = videoRect.height * videoAspect
          const left = videoRect.left + (videoRect.width - width) / 2
          return { left, right: left + width, top: videoRect.top, bottom: videoRect.bottom, width, height: videoRect.height }
        })()

    return {
      ok: true,
      objectFit: style.objectFit,
      intrinsic: { width: video.videoWidth, height: video.videoHeight },
      deltas: {
        left: Math.abs(renderedRect.left - overlayRect.left),
        right: Math.abs(renderedRect.right - overlayRect.right),
        top: Math.abs(renderedRect.top - overlayRect.top),
        bottom: Math.abs(renderedRect.bottom - overlayRect.bottom),
      },
    }
  })

  expect(fit.ok).toBeTruthy()
  expect(fit.objectFit).toBe('fill')
  expect(fit.intrinsic).toEqual({ width: 640, height: 368 })
  expect(Math.max(...Object.values(fit.deltas))).toBeLessThan(1)
})

test('shows logical preview scale sizes and auto 720p target', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await page.locator('.settings-sidebar').getByRole('button', { name: 'Preview', exact: true }).click()

  const scaleRow = page.locator('.settings-row').filter({ hasText: 'Resolution Scale' })
  await expect(scaleRow).toContainText('960x540')
  await scaleRow.locator('select').selectOption('1')
  await expect(scaleRow).toContainText('1920x1080')
  await scaleRow.locator('select').selectOption('auto')
  await expect(scaleRow).toContainText('960x540')

  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByText('Preview encoder config updated')).toBeVisible()
})

test('adapts workspace layout to responsive viewport class', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 2,
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  expect(overflow.horizontal).toBeFalsy()
  await expect(page.locator('.preview-screen')).toBeVisible()

  if (mode === 'phone') {
    await expect(page.locator('.phone-bottom-nav')).toBeVisible()
    await expect(page.locator('.mobile-statusbar')).toBeVisible()
    await expect(page.locator('.mobile-statusbar')).toContainText('Status')
    await expect(page.locator('.mobile-statusbar')).toContainText('FPS')
    await expect(page.locator('.mobile-statusbar')).toContainText('Bitrate')
    await expect(page.locator('.mobile-statusbar')).toContainText('CPU')
    await expect(page.locator('.mobile-statusbar')).toContainText('GPU')
    const landscape = await page.evaluate(() => window.innerWidth > window.innerHeight)
    if (landscape) {
      await expect(page.locator('.app-shell')).toHaveAttribute('data-phone-panel-open', 'false')
      await expect(page.locator('.adaptive-panel-shell')).toBeHidden()
    } else {
      await expect(page.locator('.adaptive-panel-shell')).toBeVisible()
      await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Scenes/)
    }
  } else if (mode === 'tablet') {
    await expect(page.locator('.tablet-section-nav')).toBeVisible()
    await expect(page.locator('.adaptive-panel-shell')).toBeVisible()
    await expect(page.locator('.phone-bottom-nav')).toBeHidden()
  } else {
    await expect(page.locator('.phone-bottom-nav')).toBeHidden()
    await expect(page.locator('.draggable-dock')).toHaveCount(5)
  }
})

test('supports core phone operator flow', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'phone', 'phone-only responsive flow')

  const nav = page.locator('.phone-bottom-nav')
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'Scenes' }).click()
  await page.getByRole('button', { name: 'Alt' }).click()
  await expect(page.getByRole('button', { name: 'Alt' })).toHaveClass(/active/)
  await page.getByRole('button', { name: 'Main' }).click()

  await nav.getByRole('button', { name: 'Sources' }).click()
  const sourceItem = page.locator('.adaptive-panel-shell .source-item', { hasText: 'Camera' })
  await expect(sourceItem).toBeVisible()
  await sourceItem.getByRole('button', { name: 'Hide' }).click()
  await expect(sourceItem.getByRole('button', { name: 'Show' })).toBeVisible()
  if (await page.evaluate(() => window.innerWidth > window.innerHeight)) {
    await page.locator('.adaptive-panel-close').click()
    await expect(page.locator('.adaptive-panel-shell')).toBeHidden()
  }

  await page.getByRole('button', { name: 'Snapshot' }).click()
  await expect(page.getByRole('link', { name: 'Open Snapshot' })).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('supports touch drag on phone preview items', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'phone', 'phone-only touch drag coverage')

  const item = page.locator('.source-bbox').first()
  await expect(item).toBeVisible()
  const before = await item.boundingBox()
  expect(before).not.toBeNull()
  if (!before) return

  await page.evaluate(({ x1, y1, x2, y2 }) => {
    const target = document.elementFromPoint(x1, y1) as HTMLElement | null
    if (!target) throw new Error('missing touch target')

    function makeTouch(x: number, y: number) {
      return new Touch({ identifier: 1, target, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y })
    }

    target.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [makeTouch(x1, y1)],
      targetTouches: [makeTouch(x1, y1)],
      changedTouches: [makeTouch(x1, y1)],
    }))
    target.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches: [makeTouch(x2, y2)],
      targetTouches: [makeTouch(x2, y2)],
      changedTouches: [makeTouch(x2, y2)],
    }))
    target.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: [makeTouch(x2, y2)],
    }))
  }, {
    x1: before.x + Math.min(before.width / 2, 40),
    y1: before.y + Math.min(before.height - 8, Math.max(16, before.height * 0.75)),
    x2: before.x + Math.min(before.width / 2, 40) + 36,
    y2: before.y + Math.min(before.height - 8, Math.max(16, before.height * 0.75)) + 18,
  })

  await expect.poll(async () => {
    const after = await item.boundingBox()
    return after ? after.x - before.x : 0
  }).toBeGreaterThan(8)
})

test('keeps phone preview context menu reachable and dismissible', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'phone', 'phone-only context menu coverage')

  const item = page.locator('.source-bbox').first()
  await expect(item).toBeVisible()
  const box = await item.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  await page.evaluate(({ x, y }) => {
    const target = document.querySelector<HTMLElement>('.source-bbox')
    if (!target) throw new Error('missing source bbox')
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y })
    target.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    }))
  }, {
    x: box.x + Math.min(box.width - 4, Math.max(4, box.width / 2)),
    y: await page.evaluate(() => window.innerHeight - 4),
  })

  const menu = page.locator('.preview-context-menu')
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox).not.toBeNull()
  if (!menuBox) return
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!viewport) return
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.y).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 1)

  await menu.getByRole('button', { name: 'Close' }).click()
  await expect(menu).toBeHidden()
})

test('keeps phone settings actions inside the visible viewport', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'phone', 'phone-only settings dialog coverage')

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  const dialog = page.locator('.settings-dialog')
  await expect(dialog).toBeVisible()
  const issues = await page.evaluate(() => {
    const result: string[] = []
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    for (const selector of ['.settings-dialog', '.settings-header', '.settings-content', '.settings-footer']) {
      const el = document.querySelector<HTMLElement>(selector)
      if (!el) {
        result.push(`missing ${selector}`)
        continue
      }
      const rect = el.getBoundingClientRect()
      if (rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
        result.push(`${selector} outside viewport ${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} of ${viewport.width}x${viewport.height}`)
      }
    }
    for (const button of Array.from(document.querySelectorAll<HTMLElement>('.settings-footer button, .settings-header button'))) {
      const rect = button.getBoundingClientRect()
      if (rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
        result.push(`button outside viewport ${button.textContent?.trim()} ${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`)
      }
    }
    return result
  })
  expect(issues).toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('changes selected tablet panel without desktop dock overflow', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'tablet', 'tablet-only responsive flow')

  const nav = page.locator('.tablet-section-nav')
  await expect(nav).toBeVisible()
  await nav.getByRole('button', { name: 'Sources' }).click()
  await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Sources/)
  await nav.getByRole('button', { name: 'Outputs' }).click()
  await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Outputs/)
  const visibleDockCount = await page.locator('.draggable-dock').evaluateAll((docks) => docks.filter((dock) => {
    const style = window.getComputedStyle(dock as HTMLElement)
    const box = (dock as HTMLElement).getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
  }).length)
  expect(visibleDockCount).toBe(0)
})

test('keeps desktop dock workspace usable up to 4k', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'desktop', 'desktop-only responsive flow')

  await expect(page.locator('.draggable-dock')).toHaveCount(5)
  await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Controls' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Audio Mixer' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible()
  const collapsed = await page.locator('.draggable-dock').evaluateAll((docks) => docks.some((dock) => {
    const box = dock.getBoundingClientRect()
    return box.width < 120 || box.height < 60
  }))
  expect(collapsed).toBeFalsy()
})

test('toggles output controls and source visibility', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  const outputCard = page.locator('.output-card', { hasText: 'Program SRT' })
  const stopButton = outputCard.getByRole('button', { name: 'Stop' })
  await expect(stopButton).toBeVisible()

  await stopButton.click()
  await expect(outputCard.getByRole('button', { name: 'Start' })).toBeVisible()
})

test('colors RTMP and SRT output indicators by sink health', async ({ page }) => {
  await installMockSocket(page, 'output-health')
  await page.goto('/')

  const indicatorClass = async (name: string) => {
    const card = page.locator('.output-card', { hasText: name })
    await expect(card).toBeVisible()
    return card.locator('.output-state-dot').getAttribute('class')
  }

  await expect(page.locator('.output-card', { hasText: 'RTMP Good' })).toContainText('connected')
  await expect(page.locator('.output-card', { hasText: 'RTMP Loss' })).toContainText('degraded')
  await expect(page.locator('.output-card', { hasText: 'RTMP Down' })).toContainText('disconnected')
  await expect(page.locator('.output-card', { hasText: 'SRT Down' })).toContainText('disconnected')
  await expect(page.locator('.output-card', { hasText: 'RTMP Good' }).locator('.output-drop-rate')).toHaveText('drop 0.0%')
  await expect(page.locator('.output-card', { hasText: 'RTMP Loss' }).locator('.output-drop-rate')).toHaveText('drop 1.2%')
  expect(await indicatorClass('RTMP Good')).toContain('connected')
  expect(await indicatorClass('RTMP Loss')).toContain('degraded')
  expect(await indicatorClass('RTMP Down')).toContain('disconnected')
  expect(await indicatorClass('SRT Down')).toContain('disconnected')
})

test('adds and removes filters from inspector', async ({ page }, testInfo) => {
  await installMockSocket(page)
  await page.goto('/')

  const filtersDock = page.locator('.draggable-dock').filter({ hasText: 'Filters' }).first()
  await expect(filtersDock).toBeVisible()
  await expect(filtersDock.getByRole('combobox', { name: 'Add effect filter' })).toBeVisible()
  await expect(filtersDock.locator('input[type="range"]').first()).toHaveCount(0)
  await expect.poll(() => filtersDock.evaluate((dock) => dock.draggable)).toBe(false)
  await expect.poll(() => filtersDock.locator('.dock-handle').evaluate((handle) => handle.draggable)).toBe(true)

  await filtersDock.getByRole('combobox', { name: 'Add effect filter' }).selectOption('contrast')
  await expect(filtersDock.locator('.filter-list-row')).toHaveCount(1)
  await expect(filtersDock.locator('.filter-list-row', { hasText: 'Contrast' })).toHaveAttribute('aria-selected', 'true')
  await expect(filtersDock.locator('input[type="range"]')).toHaveCount(1)
  await expect(filtersDock.locator('.filter-value')).toHaveText('Current: 1.15x - Range: 0.50x to 2.00x')
  await expect(filtersDock.getByRole('spinbutton', { name: 'Contrast Multiplier value' })).toHaveValue('1.15')

  const contrastSlider = filtersDock.getByRole('slider', { name: 'Contrast Multiplier' })
  const initialDockOrder = await page.locator('.draggable-dock').evaluateAll((docks) => docks.map((dock) => (dock as HTMLElement).dataset.panel).join('|'))
  if (testInfo.project.name === 'desktop-1366') {
    const box = await contrastSlider.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width * 0.9, box!.y + box!.height / 2, { steps: 4 })
    await page.mouse.up()
  } else {
    await contrastSlider.focus()
    await page.keyboard.press('ArrowRight')
  }
  await expect.poll(async () => filtersDock.locator('.filter-value').textContent()).not.toContain('Current: 1.15x')
  const afterSliderDockOrder = await page.locator('.draggable-dock').evaluateAll((docks) => docks.map((dock) => (dock as HTMLElement).dataset.panel).join('|'))
  expect(afterSliderDockOrder).toBe(initialDockOrder)

  await filtersDock.getByRole('spinbutton', { name: 'Contrast Multiplier value' }).fill('1.85')
  await filtersDock.getByRole('spinbutton', { name: 'Contrast Multiplier value' }).press('Enter')
  await expect(filtersDock.locator('.filter-value')).toHaveText('Current: 1.85x - Range: 0.50x to 2.00x')

  await filtersDock.getByRole('button', { name: 'Remove selected filter' }).click()
  await expect(filtersDock.locator('.filter-list-row')).toHaveCount(0)
})

test('visually handles a source with many filters', async ({ page }, testInfo) => {
  await installMockSocket(page, 'filter-stress')
  await page.goto('/')

  const filtersDock = page.locator('.draggable-dock').filter({ hasText: 'Filters' }).first()
  await expect(filtersDock.getByText('Target Source')).toBeVisible()
  await expect(filtersDock.getByText('Camera')).toBeVisible()
  await expect(filtersDock.locator('.filter-list-row')).toHaveCount(FILTER_STRESS_COUNT)

  const metrics = await filtersDock.evaluate((dock) => {
    const list = dock.querySelector<HTMLElement>('.filter-list')
    const start = performance.now()
    for (let i = 0; i < 40; i++) {
      if (list) list.scrollTop = i % 2 === 0 ? list.scrollHeight : 0
      dock.getBoundingClientRect()
    }
    const scrollMs = performance.now() - start
    return {
      filterCount: dock.querySelectorAll('.filter-list-row').length,
      rangeCount: dock.querySelectorAll('input[type="range"]').length,
      scrollMs,
    }
  })

  console.log(`filter stress metrics: filters=${metrics.filterCount} ranges=${metrics.rangeCount} scrollMs=${metrics.scrollMs.toFixed(2)}`)
  expect(metrics.filterCount).toBe(FILTER_STRESS_COUNT)
  expect(metrics.rangeCount).toBe(1)
  expect(metrics.scrollMs).toBeLessThan(1000)

  await filtersDock.screenshot({ path: testInfo.outputPath('filter-stress-inspector.png') })
})

test('captures snapshot from preview panel', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Snapshot' }).click()
  await expect(page.getByRole('link', { name: 'Open Snapshot' })).toBeVisible()
})

test('shows audio mixer controls', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  const mixerDock = page.locator('.draggable-dock').filter({ hasText: 'Audio Mixer' }).first()
  await expect(mixerDock).toBeVisible()
  await expect(mixerDock.getByText('Master')).toBeVisible()
  await expect(mixerDock.locator('input[type="range"]').first()).toBeVisible()
})

test('creates and deletes scene, source, and output from direct controls', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await page.evaluate(() => (window as any).__setPromptResponses(['Showcase']))
  await page.getByRole('button', { name: '+ Scene' }).click()
  await expect(page.getByRole('button', { name: 'Showcase' })).toBeVisible()

  await page.getByRole('button', { name: '+ Source' }).click()
  await expect(page.locator('.settings-overlay .source-picker-dialog')).toBeVisible()
  await page.locator('.source-kind-card', { hasText: 'Test Pattern' }).click()
  await expect(page.locator('.source-config-dialog')).toBeVisible()
  await page.locator('.source-create-row').filter({ hasText: 'Name' }).locator('input').fill('Desk Cam')
  await page.getByRole('button', { name: 'Create Source' }).click()
  const deskCam = page.locator('.source-item', { hasText: 'Desk Cam' })
  await expect(deskCam).toBeVisible()
  await deskCam.getByRole('button', { name: 'Add' }).click()
  await expect(deskCam.getByRole('button', { name: 'Hide' })).toBeVisible()
  await deskCam.getByRole('button', { name: 'Hide' }).click()
  await expect(deskCam.getByRole('button', { name: 'Show' })).toBeVisible()
  await deskCam.getByRole('button', { name: 'Show' }).click()
  await expect(deskCam.getByRole('button', { name: 'Hide' })).toBeVisible()

  await page.evaluate(() => (window as any).__setPromptResponses(['Backup Feed']))
  await page.getByRole('button', { name: '+ Output' }).click()
  await expect(page.locator('.output-card', { hasText: 'Backup Feed' })).toBeVisible()
  await expect(page.locator('.output-card', { hasText: 'Backup Feed' }).getByRole('button', { name: 'Start' })).toBeVisible()

  await deskCam.getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.source-item', { hasText: 'Desk Cam' })).toHaveCount(0)
})

test('supports keyboard shortcuts for scene switch and snapshot', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('2')
  await expect(page.getByRole('button', { name: 'Alt' })).toHaveClass(/active/)

  await page.keyboard.press('Shift+S')
  await expect(page.getByRole('link', { name: 'Open Snapshot' })).toBeVisible()
})

test('reconnects after socket close', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')

  await expect(page.getByText('API connected')).toBeVisible()
  await page.evaluate(() => (window as any).__mockSockets[0].close())
  await page.waitForFunction(() => (window as any).__mockSockets.length > 1)
  await expect(page.getByText('API connected')).toBeVisible()
})

async function expectWorkspaceNotBroken(page: Page) {
  const issues = await page.evaluate(() => {
    const result: string[] = []
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const doc = document.documentElement
    if (doc.scrollWidth > viewport.width + 2) result.push(`document horizontal overflow ${doc.scrollWidth} > ${viewport.width}`)
    if (doc.scrollHeight > viewport.height + 2) result.push(`document vertical overflow ${doc.scrollHeight} > ${viewport.height}`)

    function checkBox(selector: string, minWidth = 1, minHeight = 1) {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
      if (elements.length === 0) {
        result.push(`missing ${selector}`)
        return
      }
      for (const [index, el] of elements.entries()) {
        const box = el.getBoundingClientRect()
        if (!Number.isFinite(box.left + box.top + box.width + box.height)) result.push(`${selector}[${index}] has non-finite rect`)
        if (box.width < minWidth || box.height < minHeight) result.push(`${selector}[${index}] collapsed ${box.width}x${box.height}`)
        if (box.right < -2 || box.left > viewport.width + 2) result.push(`${selector}[${index}] horizontally outside viewport`)
      }
    }

    checkBox('.app-shell', viewport.width - 2, viewport.height - 2)
    checkBox('.obs-topbar', 320, 24)
    checkBox('.obs-layout', 320, 240)
    checkBox('.obs-center-stage', 160, 120)
    checkBox('.preview-screen', 160, 90)
    checkBox('.draggable-dock', 120, 60)
    checkBox('.obs-statusbar', 320, 24)

    const preview = document.querySelector<HTMLElement>('.source-overlay')?.getBoundingClientRect()
    for (const [index, el] of Array.from(document.querySelectorAll<HTMLElement>('.source-bbox')).entries()) {
      const box = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      if (!Number.isFinite(parseFloat(style.left)) || !Number.isFinite(parseFloat(style.top))) result.push(`source-bbox[${index}] has invalid positioned style`)
      if (box.width < 0 || box.height < 0) result.push(`source-bbox[${index}] has negative size`)
      if (preview && (box.left < preview.left - 4 || box.top < preview.top - 4 || box.right > preview.right + 4 || box.bottom > preview.bottom + 4)) {
        result.push(`source-bbox[${index}] escaped preview box=${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)} preview=${Math.round(preview.left)},${Math.round(preview.top)},${Math.round(preview.right)},${Math.round(preview.bottom)} style=${style.left},${style.top},${style.width},${style.height}`)
      }
    }

    for (const [index, el] of Array.from(document.querySelectorAll<HTMLElement>('button, input, select')).entries()) {
      const box = el.getBoundingClientRect()
      if (box.width > viewport.width + 2) result.push(`control[${index}] wider than viewport`)
    }
    return result
  })
  expect(issues).toEqual([])
}

async function expectPhoneWorkspaceNotBroken(page: Page) {
  const issues = await page.evaluate(() => {
    const result: string[] = []
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const doc = document.documentElement
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const mode = shell?.dataset.workspaceMode
    const panelOpen = shell?.dataset.phonePanelOpen === 'true'

    if (mode !== 'phone') result.push(`expected phone mode, got ${mode}`)
    if (doc.scrollWidth > viewport.width + 2) result.push(`document horizontal overflow ${doc.scrollWidth} > ${viewport.width}`)
    if (doc.scrollHeight > viewport.height + 2) result.push(`document vertical overflow ${doc.scrollHeight} > ${viewport.height}`)

    function box(selector: string, minWidth: number, minHeight: number) {
      const el = document.querySelector<HTMLElement>(selector)
      if (!el) {
        result.push(`missing ${selector}`)
        return null
      }
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') result.push(`${selector} hidden`)
      if (rect.width < minWidth || rect.height < minHeight) result.push(`${selector} collapsed ${Math.round(rect.width)}x${Math.round(rect.height)}`)
      if (rect.left < -2 || rect.top < -2 || rect.right > viewport.width + 2 || rect.bottom > viewport.height + 2) {
        result.push(`${selector} outside viewport ${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} of ${viewport.width}x${viewport.height}`)
      }
      return rect
    }

    function overlap(a: DOMRect | null, b: DOMRect | null) {
      if (!a || !b) return 0
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      return width * height
    }

    function fmt(rect: DOMRect | null) {
      if (!rect) return 'missing'
      return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
    }

    const landscape = viewport.width > viewport.height
    const topbar = box('.obs-topbar', Math.min(320, viewport.width - 2), landscape ? 32 : 40)
    const layout = box('.obs-layout', Math.min(300, viewport.width - 2), Math.min(220, viewport.height - 80))
    const stage = box('.obs-center-stage', landscape ? 220 : 180, landscape ? 180 : 180)
    const toolbar = box('.obs-stage-toolbar', landscape ? 220 : 160, landscape ? 28 : 40)
    const preview = box('.preview-screen', landscape ? 200 : 160, landscape ? 110 : 90)
    const panel = panelOpen || !landscape ? box('.adaptive-panel-shell', landscape ? 280 : 280, landscape ? 180 : 190) : null
    const nav = box('.phone-bottom-nav', landscape ? 54 : Math.min(320, viewport.width - 2), landscape ? viewport.height - 24 : 44)
    const mobileStatus = box('.mobile-statusbar', landscape ? 320 : Math.min(320, viewport.width - 2), landscape ? 16 : 22)

    const mobileStatusText = document.querySelector<HTMLElement>('.mobile-statusbar')?.textContent ?? ''
    for (const label of ['Status', 'FPS', 'Bitrate', 'CPU', 'GPU']) {
      if (!mobileStatusText.includes(label)) result.push(`mobile status missing ${label}`)
    }

    if (landscape && !panelOpen) {
      const panelEl = document.querySelector<HTMLElement>('.adaptive-panel-shell')
      const style = panelEl ? window.getComputedStyle(panelEl) : null
      if (!panelEl) result.push('missing .adaptive-panel-shell')
      if (style && style.visibility !== 'hidden') result.push(`landscape drawer should start hidden, got ${style.visibility}`)
      if (preview && preview.width < viewport.width * 0.58) result.push(`landscape preview too small: ${fmt(preview)}`)
    }

    if (!landscape && overlap(preview, panel) > 2) result.push(`preview overlaps adaptive panel preview=${fmt(preview)} panel=${fmt(panel)}`)
    if (landscape && overlap(toolbar, preview) > 2) result.push(`toolbar overlaps preview toolbar=${fmt(toolbar)} preview=${fmt(preview)}`)
    if (overlap(stage, nav) > 2) result.push(`stage overlaps phone navigation stage=${fmt(stage)} nav=${fmt(nav)}`)
    if (overlap(panel, nav) > 2) result.push(`adaptive panel overlaps phone navigation panel=${fmt(panel)} nav=${fmt(nav)}`)
    if (overlap(preview, mobileStatus) > 2) result.push(`preview overlaps mobile status preview=${fmt(preview)} status=${fmt(mobileStatus)}`)
    if (overlap(nav, mobileStatus) > 2) result.push(`phone navigation overlaps mobile status nav=${fmt(nav)} status=${fmt(mobileStatus)}`)
    if (mobileStatus && mobileStatus.bottom < viewport.height - 2) result.push(`mobile status not pinned to bottom status=${fmt(mobileStatus)} viewport=${viewport.width}x${viewport.height}`)

    if (landscape) {
      if (panel && nav && panel.right > nav.left + 2) result.push(`landscape drawer overlaps navigation panel=${fmt(panel)} nav=${fmt(nav)}`)
      if (nav && nav.width > 96) result.push(`landscape nav too wide: ${Math.round(nav.width)}`)
    } else if (panel && stage && panel.top < stage.bottom - 2) {
      result.push(`portrait panel is not below stage stage=${fmt(stage)} panel=${fmt(panel)}`)
    }

    for (const [index, el] of Array.from(document.querySelectorAll<HTMLElement>('button, input, select')).entries()) {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width > viewport.width + 2) {
        const label = el.getAttribute('aria-label') || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || el.tagName.toLowerCase()
        result.push(`control[${index}] wider than viewport ${Math.round(rect.width)}px ${el.tagName.toLowerCase()}.${el.className || ''} "${label}"`)
      }
    }

    if (topbar && layout && topbar.bottom > layout.top + 2) result.push('topbar overlaps workspace')
    return result
  })

  expect(issues).toEqual([])
}

test('keeps 21:9 phone layout usable in both orientations', async ({ page }) => {
  await installMockSocket(page, 'design-stress')
  await page.goto('/')

  const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
  test.skip(mode !== 'phone', 'phone-only 21:9 responsive coverage')

  await expect(page.locator('.phone-bottom-nav')).toBeVisible()
  const landscape = await page.evaluate(() => window.innerWidth > window.innerHeight)
  if (landscape) {
    await expect(page.locator('.app-shell')).toHaveAttribute('data-phone-panel-open', 'false')
    await expect(page.locator('.adaptive-panel-shell')).toBeHidden()
  } else {
    await expect(page.locator('.adaptive-panel-shell')).toBeVisible()
  }
  await expectPhoneWorkspaceNotBroken(page)

  await page.locator('.phone-bottom-nav').getByRole('button', { name: 'Sources' }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-phone-panel-open', 'true')
  await expect(page.locator('.adaptive-panel-shell')).toBeVisible()
  await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Sources/)
  if (landscape) {
    await expect.poll(async () => page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.adaptive-panel-shell')?.getBoundingClientRect()
      const nav = document.querySelector<HTMLElement>('.phone-bottom-nav')?.getBoundingClientRect()
      return Boolean(panel && nav && panel.right <= nav.left + 2)
    })).toBe(true)
  }
  await expectPhoneWorkspaceNotBroken(page)

  if (landscape) {
    await page.locator('.adaptive-panel-close').click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-phone-panel-open', 'false')
    await expect(page.locator('.adaptive-panel-shell')).toBeHidden()
    await expectPhoneWorkspaceNotBroken(page)
  }
})

test('survives legal-input design stress without layout breakage', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await installMockSocket(page, 'design-stress')
  await page.goto('/')
  await expect(page.getByText('SBS Studio')).toBeVisible()
  await expect(page.locator('.source-bbox')).toHaveCount(16)
  await expectWorkspaceNotBroken(page)

  await page.getByRole('button', { name: '+ Source' }).click()
  await expect(page.locator('.settings-overlay .source-picker-dialog')).toBeVisible()
  await page.locator('.source-kind-card', { hasText: 'Image' }).click()
  await expect(page.locator('.source-config-dialog')).toBeVisible()
  await page.locator('.source-create-row').filter({ hasText: 'Name' }).locator('input').fill('Legal Static Image Source With A Very Long Display Name 0123456789')
  await expect(page.locator('.source-create-row').filter({ hasText: 'Loop' }).locator('input[type="checkbox"]')).toBeChecked()
  const imagePathRow = page.locator('.source-create-row').filter({ hasText: 'Path or URI' })
  await imagePathRow.locator('input[type="file"]').setInputFiles({
    name: 'legal image name with spaces.png',
    mimeType: 'image/png',
    buffer: Buffer.from('mock-png'),
  })
  await expect(imagePathRow.locator('.asset-field-status')).toContainText('Uploaded legal_image_name_with_spaces.png')
  await expect(imagePathRow.locator('input').first()).toHaveValue(/assets\/image\/mock-legal_image_name_with_spaces.png/)
  await page.getByRole('button', { name: 'Create Source' }).click()
  await expect(page.locator('.source-picker-dialog')).toHaveCount(0)
  await expect(page.locator('.source-config-dialog')).toHaveCount(0)
  await expectWorkspaceNotBroken(page)

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expectWorkspaceNotBroken(page)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

const JUMP_TOLERANCE = 3

for (const dir of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
  test(`resize from ${dir} does not jump on release`, async ({ page }) => {
    await installMockSocket(page)
    await page.goto('/')
    await page.waitForTimeout(500)

    const bbox = page.locator('.source-bbox').first()
    await expect(bbox).toBeVisible()

    await bbox.click({ force: true })
    await page.waitForTimeout(100)

    const handle = page.locator(`.bbox-rh.rh-${dir}`)
    await expect(handle).toBeVisible()

    const handleBox = await handle.boundingBox()
    expect(handleBox).toBeTruthy()

    const dragX = dir.includes('e') ? 40 : dir.includes('w') ? -40 : 0
    const dragY = dir.includes('s') ? 30 : dir.includes('n') ? -30 : 0
    const hx = handleBox!.x + handleBox!.width / 2
    const hy = handleBox!.y + handleBox!.height / 2

    await page.mouse.move(hx, hy)
    await page.mouse.down()
    await page.mouse.move(hx + dragX, hy + dragY, { steps: 6 })

    const duringStyle = await bbox.evaluate((el: HTMLElement) => ({
      left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height,
    }))

    await page.mouse.up()
    await page.waitForTimeout(500)

    const afterStyle = await bbox.evaluate((el: HTMLElement) => ({
      left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height,
    }))

    const parse = (v: string) => parseFloat(v) || 0

    expect(Math.abs(parse(afterStyle.left) - parse(duringStyle.left))).toBeLessThan(JUMP_TOLERANCE)
    expect(Math.abs(parse(afterStyle.top) - parse(duringStyle.top))).toBeLessThan(JUMP_TOLERANCE)
    expect(Math.abs(parse(afterStyle.width) - parse(duringStyle.width))).toBeLessThan(JUMP_TOLERANCE)
    expect(Math.abs(parse(afterStyle.height) - parse(duringStyle.height))).toBeLessThan(JUMP_TOLERANCE)
  })
}

test('drag move does not jump on release', async ({ page }) => {
  await installMockSocket(page)
  await page.goto('/')
  await page.waitForTimeout(500)

  const bbox = page.locator('.source-bbox').first()
  await expect(bbox).toBeVisible()

  const beforeBox = await bbox.boundingBox()
  expect(beforeBox).toBeTruthy()

  const cx = beforeBox!.x + beforeBox!.width / 2
  const cy = beforeBox!.y + beforeBox!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy - 40, { steps: 6 })

  const duringStyle = await bbox.evaluate((el: HTMLElement) => ({
    left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height,
  }))

  await page.mouse.up()
  await page.waitForTimeout(500)

  const afterStyle = await bbox.evaluate((el: HTMLElement) => ({
    left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height,
  }))

  const parse = (v: string) => parseFloat(v) || 0

  expect(Math.abs(parse(afterStyle.left) - parse(duringStyle.left))).toBeLessThan(JUMP_TOLERANCE)
  expect(Math.abs(parse(afterStyle.top) - parse(duringStyle.top))).toBeLessThan(JUMP_TOLERANCE)
})
