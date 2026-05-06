# web-client-workspace delta

## ADDED Requirements

### Requirement: Browser Workspace Adapts To Phone Screens

The browser workspace MUST provide a phone layout that prioritizes the program preview and high-frequency operator actions instead of rendering the desktop dock grid as a long stacked page.

#### Scenario: Operator opens workspace on a phone-width viewport

- GIVEN the viewport is phone-width
- WHEN the workspace finishes synchronizing state
- THEN the program preview is visible without horizontal scrolling
- AND primary navigation is available through touch-sized bottom navigation
- AND scenes, sources, audio, outputs, and secondary controls are available without requiring desktop dock scrolling

### Requirement: Browser Workspace Preserves Desktop Dock Behavior

The browser workspace MUST keep the OBS-style dock grid behavior for desktop-width viewports.

#### Scenario: Operator opens workspace on desktop-width viewport

- GIVEN the viewport is desktop-width
- WHEN the workspace renders
- THEN the Scenes, Sources, Controls, Audio Mixer, and Filters docks remain visible according to the dock layout
- AND existing dock drag, resize, and reset behavior remains available

### Requirement: Browser Workspace Uses Progressive Disclosure On Small Screens

The browser workspace MUST move dense controls into sheets or full-screen dialogs on phone screens so the main preview remains usable.

#### Scenario: Operator opens a dense editor on phone

- GIVEN the workspace is in phone layout
- WHEN the operator opens settings, filters, source configuration, or output transport controls
- THEN the editor appears as a touch-usable sheet or full-screen dialog
- AND closing the editor returns the operator to the previous phone workspace section

### Requirement: Browser Workspace Supports Touch-First Operation

The browser workspace MUST expose phone controls with touch-sized hit targets and accessible labels.

#### Scenario: Operator uses phone navigation controls

- GIVEN the workspace is in phone layout
- WHEN the operator taps a bottom navigation item or primary action
- THEN the target is large enough for reliable touch use
- AND the active section is announced through visible and semantic state

### Requirement: Browser Workspace Is Verified Across Responsive Viewport Classes

The browser workspace MUST have Playwright coverage across small phone, phone landscape/480p, tablet, desktop, QHD, and 4K viewport classes.

#### Scenario: Responsive smoke matrix runs

- GIVEN the responsive Playwright suite is executed
- WHEN it runs the configured viewport projects
- THEN it covers phone portrait, phone landscape/480p, tablet portrait, tablet landscape, desktop, QHD, and 4K viewports
- AND each project asserts no unintended horizontal document overflow
- AND each project asserts the expected layout mode and primary controls for that viewport class
