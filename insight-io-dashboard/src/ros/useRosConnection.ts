import { useState, useEffect, useCallback, useRef } from 'react';
import { getRos, getRosUrl } from './rosClient';
import type { TransportEvent } from 'roslib';

export interface RosConnectionState {
  /** Whether the ROS bridge WebSocket is currently connected */
  connected: boolean;
  /** Last error message, or null if no error */
  error: string | null;
  /** The WebSocket URL being used */
  url: string;
  /** Force a reconnection attempt */
  reconnect: () => void;
}

/**
 * Hook that manages the ROS WebSocket connection lifecycle.
 *
 * - Auto-connects on mount
 * - Listens for 'connection', 'close', and 'error' events
 * - Auto-reconnects after 3 seconds on disconnect
 * - Cleans up listeners on unmount
 */
export function useRosConnection(): RosConnectionState {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    clearReconnectTimer();
    const ros = getRos();
    setError(null);
    ros.connect(getRosUrl());
  }, [clearReconnectTimer]);

  useEffect(() => {
    mountedRef.current = true;
    const ros = getRos();

    const onConnection = (_event: TransportEvent) => {
      if (!mountedRef.current) return;
      setConnected(true);
      setError(null);
      clearReconnectTimer();
    };

    const onClose = (_event: TransportEvent) => {
      if (!mountedRef.current) return;
      setConnected(false);
      // Schedule auto-reconnect after 3 seconds
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          ros.connect(getRosUrl());
        }
      }, 3000);
    };

    const onError = (event: TransportEvent) => {
      if (!mountedRef.current) return;
      setConnected(false);
      const message =
        event instanceof ErrorEvent ? event.message : 'ROS connection error';
      setError(message);
    };

    ros.on('connection', onConnection);
    ros.on('close', onClose);
    ros.on('error', onError);

    // If already connected, reflect that immediately
    if (ros.isConnected) {
      setConnected(true);
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      ros.off('connection', onConnection);
      ros.off('close', onClose);
      ros.off('error', onError);
    };
  }, [clearReconnectTimer]);

  return {
    connected,
    error,
    url: getRosUrl(),
    reconnect,
  };
}
