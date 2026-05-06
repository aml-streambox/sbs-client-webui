import { defineConfig } from '@playwright/test'

const targetBaseUrl = process.env.SBS_E2E_TARGET_URL
const responsiveGrep = /adapts workspace|phone operator|tablet panel|keeps desktop dock/

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
      name: 'phone-360-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 360, height: 640 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'phone-390-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'phone-landscape-480-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 854, height: 480 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'small-tablet-600-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 600, height: 960 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet-portrait-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 800, height: 1280 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet-landscape-touch',
      grep: responsiveGrep,
      use: {
        viewport: { width: 1024, height: 768 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop-1366',
      use: {
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'desktop-hd',
      grep: responsiveGrep,
      use: {
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'desktop-qhd',
      grep: responsiveGrep,
      use: {
        viewport: { width: 2560, height: 1440 },
      },
    },
    {
      name: 'desktop-4k',
      grep: responsiveGrep,
      use: {
        viewport: { width: 3840, height: 2160 },
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
