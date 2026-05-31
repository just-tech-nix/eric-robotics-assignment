import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { OccupancyMapPanel } from './components/OccupancyMapPanel';
import { assetManifest } from './data/assetManifest';
import { warehouseWorld } from './data/warehouseWorld';
import { useMissionReplay } from './hooks/useMissionReplay';
import type { ControlMode, MissionEvent, TelemetryFrame, ViewerControlsState } from './types';

// ROS 2 integration hooks (graceful fallback when not connected)
import { useRosConnection } from './ros/useRosConnection';
import { useCmdVelPublisher } from './ros/useCmdVelPublisher';
import { useRosOdometry } from './ros/useRosOdometry';
import { useRosMap, type MapData } from './ros/useRosMap';
import { useRosLidar } from './ros/useRosLidar';
import { useRosCameraCompressed } from './ros/useRosCameraCompressed';
import { useRosDiagnostics } from './ros/useRosDiagnostics';

const modeOptions: ControlMode[] = ['AUTO', 'MANUAL', 'ASSIST'];

const defaultViewerState: ViewerControlsState = {
  cameraPreset: 'iso',
  colorPreset: 'signal',
  pointSize: 0.015,
};

const quickGoalOptions = [
  { id: 'dock-b2', label: 'Dock B2 (Charging Station)', location: 'Dock B2', eta: '1m 15s', distance: 18 },
  { id: 'aisle-4', label: 'Aisle 4 Storage Bin', location: 'Aisle 4', eta: '2m 45s', distance: 54 },
  { id: 'loading-bay-1', label: 'Loading Bay 1 Reception', location: 'Bay 1', eta: '0m 30s', distance: 10 },
  { id: 'perimeter-safeguard', label: 'Perimeter Safeguard Patrol', location: 'Perimeter West', eta: '4m 20s', distance: 120 },
];

const zoomLevels = [
  { level: 1, text: 'Scale: 1:500 (50m grid)', scale: 0.6 },
  { level: 2, text: 'Scale: 1:250 (25m grid)', scale: 1.0 },
  { level: 3, text: 'Scale: 1:100 (10m grid)', scale: 1.4 },
  { level: 4, text: 'Scale: 1:50 (5m grid)', scale: 1.8 },
  { level: 5, text: 'Scale: 1:20 (2m grid)', scale: 2.2 },
];

const waypointsList = [
  { id: 'wp-1', name: 'Start Gate A', coordinates: 'X: 0.0, Y: 0.0, Z: 0.0', status: 'COMPLETED', location: 'Gate A', eta: '0m 00s' },
  { id: 'wp-2', name: 'Aisle 3 Junction', coordinates: 'X: 12.4, Y: -4.5, Z: 0.0', status: 'COMPLETED', location: 'Aisle 3', eta: '0m 45s' },
  { id: 'wp-3', name: 'Dock B2 Charger', coordinates: 'X: 25.8, Y: -18.2, Z: 0.2', status: 'ACTIVE', location: 'Dock B2', eta: '1m 15s' },
  { id: 'wp-4', name: 'Sorting Area C', coordinates: 'X: 42.1, Y: -32.8, Z: 0.0', status: 'PENDING', location: 'Bay C', eta: '2m 30s' },
  { id: 'wp-5', name: 'Shipping Deck 1', coordinates: 'X: 58.6, Y: -50.1, Z: -0.1', status: 'PENDING', location: 'Deck 1', eta: '3m 45s' },
];

function formatClock(timestamp: number) {
  const seconds = Math.floor(timestamp / 1000);
  const mins = Math.floor(seconds / 60);
  const remainingSeconds = `${seconds % 60}`.padStart(2, '0');
  return `${mins}:${remainingSeconds}`;
}

function compactLabel(text: string, max = 24) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function getCameraFilter(preset: ViewerControlsState['colorPreset'], feedType: 'video' | 'reference') {
  if (feedType === 'reference') {
    return 'brightness(0.72) contrast(1.08) saturate(0.95) sepia(0.05)';
  }

  switch (preset) {
    case 'amber':
      return 'brightness(1.03) contrast(1.06) saturate(1.08) sepia(0.16) hue-rotate(-12deg)';
    case 'ice':
      return 'brightness(1.02) contrast(1.05) saturate(1.04) sepia(0.06) hue-rotate(155deg)';
    case 'signal':
    default:
      return 'brightness(1.02) contrast(1.05) saturate(1.06)';
  }
}

const DEMO_MAP_RESOLUTION = 0.2;
const DEMO_MAP_WIDTH = Math.round(warehouseWorld.world.width / DEMO_MAP_RESOLUTION);
const DEMO_MAP_HEIGHT = Math.round(warehouseWorld.world.height / DEMO_MAP_RESOLUTION);
const DEMO_MAP_ORIGIN = { x: 0, y: 0 };
const DEMO_INITIAL_POSE = {
  x: warehouseWorld.robot.initial_x,
  y: warehouseWorld.robot.initial_y,
  headingDeg: (warehouseWorld.robot.initial_yaw * 180) / Math.PI,
};
const STABLE_MAP_BOUNDS = {
  minX: 0,
  minY: 0,
  width: warehouseWorld.world.width,
  height: warehouseWorld.world.height,
};

function getKnownMapBounds(mapData: MapData) {
  let minCellX = Number.POSITIVE_INFINITY;
  let minCellY = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let maxCellY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < mapData.data.length; index += 1) {
    if (mapData.data[index] < 0) continue;
    const cellX = index % mapData.width;
    const cellY = Math.floor(index / mapData.width);
    minCellX = Math.min(minCellX, cellX);
    minCellY = Math.min(minCellY, cellY);
    maxCellX = Math.max(maxCellX, cellX);
    maxCellY = Math.max(maxCellY, cellY);
  }

  if (!Number.isFinite(minCellX) || !Number.isFinite(minCellY) || !Number.isFinite(maxCellX) || !Number.isFinite(maxCellY)) {
    return {
      minX: mapData.origin.x,
      minY: mapData.origin.y,
      width: mapData.width * mapData.resolution,
      height: mapData.height * mapData.resolution,
    };
  }

  const paddingCells = 12;
  const clampedMinCellX = Math.max(0, minCellX - paddingCells);
  const clampedMinCellY = Math.max(0, minCellY - paddingCells);
  const clampedMaxCellX = Math.min(mapData.width - 1, maxCellX + paddingCells);
  const clampedMaxCellY = Math.min(mapData.height - 1, maxCellY + paddingCells);

  return {
    minX: mapData.origin.x + clampedMinCellX * mapData.resolution,
    minY: mapData.origin.y + clampedMinCellY * mapData.resolution,
    width: (clampedMaxCellX - clampedMinCellX + 1) * mapData.resolution,
    height: (clampedMaxCellY - clampedMinCellY + 1) * mapData.resolution,
  };
}

type DemoSegment = [number, number, number, number];

function getDemoWorldSegments(): DemoSegment[] {
  const obstacleEdges = warehouseWorld.obstacles.flatMap(({ x, y, width, height }) => ([
    [x, y, x + width, y],
    [x + width, y, x + width, y + height],
    [x + width, y + height, x, y + height],
    [x, y + height, x, y],
  ] as DemoSegment[]));

  return [...warehouseWorld.walls, ...obstacleEdges];
}

const DEMO_WORLD_SEGMENTS = getDemoWorldSegments();

function worldToDemoCell(x: number, y: number) {
  return {
    x: Math.round((x - DEMO_MAP_ORIGIN.x) / DEMO_MAP_RESOLUTION),
    y: Math.round((y - DEMO_MAP_ORIGIN.y) / DEMO_MAP_RESOLUTION),
  };
}

function createDemoMapTemplate(): MapData {
  const data = Array.from({ length: DEMO_MAP_WIDTH * DEMO_MAP_HEIGHT }, () => -1);

  const paint = (cellX: number, cellY: number, value: number, radius = 0) => {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const px = cellX + ox;
        const py = cellY + oy;
        if (px < 0 || py < 0 || px >= DEMO_MAP_WIDTH || py >= DEMO_MAP_HEIGHT) continue;
        data[py * DEMO_MAP_WIDTH + px] = value;
      }
    }
  };

  const line = (x0: number, y0: number, x1: number, y1: number, value: number, radius = 0) => {
    const start = worldToDemoCell(x0, y0);
    const end = worldToDemoCell(x1, y1);
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      paint(
        Math.round(start.x + (end.x - start.x) * t),
        Math.round(start.y + (end.y - start.y) * t),
        value,
        radius,
      );
    }
  };

  DEMO_WORLD_SEGMENTS.forEach(([x0, y0, x1, y1]) => line(x0, y0, x1, y1, 100, 1));

  return {
    data,
    width: DEMO_MAP_WIDTH,
    height: DEMO_MAP_HEIGHT,
    resolution: DEMO_MAP_RESOLUTION,
    origin: DEMO_MAP_ORIGIN,
  };
}

