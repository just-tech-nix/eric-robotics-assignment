import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import type { MissionEvent, TelemetryFrame } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useMissionReplay(telemetry: TelemetryFrame[], events: MissionEvent[]) {
  const duration = telemetry.at(-1)?.timestamp ?? 10_000;
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(events[0]?.id ?? null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const deferredTime = useDeferredValue(currentTime);

  useEffect(() => {
    if (!telemetry.length) {
      return;
    }

    startTransition(() => {
      setCurrentTime((time) => clamp(time, telemetry[0].timestamp, duration));
      setHighlightedEventId((current) => current ?? events[0]?.id ?? null);
    });
  }, [duration, events, telemetry]);

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    lastTickRef.current = null;
  }, []);

  useEffect(() => {
    if (!isPlaying || telemetry.length === 0) {
      stopAnimation();
      return;
    }

    const tick = (now: number) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
      }

      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      setCurrentTime((previous) => {
        const next = previous + delta;
        return next >= duration ? telemetry[0]?.timestamp ?? 0 : next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopAnimation;
  }, [duration, isPlaying, stopAnimation, telemetry]);

  const currentFrame = useMemo(() => {
    if (!telemetry.length) {
      return null;
    }

    const safeTime = clamp(deferredTime, telemetry[0].timestamp, duration);
    for (let index = telemetry.length - 1; index >= 0; index -= 1) {
      if (telemetry[index].timestamp <= safeTime) {
        return telemetry[index];
      }
    }

    return telemetry[0];
  }, [deferredTime, duration, telemetry]);

  const currentEventIndex = useMemo(() => {
    const resolvedIndex = events.findIndex((event) => event.id === highlightedEventId);
    if (resolvedIndex >= 0) {
      return resolvedIndex;
    }

    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].timestamp <= deferredTime) {
        return index;
      }
    }

    return 0;
  }, [deferredTime, events, highlightedEventId]);

  const seekTo = useCallback((timestamp: number, eventId?: string) => {
    startTransition(() => {
      setCurrentTime(clamp(timestamp, telemetry[0]?.timestamp ?? 0, duration));
      if (eventId) {
        setHighlightedEventId(eventId);
      }
    });
  }, [duration, telemetry]);

  const jumpToEvent = useCallback((index: number) => {
    if (!events.length) {
      return;
    }

    const boundedIndex = clamp(index, 0, events.length - 1);
    const event = events[boundedIndex];
    seekTo(event.seekTime ?? event.timestamp, event.id);
  }, [events, seekTo]);

  const togglePlayback = useCallback(() => {
    setIsPlaying((playing) => !playing);
  }, []);

  return {
    currentEventIndex,
    currentFrame,
    currentTime,
    duration,
    highlightedEventId,
    isPlaying,
    jumpToEvent,
    seekTo,
    setHighlightedEventId,
    setIsPlaying,
    togglePlayback,
  };
}
