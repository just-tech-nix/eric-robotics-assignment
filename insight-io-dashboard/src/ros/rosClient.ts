import { Ros } from 'roslib';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
const locationHost = typeof window !== 'undefined' ? window.location.host : 'localhost:5173';
// Same-origin WebSocket proxy works for desktop and phone access without hardcoded localhost ports.
const fallbackRosUrl = `${wsProtocol}://${locationHost}/rosbridge`;
const ROS_URL = (_win && typeof _win.__ROS_URL__ === 'string') ? _win.__ROS_URL__ : fallbackRosUrl;

let instance: Ros | null = null;
let connectingPromise: Promise<void> | null = null;

/**
 * Returns a singleton ROS connection instance.
 * Creates one on first call using the configured WebSocket URL.
 */
export function getRos(): Ros {
  if (!instance) {
    instance = new Ros();

    // Override connect to make it safe from concurrent calls and race conditions
    const originalConnect = instance.connect.bind(instance);
    instance.connect = function (url: string) {
      if (connectingPromise) {
        return connectingPromise;
      }
      connectingPromise = originalConnect(url).finally(() => {
        connectingPromise = null;
      });
      return connectingPromise;
    } as unknown as typeof instance.connect;

    // Start initial connection attempt
    instance.connect(ROS_URL).catch((err) => {
      console.warn('Initial ROS connection failed (normal if backend not running yet):', err);
    });
  }
  return instance;
}

/**
 * Returns the WebSocket URL used for the ROS bridge connection.
 */
export function getRosUrl(): string {
  return ROS_URL;
}

