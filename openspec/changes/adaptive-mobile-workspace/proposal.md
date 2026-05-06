## Why

The current WebUI is an OBS-like desktop workspace with dock panels. At phone widths it mostly stacks the same docks vertically, which makes the page long, control-heavy, and hard to operate with touch. Operators on phones need fast access to the live program preview, scene switching, source visibility, audio, and output controls without horizontal overflow or hunting through desktop panels.

Industry responsive guidance favors adaptive layouts over device-specific pages: flexible grids, breakpoint-driven macro layouts, touch-aware controls, and progressive disclosure. For app-like mobile navigation, bottom tab bars work well when there are a few frequent destinations; hamburger-only navigation saves space but hides high-frequency actions. SBS is a task-oriented control surface, so phone layout should prioritize the preview and expose frequent sections through persistent bottom navigation, with dense controls opened as sheets.

## What Changes

- Introduce adaptive workspace modes: desktop dock grid, tablet split layout, and phone task layout.
- Keep desktop OBS-style docks unchanged for large screens.
- Replace phone dock stacking with a preview-first screen and persistent bottom navigation for the main operator sections.
- Move dense phone controls into modal bottom sheets or full-screen panels instead of rendering every dock inline.
- Add touch-sized controls, safe-area handling, and phone-specific Playwright coverage.
- Expand Playwright coverage to run an explicit viewport matrix from small phone/480p class screens through 4K desktop.

## Capabilities

### New Capabilities

- `adaptive-mobile-workspace`: Phone and tablet layouts optimized for touch operation and small screens.

### Modified Capabilities

- `web-client-workspace`: Existing desktop workspace gains adaptive layout requirements while preserving desktop dock behavior.

## Impact

- WebUI layout: `App.tsx` needs workspace-mode state/derivation and conditional panel presentation.
- CSS: `styles.css` needs mobile-first task layout styles, bottom nav, sheets, safe-area variables, and touch target sizing.
- Tests: Playwright coverage must assert no document overflow, visible bottom navigation, usable scene/source/output flows, preserved desktop dock behavior, and layout stability across 480p-to-4K viewport classes.
- Backend/API: no changes expected.

## Non-Goals

- Native mobile app implementation.
- Replacing the desktop dock system.
- Adding a UI component framework.
- Full offline/PWA behavior.
- Redesigning backend control APIs.
