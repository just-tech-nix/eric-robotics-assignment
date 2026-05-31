import { useState, useEffect, useRef } from 'react';
import { Topic } from 'roslib';
import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

/** Quaternion orientation */
interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 3D position */
interface Position {
  x: number;
  y: number;
  z: number;
}

/** nav_msgs/msg/Odometry message shape (relevant fields) */
interface OdometryMessage {
  pose: {
    pose: {
      position: Position;
      orientation: Quaternion;
    };
  };
  twist: {
    twist: {
      linear: { x: number; y: number; z: number };
      angular: { x: number; y: number; z: number };
    };
  };
}

export interface RosOdometryState {
  /** Current position or null if no data received yet */
  position: Position | null;
  /** Current orientation quaternion or null if no data received yet */
  orientation: Quaternion | null;
  /** Magnitude of linear velocity (m/s) */
  linearSpeed: number;
  /** Magnitude of angular velocity (rad/s) */
  angularSpeed: number;
  /** Heading angle in degrees (yaw extracted from quaternion) */
  heading: number;
  /** Whether the ROS connection is active */
  connected: boolean;
}

/**
 * Convert a quaternion to heading (yaw) in degrees.
 * Uses the standard atan2 formula for extracting yaw from a quaternion.
 */
function quaternionToHeadingDeg(q: Quaternion): number {
  const siny_cosp = 2.0 * (q.w * q.z + q.x * q.y);
  const cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
  const yawRad = Math.atan2(siny_cosp, cosy_cosp);
  return (yawRad * 180) / Math.PI;
}

/**
 * Hook that subscribes to `/odom` (nav_msgs/msg/Odometry).
 *
 * - Converts quaternion to heading in degrees
 * - Throttles updates to 10Hz (100ms)
 * - Cleans up subscription on unmount
 */
export function useRosOdometry(): RosOdometryState {
  const { connected } = useRosConnection();
  const [position, setPosition] = useState<Position | null>(null);
  const [orientation, setOrientation] = useState<Quaternion | null>(null);
  const [linearSpeed, setLinearSpeed] = useState(0);
  const [angularSpeed, setAngularSpeed] = useState(0);
  const [heading, setHeading] = useState(0);
  const topicRef = useRef<Topic<OdometryMessage> | null>(null);

  useEffect(() => {
    if (!connected) return;

    const ros = getRos();
    const topic = new Topic<OdometryMessage>({
      ros,
      name: '/odom',
      messageType: 'nav_msgs/msg/Odometry',
      throttle_rate: 100, // 10 Hz
    });
    topicRef.current = topic;

    const handleMessage = (msg: OdometryMessage) => {
      const pos = msg.pose.pose.position;
      const orient = msg.pose.pose.orientation;
      const lin = msg.twist.twist.linear;
      const ang = msg.twist.twist.angular;

      setPosition({ x: pos.x, y: pos.y, z: pos.z });
      setOrientation({ x: orient.x, y: orient.y, z: orient.z, w: orient.w });
      setLinearSpeed(Math.sqrt(lin.x * lin.x + lin.y * lin.y + lin.z * lin.z));
      setAngularSpeed(Math.abs(ang.z));
      setHeading(quaternionToHeadingDeg(orient));
    };

    try {
      topic.subscribe(handleMessage);
    } catch (err) {
      console.warn('Failed to subscribe to /odom:', err);
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

  return { position, orientation, linearSpeed, angularSpeed, heading, connected };
}
