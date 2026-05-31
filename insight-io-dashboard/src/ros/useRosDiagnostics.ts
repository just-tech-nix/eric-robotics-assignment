import { useEffect, useMemo, useRef, useState } from 'react';
import { Topic } from 'roslib';

import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

interface BatteryStateMessage {
  voltage: number;
  percentage: number;
}

interface DiagnosticValue {
  key: string;
  value: string;
}

interface DiagnosticStatusMessage {
  level: number;
  name: string;
  message: string;
  values: DiagnosticValue[];
}

interface DiagnosticArrayMessage {
  status: DiagnosticStatusMessage[];
}

type DiagnosticsSnapshot = {
  supplyVoltage: number | null;
  batteryPercent: number | null;
  motorTempC: number | null;
  vibrationG: number | null;
  jitterMs: number | null;
  commandAgeMs: number | null;
  odomAgeMs: number | null;
  measuredLinearMps: number | null;
  measuredAngularRps: number | null;
  targetLinearMps: number | null;
  targetAngularRps: number | null;
  worstLevel: number;
  statusMessage: string;
  updatedAt: number;
};

type HistoryPoint = {
  t: number;
  speed: number;
  temp: number;
};

export interface RosDiagnosticsState extends DiagnosticsSnapshot {
  history: HistoryPoint[];
  freshnessMs: number | null;
}

const EMPTY_SNAPSHOT: DiagnosticsSnapshot = {
  supplyVoltage: null,
  batteryPercent: null,
  motorTempC: null,
  vibrationG: null,
  jitterMs: null,
  commandAgeMs: null,
  odomAgeMs: null,
  measuredLinearMps: null,
  measuredAngularRps: null,
  targetLinearMps: null,
  targetAngularRps: null,
  worstLevel: 0,
  statusMessage: 'Waiting for diagnostics',
  updatedAt: 0,
};

function parseNumeric(values: DiagnosticValue[], key: string): number | null {
  const found = values.find((entry) => entry.key === key)?.value;
  if (!found) return null;
  const parsed = Number(found);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useRosDiagnostics(): RosDiagnosticsState {
  const { connected } = useRosConnection();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>(EMPTY_SNAPSHOT);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const batteryTopicRef = useRef<Topic<BatteryStateMessage> | null>(null);
  const diagnosticsTopicRef = useRef<Topic<DiagnosticArrayMessage> | null>(null);

  useEffect(() => {
    if (!connected) {
      setSnapshot(EMPTY_SNAPSHOT);
      setHistory([]);
      return;
    }

    const ros = getRos();
    const batteryTopic = new Topic<BatteryStateMessage>({
      ros,
      name: '/battery_state',
      messageType: 'sensor_msgs/msg/BatteryState',
      throttle_rate: 250,
    });
    const diagnosticsTopic = new Topic<DiagnosticArrayMessage>({
      ros,
      name: '/diagnostics',
      messageType: 'diagnostic_msgs/msg/DiagnosticArray',
      throttle_rate: 250,
    });

    batteryTopicRef.current = batteryTopic;
    diagnosticsTopicRef.current = diagnosticsTopic;

    const handleBattery = (msg: BatteryStateMessage) => {
      setSnapshot((prev) => ({
        ...prev,
        supplyVoltage: Number.isFinite(msg.voltage) ? msg.voltage : prev.supplyVoltage,
        batteryPercent: Number.isFinite(msg.percentage) ? msg.percentage * 100 : prev.batteryPercent,
        updatedAt: Date.now(),
      }));
    };

    const handleDiagnostics = (msg: DiagnosticArrayMessage) => {
      const statuses = msg.status ?? [];
      const drivetrain = statuses.find((status) => status.name.includes('Drivetrain'));
      const control = statuses.find((status) => status.name.includes('Control'));
      const power = statuses.find((status) => status.name.includes('Power'));

      const nextSnapshot: DiagnosticsSnapshot = {
        supplyVoltage: power ? parseNumeric(power.values, 'supply_voltage') : null,
        batteryPercent: power ? parseNumeric(power.values, 'battery_percent') : null,
        motorTempC: drivetrain ? parseNumeric(drivetrain.values, 'motor_temp_c') : null,
        vibrationG: drivetrain ? parseNumeric(drivetrain.values, 'vibration_g') : null,
        jitterMs: control ? parseNumeric(control.values, 'jitter_ms') : null,
        commandAgeMs: control ? parseNumeric(control.values, 'command_age_ms') : null,
        odomAgeMs: control ? parseNumeric(control.values, 'odom_age_ms') : null,
        measuredLinearMps: drivetrain ? parseNumeric(drivetrain.values, 'measured_linear_mps') : null,
        measuredAngularRps: drivetrain ? parseNumeric(drivetrain.values, 'measured_angular_rps') : null,
        targetLinearMps: drivetrain ? parseNumeric(drivetrain.values, 'target_linear_mps') : null,
        targetAngularRps: drivetrain ? parseNumeric(drivetrain.values, 'target_angular_rps') : null,
        worstLevel: statuses.reduce((max, status) => Math.max(max, status.level ?? 0), 0),
        statusMessage: statuses.find((status) => (status.level ?? 0) > 0)?.message ?? 'Nominal',
        updatedAt: Date.now(),
      };

      setSnapshot((prev) => ({
        ...prev,
        ...nextSnapshot,
        supplyVoltage: nextSnapshot.supplyVoltage ?? prev.supplyVoltage,
        batteryPercent: nextSnapshot.batteryPercent ?? prev.batteryPercent,
      }));

      setHistory((prev) => {
        const point: HistoryPoint = {
          t: Date.now(),
          speed: Math.abs(nextSnapshot.measuredLinearMps ?? 0),
          temp: nextSnapshot.motorTempC ?? 0,
        };
        return [...prev.slice(-39), point];
      });
    };

    batteryTopic.subscribe(handleBattery);
    diagnosticsTopic.subscribe(handleDiagnostics);

    return () => {
      try {
        batteryTopic.unsubscribe();
      } catch {
        // ignore
      }
      try {
        diagnosticsTopic.unsubscribe();
      } catch {
        // ignore
      }
      batteryTopicRef.current = null;
      diagnosticsTopicRef.current = null;
    };
  }, [connected]);

  const freshnessMs = useMemo(() => {
    if (!snapshot.updatedAt) return null;
    return Date.now() - snapshot.updatedAt;
  }, [snapshot.updatedAt, history]);

  return {
    ...snapshot,
    history,
    freshnessMs,
  };
}
