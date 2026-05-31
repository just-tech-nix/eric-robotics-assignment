"""
world_model.py — Warehouse world model with ray-casting and collision detection.

Loads a warehouse YAML definition and provides geometric queries (ray intersection,
collision checking) used by the motor, LiDAR, and camera simulator nodes.
"""

import math
import yaml
from typing import List, Tuple, Optional

Segment = Tuple[float, float, float, float]  # x1, y1, x2, y2


class WorldModel:
    """2-D top-down world built from walls and axis-aligned obstacles."""

    def __init__(self, yaml_path: str):
        with open(yaml_path, 'r') as f:
            data = yaml.safe_load(f)

        world = data.get('world', {})
        self.width: float = world.get('width', 40.0)
        self.height: float = world.get('height', 25.0)
        self.resolution: float = world.get('resolution', 0.05)

        robot = data.get('robot', {})
        self.robot_radius: float = robot.get('radius', 0.35)
        self.initial_x: float = robot.get('initial_x', 3.0)
        self.initial_y: float = robot.get('initial_y', 3.0)
        self.initial_yaw: float = robot.get('initial_yaw', 0.0)

        # Convert all geometry into line segments for uniform ray casting
        self.segments: List[Segment] = []
        self.obstacle_heights: List[float] = []  # z-height for each segment (for 3D)

        # Boundary walls
        for wall in data.get('walls', []):
            x1, y1, x2, y2 = wall
            self.segments.append((x1, y1, x2, y2))
            self.obstacle_heights.append(3.0)  # wall height

        # Obstacles (boxes and racks → 4 edges each)
        for obs in data.get('obstacles', []):
            ox = obs.get('x', 0.0)
            oy = obs.get('y', 0.0)
            ow = obs.get('width', 1.0)
            oh = obs.get('height', 1.0)
            oz = obs.get('height_z', 2.0)

            # Four edges of axis-aligned rectangle
            edges = [
                (ox, oy, ox + ow, oy),           # bottom
                (ox + ow, oy, ox + ow, oy + oh),  # right
                (ox + ow, oy + oh, ox, oy + oh),  # top
                (ox, oy + oh, ox, oy),             # left
            ]
            for edge in edges:
                self.segments.append(edge)
                self.obstacle_heights.append(oz)

    # ── Ray casting ─────────────────────────────────────────────────

    @staticmethod
    def _ray_segment_intersect(
        ox: float, oy: float,
        dx: float, dy: float,
        x1: float, y1: float,
        x2: float, y2: float
    ) -> Optional[float]:
        """
        Return parametric t ≥ 0 for the intersection of the ray
        (ox + t*dx, oy + t*dy) with segment (x1,y1)→(x2,y2), or None.
        """
        sx = x2 - x1
        sy = y2 - y1
        denom = dx * sy - dy * sx
        if abs(denom) < 1e-12:
            return None  # parallel

        t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom
        u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom

        if t >= 0.0 and 0.0 <= u <= 1.0:
            return t
        return None

    def ray_cast(self, origin_x: float, origin_y: float,
                 angle: float, max_range: float) -> float:
        """
        Cast a 2-D ray from (origin_x, origin_y) at the given angle (radians).
        Returns the distance to the nearest wall/obstacle, capped at max_range.
        """
        dx = math.cos(angle)
        dy = math.sin(angle)
        closest = max_range

        for seg in self.segments:
            t = self._ray_segment_intersect(
                origin_x, origin_y, dx, dy,
                seg[0], seg[1], seg[2], seg[3]
            )
            if t is not None and t < closest:
                closest = t

        return closest

    def ray_cast_3d(self, origin_x: float, origin_y: float, origin_z: float,
                    h_angle: float, v_angle: float,
                    max_range: float) -> Tuple[float, float]:
        """
        Cast a 3-D ray. Returns (distance, height_of_hit_surface).
        The vertical component determines whether the ray hits above or below
        the obstacle's z-height.
        """
        cos_v = math.cos(v_angle)
        sin_v = math.sin(v_angle)

        # Project onto XY plane
        if abs(cos_v) < 1e-9:
            return max_range, 0.0

        dx = math.cos(h_angle) * cos_v
        dy = math.sin(h_angle) * cos_v

        closest = max_range
        hit_height = 0.0

        for i, seg in enumerate(self.segments):
            t = self._ray_segment_intersect(
                origin_x, origin_y, dx, dy,
                seg[0], seg[1], seg[2], seg[3]
            )
            if t is not None:
                # Check if the ray's z at this t intersects the obstacle height
                dist_3d = t / cos_v if abs(cos_v) > 1e-9 else max_range
                z_at_hit = origin_z + dist_3d * sin_v
                obs_h = self.obstacle_heights[i]

                if 0.0 <= z_at_hit <= obs_h and dist_3d < closest:
                    closest = dist_3d
                    hit_height = obs_h

        return closest, hit_height

    # ── Collision detection ─────────────────────────────────────────

    def check_collision(self, x: float, y: float, radius: float) -> bool:
        """Return True if a circle at (x, y) with the given radius overlaps any segment."""
        for seg in self.segments:
            if self._point_segment_distance(x, y, seg[0], seg[1], seg[2], seg[3]) < radius:
                return True
        # Also check world boundaries
        if x - radius < 0 or x + radius > self.width:
            return True
        if y - radius < 0 or y + radius > self.height:
            return True
        return False

    @staticmethod
    def _point_segment_distance(px: float, py: float,
                                x1: float, y1: float,
                                x2: float, y2: float) -> float:
        """Minimum distance from point (px, py) to line segment (x1,y1)→(x2,y2)."""
        dx = x2 - x1
        dy = y2 - y1
        length_sq = dx * dx + dy * dy
        if length_sq < 1e-12:
            return math.hypot(px - x1, py - y1)

        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_sq))
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy
        return math.hypot(px - proj_x, py - proj_y)
