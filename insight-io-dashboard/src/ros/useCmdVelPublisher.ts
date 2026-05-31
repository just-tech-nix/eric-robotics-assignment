import { useCallback, useEffect, useRef } from 'react';
import { Topic } from 'roslib';
import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

/** ROS 2 geometry_msgs/msg/Twist message shape */
interface TwistMessage {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

export interface CmdVelPublisher {
  /** Publish a velocity command (linear.x in m/s, angular.z in rad/s) */
  publish: (linearX: number, angularZ: number) => void;
  /** Send zero velocity (emergency stop) */
  stop: () => void;
}

/** Deadman timeout in milliseconds — auto-sends zero if no publish call within this window */
const DEADMAN_TIMEOUT_MS = 300;

/**
 * Hook that publishes velocity commands on `/cmd_vel`.
 *
 * - Creates a ROSLIB.Topic for `/cmd_vel` (geometry_msgs/msg/Twist)
 * - Includes a deadman timer: if no `publish()` call for 300ms, auto-sends zero
 * - Only creates the topic when the ROS connection is available
 */
export function useCmdVelPublisher(): CmdVelPublisher {
  const { connected } = useRosConnection();
  const topicRef = useRef<Topic<TwistMessage> | null>(null);
  const deadmanRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create / tear down topic based on connection state
  useEffect(() => {
    if (connected) {
      const ros = getRos();
      topicRef.current = new Topic<TwistMessage>({
        ros,
        name: '/cmd_vel',
        messageType: 'geometry_msgs/msg/Twist',
      });
      try {
        topicRef.current.advertise();
      } catch (err) {
        console.warn('Failed to advertise topic /cmd_vel:', err);
      }
    }

    return () => {
      if (deadmanRef.current !== null) {
        clearTimeout(deadmanRef.current);
        deadmanRef.current = null;
      }
      if (topicRef.current) {
        try {
          topicRef.current.unadvertise();
        } catch (err) {
          // Ignore unadvertise errors when disconnecting/unmounting
        }
        topicRef.current = null;
      }
    };
  }, [connected]);

  const sendTwist = useCallback((linearX: number, angularZ: number) => {
    if (!topicRef.current) return;
    const msg: TwistMessage = {
      linear: { x: linearX, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angularZ },
    };
    try {
      topicRef.current.publish(msg);
    } catch (err) {
      console.warn('Failed to publish command on /cmd_vel:', err);
    }
  }, []);

  const resetDeadman = useCallback(() => {
    if (deadmanRef.current !== null) {
      clearTimeout(deadmanRef.current);
    }
    deadmanRef.current = setTimeout(() => {
      sendTwist(0, 0);
    }, DEADMAN_TIMEOUT_MS);
  }, [sendTwist]);

  const publish = useCallback(
    (linearX: number, angularZ: number) => {
      sendTwist(linearX, angularZ);
      resetDeadman();
    },
    [sendTwist, resetDeadman],
  );

  const stop = useCallback(() => {
    if (deadmanRef.current !== null) {
      clearTimeout(deadmanRef.current);
      deadmanRef.current = null;
    }
    sendTwist(0, 0);
  }, [sendTwist]);

  return { publish, stop };
}
