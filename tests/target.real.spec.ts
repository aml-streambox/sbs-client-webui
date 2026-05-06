import { expect, test } from '@playwright/test'
import WebSocket from 'ws'

const controllerUrl = process.env.SBS_E2E_CONTROLLER_WS
const baseUrl = process.env.SBS_E2E_TARGET_URL

type RpcResponse = {
  result?: any
  error?: { message: string }
}

async function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  if (!controllerUrl) {
    throw new Error('SBS_E2E_CONTROLLER_WS is required')
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(controllerUrl)
    socket.once('open', () => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))
    })
    socket.once('message', (raw) => {
      const response = JSON.parse(String(raw)) as RpcResponse
      socket.close()
      if (response.error) {
        reject(new Error(response.error.message))
        return
      }
      resolve(response.result)
    })
    socket.once('error', reject)
  })
}

async function waitForInstance(instanceId: number): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    try {
      await rpc('instance.call', { instance_id: instanceId, method: 'system.getState' })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error(`instance ${instanceId} did not become ready`)
}

test.describe.serial('target-backed webui verification', () => {
  let instanceId = 0
  let instanceName = ''

  test.beforeAll(async () => {
    if (!baseUrl || !controllerUrl) {
      throw new Error('SBS_E2E_TARGET_URL and SBS_E2E_CONTROLLER_WS are required')
    }
    instanceName = `E2E Managed Instance ${Date.now()}-${Math.floor(Math.random() * 10000)}`
    const created = await rpc('instance.create', { name: instanceName })
    instanceId = Number(created.instance_id)
    await waitForInstance(instanceId)
  })

  test.afterAll(async () => {
    if (instanceId > 0) {
      await rpc('instance.remove', { instance_id: instanceId })
    }
  })

  test('connects to deployed target and renders workspace without scroll regression', async ({ page }) => {
    await page.goto(`${baseUrl}?instance=${instanceId}`)
    await expect(page.getByText(`Inst ${instanceId}`)).toBeVisible()
    await page.locator('#instance-trigger').click()
    await expect(page.locator('#instance-panel')).toBeVisible()
    await expect(page.locator('#instance-panel')).toContainText(instanceName)
    await page.locator('#instance-trigger').click()
    await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Controls' })).toBeVisible()

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > window.innerWidth,
      vertical: document.documentElement.scrollHeight > window.innerHeight,
    }))
    expect(overflow.horizontal).toBeFalsy()
    expect(overflow.vertical).toBeFalsy()
  })

  test('supports core mouse-driven user flow on deployed target', async ({ page }) => {
    page.on('dialog', async (dialog) => {
      const message = dialog.message()
      if (message.includes('Scene name')) {
        await dialog.accept('Verification Scene')
      } else if (message.includes('Output name')) {
        await dialog.accept('Verification Output')
      } else {
        await dialog.dismiss()
      }
    })

    await page.goto(`${baseUrl}?instance=${instanceId}`)
    await page.getByRole('button', { name: '+ Scene' }).click()
    await expect(page.getByRole('button', { name: /Verification Scene/ })).toBeVisible()

    await page.getByRole('button', { name: '+ Source' }).click()
    await expect(page.locator('.settings-overlay .source-picker-dialog')).toBeVisible()
    await page.locator('.source-kind-card', { hasText: 'Test Pattern' }).click()
    await expect(page.locator('.source-config-dialog')).toBeVisible()
    await page.locator('.source-create-row').filter({ hasText: 'Name' }).locator('input').fill('Verification Source')
    await page.getByRole('button', { name: 'Create Source' }).click()
    await expect(page.locator('.source-item', { hasText: 'Verification Source' })).toBeVisible()

    await page.getByRole('button', { name: '+ Output' }).click()
    await expect(page.locator('.output-card', { hasText: 'Verification Output' })).toBeVisible()

    await page.getByRole('button', { name: 'Snapshot' }).click()
    await expect(page.getByRole('link', { name: 'Open Snapshot' })).toBeVisible()
  })

  test('supports touch interaction across compact layouts', async ({ page }, testInfo) => {
    await page.goto(`${baseUrl}?instance=${instanceId}`)
    await page.locator('#instance-trigger').click()
    await expect(page.locator('#instance-panel')).toBeVisible()
    const panelItems = page.locator('.instance-panel-item')
    await expect(panelItems.first()).toBeVisible()
    await page.locator('#instance-trigger').click()

    if (testInfo.project.name.includes('touch')) {
      await page.getByRole('button', { name: 'Refresh State' }).tap()
    } else {
      await page.getByRole('button', { name: 'Refresh State' }).click()
    }

    await expect(page.getByText('Shortcuts: 1-9 scenes, P preview, Shift+S snapshot, R refresh')).toBeVisible()
  })

  test('adapts workspace layout to responsive target viewport class', async ({ page }) => {
    await page.goto(`${baseUrl}?instance=${instanceId}`)
    await expect(page.getByText(`Inst ${instanceId}`)).toBeVisible()

    const mode = await page.locator('.app-shell').getAttribute('data-workspace-mode')
    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > window.innerWidth + 2,
    }))
    expect(overflow.horizontal).toBeFalsy()
    await expect(page.locator('.preview-screen')).toBeVisible()

    if (mode === 'phone') {
      await expect(page.locator('.phone-bottom-nav')).toBeVisible()
      await page.locator('.phone-bottom-nav').getByRole('button', { name: 'Sources' }).click()
      await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Sources/)
    } else if (mode === 'tablet') {
      await expect(page.locator('.tablet-section-nav')).toBeVisible()
      await page.locator('.tablet-section-nav').getByRole('button', { name: 'Outputs' }).click()
      await expect(page.locator('.adaptive-panel-shell')).toHaveAttribute('aria-label', /Outputs/)
    } else {
      await expect(page.locator('.phone-bottom-nav')).toBeHidden()
      await expect(page.locator('.draggable-dock')).toHaveCount(5)
    }
  })
})
