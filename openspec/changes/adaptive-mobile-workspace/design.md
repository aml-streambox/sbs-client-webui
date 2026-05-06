## Context

SBS WebUI is currently a single React app with a desktop-first OBS-style workspace. The `styles.css` responsive rules stack `.obs-layout` below `920px`, but all major docks still render inline. This is acceptable for tablets but weak for phones: the preview loses priority, panels become a long scroll, top/bottom chrome consumes space, and touch targets remain desktop-sized in several places.

External guidance relevant to this change:

- MDN describes responsive design as a flexible, multi-device approach using viewport configuration, flexible grids, media queries, and modern CSS layout rather than fixed device pages.
- web.dev emphasizes macro layouts, micro layouts, media queries, input mechanism differences, and common UI patterns for responsive interfaces.
- Nielsen Norman Group's mobile navigation guidance highlights that mobile navigation must be discoverable, accessible, and space-efficient; tab bars suit a small number of frequent destinations, while hamburger menus hide options and reduce discoverability.

For SBS, the frequent phone tasks are operational: monitor program, switch scene, toggle source visibility, check audio, start/stop output, snapshot, and open settings. This maps better to a persistent bottom tab/action bar plus sheets than to a hamburger menu or a vertically stacked desktop dashboard.

## Recommended Layout Model

### Desktop: Dock Workspace

Keep the current OBS-style dock grid for wide screens. It supports simultaneous monitoring and manipulation and matches desktop operator expectations.

### Tablet: Split Workspace

Use a two-region adaptive layout: preview/stage remains dominant, with one panel rail or side sheet for the selected tool. Tablet can still tolerate some dock behavior, but should avoid five simultaneous cramped panels.

### Phone: Task Workspace

Use a preview-first single-column app layout:

- Top compact app bar: instance/status, connection, settings entry.
- Main content: program preview with zoom/snapshot/preview controls.
- Bottom navigation: `Scenes`, `Sources`, `Audio`, `Outputs`, `More`.
- Active section opens as a bottom sheet or full-height panel over/under the preview.
- Dense editors (filters, source config, settings, output transport) use full-screen dialogs or bottom sheets.

## Design Decisions

### 1. Use Adaptive Layout Modes, Not Browser/User-Agent Detection

Derive mode from viewport/container size and input features. Use CSS breakpoints and small React state only where presentation must change structure.

### 2. Prefer Bottom Navigation For Phone Primary Sections

SBS has a small set of high-frequency sections. Bottom navigation keeps them discoverable and reachable with thumbs. Avoid hamburger-only navigation for scenes/sources because those are operationally frequent.

### 3. Use Progressive Disclosure For Dense Controls

Filters, settings, source creation, output transport, and instance management should not all occupy phone page height. Show summaries first, open details in sheets/dialogs.

### 4. Preserve A Single Source Of Truth For Panel Content

Reuse existing render functions where possible. Do not fork business logic into separate mobile components unless desktop/mobile behavior truly differs.

### 5. Preserve Preview Interaction Semantics

Phone preview should keep zoom and selection where practical, but avoid requiring precision resize handles as the only touch path. Keep advanced transform editing available through a sheet/menu.

## Breakpoint Strategy

- Desktop: `>= 1100px`, current dock grid.
- Tablet: `700px - 1099px`, split layout with preview plus selected panel.
- Phone: `< 700px` or coarse pointer with narrow inline size, preview-first task layout.

Exact thresholds should be validated by Playwright screenshots and assertions across a viewport matrix, not just one representative mobile/desktop size.

Initial required viewport matrix:

- Phone compact portrait: `360x640`
- Phone modern portrait: `390x844`
- Phone landscape / 480p class: `854x480`
- Small tablet portrait: `600x960`
- Tablet portrait: `800x1280`
- Tablet landscape: `1024x768`
- Laptop desktop: `1366x768`
- HD desktop: `1920x1080`
- QHD desktop: `2560x1440`
- 4K desktop: `3840x2160`

The matrix should include both touch-enabled and non-touch projects where meaningful. Phone/tablet projects should assert touch navigation and sheet behavior; desktop/QHD/4K projects should assert dock grid behavior and that oversized viewports do not create unusable whitespace or collapsed panels.

## Risks

- Duplicating panel logic if mobile is implemented as separate components. Mitigation: keep shared render functions.
- Hiding critical output state behind sheets. Mitigation: add compact status chips on the phone preview screen.
- Touch precision for source transforms. Mitigation: provide numeric/quick transform actions in sheets; keep drag for rough positioning.
- Regression risk to desktop dock layout. Mitigation: keep desktop CSS path mostly untouched and expand Playwright coverage.
- Test runtime growth from many viewport projects. Mitigation: keep a fast smoke matrix for every change and reserve heavier visual/screenshot checks for focused responsive suites or CI stages.

## Open Questions

- Should the default phone landing tab be `Scenes` or keep all sections collapsed until the operator opens one?
- Which actions deserve persistent preview overlay buttons on phone: snapshot, start/stop preview, output start/stop?
- Should phone layout persist the last selected tab per browser via localStorage?
