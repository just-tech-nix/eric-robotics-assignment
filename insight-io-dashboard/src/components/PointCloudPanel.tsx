import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';

import type { ViewerControlsState } from '../types';

type PointCloudPanelProps = {
  assetPath: string;
  className?: string;
  controlsState: ViewerControlsState;
  visible: boolean;
  isEStopActive?: boolean;
  hideHeader?: boolean;
  zoomLevel?: number;
  robotPos?: { x: number; y: number };
  /** Live LiDAR points from ROS (flat Float32Array of x,y,z triples) */
  livePoints?: Float32Array | null;
  /** Number of live points (livePoints.length / 3) */
  livePointCount?: number;
};

type SceneBundle = {
  camera: THREE.PerspectiveCamera;
  cloud: THREE.Points | null;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  resizeObserver: ResizeObserver;
  scene: THREE.Scene;
};

const backgrounds: Record<ViewerControlsState['colorPreset'], string> = {
  amber: '#160d07',
  ice: '#07131b',
  signal: '#08111f',
};

const colors: Record<ViewerControlsState['colorPreset'], string> = {
  amber: '#ffb45c',
  ice: '#7ce6ff',
  signal: '#7cff9d',
};

function framePointCloud(camera: THREE.PerspectiveCamera, controls: OrbitControls, cloud: THREE.Points) {
  const box = new THREE.Box3().setFromObject(cloud);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance = maxSize / Math.tan(halfFov);

  camera.position.set(center.x + distance * 0.8, center.y + distance * 0.45, center.z + distance * 0.65);
  camera.near = Math.max(maxSize / 100, 0.01);
  camera.far = maxSize * 40;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function applyPreset(
  bundle: SceneBundle,
  controlsState: ViewerControlsState,
  isEStopActive?: boolean,
  zoomLevel: number = 2,
  scanPlane?: THREE.Mesh | null,
  gridHelper?: THREE.GridHelper | null
) {
  const activeColor = isEStopActive ? '#ff4d5a' : colors[controlsState.colorPreset];
  const activeBg = isEStopActive ? '#1f0608' : backgrounds[controlsState.colorPreset];
  bundle.scene.background = new THREE.Color(activeBg);

  if (bundle.cloud) {
    const material = bundle.cloud.material as THREE.PointsMaterial;
    material.size = controlsState.pointSize;
    material.vertexColors = false;
    material.color = new THREE.Color(activeColor);
  }

  if (scanPlane) {
    const mat = scanPlane.material as THREE.MeshBasicMaterial;
    mat.color = new THREE.Color(activeColor);
  }

  if (gridHelper) {
    const gridMat = gridHelper.material as any;
    if (gridMat && gridMat.color) {
      gridMat.color.set(activeColor);
    }
  }

  // Calculate zoom multiplier: zoomLevel ranges from 1 to 5.
  const zoomFactor = 1.8 - (zoomLevel - 1) * 0.35;

  switch (controlsState.cameraPreset) {
    case 'top':
      bundle.camera.position.set(
        bundle.controls.target.x,
        bundle.controls.target.y + 2.8 * zoomFactor,
        bundle.controls.target.z + 0.15 * zoomFactor
      );
      break;
    case 'profile':
      bundle.camera.position.set(
        bundle.controls.target.x + 2.2 * zoomFactor,
        bundle.controls.target.y + 0.6 * zoomFactor,
        bundle.controls.target.z + 0.2 * zoomFactor
      );
      break;
    default: {
      const box = new THREE.Box3().setFromObject(bundle.cloud || new THREE.Object3D());
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxSize = Math.max(size.x, size.y, size.z);
      const halfFov = THREE.MathUtils.degToRad(bundle.camera.fov / 2);
      const distance = (maxSize / Math.tan(halfFov)) * zoomFactor;

      bundle.camera.position.set(
        center.x + distance * 0.8,
        center.y + distance * 0.45,
        center.z + distance * 0.65
      );
      bundle.camera.near = Math.max(maxSize / 100, 0.01);
      bundle.camera.far = maxSize * 40;
      bundle.camera.lookAt(center);
      bundle.camera.updateProjectionMatrix();
      bundle.controls.target.copy(center);
      break;
    }
  }

  bundle.camera.lookAt(bundle.controls.target);
  bundle.controls.update();
}

export function PointCloudPanel({
  assetPath,
  className,
  controlsState,
  visible,
  isEStopActive,
  hideHeader,
  zoomLevel = 2,
  robotPos,
  livePoints,
  livePointCount,
}: PointCloudPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneBundle | null>(null);
  const frameRef = useRef<number | null>(null);
  const controlsStateRef = useRef(controlsState);
  const isEStopActiveRef = useRef(isEStopActive);
  const zoomLevelRef = useRef(zoomLevel);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const groupRef = useRef<THREE.Group | null>(null);
  const scanPlaneRef = useRef<THREE.Mesh | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const cloudBoxRef = useRef<THREE.Box3 | null>(null);
  const needsRenderRef = useRef(true);

  const requestRender = () => {
    needsRenderRef.current = true;
  };

  // Track whether we're using live data
  const isLiveMode = !!(livePoints && livePointCount && livePointCount > 0);

  // Ref for the live points geometry so we can update it efficiently
  const liveCloudRef = useRef<THREE.Points | null>(null);

  const statusLabel = useMemo(() => {
    if (status === 'loading' && !isLiveMode) {
      return 'Loading lidar cloud';
    }
    if (status === 'error' && !isLiveMode) {
      return 'Cloud unavailable';
    }
    if (isLiveMode) {
      return isEStopActive ? 'LiDAR lockdown (LIVE)' : `LiDAR live (${livePointCount} pts)`;
    }
    return isEStopActive ? 'Point cloud lockdown' : 'Point cloud live';
  }, [status, isEStopActive, isLiveMode, livePointCount]);

  useEffect(() => {
    controlsStateRef.current = controlsState;
  }, [controlsState]);

  useEffect(() => {
    isEStopActiveRef.current = isEStopActive;
  }, [isEStopActive]);

  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // Keep the visual reference grid stable. Robot motion is represented by ROS map/pose,
  // not by sliding the entire floor under the operator.
  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.position.x = 0;
      gridHelperRef.current.position.z = 0;
    }
    requestRender();
  }, [robotPos]);

  // Update live point cloud data when new points arrive
  useEffect(() => {
    const bundle = sceneRef.current;
    if (!bundle || !isLiveMode || !livePoints) return;

    if (!liveCloudRef.current) {
      // Create a new Points object for live data
      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.Float32BufferAttribute(livePoints, 3);
      geometry.setAttribute('position', posAttr);
      geometry.computeBoundingSphere();

      const material = new THREE.PointsMaterial({
        size: controlsStateRef.current.pointSize,
        sizeAttenuation: true,
        color: new THREE.Color(
          isEStopActiveRef.current ? '#ff4d5a' : colors[controlsStateRef.current.colorPreset]
        ),
      });

      const points = new THREE.Points(geometry, material);
      bundle.scene.add(points);
      liveCloudRef.current = points;
      bundle.cloud = points;

      // Frame the camera on initial live data
      if (livePointCount! > 10) {
        const box = new THREE.Box3().setFromObject(points);
        cloudBoxRef.current = box;
      }

      requestRender();
      setStatus('ready');
    } else {
      // Update existing geometry with new points
      const geometry = liveCloudRef.current.geometry;
      const posAttr = geometry.getAttribute('position') as THREE.Float32BufferAttribute;

      if (posAttr.array.length !== livePoints.length) {
        // Point count changed, need new attribute
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(livePoints, 3));
      } else {
        // Same count, just update data
        (posAttr.array as Float32Array).set(livePoints);
        posAttr.needsUpdate = true;
      }
      geometry.computeBoundingSphere();
      bundle.cloud = liveCloudRef.current;
    }
    requestRender();
  }, [livePoints, livePointCount, isLiveMode]);

  // Initialize the Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.4;
    controls.maxDistance = 12;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.addEventListener('change', requestRender);

    const ambient = new THREE.AmbientLight('#d5efff', 1.2);
    const point = new THREE.PointLight('#f5fbff', 1.8, 12);
    point.position.set(2, 2, 2);
    scene.add(ambient, point);

    const resizeObserver = new ResizeObserver(() => {
      if (!container) {
        return;
      }
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight, false);
      requestRender();
    });

    resizeObserver.observe(container);

    const bundle: SceneBundle = {
      camera,
      cloud: null,
      controls,
      renderer,
      resizeObserver,
      scene,
    };

    sceneRef.current = bundle;
    scene.background = new THREE.Color(isEStopActiveRef.current ? '#1f0608' : backgrounds.signal);

    // Add Ground Grid Helper
    const gridHelper = new THREE.GridHelper(50, 50, colors.signal, colors.signal);
    gridHelper.position.y = -0.05;
    const gridMat = gridHelper.material as THREE.LineBasicMaterial;
    gridMat.vertexColors = false;
    gridMat.transparent = true;
    gridMat.opacity = 0.22;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Add Dynamic LiDAR Scan Plane
    const scanPlaneGeo = new THREE.RingGeometry(0.1, 18, 64);
    const scanPlaneMat = new THREE.MeshBasicMaterial({
      color: colors[controlsStateRef.current.colorPreset] || colors.signal,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide
    });
    const scanPlane = new THREE.Mesh(scanPlaneGeo, scanPlaneMat);
    scanPlane.rotation.x = Math.PI / 2;
    scanPlane.position.y = 0;
    scene.add(scanPlane);
    scanPlaneRef.current = scanPlane;

    // Load static PCD file as fallback (only if no live data provided)
    if (!isLiveMode) {
      const loader = new PCDLoader();
      loader.load(
        assetPath,
        (points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>) => {
          points.rotation.x = -Math.PI / 2;
          points.rotation.z = Math.PI * 0.08;

          const group = new THREE.Group();
          group.add(points);
          scene.add(group);
          bundle.cloud = points;
          groupRef.current = group;

          const box = new THREE.Box3().setFromObject(points);
          cloudBoxRef.current = box;
          const minY = box.min.y;

          gridHelper.position.y = minY - 0.05;
          scanPlane.position.y = minY;

          if (robotPos && gridHelper) {
            gridHelper.position.x = -(robotPos.x % 1.0);
            gridHelper.position.z = -(robotPos.y % 1.0);
          }

          framePointCloud(camera, controls, points);
          applyPreset(bundle, controlsStateRef.current, isEStopActiveRef.current, zoomLevelRef.current, scanPlane, gridHelper);
          requestRender();
          setStatus('ready');
        },
        undefined,
        () => setStatus('error'),
      );
    } else {
      // In live mode, set initial camera position
      camera.position.set(15, 12, 15);
      controls.target.set(0, 0, 0);
      controls.update();
      requestRender();
      setStatus('ready');
    }

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      renderer.dispose();
      scene.clear();
      renderer.domElement.remove();
      sceneRef.current = null;
      groupRef.current = null;
      liveCloudRef.current = null;
      scanPlaneRef.current = null;
      gridHelperRef.current = null;
      cloudBoxRef.current = null;
    };
  }, [assetPath]);

  useEffect(() => {
    const bundle = sceneRef.current;
    if (!bundle) {
      return;
    }

    applyPreset(bundle, controlsState, isEStopActive, zoomLevel, scanPlaneRef.current, gridHelperRef.current);
    requestRender();
  }, [controlsState, isEStopActive, zoomLevel]);

  useEffect(() => {
    const bundle = sceneRef.current;
    if (!bundle || !visible) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    const renderFrame = () => {
      if (bundle.controls) {
        bundle.controls.autoRotate = false;
      }

      if (scanPlaneRef.current && cloudBoxRef.current) {
        const box = cloudBoxRef.current;
        scanPlaneRef.current.position.y = box.min.y;
      }

      const controlsMoving = bundle.controls.update();
      if (needsRenderRef.current || controlsMoving) {
        bundle.renderer.render(bundle.scene, bundle.camera);
        needsRenderRef.current = false;
      }
      frameRef.current = requestAnimationFrame(renderFrame);
    };

    needsRenderRef.current = true;
    frameRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [visible]);

  return (
    <section className={className}>
      {!hideHeader && (
        <div className="panel-header">
          <div>
            <p className="eyebrow">3D map view</p>
            <h3>Mission geometry</h3>
          </div>
          <span className={`viewer-pill viewer-pill--${isEStopActive ? 'error' : status}`}>{statusLabel}</span>
        </div>
      )}
      <div className="point-cloud-shell">
        <div className="point-cloud-canvas" ref={containerRef} />
        {!hideHeader && (
          <div className="point-cloud-legend">
            <span>Preset {isEStopActive ? 'E-STOP' : controlsState.colorPreset}</span>
            <span>{isLiveMode ? 'LIVE ROS' : controlsState.cameraPreset} camera</span>
          </div>
        )}
      </div>
    </section>
  );
}
