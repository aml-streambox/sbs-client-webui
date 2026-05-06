# web-client-workspace

## Purpose

Define the operator-facing behavior of the SBS browser workspace, including reconnect handling, state synchronization, direct control flows, and adaptive layout behavior across desktop, tablet, and phone screens.

## Requirements

### Requirement: Browser Workspace Reconnects And Resynchronizes

The browser client MUST automatically reconnect after control-plane connection loss and MUST restore authoritative state by re-subscribing and fetching a fresh full-state snapshot.

#### Scenario: Server restarts during an active session

- GIVEN the WebSocket connection closes unexpectedly
- WHEN the browser client detects the disconnect
- THEN it retries connection with bounded backoff
- AND after reconnect it re-subscribes to required PubSub topics
- AND it refreshes current SBS state before presenting the session as connected

### Requirement: Browser Workspace Exposes Direct Operator Actions

The browser client MUST expose direct controls for common scene, source, output, preview, filter, and snapshot actions without requiring the operator to type raw commands for those flows.

#### Scenario: Operator switches scenes from the workspace

- GIVEN the operator selects a scene in the scenes panel
- WHEN the client sends the requested action
- THEN the workspace updates the active scene state
- AND it surfaces success or failure in visible workspace status

#### Scenario: Operator manages preview or snapshot from the workspace

- GIVEN the operator uses visible preview or snapshot controls
- WHEN the browser client performs the action through the SBS control API
- THEN the workspace updates visible preview or snapshot state accordingly

### Requirement: Browser Workspace Surfaces Instance Context

The browser workspace MUST make the currently attached instance visible to the operator.

#### Scenario: Operator inspects current workspace target

- WHEN the workspace is connected to an instance
- THEN the visible workspace state includes enough instance identity to confirm which instance the tab is controlling
