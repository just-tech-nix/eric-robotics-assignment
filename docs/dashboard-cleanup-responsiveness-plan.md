# Plan: Dashboard Cleanup And Responsiveness

**Generated**: 2026-05-31
**Estimated Complexity**: High

## Overview
This plan cleans up the operator dashboard so it feels intentional, stable, and interview-ready rather than demo-heavy. The work focuses on four areas:

1. Remove or calm placeholder motion and auto-flipping state.
2. Fix broken or misleading controls, especially map reset and zoom/minimap behavior.
3. Rework the main dashboard layout so the live map and overlays coexist cleanly on desktop, tablet, and mobile.
4. Simplify navigation to only the screens that materially help the assignment story.

## Assumptions
- `Quick Goal` is intended to represent a selectable target waypoint/location, not a random rotating alert.
- `Mode`, `Failsafe`, `System`, and similar status pills should reflect either real ROS state or a stable demo fallback, not constant decorative churn.
- The current `Reset Map` behavior is incorrect if it preserves old SLAM geometry and layers a new map over it.
- The interview/demo flow should prioritize `Operator Dashboard`, `Map View Only`, `System Configuration`, and `Analytics Console`.

## What Your Screenshots Correctly Identified
- Mobile layout is still broken: overlays compress the map and fight for the same vertical space.
- Tablet layout is also broken: the map is visible, but controls crowd the viewport and reduce legibility.
- The top HUD still contains distracting placeholder behavior.
- The `Reset Map` behavior is functionally wrong from a user point of view.
- The live navigation card in map-only view is too large and sits on top of the content instead of framing it.
- The minimap zoom rail is visually clipped and its purpose is unclear.
- The quick goal options are location targets. The names shown there are effectively waypoint/location labels plus ETA and distance.

## Non-Goals
- No new pages.
- No new advanced mission-planning feature.
- No redesign of System Configuration beyond stabilization.
- No full ROS architecture rewrite unless map reset cannot be fixed from the current UI/backend contract.

## Sprint 1: Stabilize Dashboard Behavior
**Goal**: Remove distracting fake motion and make the homepage state feel intentional.
**Demo/Validation**:
- Open the main dashboard and wait 30-60 seconds.
- Verify that status, mode, quick goal, and system/failsafe labels no longer twitch or rotate without a meaningful trigger.

### Task 1.1: Audit demo-driven auto state mutations
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Identify all timers/effects that rotate quick goals, mode state, initiate state, safety/system text, and demo telemetry labels.
- **Dependencies**: None
- **Acceptance Criteria**:
  - Every auto-changing dashboard label is mapped to either a real ROS source or a deliberate demo state transition.
  - Decorative churn is listed explicitly for removal.
- **Validation**:
  - Code review checklist of all `setInterval`, replay-driven overrides, and demo fallback mutations.

### Task 1.2: Lock homepage controls to meaningful state changes
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Stop automatic flipping of `Quick Goal`, `Mode`, `Failsafe`, `System`, and `Initiate` presentation unless driven by user action or ROS data.
- **Dependencies**: Task 1.1
- **Acceptance Criteria**:
  - Quick goal stays on the selected/current target until changed.
  - Mode only changes on user action or actual source data.
  - Safety/system states do not pulse between `OKAY` and `WARN` as ornament.
  - `Initiate` has a clear behavior or is removed.
- **Validation**:
  - Manual browser check on homepage for 60 seconds with no unexpected state churn.

### Task 1.3: Decide fate of `Initiate`
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Either keep `Initiate` with one narrow purpose such as restarting demo mission state, or remove it from the main UI.
- **Dependencies**: Task 1.2
- **Acceptance Criteria**:
  - The button has one explainable function.
  - If kept, the function can be described in one interview sentence.
- **Validation**:
  - Click test plus short reviewer explanation in README/demo notes if retained.

## Sprint 2: Fix Map Reset And Map Integrity
**Goal**: Make reset behavior correct and prevent old/new map layering artifacts.
**Demo/Validation**:
- Build part of a map.
- Click `Reset Map`.
- Confirm the map truly returns to a cleared state instead of overlaying old geometry.

### Task 2.1: Verify actual SLAM reset semantics
- **Location**: [insight-io-dashboard/src/ros/useResetMap.ts](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\ros\useResetMap.ts), ROS backend/container startup files
- **Description**: Confirm whether the current service only clears incremental changes instead of fully resetting SLAM state.
- **Dependencies**: None
- **Acceptance Criteria**:
  - Exact reset behavior is documented.
  - We know whether frontend-only clearing is sufficient or backend reset is required.
- **Validation**:
  - Service invocation test plus before/after map observation.

### Task 2.2: Implement a true reset path
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx), [insight-io-dashboard/src/ros/useResetMap.ts](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\ros\useResetMap.ts), possibly ROS launch/backend files
- **Description**: Reset both frontend visual state and the live SLAM state in a way that leaves one clean map.
- **Dependencies**: Task 2.1
- **Acceptance Criteria**:
  - Demo mode resets to the initial map cleanly.
  - Live mode clears previous mapping state visibly.
  - No layered duplicate map remains after reset.
- **Validation**:
  - Manual test in both demo and ROS-live flows.