function raySegmentDistance(
  originX: number,
  originY: number,
  dx: number,
  dy: number,
  [x1, y1, x2, y2]: DemoSegment,
) {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const t = ((x1 - originX) * sy - (y1 - originY) * sx) / denom;
  const u = ((x1 - originX) * dy - (y1 - originY) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

function castDemoRay(originX: number, originY: number, angleRad: number, maxRange: number) {
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  let closest = maxRange;

  for (const segment of DEMO_WORLD_SEGMENTS) {
    const distance = raySegmentDistance(originX, originY, dx, dy, segment);
    if (distance !== null && distance < closest) {
      closest = distance;
    }
  }

  return closest;
}

function revealDemoMap(baseMap: MapData, pose: { x: number; y: number; headingDeg: number }): MapData {
  const data = baseMap.data.slice();
  const cell = worldToDemoCell(pose.x, pose.y);
  const cx = cell.x;
  const cy = cell.y;

  const markValue = (x: number, y: number, value: number, radius = 0) => {
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const px = x + ox;
        const py = y + oy;
        if (px < 0 || py < 0 || px >= baseMap.width || py >= baseMap.height) continue;
        const idx = py * baseMap.width + px;
        if (value === 0 && data[idx] > 60) continue;
        data[idx] = value;
      }
    }
  };

  for (let oy = -3; oy <= 3; oy += 1) {
    for (let ox = -3; ox <= 3; ox += 1) {
      if (ox * ox + oy * oy <= 10) {
        markValue(cx + ox, cy + oy, 0);
      }
    }
  }

  const maxRange = 9;
  for (let beam = -75; beam <= 75; beam += 6) {
    const angle = ((pose.headingDeg + beam) * Math.PI) / 180;
    const hitDistance = castDemoRay(pose.x, pose.y, angle, maxRange);
    const freeSteps = Math.max(1, Math.floor(hitDistance / baseMap.resolution));

    for (let step = 1; step < freeSteps; step += 1) {
      const worldX = pose.x + Math.cos(angle) * step * baseMap.resolution;
      const worldY = pose.y + Math.sin(angle) * step * baseMap.resolution;
      const freeCell = worldToDemoCell(worldX, worldY);
      markValue(freeCell.x, freeCell.y, 0, step < 4 ? 1 : 0);
    }

    if (hitDistance < maxRange - 0.001) {
      const hitX = pose.x + Math.cos(angle) * hitDistance;
      const hitY = pose.y + Math.sin(angle) * hitDistance;
      const hitCell = worldToDemoCell(hitX, hitY);
      markValue(hitCell.x, hitCell.y, 100, 1);
    }
  }

  return {
    ...baseMap,
    data,
  };
}

