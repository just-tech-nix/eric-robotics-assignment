export type WarehouseSegment = [number, number, number, number];

export type WarehouseObstacle = {
  type: 'box' | 'rack';
  x: number;
  y: number;
  width: number;
  height: number;
  height_z: number;
};

export type WarehouseWorld = {
  world: {
    frame_id: string;
    width: number;
    height: number;
    resolution: number;
  };
  robot: {
    radius: number;
    initial_x: number;
    initial_y: number;
    initial_yaw: number;
  };
  walls: WarehouseSegment[];
  obstacles: WarehouseObstacle[];
};

// Keep this in sync with eric_sim/maps/warehouse.yaml so the demo fallback and
// the ROS-backed simulator describe the same warehouse geometry.
export const warehouseWorld: WarehouseWorld = {
  world: {
    frame_id: 'map',
    width: 40,
    height: 25,
    resolution: 0.05,
  },
  robot: {
    radius: 0.35,
    initial_x: 3,
    initial_y: 3,
    initial_yaw: 0,
  },
  walls: [
    [0, 0, 40, 0],
    [40, 0, 40, 25],
    [40, 25, 0, 25],
    [0, 25, 0, 0],
  ],
  obstacles: [
    { type: 'box', x: 8, y: 5, width: 4, height: 2, height_z: 1.8 },
    { type: 'box', x: 17, y: 10, width: 5, height: 3, height_z: 2.2 },
    { type: 'rack', x: 25, y: 6, width: 10, height: 1.5, height_z: 2.5 },
    { type: 'box', x: 12, y: 18, width: 3, height: 4, height_z: 1.5 },
    { type: 'rack', x: 30, y: 15, width: 6, height: 1, height_z: 3 },
    { type: 'box', x: 5, y: 12, width: 2, height: 2, height_z: 1 },
  ],
};
