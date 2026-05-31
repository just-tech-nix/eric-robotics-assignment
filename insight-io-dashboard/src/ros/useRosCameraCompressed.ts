import { useState, useEffect, useRef, useCallback } from 'react';
import { Topic } from 'roslib';
import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

/** sensor_msgs/msg/CompressedImage message shape */
interface CompressedImageMessage {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  format: string;
  data: string; // base64-encoded image data from rosbridge
}

export interface RosCameraCompressedState {
  /** Base64 data URL for the latest camera frame, or null if no data */
  imageDataUrl: string | null;
  /** Rolling average frames per second */
  fps: number;
}

/** Number of frame timestamps to keep for rolling FPS calculation */
const FPS_WINDOW_SIZE = 30;

/**
 * Hook that subscribes to compressed camera images on
 * `/camera/image/compressed` (sensor_msgs/msg/CompressedImage).
 *
 * - Throttles to 10Hz (100ms)
 * - Converts base64 data to a data URL for direct use in <img> elements
 * - Tracks FPS with a rolling window
 * - Cleans up subscription on unmount
 */
export function useRosCameraCompressed(): RosCameraCompressedState {
  const { connected } = useRosConnection();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const topicRef = useRef<Topic<CompressedImageMessage> | null>(null);
  const frameTimestampsRef = useRef<number[]>([]);

  const calculateFps = useCallback(() => {
    const timestamps = frameTimestampsRef.current;
    if (timestamps.length < 2) return 0;
    const oldest = timestamps[0];
    const newest = timestamps[timestamps.length - 1];
    const elapsed = (newest - oldest) / 1000; // seconds
    if (elapsed <= 0) return 0;
    return (timestamps.length - 1) / elapsed;
  }, []);

  useEffect(() => {
    if (!connected) return;

    const ros = getRos();
    const topic = new Topic<CompressedImageMessage>({
      ros,
      name: '/camera/image/compressed',
      messageType: 'sensor_msgs/msg/CompressedImage',
      throttle_rate: 100, // 10 Hz
    });
    topicRef.current = topic;

    const handleMessage = (msg: CompressedImageMessage) => {
      // Determine MIME type from format field, default to jpeg
      const format = msg.format?.toLowerCase() || 'jpeg';
      const mime = format.includes('png') ? 'image/png' : 'image/jpeg';

      setImageDataUrl(`data:${mime};base64,${msg.data}`);

      // Track frame timestamps for FPS calculation
      const now = performance.now();
      const timestamps = frameTimestampsRef.current;
      timestamps.push(now);
      if (timestamps.length > FPS_WINDOW_SIZE) {
        timestamps.shift();
      }
      setFps(Math.round(calculateFps()));
    };

    try {
      topic.subscribe(handleMessage);
    } catch (err) {
      console.warn('Failed to subscribe to /camera/image/compressed:', err);
    }

    return () => {
      try {
        topic.unsubscribe();
      } catch (err) {
        // Ignore unsubscribe errors
      }
      topicRef.current = null;
      frameTimestampsRef.current = [];
    };
  }, [connected, calculateFps]);

  return { imageDataUrl, fps };
}
