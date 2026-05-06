# Tasks

## Phase 1: Layout Mode Foundation

- [x] 1.1 Define workspace modes: `desktop`, `tablet`, `phone` from viewport/container size.
- [x] 1.2 Add phone section state for bottom navigation: scenes, sources, audio, outputs, more.
- [x] 1.3 Keep desktop dock layout path unchanged for wide screens.
- [x] 1.4 Add safe-area CSS variables for phone top/bottom chrome.

## Phase 2: Phone Task Layout

- [x] 2.1 Create compact phone app bar with instance, connection, and settings access.
- [x] 2.2 Make preview the primary phone surface with existing zoom/snapshot controls usable at touch sizes.
- [x] 2.3 Add persistent bottom navigation for Scenes, Sources, Audio, Outputs, More.
- [x] 2.4 Render selected phone section as a bottom sheet or full-height panel.
- [x] 2.5 Ensure source create/edit, filters, settings, and output transport dialogs are full-screen or sheet-based on phone.

## Phase 3: Tablet Layout

- [x] 3.1 Replace cramped tablet dock stacking with preview plus selected side/bottom panel.
- [x] 3.2 Keep enough simultaneous state visible for operation: preview, active scene/source status, output status.
- [x] 3.3 Validate tablet touch and non-touch viewport behavior.

## Phase 4: Touch & Accessibility

- [x] 4.1 Ensure primary phone controls meet at least 44px/48dp touch target guidance.
- [x] 4.2 Add labels/aria-current for bottom navigation and active sheets.
- [x] 4.3 Ensure dialogs trap focus and close via Escape/backdrop where applicable.
- [x] 4.4 Respect viewport safe areas for notches and browser bars.

## Phase 5: Testing

- [x] 5.1 Define a Playwright viewport project matrix covering `360x640`, `390x844`, `854x480`, `600x960`, `800x1280`, `1024x768`, `1366x768`, `1920x1080`, `2560x1440`, and `3840x2160`.
- [x] 5.2 Add Playwright assertions for phone viewport: no horizontal overflow, bottom nav visible, preview visible above fold.
- [x] 5.3 Add phone flow test: switch scene, toggle source visibility, snapshot, open settings.
- [x] 5.4 Add tablet flow test: selected panel changes without desktop dock overflow.
- [x] 5.5 Add desktop/QHD/4K flow tests proving dock behavior remains usable and panels do not collapse or overflow.
- [x] 5.6 Re-run existing desktop workspace smoke tests to prove dock behavior is preserved.
- [x] 5.7 Add target-backed responsive verification for at least phone, tablet, desktop, and 4K viewports.
