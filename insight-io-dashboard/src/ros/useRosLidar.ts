import { useState, useEffect, useRef } from 'react';
import { Topic } from 'roslib';
import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

/** sensor_msgs/msg/LaserScan message shape (relevant fields) */
interface LaserScanMessage {
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  range_min: number;
  range_max: number;
  ranges: number[];
  intensities?: number[];
}

export interface RosLidarState {
  /** Flat Float32Array of 3D points [x1,y1,z1, x2,y2,z2, ...], or null if no data */
  points: Float32Array | null;
  /** Number of valid points in the current scan */
  pointCount: number;
}

/**
 * Convert a LaserScan message into a Float32Array of 3D points.
 * Each valid range produces [x, y, z=0] in the sensor frame.
 */
function laserScanToPoints(msg: LaserScanMessage): { points: Float32Array; count: number } {
  const { ranges, angle_min, angle_increment, range_min, range_max } = msg;

  // First pass: count valid ranges to allocate exact buffer size
  let validCount = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r >= range_min && r <= range_max && Number.isFinite(r)) {
      validCount++;
    }
  }

  const buffer = new Float32Array(validCount * 3);
  let idx = 0;

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r >= range_min && r <= range_max && Number.isFinite(r)) {
      const angle = angle_min + i * angle_increment;
      buffer[idx++] = r * Math.cos(angle); // x
      buffer[idx++] = r * Math.sin(angle); // y
      buffer[idx++] = 0;                   // z (2D scan)
    }
  }

  return { points: buffer, count: validCount };
}

/**
 * Hook that subscribes to LiDAR scan data on `/scan` (sensor_msgs/msg/LaserScan).
 *
 * - Throttles to 5Hz (200ms)
 * - Converts polar LaserScan ranges to Cartesian 3D points
 * - Returns a compact Float32Array for efficient rendering
 * - Cleans up subscription on unmount
 */
export function useRosLidar(): RosLidarState {
  const { connected } = useRosConnection();
  const [points, setPoints] = useState<Float32Array | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const topicRef = useRef<Topic<LaserScanMessage> | null>(null);

  useEffect(() => {
    if (!connected) return;

    const ros = getRos();
    const topic = new Topic<LaserScanMessage>({
      ros,
      name: '/scan',
      messageType: 'sensor_msgs/msg/LaserScan',
      throttle_rate: 200, // 5 Hz
    });
    topicRef.current = topic;

    const handleMessage = (msg: LaserScanMessage) => {
      const result = laserScanToPoints(msg);
      setPoints(result.points);
      setPointCount(result.count);
    };

    try {
      topic.subscribe(handleMessage);
    } catch (err) {
      console.warn('Failed to subscribe to /scan:', err);
    }

    return () => {
      try {
        topic.unsubscribe();
      } catch (err) {
        // Ignore unsubscribe errors
      }
      topicRef.current = null;
    };
  }, [connected]);

  return { points, pointCount };
}
