import { defineConfig } from '@playwright/test'

const targetBaseUrl = process.env.SBS_E2E_TARGET_URL

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: 1,
  use: {
    baseURL: targetBaseUrl || 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1366',
      use: {
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'tablet-touch',
      use: {
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'portrait-touch',
      use: {
        viewport: { width: 800, height: 1280 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: targetBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        port: 4173,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
