export type ControlMode = 'AUTO' | 'MANUAL' | 'ASSIST';

export type PanelState = 'hidden' | 'split' | 'focus';

export type AssetManifest = {
  video: string;
  pointCloud: string;
  referenceFrame: string;
  telemetry: string;
  missionEvents: string;
};

export type ViewerControlsState = {
  pointSize: number;
  colorPreset: 'signal' | 'ice' | 'amber';
  cameraPreset: 'iso' | 'top' | 'profile';
};

export type TelemetryFrame = {
  timestamp: number;
  missionId: string;
  status: string;
  battery: number;
  connection: number;
  speed: number;
  heading: number;
  mode: ControlMode;
  safety: 'OKAY' | 'WARN' | 'LOCKED';
  system: 'OKAY' | 'WARN' | 'FAULT';
  alert: string | null;
  quickGoal: string;
  locationLabel: string;
  eta: string;
};

export type MissionEvent = {
  id: string;
  timestamp: number;
  label: string;
  severity: 'info' | 'warn' | 'critical';
  uiTarget: 'camera' | 'map' | 'status' | 'controls';
  description: string;
  seekTime?: number;
};