### Task 2.3: Add user feedback for map reset
- **Location**: [insight-io-dashboard/src/components/OccupancyMapPanel.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\components\OccupancyMapPanel.tsx), [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Show pending/success/failure feedback instead of silently failing.
- **Dependencies**: Task 2.2
- **Acceptance Criteria**:
  - User can tell whether reset is in progress and whether it succeeded.
- **Validation**:
  - UI test with success and forced-failure behavior.

## Sprint 3: Recompose The Homepage Layout
**Goal**: Make the live map the primary visual anchor while preserving critical controls.
**Demo/Validation**:
- Open homepage on desktop.
- Verify map, minimap, E-stop, drive pad, and top HUD all remain visible without collision.

### Task 3.1: Redesign homepage spatial hierarchy
- **Location**: [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Reduce top overlay footprint and reserve a reliable central area for the map canvas.
- **Dependencies**: Sprint 1
- **Acceptance Criteria**:
  - Status/goal/telemetry/mode controls no longer cover meaningful map area.
  - The homepage looks deliberate, not crowded.
- **Validation**:
  - Desktop screenshot comparison before/after.

### Task 3.2: Fix minimap and zoom rail placement
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx), [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Either keep the zoom rail fully visible and explainable, or remove it if it adds no operator value.
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - No part of the rail renders off-screen.
  - Its purpose is obvious, or it is removed.
- **Validation**:
  - Desktop, tablet, and mobile viewport checks.

### Task 3.3: Reposition live map supporting cards
- **Location**: [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Move the `Live Navigation Map` card and minimap so they frame the map instead of sitting on top of it.
- **Dependencies**: Task 3.1
- **Acceptance Criteria**:
  - The label card no longer overlaps important geometry.
  - The map is slightly reduced or repositioned as needed to maintain breathing room.
  - The result looks polished and senior-level.
- **Validation**:
  - Review against your screenshot references.

## Sprint 4: Mobile And Tablet Responsiveness
**Goal**: Make the dashboard readable and operable at phone and tablet sizes.
**Demo/Validation**:
- Test at ~`425x858`, `768x858`, and full desktop.
- Confirm no clipped rails, no hidden important controls, and no overlapping map/HUD sections.

### Task 4.1: Mobile dashboard layout pass
- **Location**: [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Reflow the homepage for phones with a true mobile layout rather than scaled desktop overlays.
- **Dependencies**: Sprint 3
- **Acceptance Criteria**:
  - Top HUD stacks cleanly.
  - Map remains visible.
  - E-stop and drive pad do not cover key content.
  - Minimap/zoom affordances are either fixed or intentionally hidden.
- **Validation**:
  - Browser emulation at mobile breakpoints plus screenshot check.

### Task 4.2: Tablet layout pass
- **Location**: [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Add a tablet-specific layout tier between mobile and desktop.
- **Dependencies**: Task 4.1
- **Acceptance Criteria**:
  - Tablet no longer looks like stretched mobile or compressed desktop.
  - Map and controls have balanced spacing.
- **Validation**:
  - Browser emulation around `768px` width.

### Task 4.3: Map-only responsive cleanup
- **Location**: [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css), [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Ensure map-only view has a dedicated composition on mobile/tablet, not a desktop card floating over a reduced map.
- **Dependencies**: Task 4.2
- **Acceptance Criteria**:
  - Map-only page reads as a complete screen.
  - Reset button remains reachable.
  - Card/minimap positioning is stable.
- **Validation**:
  - Mobile/tablet screenshots.

## Sprint 5: Navigation And Feature Simplification
**Goal**: Keep only pages and controls that strengthen the assignment narrative.
**Demo/Validation**:
- Walk through the final nav in under 2 minutes and confirm each destination has a clear purpose.

### Task 5.1: Remove or hide redundant pages from runtime navigation
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx)
- **Description**: Remove `Waypoints List` and `Sensor Feed Only` from user navigation if homepage/map/config/analytics already cover the story.
- **Dependencies**: None
- **Acceptance Criteria**:
  - Left rail only contains meaningful destinations.
  - No dead branches remain reachable by user interaction.
- **Validation**:
  - Manual nav walk-through.

### Task 5.2: Remove dead code and stale styles after simplification
- **Location**: [insight-io-dashboard/src/App.tsx](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\App.tsx), [insight-io-dashboard/src/index.css](F:\hermes\projects\Assignment - ERIC Robotics\681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70\insight-io-dashboard\src\index.css)
- **Description**: Delete hidden replay UI, unused tab content, and obsolete CSS blocks.
- **Dependencies**: Task 5.1
- **Acceptance Criteria**:
  - No hidden runtime branches remain just disabled in place.
  - CSS no longer contains dead replay/waypoint layouts.
- **Validation**:
  - Build passes and grep shows removed feature blocks are gone.

## Testing Strategy
- `npm run build`
- `docker compose up -d --build`
- Browser verification at desktop, tablet, and mobile widths
- Manual ROS-live check for reset behavior
- Manual demo-mode check for reset behavior
- Screenshot comparison against the six issues you identified

## Potential Risks And Gotchas
- `Reset Map` may require a backend-level SLAM reset, not only a frontend service call.
- Some current UI behavior may be tied to replay/demo telemetry assumptions.
- Mobile layout cannot be fixed well with tiny CSS adjustments alone; parts of the DOM hierarchy may need to be reordered.
- If a control has no operator value, keeping it and trying to “style-fix” it is the wrong move.

## Rollback Plan
- Revert navigation simplification first if needed.
- Revert layout/CSS changes separately from reset-map logic.
- Keep map reset work in isolated commits so backend vs frontend changes can be rolled back independently.
