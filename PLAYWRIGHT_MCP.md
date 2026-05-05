# Playwright Verification

This client uses Playwright for deterministic browser verification and Playwright MCP for agent-driven interactive checks.

Suggested flows:
- `npm run test:e2e` for repeatable smoke and UI-regression tests
- `npx @playwright/mcp@latest` when an AI agent needs to drive the UI like a user during exploratory validation

Expected verification scope:
- app shell renders correctly
- command bar is usable
- source/scene/output controls remain operable as the UI grows
- preview connection state and telemetry indicators stay visible to the operator
