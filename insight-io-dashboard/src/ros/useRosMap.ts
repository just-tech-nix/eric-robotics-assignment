import { useState, useEffect, useRef } from 'react';
import { Topic } from 'roslib';
import { getRos } from './rosClient';
import { useRosConnection } from './useRosConnection';

/** Parsed map data returned by the hook */
export interface MapData {
  /** Flat array of occupancy values (-1 = unknown, 0–100 = probability) */
  data: number[];
  /** Map width in cells */
  width: number;
  /** Map height in cells */
  height: number;
  /** Cell resolution in meters/cell */
  resolution: number;
  /** Origin position in world coordinates */
  origin: { x: number; y: number };
}

export interface RosMapState {
  /** Parsed occupancy grid data, or null if no map received yet */
  mapData: MapData | null;
  /** Timestamp (ms since epoch) of the last map update */
  lastUpdate: number;
}

/** nav_msgs/msg/OccupancyGrid message shape (relevant fields) */
interface OccupancyGridMessage {
  info: {
    width: number;
    height: number;
    resolution: number;
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[];
}

/**
 * Hook that subscribes to the SLAM map on `/map` (nav_msgs/msg/OccupancyGrid).
 *
 * - Throttles to 1Hz (1000ms) since maps update slowly
 * - Parses width, height, resolution, origin, and occupancy data
 * - Cleans up subscription on unmount
 */
export function useRosMap(): RosMapState {
  const { connected } = useRosConnection();
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const topicRef = useRef<Topic<OccupancyGridMessage> | null>(null);

  useEffect(() => {
    if (!connected) return;

    const ros = getRos();
    const topic = new Topic<OccupancyGridMessage>({
      ros,
      name: '/map',
      messageType: 'nav_msgs/msg/OccupancyGrid',
      throttle_rate: 1000, // 1 Hz
    });
    topicRef.current = topic;

    const handleMessage = (msg: OccupancyGridMessage) => {
      setMapData({
        data: msg.data,
        width: msg.info.width,
        height: msg.info.height,
        resolution: msg.info.resolution,
        origin: {
          x: msg.info.origin.position.x,
          y: msg.info.origin.position.y,
        },
      });
      setLastUpdate(Date.now());
    };

    try {
      topic.subscribe(handleMessage);
    } catch (err) {
      console.warn('Failed to subscribe to /map:', err);
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

  return { mapData, lastUpdate };
}
