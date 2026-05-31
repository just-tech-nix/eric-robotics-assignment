import { useEffect, useRef } from 'react';

import type { MapData } from '../ros/useRosMap';
import { useResetMap } from '../ros/index';

type WorldBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

type OccupancyMapPanelProps = {
  mapData: MapData | null;
  robotPose: { x: number; y: number; headingDeg: number } | null;
  className?: string;
  stableBounds?: WorldBounds;
};

function drawRobot(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  headingDeg: number,
  scalePx: number,
) {
  const angle = (headingDeg * Math.PI) / 180;
  const bodyLength = Math.max(14, scalePx * 1.4);
  const bodyWidth = Math.max(10, scalePx * 0.95);
  const wheelWidth = Math.max(3, scalePx * 0.18);
  const sensorReach = bodyLength * 2.9;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-angle);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bodyLength * 0.3, 0);
  ctx.arc(0, 0, sensorReach, -0.48, 0.48, false);
  ctx.stroke();

  ctx.fillStyle = 'rgba(8, 17, 31, 0.92)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-bodyLength * 0.55, -bodyWidth * 0.55, bodyLength * 1.1, bodyWidth * 1.1, bodyWidth * 0.34);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-bodyLength * 0.62, -bodyWidth * 0.64, wheelWidth, bodyWidth * 1.28);
  ctx.fillRect(bodyLength * 0.62 - wheelWidth, -bodyWidth * 0.64, wheelWidth, bodyWidth * 1.28);

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(bodyLength * 0.62, 0);
  ctx.lineTo(bodyLength * 0.22, bodyWidth * 0.28);
  ctx.lineTo(bodyLength * 0.22, -bodyWidth * 0.28);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(-bodyLength * 0.08, 0, Math.max(2.5, scalePx * 0.2), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(sensorReach * 0.68, 0);
  ctx.stroke();

  ctx.restore();
}

export function OccupancyMapPanel({ mapData, robotPose, className, stableBounds }: OccupancyMapPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapImageRef = useRef<HTMLCanvasElement | null>(null);

  // Generate map image whenever mapData changes
  useEffect(() => {
    if (!mapData || mapData.width <= 0 || mapData.height <= 0) {
      mapImageRef.current = null;
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = mapData.width;
    offscreen.height = mapData.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const image = offCtx.createImageData(mapData.width, mapData.height);
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const srcIdx = x + (mapData.height - 1 - y) * mapData.width;
        const value = mapData.data[srcIdx] ?? -1;
        const dstIdx = (y * mapData.width + x) * 4;

        let r = 0;
        let g = 0;
        let b = 0;

        if (value < 0) {
          // unknown: dark gray
          r = 85; g = 85; b = 85;
        } else {
          // occupancy: 0 (free) -> white, 100 (occupied) -> black
          const intensity = Math.round(255 * (1 - value / 100));
          r = intensity;
          g = intensity;
          b = intensity;
        }

        image.data[dstIdx] = r;
        image.data[dstIdx + 1] = g;
        image.data[dstIdx + 2] = b;
        image.data[dstIdx + 3] = 255;
      }
    }

    offCtx.putImageData(image, 0, 0);
    mapImageRef.current = offscreen;
  }, [mapData]);

  // Resize canvas and render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = '#08111f';
    ctx.fillRect(0, 0, width, height);

    if (!mapData || mapData.width <= 0 || mapData.height <= 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.fillText('Waiting for SLAM map...', 24, 36);
      ctx.font = '500 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
      ctx.fillText('Drive the robot in MANUAL mode to build occupancy.', 24, 60);
      return;
    }

    const padding = 24;
    const worldMinX = stableBounds?.minX ?? mapData.origin.x;
    const worldMinY = stableBounds?.minY ?? mapData.origin.y;
    const worldWidth = stableBounds?.width ?? mapData.width * mapData.resolution;
    const worldHeight = stableBounds?.height ?? mapData.height * mapData.resolution;
    const usableW = width - padding * 2;
    const usableH = height - padding * 2;
    const scale = Math.min(usableW / worldWidth, usableH / worldHeight);
    const drawW = worldWidth * scale;
    const drawH = worldHeight * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    const mapWorldWidth = mapData.width * mapData.resolution;
    const mapWorldHeight = mapData.height * mapData.resolution;
    const mapOffsetX = offsetX + (mapData.origin.x - worldMinX) * scale;
    const mapOffsetY = offsetY + drawH - (mapData.origin.y - worldMinY + mapWorldHeight) * scale;
    const mapDrawW = mapWorldWidth * scale;
    const mapDrawH = mapWorldHeight * scale;

    if (mapImageRef.current) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mapImageRef.current, mapOffsetX, mapOffsetY, mapDrawW, mapDrawH);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(offsetX, offsetY, drawW, drawH);

    for (let i = 1; i < 5; i++) {
      const gx = offsetX + (drawW * i) / 5;
      const gy = offsetY + (drawH * i) / 5;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, offsetY);
      ctx.lineTo(gx, offsetY + drawH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offsetX, gy);
      ctx.lineTo(offsetX + drawW, gy);
      ctx.stroke();
    }

    if (robotPose) {
      const px = offsetX + (robotPose.x - worldMinX) * scale;
      const py = offsetY + drawH - (robotPose.y - worldMinY) * scale;
      if (Number.isFinite(px) && Number.isFinite(py)) {
        drawRobot(ctx, px, py, robotPose.headingDeg, Math.max(10, scale * 0.45));
      }
    }

    ctx.fillStyle = 'rgba(8, 17, 31, 0.82)';
    ctx.fillRect(18, 16, 320, 68);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.strokeRect(18, 16, 320, 68);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.fillText('SLAM OCCUPANCY MAP', 32, 38);
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${mapData.width}×${mapData.height} cells  •  ${mapData.resolution.toFixed(2)} m/cell`, 32, 58);
    ctx.fillText('Stable world frame render with robot pose overlay', 32, 76);
  }, [mapData, robotPose, stableBounds]);

  const { reset, resetPending } = useResetMap();

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 24 }}
      />
      {/* Reset Map Button */}
      <button
        onClick={reset}
        disabled={resetPending}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          padding: '6px 10px',
          background: resetPending ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.16)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 6,
          color: '#e2e8f0',
          fontSize: '12px',
          cursor: resetPending ? 'not-allowed' : 'pointer',
          zIndex: 10,
        }}
      >
        {resetPending ? 'Resetting…' : 'Reset Map'}
      </button>
    </div>
  );
}