function normalizeAnalogInput(rawX: number, rawY: number) {
  let x = rawX;
  let y = rawY;
  const magnitude = Math.hypot(x, y);

  if (magnitude > 1) {
    x /= magnitude;
    y /= magnitude;
  }

  const deadzone = 0.16;
  if (magnitude <= deadzone) {
    return { x: 0, y: 0, active: false };
  }

  const scaledMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const normalizedX = (x / Math.max(magnitude, 1e-6)) * scaledMagnitude;
  const normalizedY = (y / Math.max(magnitude, 1e-6)) * scaledMagnitude;

  return {
    x: Math.abs(normalizedX) < 0.08 ? 0 : Number(normalizedX.toFixed(3)),
    y: Math.abs(normalizedY) < 0.08 ? 0 : Number(normalizedY.toFixed(3)),
    active: true,
  };
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryFrame[]>([]);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [panelState, setPanelState] = useState<'hidden' | 'split' | 'focus'>('split');
  const [modeOverride, setModeOverride] = useState<ControlMode | null>(null);
  const [viewerControls, setViewerControls] = useState<ViewerControlsState>(defaultViewerState);
  const [assetLoadError, setAssetLoadError] = useState<string | null>(null);

  // Layout switcher and content modes
  const [activeTab, setActiveTab] = useState<string>('grid');
  const [cameraFeedType, setCameraFeedType] = useState<'video' | 'reference'>('video');
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [isGoalDrawerOpen, setIsGoalDrawerOpen] = useState(false);
  const [isEStopActive, setIsEStopActive] = useState(false);
  const [showEStopConfirm, setShowEStopConfirm] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileReplayExpanded, setIsMobileReplayExpanded] = useState(false);
  const [isDesktopReplayHidden, setIsDesktopReplayHidden] = useState(false);

  // Unified background swapping view state: 'map' (Point Cloud main) or 'camera' (Video main)
  const [mainView, setMainView] = useState<'map' | 'camera'>('map');

  // Manual teleoperation states
  const [speedOverride, setSpeedOverride] = useState<number | null>(null);
  const [headingOverride, setHeadingOverride] = useState<number | null>(null);
  const [manualControlStatus, setManualControlStatus] = useState<'OFF' | 'ACTIVE'>('OFF');

  // Zoom control state (minimapZoom ranges 1 to 5)
  const [minimapZoom, setMinimapZoom] = useState(2);

  // Local overrides for Location & ETA
  const [localLocationLabel, setLocalLocationLabel] = useState<string | null>(null);
  const [localEta, setLocalEta] = useState<string | null>(null);

  // Self-test diagnostic states
  const [isTesting, setIsTesting] = useState(false);
  const [testProgress, setTestProgress] = useState(0);

  // Local log console states
  const [logs, setLogs] = useState<{ id: string; time: string; msg: string; type: 'info' | 'warn' | 'critical' }[]>([
    { id: '1', time: '12:00:00', msg: 'System initialized. Operator Dashboard standby.', type: 'info' },
    { id: '2', time: '12:00:01', msg: 'Lidar scanner connection established (50,000 points budgeted).', type: 'info' },
    { id: '3', time: '12:00:02', msg: 'Simulated video feed ready (poster frame cached offline).', type: 'info' },
  ]);

  const addLog = (msg: string, type: 'info' | 'warn' | 'critical' = 'info') => {
    const time = new Date().toLocaleTimeString(undefined, { hour12: false });
    setLogs((prev) => [
      { id: Math.random().toString(), time, msg, type },
      ...prev.slice(0, 39),
    ]);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateViewportMode = () => {
      const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      const mobile = window.innerWidth <= 768 || coarsePointer;
      setIsMobileViewport(mobile);
      if (!mobile) {
        setIsMobileReplayExpanded(false);
        setIsGoalDrawerOpen(false);
      } else {
        setIsDesktopReplayHidden(false);
      }
    };

    updateViewportMode();
    window.addEventListener('resize', updateViewportMode);
    return () => window.removeEventListener('resize', updateViewportMode);
  }, []);

  // ── ROS 2 Integration Hooks ──────────────────────────────────────
  const rosConn = useRosConnection();
  const cmdVel = useCmdVelPublisher();
  const rosOdom = useRosOdometry();
  const rosMap = useRosMap();
  const rosLidar = useRosLidar();
  const rosCamera = useRosCameraCompressed();
  const rosDiagnostics = useRosDiagnostics();

  // Derive whether we're in live ROS mode (auto-detected)
  const isRosLive = rosConn.connected;

  // Log ROS connection state changes
  const prevRosConnected = useRef(false);
  useEffect(() => {
    if (rosConn.connected && !prevRosConnected.current) {
      addLog(`ROS 2 Bridge connected (${rosConn.url}). LIVE mode active.`, 'info');
    } else if (!rosConn.connected && prevRosConnected.current) {
      addLog('ROS 2 Bridge disconnected. Falling back to DEMO mode.', 'warn');
    }
    prevRosConnected.current = rosConn.connected;
  }, [rosConn.connected, rosConn.url]);
  // ────────────────────────────────────────────────────────────────

  const replay = useMissionReplay(telemetry, events);
  const currentFrame = replay.currentFrame;

  // Active Key holds and Robot Position coordinates
  const [activeKeys, setActiveKeys] = useState({ W: false, A: false, S: false, D: false });
  const [analogStick, setAnalogStick] = useState({ x: 0, y: 0, active: false });
  const gamepadContainerRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [robotPos, setRobotPos] = useState({ x: DEMO_INITIAL_POSE.x, y: DEMO_INITIAL_POSE.y });
  const [demoMapData, setDemoMapData] = useState<MapData>(() => revealDemoMap(createDemoMapTemplate(), DEMO_INITIAL_POSE));

  // Use ROS odometry for robot position when connected
  useEffect(() => {
    if (isRosLive && rosOdom.position) {
      setRobotPos({ x: rosOdom.position.x, y: rosOdom.position.y });
    }
  }, [isRosLive, rosOdom.position]);

  // Fluctuation pings for real-time connection link noise
  const [connNoise, setConnNoise] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setConnNoise(Math.floor(Math.random() * 5) - 2); // -2% to 2% jitter
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  // Battery consumption drain over time during playback or driving
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  useEffect(() => {
    const isDriving = speedOverride !== null && speedOverride > 0;
    if (!replay.isPlaying && !isDriving) return;
    const interval = setInterval(() => {
      setBatteryLevel((prev) => {
        const base = prev ?? currentFrame?.battery ?? 95;
        return Math.max(1, base - 0.05); // slow discharge rate
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [replay.isPlaying, speedOverride, currentFrame]);

  // Keep references updated for requestAnimationFrame loop
  const activeKeysRef = useRef(activeKeys);
  const analogStickRef = useRef(analogStick);
  const speedOverrideRef = useRef(speedOverride);
  const headingOverrideRef = useRef(headingOverride);
  const activeModeRef = useRef(currentFrame?.mode ?? 'AUTO');
  const isPlayingRef = useRef(replay.isPlaying);
  const currentFrameRef = useRef(currentFrame);
  const isEStopActiveRef = useRef(isEStopActive);

  useEffect(() => { activeKeysRef.current = activeKeys; }, [activeKeys]);
  useEffect(() => { analogStickRef.current = analogStick; }, [analogStick]);
  useEffect(() => { speedOverrideRef.current = speedOverride; }, [speedOverride]);
  useEffect(() => { headingOverrideRef.current = headingOverride; }, [headingOverride]);
  useEffect(() => { activeModeRef.current = modeOverride ?? currentFrame?.mode ?? 'AUTO'; }, [modeOverride, currentFrame]);
  useEffect(() => { isPlayingRef.current = replay.isPlaying; }, [replay.isPlaying]);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
  useEffect(() => { isEStopActiveRef.current = isEStopActive; }, [isEStopActive]);

  // Central Physics and Coordinates Tick Loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000); // prevent lag jumps
      lastTime = now;

      const keys = activeKeysRef.current;
      const isEStop = isEStopActiveRef.current;
      const speed = speedOverrideRef.current;
      const heading = headingOverrideRef.current;
      const mode = activeModeRef.current;
      const frame = currentFrameRef.current;
      const isPlaying = isPlayingRef.current;

      if (isEStop) {
        if (speed !== 0 && speed !== null) {
          setSpeedOverride(0);
        }
        // Also send stop to ROS when E-Stop is active
        cmdVel.stop();
        frameId = requestAnimationFrame(tick);
        return;
      }

      // Check current speed
      const baseSpeed = speed !== null ? speed : (frame ? frame.speed : 0);
      let newSpeed = baseSpeed;

      // Handle Manual propulsion and steering inertia
      if (mode === 'MANUAL') {
        const analog = analogStickRef.current;
        const forwardInput = analog.active ? Math.max(0, -analog.y) : (keys.W ? 1 : 0);
        const reverseInput = analog.active ? Math.max(0, analog.y) : (keys.S ? 1 : 0);
        const keyTurnInput = (keys.D ? 1 : 0) - (keys.A ? 1 : 0);
        const baseTurnInput = analog.active ? analog.x : keyTurnInput;
        const throttleDemand = Math.max(forwardInput, reverseInput);
        const pivotTurnThreshold = analog.active ? 0.58 : 0.85;
        const isIntentionalPivot = throttleDemand < 0.08 && Math.abs(baseTurnInput) > pivotTurnThreshold;
        const curvedTurnInput = throttleDemand > 0.12
          ? baseTurnInput * (0.24 + throttleDemand * 0.34)
          : baseTurnInput * 0.62;
        const turnInput = Number((isIntentionalPivot ? baseTurnInput * 0.92 : curvedTurnInput).toFixed(3));

        if (forwardInput > 0) {
          newSpeed = Math.min(3.0, Number((baseSpeed + dt * (0.9 + forwardInput * 1.1)).toFixed(3)));
        } else if (reverseInput > 0) {
          newSpeed = Math.max(0.0, Number((baseSpeed - dt * (1.5 + reverseInput * 1.4)).toFixed(3)));
        } else {
          // decay speed back to 0
          if (baseSpeed > 0) {
            newSpeed = Math.max(0.0, Number((baseSpeed - dt * 1.2).toFixed(3)));
          }
        }

        if (newSpeed !== speed) {
          setSpeedOverride(newSpeed === 0 ? null : newSpeed);
        }

        // Steer heading: gentle arcs while moving, slower pivot when turn-only.
        const baseHeading = heading !== null ? heading : (frame ? frame.heading : 0);
        let newHeading = baseHeading;
        if (Math.abs(turnInput) > 0.01) {
          const headingRate = isIntentionalPivot ? 46 : 14 + throttleDemand * 16;
          newHeading = (baseHeading + turnInput * dt * headingRate + 360) % 360;
        }

        if (newHeading !== baseHeading) {
          setHeadingOverride(Number(newHeading.toFixed(1)));
        }

        // ── Publish /cmd_vel to ROS when in MANUAL mode ──
        const rawLinearX = forwardInput * 1.05 - reverseInput * 0.45;
        const turnPenalty = throttleDemand > 0.12 ? Math.min(0.12, Math.abs(turnInput) * 0.08) : 0;
        const linearX = Number((rawLinearX * (1 - turnPenalty)).toFixed(3));
        const angularScale = isIntentionalPivot ? 0.78 : 0.1 + throttleDemand * 0.38;
        const angularZ = Number((-turnInput * angularScale).toFixed(3));
        if (Math.abs(linearX) > 0.01 || Math.abs(angularZ) > 0.01) {
          cmdVel.publish(linearX, angularZ);
        } else if (!analog.active && !keys.W && !keys.A && !keys.S && !keys.D) {
          cmdVel.stop();
        } else if (analog.active && Math.abs(analog.x) <= 0.02 && Math.abs(analog.y) <= 0.02) {
          cmdVel.stop();
        }
        // ────────────────────────────────────────────────
      }

      // Integrate coordinates for 3D viewpoint translation (demo mode only, ROS mode uses /odom)
      if (!rosConn.connected) {
        const effectiveSpeed = mode === 'MANUAL' 
          ? (newSpeed ?? 0) 
          : (isPlaying && frame ? frame.speed : 0);
        
        const effectiveHeading = isEStop 
          ? 0 
          : (heading !== null ? heading : (frame ? frame.heading : 0));

        if (effectiveSpeed > 0) {
          const rad = (effectiveHeading * Math.PI) / 180;
          const dx = effectiveSpeed * Math.sin(rad) * dt * 3.5;
          const dz = -effectiveSpeed * Math.cos(rad) * dt * 3.5;
          setRobotPos((prev) => ({
            x: prev.x + dx,
            y: prev.y + dz
          }));
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  // Calculate joystick translation offset
  const joystickOffset = useMemo(() => {
    const maxDistance = 24;

    if (analogStick.active) {
      return {
        x: analogStick.x * maxDistance,
        y: analogStick.y * maxDistance,
      };
    }

    let x = 0;
    let y = 0;
    if (activeKeys.W) y -= 1;
    if (activeKeys.S) y += 1;
    if (activeKeys.A) x -= 1;
    if (activeKeys.D) x += 1;

    if (x !== 0 && y !== 0) {
      const len = Math.sqrt(x * x + y * y);
      x /= len;
      y /= len;
    }

    return {
      x: x * maxDistance,
      y: y * maxDistance
    };
  }, [activeKeys, analogStick]);

  const handleKeyStart = (key: 'W' | 'A' | 'S' | 'D') => {
    if (isEStopActive) {
      addLog('Propulsion locked: Cannot issue manual command under E-Stop condition.', 'critical');
      return;
    }
    if (modeOverride !== 'MANUAL') {
      setModeOverride('MANUAL');
      setManualControlStatus('ACTIVE');
      addLog('Control mode overridden to MANUAL via keypad teleoperation.');
    }
    setAnalogStick({ x: 0, y: 0, active: false });
    setActiveKeys((prev) => {
      if (!prev[key]) {
        if (key === 'W') addLog('Manual propulsion [W] engaged: Accelerating forward.', 'info');
        if (key === 'S') addLog('Manual propulsion [S] engaged: Reversing / braking.', 'info');
        if (key === 'A') addLog('Manual steering [A] engaged: Adjusting heading counter-clockwise.', 'info');
        if (key === 'D') addLog('Manual steering [D] engaged: Adjusting heading clockwise.', 'info');
      }
      return { ...prev, [key]: true };
    });
  };

  const handleKeyEnd = (key: 'W' | 'A' | 'S' | 'D') => {
    setActiveKeys((prev) => {
      if (prev[key]) {
        if (key === 'W' || key === 'S') addLog('Propulsion input released. Decelerating.', 'info');
        if (key === 'A' || key === 'D') addLog('Steering input released.', 'info');
      }
      return { ...prev, [key]: false };
    });
  };

  const pulseManualCommand = (key: 'W' | 'A' | 'S' | 'D', durationMs = 220) => {
    handleKeyStart(key);
    window.setTimeout(() => handleKeyEnd(key), durationMs);
  };

  const updateAnalogStickFromPoint = (clientX: number, clientY: number) => {
    const pad = gamepadContainerRef.current;
    if (!pad) return;

    const rect = pad.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.max(24, rect.width * 0.34);

    const normalizedAnalog = normalizeAnalogInput(
      (clientX - centerX) / radius,
      (clientY - centerY) / radius,
    );

    if (isEStopActive) {
      return;
    }

    if (modeOverride !== 'MANUAL') {
      setModeOverride('MANUAL');
      setManualControlStatus('ACTIVE');
    }

    setActiveKeys({ W: false, A: false, S: false, D: false });
    setAnalogStick(normalizedAnalog);
  };

  const resetAnalogStick = () => {
    activePointerIdRef.current = null;
    setAnalogStick({ x: 0, y: 0, active: false });
  };

  const handleGamepadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateAnalogStickFromPoint(event.clientX, event.clientY);
  };

  const handleGamepadPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateAnalogStickFromPoint(event.clientX, event.clientY);
  };

  const handleGamepadPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    resetAnalogStick();
  };

  useEffect(() => {
    let cancelled = false;

    async function loadAssets() {
      try {
        const [telemetryResponse, eventsResponse] = await Promise.all([
          fetch(assetManifest.telemetry),
          fetch(assetManifest.missionEvents),
        ]);

        const [telemetryPayload, eventsPayload] = await Promise.all([
          telemetryResponse.json() as Promise<TelemetryFrame[]>,
          eventsResponse.json() as Promise<MissionEvent[]>,
        ]);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setTelemetry(telemetryPayload);
          setEvents(eventsPayload);
        });
      } catch {
        if (!cancelled) {
          setAssetLoadError('Unable to load bundled mission assets.');
        }
      }
    }

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const targetTime = replay.currentTime / 1000;
    const drift = Math.abs(video.currentTime - targetTime);
    if (!replay.isPlaying || drift > 0.35) {
      video.currentTime = targetTime;
    }
    if (replay.isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [replay.currentTime, replay.isPlaying]);

  const activeMode = modeOverride ?? currentFrame?.mode ?? 'AUTO';
  const demoHeadingValue = headingOverride ?? currentFrame?.heading ?? 0;
  const robotPoseForMap = useMemo(
    () => (
      isRosLive && rosOdom.position
        ? { x: rosOdom.position.x, y: rosOdom.position.y, headingDeg: rosOdom.heading }
        : { x: robotPos.x, y: robotPos.y, headingDeg: demoHeadingValue }
    ),
    [demoHeadingValue, isRosLive, robotPos.x, robotPos.y, rosOdom.heading, rosOdom.position],
  );
  const activeMapData = isRosLive ? rosMap.mapData : demoMapData;
  const [liveStableMapBounds, setLiveStableMapBounds] = useState<{ minX: number; minY: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!isRosLive || !rosMap.mapData) {
      setLiveStableMapBounds(null);
      return;
    }

    const currentBounds = getKnownMapBounds(rosMap.mapData);
    const currentMinX = currentBounds.minX;
    const currentMinY = currentBounds.minY;
    const currentMaxX = currentBounds.minX + currentBounds.width;
    const currentMaxY = currentBounds.minY + currentBounds.height;
    const padding = Math.max(0.6, rosMap.mapData.resolution * 8);

    setLiveStableMapBounds((prev) => {
      const nextMinX = prev ? Math.min(prev.minX, currentMinX - padding) : currentMinX - padding;
      const nextMinY = prev ? Math.min(prev.minY, currentMinY - padding) : currentMinY - padding;
      const prevMaxX = prev ? prev.minX + prev.width : currentMaxX + padding;
      const prevMaxY = prev ? prev.minY + prev.height : currentMaxY + padding;
      const nextMaxX = prev ? Math.max(prevMaxX, currentMaxX + padding) : currentMaxX + padding;
      const nextMaxY = prev ? Math.max(prevMaxY, currentMaxY + padding) : currentMaxY + padding;

      return {
        minX: nextMinX,
        minY: nextMinY,
        width: nextMaxX - nextMinX,
        height: nextMaxY - nextMinY,
      };
    });
  }, [isRosLive, rosMap.mapData]);

  const resolvedStableMapBounds = isRosLive
    ? liveStableMapBounds ?? (activeMapData ? getKnownMapBounds(activeMapData) : STABLE_MAP_BOUNDS)
    : STABLE_MAP_BOUNDS;

  // Use ROS odometry values when in live mode
  const rosSpeedLabel = isRosLive ? rosOdom.linearSpeed.toFixed(1) : null;
  const rosHeadingValue = isRosLive ? rosOdom.heading : null;
  const activeEvent = events[replay.currentEventIndex] ?? null;

  useEffect(() => {
    if (isRosLive) {
      return;
    }

    setDemoMapData((prev) => revealDemoMap(prev, robotPoseForMap));
  }, [isRosLive, robotPoseForMap]);

  useEffect(() => {
    if (isRosLive || activeMode !== 'AUTO' || telemetry.length === 0 || replay.isPlaying || isEStopActive) {
      return;
    }

    replay.setIsPlaying(true);
  }, [activeMode, isEStopActive, isRosLive, replay, telemetry.length]);

  const lastEventIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeEvent && activeEvent.id !== lastEventIdRef.current) {
      lastEventIdRef.current = activeEvent.id;
      addLog(`Event Alert: [${activeEvent.severity.toUpperCase()}] ${activeEvent.label} - ${activeEvent.description}`, activeEvent.severity);
    }
  }, [activeEvent]);

  // Handle manual commands overrides
  const speedLabel = isEStopActive 
    ? '0.0' 
    : rosSpeedLabel !== null
    ? rosSpeedLabel
    : speedOverride !== null 
    ? speedOverride.toFixed(1) 
    : currentFrame 
    ? currentFrame.speed.toFixed(1) 
    : '--';

  const currentFrameHeading = isEStopActive 
    ? 0 
    : rosHeadingValue !== null
    ? rosHeadingValue
    : headingOverride !== null 
    ? headingOverride 
    : currentFrame 
    ? currentFrame.heading 
    : 0;

  const currentFrameSafety = isEStopActive 
    ? 'LOCKED' 
    : currentFrame 
    ? currentFrame.safety 
    : 'OKAY';

  const currentFrameSystem = isEStopActive 
    ? 'FAULT' 
    : isTesting 
    ? 'WARN' 
    : currentFrame 
    ? currentFrame.system 
    : 'OKAY';

  const currentFrameLocationLabel = localLocationLabel 
    ? localLocationLabel 
    : currentFrame 
    ? currentFrame.locationLabel 
    : 'Dock B2';

  const currentFrameEta = localEta 
    ? localEta 
    : currentFrame 
    ? currentFrame.eta 
    : 'ETA --';

  const numericSpeed = speedLabel !== '--' ? Number.parseFloat(speedLabel) || 0 : 0;
  const diagnosticsMetrics = useMemo(() => {
    if (isRosLive) {
      return {
        supplyVoltage: rosDiagnostics.supplyVoltage,
        motorTempC: rosDiagnostics.motorTempC,
        jitterMs: rosDiagnostics.jitterMs,
        vibrationG: rosDiagnostics.vibrationG,
        freshnessMs: rosDiagnostics.freshnessMs,
        statusText: rosDiagnostics.statusMessage,
        batteryPercent: rosDiagnostics.batteryPercent,
      };
    }

    return {
      supplyVoltage: Number((24.15 - numericSpeed * 0.05 + Math.sin(replay.currentTime / 1800) * 0.08).toFixed(2)),
      motorTempC: Number((41.8 + numericSpeed * 1.15).toFixed(1)),
      jitterMs: Math.max(6, Math.round(7 + Math.abs(currentFrameHeading) * 0.02 + numericSpeed * 2.5)),
      vibrationG: Number((0.06 + numericSpeed * 0.035).toFixed(2)),
      freshnessMs: 0,
      statusText: isEStopActive ? 'E-stop active' : 'Demo diagnostics',
      batteryPercent: batteryLevel ?? currentFrame?.battery ?? null,
    };
  }, [batteryLevel, currentFrame?.battery, currentFrameHeading, isEStopActive, isRosLive, numericSpeed, replay.currentTime, rosDiagnostics]);

  const timelinePercent = replay.duration > 0 ? (replay.currentTime / replay.duration) * 100 : 0;

  const alerts = useMemo(() => {
    if (isEStopActive) {
      return [
        { label: 'BATTERY OK', tone: 'ok' },
        { label: 'E-STOP ACTIVE', tone: 'critical' },
        { label: 'ACTUATORS LOCKED', tone: 'critical' },
        { label: 'DRIVES LOCKED', tone: 'critical' },
      ];
    }

    if (!currentFrame) {
      return [];
    }

    const chips = [
      { label: `Battery ${currentFrame.battery}%`, tone: currentFrame.battery > 40 ? 'ok' : 'warn' },
      { label: `${currentFrame.connection}% link`, tone: currentFrame.connection > 75 ? 'ok' : 'warn' },
      { label: `Safety ${currentFrameSafety}`, tone: currentFrameSafety === 'OKAY' ? 'ok' : 'warn' },
      { label: `System ${currentFrameSystem}`, tone: currentFrameSystem === 'OKAY' ? 'ok' : 'warn' },
    ];

    if (currentFrame.alert) {
      chips.push({ label: currentFrame.alert, tone: 'critical' });
    }

    if (manualControlStatus === 'ACTIVE') {
      chips.push({ label: 'MANUAL OVERRIDE', tone: 'warn' });
    }

    return chips;
  }, [currentFrame, isEStopActive, currentFrameSafety, currentFrameSystem, manualControlStatus]);

  const handleZoomIn = () => {
    setMinimapZoom((z) => {
      const next = Math.min(5, z + 1);
      addLog(`Zoom increased to level ${next} (${zoomLevels[next - 1].level}x)`);
      return next;
    });
  };

  const handleZoomOut = () => {
    setMinimapZoom((z) => {
      const next = Math.max(1, z - 1);
      addLog(`Zoom decreased to level ${next} (${zoomLevels[next - 1].level}x)`);
      return next;
    });
  };

  const handleEStopClick = () => {
    if (isEStopActive) {
      setIsEStopActive(false);
      addLog('Emergency Lockdown reset. Actuators released. System in standby.', 'info');
    } else {
      setShowEStopConfirm(true);
    }
  };

  const engageEStop = () => {
    setShowEStopConfirm(false);
    setIsEStopActive(true);
    replay.setIsPlaying(false);
    addLog('EMERGENCY LOCKDOWN ENGAGED BY OPERATOR! PROPULSION SHUTDOWN.', 'critical');
  };

  const runSelfTest = () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestProgress(0);
    addLog('LiDAR & IMU Self-Test initiated by operator.', 'info');

    const interval = setInterval(() => {
      setTestProgress((prev) => {
        const next = prev + 10;
        if (next === 30) {
          addLog('Calibrating IMU gyroscope and accelerometer... [PASS]', 'info');
        } else if (next === 60) {
          addLog('Checking network failsafe ping response (8ms)... [PASS]', 'info');
        } else if (next === 80) {
          addLog('Scanning point cloud density grid budget... [PASS]', 'info');
        } else if (next >= 100) {
          clearInterval(interval);
          setIsTesting(false);
          addLog('System Diagnostics completed. Status: nominal.', 'info');
          return 100;
        }
        return next;
      });
    }, 200);
  };

  const handleKeyboardShortcuts = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      replay.togglePlayback();
      addLog(`Replay ${replay.isPlaying ? 'paused' : 'started'} via Spacebar shortcut`);
    }

    if (event.code === 'ArrowRight') {
      event.preventDefault();
      replay.jumpToEvent(replay.currentEventIndex + 1);
    }

    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      replay.jumpToEvent(replay.currentEventIndex - 1);
    }

    if (event.code === 'KeyM') {
      event.preventDefault();
      setMainView((view) => (view === 'map' ? 'camera' : 'map'));
      addLog(`View swapped to: ${mainView === 'map' ? 'Camera' : 'Map'} via hotkey`);
    }

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      event.preventDefault();
      if (event.repeat) return;
      const keyChar = event.code.replace('Key', '') as 'W' | 'A' | 'S' | 'D';
      handleKeyStart(keyChar);
    }
  });

  const handleKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      const keyChar = event.code.replace('Key', '') as 'W' | 'A' | 'S' | 'D';
      handleKeyEnd(keyChar);
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcuts);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Calculate sliding-window history for the telemetry SVG graph
  const historyFrames = useMemo(() => {
    if (isRosLive) {
      return rosDiagnostics.history;
    }
    if (!telemetry.length) return [];
    const past = telemetry.filter((f) => f.timestamp <= replay.currentTime);
    return past.slice(-30).map((f) => ({
      t: f.timestamp,
      speed: f.speed,
      temp: 41.8 + f.speed * 1.15,
    }));
  }, [isRosLive, replay.currentTime, rosDiagnostics.history, telemetry]);

  const chartPaths = useMemo(() => {
    if (historyFrames.length < 2) return { speed: '', temp: '' };
    
    const width = 680;
    const height = 150;
    const speedMax = Math.max(1.5, ...historyFrames.map((f) => Math.abs(f.speed)));
    const tempValues = historyFrames.map((f) => f.temp);
    const tempMin = Math.min(...tempValues, 35);
    const tempMax = Math.max(...tempValues, 60);
    
    const speedPoints = historyFrames.map((f, i) => {
      const x = (i / (historyFrames.length - 1)) * width;
      const y = height - (Math.abs(f.speed) / speedMax) * (height - 18) - 9;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const tempPoints = historyFrames.map((f, i) => {
      const x = (i / (historyFrames.length - 1)) * width;
      const normalized = (f.temp - tempMin) / Math.max(tempMax - tempMin, 1);
      const y = height - normalized * (height - 18) - 9;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      speed: `M ${speedPoints.join(' L ')}`,
      temp: `M ${tempPoints.join(' L ')}`
    };
  }, [historyFrames]);

  const railTabs = [
    { id: 'grid', label: 'Operator Dashboard', icon: 'grid', svgPath: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z' },
    { id: 'map', label: 'Map View Only', icon: 'map', svgPath: 'M3 6l6-3 6 3 6-3v12l-6 3-6-3-6 3V6zm6-3v15m6-12v15' },
    { id: 'pin', label: 'Waypoints List', icon: 'pin', svgPath: 'M12 2a8 8 0 00-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 00-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z' },
    { id: 'scan', label: 'Sensor Feed Only', icon: 'scan', svgPath: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M12 8a4 4 0 100 8 4 4 0 000-8z' },
    { id: 'globe', label: 'System Configuration', icon: 'globe', svgPath: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-18v18m-9-9h18' },
    { id: 'trend', label: 'Analytics Console', icon: 'trend', svgPath: 'M3 12h4l3-9 4 18 3-9h4' },
  ];

  // Dynamic angle for waypoint compass radar
  const waypointCompassAngle = useMemo(() => {
    const goal = selectedGoal || 'Dock B2';
    switch (goal) {
      case 'Dock B2': return 45;
      case 'Aisle 4': return 135;
      case 'Bay 1': return -45;
      case 'Perimeter West': return 225;
      default: return 90;
    }
  }, [selectedGoal]);
  const activeWaypoint = waypointsList.find((wp) => wp.location === (selectedGoal || 'Dock B2')) ?? waypointsList[2];

  return (
    <main className={`dashboard dashboard--${panelState}`}>
      <div className="ambient-grid" />

      {/* Left Sidebar Rail */}
      <aside className="left-rail">
        <div className="brand-lockup">
          <span className="brand-word">ERIC</span>
          <span className="brand-sub">robotics</span>
        </div>
        <nav className="rail-nav" aria-label="Operator sections">
          {railTabs.map((tab) => (
            <button
              key={tab.id}
              className={`rail-button ${activeTab === tab.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'map') {
                  setMainView('map');
                  setPanelState('focus');
                } else if (tab.id === 'scan') {
                  setMainView('camera');
                  setPanelState('hidden');
                } else if (tab.id === 'grid') {
                  setPanelState('split');
                }
                addLog(`Navigation: Switched tab to ${tab.label}`);
              }}
              title={tab.label}
            >
              <svg viewBox="0 0 24 24">
                <path d={tab.svgPath} />
              </svg>
              <span className="rail-button-tooltip">{tab.label}</span>
            </button>
          ))}
        </nav>
        <button
          className="rail-footer"
          type="button"
          onClick={() => {
            const nextView = mainView === 'map' ? 'camera' : 'map';
            setMainView(nextView);
            addLog(`Viewport configuration toggled: ${nextView}`);
          }}
        >
          <span>Swap View</span>
        </button>
      </aside>

      {/* Main Content Workspace */}
      <section className="main-workspace">
        
        {/* Render Viewport backgrounds for Dashboard/Map/Scan tabs */}
        {(activeTab === 'grid' || activeTab === 'map' || activeTab === 'scan') && (
          <div className="view-container">
            {activeTab === 'map' ? (
              <>
                <div className="view-main" style={{ inset: 0 }}>
                  <OccupancyMapPanel
                    className="point-cloud-canvas"
                    mapData={activeMapData}
                    robotPose={robotPoseForMap}
                    stableBounds={resolvedStableMapBounds}
                  />
                </div>

                <div
                  className="view-pip view-pip--map-inset"
                  onClick={() => {
                    setActiveTab('scan');
                    setMainView('camera');
                    addLog('Map view camera inset opened as full sensor view.');
                  }}
                >
                  {isRosLive && rosCamera.imageDataUrl ? (
                    <img
                      className="camera-surface"
                      src={rosCamera.imageDataUrl}
                      alt="Live ROS camera feed"
                      style={{ filter: getCameraFilter(viewerControls.colorPreset, 'video') }}
                    />
                  ) : (
                    <img
                      className="camera-surface"
                      src={assetManifest.referenceFrame}
                      alt="Camera reference still frame"
                      style={{ filter: getCameraFilter(viewerControls.colorPreset, 'reference') }}
                    />
                  )}
                  <div className="camera-scanlines" />
                  <div className="camera-vignette" />
                </div>

                <div
                  style={{
                    position: 'absolute',
                    top: 24,
                    left: 24,
                    zIndex: 35,
                    padding: '14px 18px',
                    borderRadius: 18,
                    backdropFilter: 'blur(18px)',
                    background: 'rgba(8, 17, 31, 0.8)',
                    border: '1px solid rgba(56, 189, 248, 0.16)',
                    color: '#e2e8f0',
                    display: 'grid',
                    gap: 6,
                    minWidth: 260,
                  }}
                >
                  <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                    Live navigation map
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {isRosLive ? 'Occupancy map + robot pose' : 'Simulated occupancy map + auto route pose'}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                    {isRosLive
                      ? 'Robot arrow, heading cone, and SLAM occupancy grid shown in world coordinates.'
                      : 'Demo mode now reveals a live occupancy map while AUTO playback drives the simulated robot route.'}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Live occupancy map layer */}
                <div
                  className={mainView === 'map' ? 'view-main' : 'view-pip'}
                  onClick={() => {
                    if (mainView !== 'map') {
                      setMainView('map');
                      addLog('Switched main view to live occupancy map');
                    }
                  }}
                >
                  <OccupancyMapPanel
                    className="point-cloud-canvas"
                    mapData={activeMapData}
                    robotPose={robotPoseForMap}
                    stableBounds={resolvedStableMapBounds}
                  />
                  {mainView !== 'map' && (
                    <div
                      className="pip-click-shield"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 25,
                        cursor: 'pointer'
                      }}
                    />
                  )}
                </div>

                {/* Camera feed panel layer */}
                <div
                  className={mainView === 'camera' ? 'view-main' : 'view-pip'}
                  onClick={() => {
                    if (mainView !== 'camera') {
                      setMainView('camera');
                      addLog('Switched main view to Camera Feed');
                    }
                  }}
                >
                  {/* Live ROS camera feed when connected */}
                  {isRosLive && rosCamera.imageDataUrl ? (
                    <img
                      className="camera-surface"
                      src={rosCamera.imageDataUrl}
                      alt="Live ROS camera feed"
                      style={{ filter: getCameraFilter(viewerControls.colorPreset, 'video') }}
                    />
                  ) : cameraFeedType === 'video' ? (
                    <video
                      ref={videoRef}
                      className="camera-surface"
                      src={assetManifest.video}
                      poster={assetManifest.referenceFrame}
                      loop
                      muted
                      playsInline
                      autoPlay
                      style={{ filter: getCameraFilter(viewerControls.colorPreset, cameraFeedType) }}
                    />
                  ) : (
                    <img
                      className="camera-surface"
                      src={assetManifest.referenceFrame}
                      alt="Camera reference still frame"
                      style={{ filter: getCameraFilter(viewerControls.colorPreset, cameraFeedType) }}
                    />
                  )}
                  <div className="camera-scanlines" />
                  <div className="camera-vignette" />

                  {/* HUD crosshair and metadata overlay */}
                  {mainView === 'camera' && (
                    <div className="hud-overlay">
                      <div className="hud-left font-mono">
                        <span>CAM-01: {isRosLive ? 'LIVE' : 'ACTIVE'}</span>
                        <span>{isRosLive ? `ROS @ ${rosCamera.fps}FPS` : '1080p @ 30FPS'}</span>
                      </div>
                      <div className="hud-right font-mono">
                        <span>REC <span className="rec-dot">●</span></span>
                        <span>SIGNAL: {Math.min(100, Math.max(0, (currentFrame?.connection ?? 96) + connNoise))}%</span>
                      </div>
                      <div className="hud-crosshair">
                        <div className="cross-h"></div>
                        <div className="cross-v"></div>
                      </div>
                      {!isRosLive && cameraFeedType === 'video' && (
                        <div className="hud-watermark font-mono">SIMULATED CONTEXT FEED</div>
                      )}
                      {isRosLive && (
                        <div className="hud-watermark font-mono" style={{ color: 'var(--signal)' }}>LIVE ROS CAMERA FEED</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'grid' && (
              <div className="pip-labels-overlay">
                <span>{currentFrameLocationLabel}</span>
                <span>{currentFrameEta}</span>
              </div>
            )}

            {/* Alarm banner in E-Stop state */}
            {isEStopActive && (
              <>
                <div className="estop-alarm-overlay" />
                <div className="hud-estop-banner font-mono">EMERGENCY VEHICLE STOP ENGAGED</div>
              </>
            )}

            {/* View overlays when Dashboard Tab is active */}
            {activeTab === 'grid' && (
              <>
                {/* Floating Top Header bar */}
                <header className={`hud-header ${isMobileViewport ? 'is-mobile-viewport' : ''}`}>
                  {/* Top Left Pills */}
                  <div className="hud-header-left">
                    <div className="white-pill status-pill">
                      <span className={`status-pill-dot ${isEStopActive ? 'is-estop' : ''}`} />
                      <span>Status</span>
                      <strong>{currentFrame?.missionId ?? 'Loading mission'}</strong>
                      <button
                        className="status-pill-toggle"
                        type="button"
                        onClick={() => {
                          replay.togglePlayback();
                          addLog(`Replay ${replay.isPlaying ? 'paused' : 'started'} via button.`);
                        }}
                        title={replay.isPlaying ? 'Pause' : 'Play'}
                      >
                        {replay.isPlaying ? 'Ⅱ' : '▶'}
                      </button>
                    </div>

                    <div className="quick-goal-wrapper">
                      <button
                        className="white-pill quick-goal-button"
                        type="button"
                        onClick={() => setIsGoalDrawerOpen(!isGoalDrawerOpen)}
                      >
                        <span>{isMobileViewport ? 'Goal' : 'Quick goal'}</span>
                        <strong>{compactLabel(selectedGoal ? selectedGoal : (currentFrame?.quickGoal ?? 'Syncing route'), isMobileViewport ? 18 : 34)}</strong>
                        <span className="quick-goal-arrow">→</span>
                      </button>
                      {isGoalDrawerOpen && (
                        <div className="goal-selection-panel">
                          <div className="panel-header-small">Select Target Waypoint</div>
                          <div className="goal-options">
                            {quickGoalOptions.map((option) => (
                              <button
                                key={option.id}
                                className={`goal-option-btn ${selectedGoal === option.location ? 'is-active' : ''}`}
                                type="button"
                                onClick={() => {
                                  setSelectedGoal(option.location);
                                  setIsGoalDrawerOpen(false);
                                  setLocalLocationLabel(option.location);
                                  setLocalEta(option.eta);
                                  addLog(`Routing updated: Heading to ${option.label}. ETA: ${option.eta}.`);
                                }}
                              >
                                <div className="goal-option-title">{option.location}</div>
                                <div className="goal-option-meta">{option.eta} • {option.distance}m</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Center Pills */}
                  <div className="hud-header-center">
                    <div className={`telemetry-glass-pill ${isMobileViewport ? 'is-mobile-compact' : ''}`}>
                      {/* ROS connection indicator */}
                      <div className="telemetry-item">
                        <span className={`telemetry-item-dot ${isRosLive ? '' : 'is-warn'}`} style={{ background: isRosLive ? 'var(--signal)' : undefined }} />
                        <span>{isRosLive ? 'ROS LIVE' : 'DEMO'}</span>
                      </div>
                      <div className="telemetry-item">
                        <span>{batteryLevel !== null ? batteryLevel.toFixed(1) : (currentFrame?.battery ?? '--')}% Bat</span>
                      </div>
                      {!isMobileViewport && (
                        <div className="telemetry-item">
                          <span>{isRosLive ? '100' : Math.min(100, Math.max(0, (currentFrame?.connection ?? 94) + connNoise))}% Link</span>
                        </div>
                      )}
                      <div className="telemetry-item">
                        <span>Speed: {speedLabel} m/s</span>
                      </div>
                      <div className="telemetry-item">
                        <span>Heading: {typeof currentFrameHeading === 'number' ? currentFrameHeading.toFixed(1) : currentFrameHeading}°</span>
                      </div>
                      {isMobileViewport ? (
                        <div className="telemetry-item">
                          <span>{currentFrameSafety}/{currentFrameSystem}</span>
                        </div>
                      ) : (
                        <>
                          <div className="telemetry-item">
                            <span>Failsafe</span>
                            <span className={`telemetry-item-dot ${currentFrameSafety === 'LOCKED' ? 'is-critical' : currentFrameSafety === 'WARN' ? 'is-warn' : ''}`} />
                            <span>{currentFrameSafety}</span>
                          </div>
                          <div className="telemetry-item">
                            <span>System</span>
                            <span className={`telemetry-item-dot ${currentFrameSystem === 'FAULT' ? 'is-critical' : currentFrameSystem === 'WARN' ? 'is-warn' : ''}`} />
                            <span>{currentFrameSystem}</span>
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      className="view-selector-pill"
                      type="button"
                      onClick={() => {
                        const nextView = mainView === 'map' ? 'camera' : 'map';
                        setMainView(nextView);
                        addLog(`View swapped to: ${nextView === 'map' ? 'Map View' : 'Camera View'}`);
                      }}
                    >
                      {mainView === 'map' ? (isMobileViewport ? 'Map' : 'Map View') : (isMobileViewport ? 'Camera' : 'Camera View')}
                    </button>
                  </div>

                  {/* Top Right Pills */}
                  <div className="hud-header-right">
                    <div className="white-pill mode-pill-container">
                      <span className="mode-pill-label">Mode</span>
                      <div className="mode-toggle-track">
                        {modeOptions.map((mode) => (
                          <button
                            key={mode}
                            className={`mode-toggle-btn ${mode === activeMode ? 'is-active' : ''}`}
                            type="button"
                            onClick={() => {
                              setModeOverride(mode);
                              if (mode !== 'MANUAL') {
                                setManualControlStatus('OFF');
                              } else {
                                setManualControlStatus('ACTIVE');
                              }
                              if (!isRosLive && mode === 'AUTO') {
                                replay.setIsPlaying(true);
                                addLog('AUTO mission playback engaged. Demo robot is mapping the route in real time.');
                              }
                              addLog(`Control mode switched to: ${mode}`);
                            }}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      className="white-pill initiate-pill-button"
                      type="button"
                      onClick={() => {
                        replay.seekTo(0);
                        replay.setIsPlaying(true);
                        setSpeedOverride(null);
                        setHeadingOverride(null);
                        setSelectedGoal(null);
                        setIsEStopActive(false);
                        setBatteryLevel(null);
                        setRobotPos({ x: DEMO_INITIAL_POSE.x, y: DEMO_INITIAL_POSE.y });
                        setDemoMapData(revealDemoMap(createDemoMapTemplate(), DEMO_INITIAL_POSE));
                        addLog('Mission initialized. Telemetry replaying from zero offset.');
                      }}
                    >
                      <span>Initiate</span>
                      <span className="initiate-pill-arrow">→</span>
                    </button>
                  </div>
                </header>

                {/* Vertical Zoom Slider (Left, next to PiP) */}
                <div className="zoom-slider-container">
                  <button
                    className="zoom-slider-btn"
                    type="button"
                    onClick={handleZoomIn}
                    title="Zoom In"
                  >
                    +
                  </button>
                  <div className="zoom-slider-track">
                    <input
                      className="zoom-slider-input"
                      type="range"
                      min="1"
                      max="5"
                      step="1"
                      value={minimapZoom}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setMinimapZoom(val);
                        addLog(`Zoom level adjusted: ${val}`);
                      }}
                      aria-label="Viewport Zoom"
                    />
                  </div>
                  <button
                    className="zoom-slider-btn"
                    type="button"
                    onClick={handleZoomOut}
                    title="Zoom Out"
                  >
                    -
                  </button>
                  <span className="zoom-slider-text">{minimapZoom}x</span>
                </div>

                {/* Floating Bottom Right Controls */}
                <div className="hud-controls-right">
                  {/* Custom E-Stop SVG Button */}
                  <button
                    className="emergency-stop-svg-btn"
                    type="button"
                    onClick={handleEStopClick}
                    title={isEStopActive ? 'Reset Emergency Stop' : 'Engage Emergency Stop'}
                  >
                    <svg viewBox="0 0 100 100" width="100%" height="100%">
                      <circle cx="50" cy="50" r="46" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
                      <path id="topTextPath" d="M 12 50 A 38 38 0 0 1 88 50" fill="none" />
                      <path id="bottomTextPath" d="M 12 50 A 38 38 0 0 0 88 50" fill="none" />
                      <text fill="#1e293b" fontSize="6.5" fontWeight="900" letterSpacing="0.4" fontFamily="sans-serif">
                        <textPath href="#topTextPath" startOffset="50%" textAnchor="middle">
                          EMERGENCY
                        </textPath>
                      </text>
                      <text fill="#1e293b" fontSize="6.5" fontWeight="900" letterSpacing="0.4" fontFamily="sans-serif">
                        <textPath href="#bottomTextPath" startOffset="50%" textAnchor="middle">
                          STOP
                        </textPath>
                      </text>
                      <circle cx="50" cy="50" r="28" fill={isEStopActive ? '#e11d48' : '#ef4444'} stroke="#b91c1c" strokeWidth="1.5" />
                      {isEStopActive && (
                        <circle cx="50" cy="50" r="28" fill="none" stroke="#f43f5e" strokeWidth="2" opacity="0.8">
                          <animate attributeName="r" values="28;31;28" dur="1s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.8;0;0.8" dur="1s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <g transform="translate(50,50) scale(0.68) translate(-25,-25)">
                        <path d="M25,5 C36.045695,5 45,13.954305 45,25 C45,28.8540866 43.9130722,32.4549444 42.0360341,35.5085449 L38.5085449,32.0360341 C39.4549444,30.0130722 40,27.8540866 40,25 C40,16.7157288 33.2842712,10 25,10 L25,14 L17,8 L25,2 L25,5 Z" fill="#ffffff" />
                        <path d="M45,25 C45,36.045695 36.045695,45 25,45 C21.1459134,45 17.5450556,43.9130722 14.4914551,42.0360341 L17.9639659,38.5085449 C19.9869278,39.4549444 22.1459134,40 25,40 C33.2842712,40 40,33.2842712 40,25 L36,25 L42,17 L48,25 L45,25 Z" fill="#ffffff" transform="rotate(120, 25, 25)" />
                        <path d="M25,45 C13.954305,45 5,36.045695 5,25 C5,21.1459134 6.0869278,17.5450556 7.9639659,14.4914551 L11.4914551,17.9639659 C10.5450556,19.9869278 10,22.1459134 10,25 C10,33.2842712 16.7157288,40 25,40 L25,36 L33,42 L25,48 L25,45 Z" fill="#ffffff" transform="rotate(240, 25, 25)" />
                      </g>
                    </svg>
                  </button>

                  {/* Custom WASD Gamepad Pad */}
                  <div
                    ref={gamepadContainerRef}
                    className={`gamepad-container ${
                    activeKeys.W ? 'key-w-active ' : ''
                  }${
                    activeKeys.A ? 'key-a-active ' : ''
                  }${
                    activeKeys.S ? 'key-s-active ' : ''
                  }${
                    activeKeys.D ? 'key-d-active ' : ''
                  }${analogStick.active ? ' analog-active' : ''}`}
                    aria-label="Directional control pad"
                    onPointerDown={handleGamepadPointerDown}
                    onPointerMove={handleGamepadPointerMove}
                    onPointerUp={handleGamepadPointerUp}
                    onPointerCancel={handleGamepadPointerUp}
                  >
                    <span className="gamepad-arrow gamepad-arrow-up">▲</span>
                    <span className="gamepad-arrow gamepad-arrow-left">◀</span>
                    <span className="gamepad-arrow gamepad-arrow-right">▶</span>
                    <span className="gamepad-arrow gamepad-arrow-down">▼</span>
                    <div
                      className="gamepad-inner"
                      style={{
                        transform: `translate(${joystickOffset.x}px, ${joystickOffset.y}px)`,
                        transition: 'transform 0.08s ease-out'
                      }}
                    >
                      <button
                        type="button"
                        className="gamepad-key gamepad-key-w"
                        onMouseDown={() => handleKeyStart('W')}
                        onMouseUp={() => handleKeyEnd('W')}
                        onMouseLeave={() => handleKeyEnd('W')}
                        onClick={() => pulseManualCommand('W', 260)}
                        onTouchStart={(e) => { e.preventDefault(); handleKeyStart('W'); }}
                        onTouchEnd={() => handleKeyEnd('W')}
                        title="Forward"
                      >
                        W
                      </button>
                      <button
                        type="button"
                        className="gamepad-key gamepad-key-a"
                        onMouseDown={() => handleKeyStart('A')}
                        onMouseUp={() => handleKeyEnd('A')}
                        onMouseLeave={() => handleKeyEnd('A')}
                        onClick={() => pulseManualCommand('A', 220)}
                        onTouchStart={(e) => { e.preventDefault(); handleKeyStart('A'); }}
                        onTouchEnd={() => handleKeyEnd('A')}
                        title="Steer Left"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        className="gamepad-key gamepad-key-d"
                        onMouseDown={() => handleKeyStart('D')}
                        onMouseUp={() => handleKeyEnd('D')}
                        onMouseLeave={() => handleKeyEnd('D')}
                        onClick={() => pulseManualCommand('D', 220)}
                        onTouchStart={(e) => { e.preventDefault(); handleKeyStart('D'); }}
                        onTouchEnd={() => handleKeyEnd('D')}
                        title="Steer Right"
                      >
                        D
                      </button>
                      <button
                        type="button"
                        className="gamepad-key gamepad-key-s"
                        onMouseDown={() => handleKeyStart('S')}
                        onMouseUp={() => handleKeyEnd('S')}
                        onMouseLeave={() => handleKeyEnd('S')}
                        onClick={() => pulseManualCommand('S', 260)}
                        onTouchStart={(e) => { e.preventDefault(); handleKeyStart('S'); }}
                        onTouchEnd={() => handleKeyEnd('S')}
                        title="Reverse"
                      >
                        S
                      </button>
                      <span className="gamepad-center-label">DRAG</span>
                    </div>
                  </div>
                </div>

                {/* Floating Bottom Replay Timeline Panel */}
                {!isMobileViewport && isDesktopReplayHidden && (
                  <button
                    className="replay-show-toggle"
                    type="button"
                    onClick={() => setIsDesktopReplayHidden(false)}
                  >
                    Show mission replay
                  </button>
                )}
                <section className={`replay-panel ${isMobileViewport && !isMobileReplayExpanded ? 'is-collapsed' : ''} ${!isMobileViewport && isDesktopReplayHidden ? 'is-hidden-desktop' : ''}`}>
                  <div className="replay-panel__top">
                    <div>
                      <p className="eyebrow">{isMobileViewport ? 'Replay' : 'Mission replay'}</p>
                      <h2>{activeEvent?.label ?? 'Awaiting telemetry feed'}</h2>
                      {(!isMobileViewport || isMobileReplayExpanded) && (
                        <p>{activeEvent?.description ?? 'Timeline markers drive the dashboard state.'}</p>
                      )}
                    </div>
                    <div className="replay-panel__actions">
                      {!isMobileViewport && (
                        <div className="replay-shortcuts">
                          <span>[Space] play/pause</span>
                          <span>[Left/Right] jump event</span>
                          <span>[M] swap main views</span>
                        </div>
                      )}
                      {isMobileViewport && (
                        <button
                          className="replay-collapse-toggle"
                          type="button"
                          onClick={() => setIsMobileReplayExpanded((value) => !value)}
                        >
                          {isMobileReplayExpanded ? 'Hide details' : 'More'}
                        </button>
                      )}
                      {!isMobileViewport && (
                        <button
                          className="replay-collapse-toggle"
                          type="button"
                          onClick={() => setIsDesktopReplayHidden(true)}
                        >
                          Hide replay
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`timeline ${isMobileViewport && !isMobileReplayExpanded ? 'is-compact' : ''}`}>
                    <button
                      className="timeline-play"
                      type="button"
                      onClick={replay.togglePlayback}
                      title={replay.isPlaying ? 'Pause' : 'Play'}
                    >
                      {replay.isPlaying ? 'II' : '▶'}
                    </button>
                    <div className="timeline-track">
                      <div className="timeline-progress" style={{ width: `${timelinePercent}%` }} />
                      <input
                        aria-label="Replay timeline"
                        max={replay.duration}
                        min={0}
                        step={50}
                        type="range"
                        value={replay.currentTime}
                        onChange={(event) => replay.seekTo(Number(event.currentTarget.value))}
                      />
                      {(!isMobileViewport || isMobileReplayExpanded) && (
                        <div className="timeline-markers">
                          {events.map((eventItem) => (
                            <button
                              key={eventItem.id}
                              className={`timeline-marker timeline-marker--${eventItem.severity} ${
                                eventItem.id === replay.highlightedEventId ? 'is-selected' : ''
                              }`}
                              style={{ left: `${(eventItem.timestamp / replay.duration) * 100}%` }}
                              type="button"
                              onClick={() => replay.jumpToEvent(events.findIndex(({ id }) => id === eventItem.id))}
                              title={eventItem.label}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="timeline-clock">
                      <span>{formatClock(replay.currentTime)}</span>
                      <span>/</span>
                      <span>{formatClock(replay.duration)}</span>
                    </div>
                  </div>
                  {(!isMobileViewport || isMobileReplayExpanded) && (
                    <div className="alert-row">
                      {alerts.map((alert) => (
                        <span key={alert.label} className={`alert-chip alert-chip--${alert.tone}`}>
                          {alert.label}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Simple overlays for full Map tab */}
            {activeTab === 'map' && (
              <div
                className="viewer-controls"
                style={{
                  position: 'absolute',
                  top: '24px',
                  right: '24px',
                  background: 'rgba(10, 18, 30, 0.82)',
                  backdropFilter: 'blur(14px)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '16px',
                  padding: '16px 20px',
                  zIndex: 30,
                  width: '260px'
                }}
              >
                <div className="panel-header" style={{ padding: 0, borderBottom: 'none', background: 'none', marginBottom: '12px' }}>
                  <div>
                    <p className="eyebrow" style={{ fontSize: '0.62rem' }}>Viewer controls</p>
                    <h3 style={{ fontSize: '1rem', margin: '2px 0 0' }}>Cloud presets</h3>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-soft)', letterSpacing: '0.08em', fontWeight: 'bold' }}>Color</span>
                    <select
                      value={viewerControls.colorPreset}
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        color: '#ffffff',
                        fontSize: '0.78rem'
                      }}
                      onChange={(event) =>
                        setViewerControls((state) => ({ ...state, colorPreset: event.currentTarget.value as ViewerControlsState['colorPreset'] }))
                      }
                    >
                      <option value="signal">Signal</option>
                      <option value="ice">Ice</option>
                      <option value="amber">Amber</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-soft)', letterSpacing: '0.08em', fontWeight: 'bold' }}>Camera</span>
                    <select
                      value={viewerControls.cameraPreset}
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        color: '#ffffff',
                        fontSize: '0.78rem'
                      }}
                      onChange={(event) =>
                        setViewerControls((state) => ({ ...state, cameraPreset: event.currentTarget.value as ViewerControlsState['cameraPreset'] }))
                      }
                    >
                      <option value="iso">Isometric</option>
                      <option value="top">Top</option>
                      <option value="profile">Profile</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-soft)', letterSpacing: '0.08em', fontWeight: 'bold' }}>Point size</span>
                    <input
                      max="0.04"
                      min="0.008"
                      step="0.002"
                      type="range"
                      style={{ width: '100%', accentColor: 'var(--cyan)' }}
                      value={viewerControls.pointSize}
                      onChange={(event) =>
                        setViewerControls((state) => ({ ...state, pointSize: Number(event.currentTarget.value) }))
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Waypoints Queue List (Premium Glass Layout) */}
        {activeTab === 'pin' && (
          <div className="tab-panel-overlay">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Waypoints & Targets</p>
                <h3>Mission routing coordinates</h3>
              </div>
              <span className="view-selector-pill" style={{ pointerEvents: 'none' }}>Active Target: {selectedGoal || 'Dock B2'}</span>
            </div>

            <div className="waypoint-container-layout">
              <div className="waypoint-list">
                {waypointsList.map((wp) => (
                  <div
                    key={wp.id}
                    className={`waypoint-card ${selectedGoal === wp.location || (!selectedGoal && wp.location === 'Dock B2') ? 'is-active' : ''}`}
                    onClick={() => {
                      setSelectedGoal(wp.location);
                      setLocalLocationLabel(wp.location);
                      setLocalEta(wp.eta);
                      addLog(`Routing updated: Heading to ${wp.name}. Coordinates: ${wp.coordinates}`);
                    }}
                  >
                    <div className="wp-indicator">
                      {wp.status === 'COMPLETED' ? '✓' : (selectedGoal === wp.location || (!selectedGoal && wp.location === 'Dock B2')) ? '●' : '○'}
                    </div>
                    <div className="wp-details">
                      <div className="wp-name">{wp.name}</div>
                      <div className="wp-coords monospace">{wp.coordinates}</div>
                    </div>
                    <span className={`wp-status wp-status--${wp.status.toLowerCase()}`}>{wp.status}</span>
                  </div>
                ))}
              </div>

              <div className="waypoint-detail-panel">
                <div className="waypoint-detail-header">
                  <h4>Selected Target Routing Details</h4>
                </div>
                <div className="waypoint-coords-large">
                  {activeWaypoint.coordinates}
                </div>
                
                {/* SVG radar visualizer */}
                <div className="radar-visualizer">
                  <div className="radar-circle">
                    <div className="radar-sweep" />
                    <div
                      className="radar-dot-pointer"
                      style={{
                        position: 'absolute',
                        width: '10px',
                        height: '10px',
                        background: 'var(--cyan)',
                        borderRadius: '50%',
                        boxShadow: '0 0 10px var(--cyan)',
                        transform: `rotate(${waypointCompassAngle}deg) translate(50px) rotate(-${waypointCompassAngle}deg)`,
                        transition: 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}
                    />
                  </div>
                </div>

                <div className="waypoint-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setSelectedGoal(activeWaypoint.location);
                      setLocalLocationLabel(activeWaypoint.location);
                      setLocalEta(activeWaypoint.eta);
                      addLog(`Initiated sequence routing to ${activeWaypoint.name}`);
                    }}
                  >
                    Set Route: {activeWaypoint.location}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      addLog('Waypoint added to queue. Telemetry sync pending.', 'info');
                    }}
                  >
                    Add Waypoint
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Telemetry Analytics Dashboard (Premium glass charts) */}
        {activeTab === 'trend' && (
          <div className="tab-panel-overlay">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Realtime Metrics</p>
                <h3>Telemetry logs & analysis</h3>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setLogs([]);
                  addLog('Console logs cleared.');
                }}
              >
                Clear Console
              </button>
            </div>

            <div className="analytics-container-layout">
              {/* Telemetry Metrics cards */}
              <div className="telemetry-grid-metrics">
                <div className="metric-box">
                  <span className="metric-label">Supply Voltage</span>
                  <span className="metric-value monospace">{diagnosticsMetrics.supplyVoltage !== null ? `${diagnosticsMetrics.supplyVoltage.toFixed(2)} V` : '--'}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Motor Temperature</span>
                  <span className="metric-value monospace">{diagnosticsMetrics.motorTempC !== null ? `${diagnosticsMetrics.motorTempC.toFixed(1)} °C` : '--'}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Jitter Latency</span>
                  <span className="metric-value monospace">{diagnosticsMetrics.jitterMs !== null ? `${diagnosticsMetrics.jitterMs} ms` : '--'}</span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Vibration Index</span>
                  <span className="metric-value monospace">{diagnosticsMetrics.vibrationG !== null ? `${diagnosticsMetrics.vibrationG.toFixed(2)} g` : '--'}</span>
                </div>
              </div>

              {/* Dynamic SVG Chart */}
              <div className="chart-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <span className="chart-section-title">{isRosLive ? 'Live drivetrain history (ROS-backed)' : 'Drive history waveform'}</span>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.65rem', fontWeight: 'bold', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--cyan)' }}>● Speed (m/s)</span>
                    <span style={{ color: 'var(--warn)' }}>● Temp (°C)</span>
                    <span style={{ color: 'var(--text-soft)' }}>Freshness: {diagnosticsMetrics.freshnessMs !== null ? `${Math.max(0, diagnosticsMetrics.freshnessMs)} ms` : 'waiting'}</span>
                  </div>
                </div>
                <div className="chart-wrapper">
                  <svg width="100%" height="100%" viewBox="0 0 680 150" preserveAspectRatio="none">
                    <line x1="0" y1="30" x2="680" y2="30" className="chart-grid-line" />
                    <line x1="0" y1="75" x2="680" y2="75" className="chart-grid-line" />
                    <line x1="0" y1="120" x2="680" y2="120" className="chart-grid-line" />
                    {chartPaths.speed && <path d={chartPaths.speed} className="chart-path-speed" />}
                    {chartPaths.temp && <path d={chartPaths.temp} className="chart-path-temp" />}
                  </svg>
                </div>
              </div>

              {/* Active Operator Log Terminal */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div className="logs-terminal-title">Active Operator System Log</div>
                <div className="logs-terminal monospace">
                  {isRosLive && (
                    <div className="log-line log-line--info">
                      <span className="log-time">[LIVE]</span>{' '}
                      <span className="log-text">Diagnostics status: {diagnosticsMetrics.statusText}{diagnosticsMetrics.batteryPercent !== null ? ` • Battery ${diagnosticsMetrics.batteryPercent.toFixed(1)}%` : ''}</span>
                    </div>
                  )}
                  {logs.map((log) => (
                    <div key={log.id} className={`log-line log-line--${log.type}`}>
                      <span className="log-time">[{log.time}]</span>{' '}
                      <span className="log-text">{log.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: System Configuration / Calibration overlay */}
        {activeTab === 'globe' && (
          <div className="tab-panel-overlay">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Hardware Diagnostics</p>
                <h3>System configuration & calibration</h3>
              </div>
            </div>

            <div className="calibration-container-layout">
              {/* ROS 2 Connection Status Section */}
              <div className="settings-section">
                <h4>ROS 2 Connection</h4>
                <div className="setting-row">
                  <span>Bridge Status</span>
                  <span className={`badge monospace`} style={{
                    color: isRosLive ? 'var(--signal)' : 'var(--warn)',
                    border: `1px solid ${isRosLive ? 'rgba(124,255,157,0.3)' : 'rgba(251,191,36,0.3)'}`,
                    background: isRosLive ? 'rgba(124,255,157,0.08)' : 'rgba(251,191,36,0.08)'
                  }}>
                    {isRosLive ? '● Connected (ws://localhost:9090)' : '○ Disconnected — Demo Mode'}
                  </span>
                </div>
                {isRosLive && (
                  <>
                    <div className="setting-row">
                      <span>Robot Position</span>
                      <span className="badge monospace" style={{ color: 'var(--cyan)', border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.08)' }}>
                        X: {(isRosLive ? rosOdom.position?.x : robotPoseForMap.x)?.toFixed(2) ?? '--'} Y: {(isRosLive ? rosOdom.position?.y : robotPoseForMap.y)?.toFixed(2) ?? '--'}
                      </span>
                    </div>
                    <div className="setting-row">
                      <span>LiDAR Points</span>
                      <span className="badge monospace" style={{ color: 'var(--signal)', border: '1px solid rgba(124,255,157,0.3)', background: 'rgba(124,255,157,0.08)' }}>
                        {rosLidar.pointCount} pts @ /scan
                      </span>
                    </div>
                    <div className="setting-row">
                      <span>Camera Feed</span>
                      <span className="badge monospace" style={{ color: 'var(--cyan)', border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.08)' }}>
                        {rosCamera.fps} FPS @ /camera/image/compressed
                      </span>
                    </div>
                    <div className="setting-row">
                      <span>SLAM Map</span>
                      <span className="badge monospace" style={{ color: 'var(--signal)', border: '1px solid rgba(124,255,157,0.3)', background: 'rgba(124,255,157,0.08)' }}>
                        {activeMapData ? `${activeMapData.width}x${activeMapData.height} @ ${activeMapData.resolution}m/px` : 'Waiting...'}
                      </span>
                    </div>
                  </>
                )}
                {!isRosLive && (
                  <div className="setting-row">
                    <span>Reconnect</span>
                    <button type="button" className="btn-primary" onClick={() => rosConn.reconnect()}>Reconnect to ROS Bridge</button>
                  </div>
                )}
              </div>

              <div className="settings-section">
                <h4>Camera Feed Settings</h4>
                {isRosLive ? (
                  <>
                    <div className="setting-row">
                      <span>Active Camera Source</span>
                      <span className="badge monospace" style={{ color: 'var(--signal)', border: '1px solid rgba(124,255,157,0.3)', background: 'rgba(124,255,157,0.08)' }}>
                        /camera/image/compressed (live robot-perspective stream)
                      </span>
                    </div>
                    <div className="setting-row">
                      <span>Operator Use</span>
                      <span className="badge monospace" style={{ color: 'var(--cyan)', border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.08)' }}>
                        Street-view style situational awareness only
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="setting-row">
                      <span>Active Camera Source</span>
                      <div className="toggle-group">
                        <button
                          type="button"
                          className={cameraFeedType === 'reference' ? 'is-selected' : ''}
                          onClick={() => {
                            setCameraFeedType('reference');
                            addLog('Camera source changed: Static Reference Frame');
                          }}
                        >
                          Reference Still
                        </button>
                        <button
                          type="button"
                          className={cameraFeedType === 'video' ? 'is-selected' : ''}
                          onClick={() => {
                            setCameraFeedType('video');
                            addLog('Camera source changed: Simulated Video Feed');
                          }}
                        >
                          Video Feed
                        </button>
                      </div>
                    </div>
                    <div className="setting-row">
                      <span>Feed Filters</span>
                      <span className="badge monospace" style={{ color: 'var(--cyan)', border: '1px solid rgba(14,165,233,0.3)', background: 'rgba(14,165,233,0.08)' }}>Digital Tint Enabled</span>
                    </div>
                  </>
                )}
              </div>

              <div className="settings-section">
                <h4>LiDAR Point Size Preset</h4>
                <div className="setting-row">
                  <span>Point Budget</span>
                  <select
                    value={viewerControls.pointSize}
                    onChange={(e) => {
                      setViewerControls((s) => ({ ...s, pointSize: parseFloat(e.target.value) }));
                      addLog(`Point cloud density updated size: ${e.target.value}`);
                    }}
                  >
                    <option value="0.008">Low Density (Small)</option>
                    <option value="0.015">Normal Density (Medium)</option>
                    <option value="0.025">High Density (Large)</option>
                    <option value="0.035">Ultra Density (XLarge)</option>
                  </select>
                </div>
              </div>

              <div className="settings-section">
                <h4>Diagnostics Self-Tests</h4>
                <div className="setting-row">
                  <span>IMU/LiDAR Self-Test</span>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={runSelfTest}
                    disabled={isTesting}
                  >
                    {isTesting ? 'Running Diagnostics...' : 'Run Test'}
                  </button>
                </div>
                {isTesting && (
                  <div className="test-progress-bar">
                    <div className="test-progress-fill" style={{ width: `${testProgress}%` }}></div>
                    <span className="test-progress-label">Progress: {testProgress}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Shutdown confirmation dialog modal overlay */}
        {showEStopConfirm && (
          <div className="estop-modal-overlay">
            <div className="estop-modal">
              <div className="estop-modal-title">⚠️ SYSTEM SHUTDOWN CONFIRMATION</div>
              <div className="estop-modal-body">
                Are you sure you want to engage the Emergency Vehicle Stop? All actuators will be locked immediately and telemetry commands will suspend.
              </div>
              <div className="estop-modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowEStopConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-confirm-estop"
                  onClick={engageEStop}
                >
                  ENGAGE SHUTDOWN
                </button>
              </div>
            </div>
          </div>
        )}

      </section>

      {assetLoadError ? <div className="asset-error">{assetLoadError}</div> : null}
    </main>
  );
}

