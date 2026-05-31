"""
camera_stream_node.py — Simulated forward-facing operator camera.

Subscribes:  /odom  (nav_msgs/msg/Odometry) — robot pose
Publishes:   /camera/image/compressed  (sensor_msgs/msg/CompressedImage)  @ 15 Hz

The output is intentionally first-person / street-view style so the dashboard can
show what a robotics operator would expect while driving. It is not used for SLAM;
SLAM remains LiDAR-only.
"""

import io
import math
import os

import rclpy
from rclpy.node import Node

from nav_msgs.msg import Odometry
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import Header

from ament_index_python.packages import get_package_share_directory

from .world_model import WorldModel

try:
    from PIL import Image as PILImage
    from PIL import ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def _create_minimal_jpeg(width: int, height: int, r: int, g: int, b: int) -> bytes:
    if HAS_PIL:
        img = PILImage.new('RGB', (width, height), (r, g, b))
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=70)
        return buf.getvalue()
    return (
        b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        b'\xff\xd9'
    )


class CameraStreamNode(Node):
    """Publishes a synthetic first-person camera aligned with robot heading."""

    WIDTH = 640
    HEIGHT = 360
    FPS = 15
    HFOV = math.radians(78.0)
    CAMERA_Z = 0.72
    CAMERA_FORWARD_OFFSET = 0.16
    MAX_RANGE = 12.0

    def __init__(self):
        super().__init__('camera_stream_node')
        self.get_logger().info('Camera stream node starting...')

        share_dir = get_package_share_directory('eric_sim')
        world_path = os.path.join(share_dir, 'maps', 'warehouse.yaml')
        self.world = WorldModel(world_path)

        self.robot_x = self.world.initial_x
        self.robot_y = self.world.initial_y
        self.robot_yaw = self.world.initial_yaw
        self.robot_radius = self.world.robot_radius

        self.odom_sub = self.create_subscription(Odometry, '/odom', self._odom_callback, 10)
        self.img_pub = self.create_publisher(CompressedImage, '/camera/image/compressed', 10)
        self.timer = self.create_timer(1.0 / self.FPS, self._tick)

        self.get_logger().info(
            f'Camera stream ready — {self.WIDTH}x{self.HEIGHT} @ {self.FPS} FPS '
            f'(PIL={HAS_PIL})'
        )

    def _odom_callback(self, msg: Odometry):
        self.robot_x = msg.pose.pose.position.x
        self.robot_y = msg.pose.pose.position.y
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.robot_yaw = math.atan2(siny, cosy)

    def _tick(self):
        stamp = self.get_clock().now().to_msg()
        jpeg_data = self._render_operator_view() if HAS_PIL else _create_minimal_jpeg(self.WIDTH, self.HEIGHT, 20, 24, 32)

        msg = CompressedImage()
        msg.header = Header(stamp=stamp, frame_id='camera_link')
        msg.format = 'jpeg'
        msg.data = jpeg_data
        self.img_pub.publish(msg)

    def _render_operator_view(self) -> bytes:
        width, height = self.WIDTH, self.HEIGHT
        horizon = int(height * 0.43)
        image = PILImage.new('RGB', (width, height), (18, 22, 28))
        draw = ImageDraw.Draw(image)

        # Ceiling / upper structure band
        for y in range(horizon):
            t = y / max(1, horizon)
            color = (
                int(30 + 16 * t),
                int(34 + 18 * t),
                int(40 + 18 * t),
            )
            draw.line([(0, y), (width, y)], fill=color)

        # Floor band
        for y in range(horizon, height):
            t = (y - horizon) / max(1, height - horizon)
            color = (
                int(34 + 42 * t),
                int(36 + 44 * t),
                int(38 + 48 * t),
            )
            draw.line([(0, y), (width, y)], fill=color)

        cam_x = self.robot_x + self.CAMERA_FORWARD_OFFSET * math.cos(self.robot_yaw)
        cam_y = self.robot_y + self.CAMERA_FORWARD_OFFSET * math.sin(self.robot_yaw)
        focal = (width / 2) / math.tan(self.HFOV / 2)

        # Perspective guide lines on the floor.
        for lateral in (-3.5, -2.0, 0.0, 2.0, 3.5):
            self._draw_floor_guide(draw, cam_x, cam_y, focal, width, height, horizon, lateral)

        # Main wall / obstacle rendering via horizontal ray casting.
        column_step = 3
        for column in range(0, width, column_step):
            rel = ((column + column_step * 0.5) / width - 0.5) * self.HFOV
            ray_angle = self.robot_yaw + rel
            dist, hit_height = self.world.ray_cast_3d(
                cam_x,
                cam_y,
                self.CAMERA_Z,
                ray_angle,
                0.0,
                self.MAX_RANGE,
            )

            corrected = max(0.25, dist * math.cos(rel))
            if dist >= self.MAX_RANGE - 1e-3 or hit_height <= self.CAMERA_Z:
                continue

            wall_height = hit_height - self.CAMERA_Z
            projected = int(min(height * 0.9, (wall_height * focal) / corrected))
            top = max(0, horizon - projected // 2)
            bottom = min(height - 1, horizon + projected // 2)

            depth = min(1.0, corrected / self.MAX_RANGE)
            brightness = 1.0 - 0.72 * depth
            wall_color = (
                int(88 * brightness + 34),
                int(94 * brightness + 30),
                int(102 * brightness + 26),
            )
            edge_color = (
                min(255, wall_color[0] + 20),
                min(255, wall_color[1] + 20),
                min(255, wall_color[2] + 18),
            )

            draw.rectangle([column, top, min(width - 1, column + column_step), bottom], fill=wall_color)
            draw.line([(column, top), (column, bottom)], fill=edge_color)

        # Keep the raw feed visually clean; the web dashboard overlays status itself.

        buf = io.BytesIO()
        image.save(buf, format='JPEG', quality=78)
        return buf.getvalue()

    def _draw_floor_guide(self, draw, cam_x, cam_y, focal, width, height, horizon, lateral_offset):
        points = []
        for distance in (1.5, 2.5, 4.0, 6.0, 9.0):
            wx = cam_x + distance * math.cos(self.robot_yaw) - lateral_offset * math.sin(self.robot_yaw)
            wy = cam_y + distance * math.sin(self.robot_yaw) + lateral_offset * math.cos(self.robot_yaw)
            rel_x, rel_y = self._to_camera_frame(wx, wy, cam_x, cam_y)
            if rel_x <= 0.15:
                continue
            sx = int(width / 2 + (rel_y * focal) / rel_x)
            sy = int(min(height - 1, horizon + (self.CAMERA_Z * focal) / rel_x))
            points.append((sx, sy))
        if len(points) >= 2:
            draw.line(points, fill=(44, 66, 84), width=1)

    def _to_camera_frame(self, wx: float, wy: float, cam_x: float, cam_y: float):
        dx = wx - cam_x
        dy = wy - cam_y
        forward = dx * math.cos(self.robot_yaw) + dy * math.sin(self.robot_yaw)
        lateral = -dx * math.sin(self.robot_yaw) + dy * math.cos(self.robot_yaw)
        return forward, lateral

    def _draw_minimap(self, draw, width: int, height: int):
        box_w, box_h = 168, 132
        x0, y0 = width - box_w - 18, 18
        x1, y1 = width - 18, 18 + box_h
        draw.rectangle([x0, y0, x1, y1], outline=(34, 211, 238), fill=(7, 12, 20))

        sx = (box_w - 16) / self.world.width
        sy = (box_h - 16) / self.world.height

        def w2p(wx: float, wy: float):
            px = x0 + 8 + wx * sx
            py = y1 - 8 - wy * sy
            return px, py

        for seg in self.world.segments:
            draw.line([w2p(seg[0], seg[1]), w2p(seg[2], seg[3])], fill=(56, 189, 248), width=1)

        rx, ry = w2p(self.robot_x, self.robot_y)
        arrow_len = 10
        tip = (
            rx + arrow_len * math.cos(self.robot_yaw),
            ry - arrow_len * math.sin(self.robot_yaw),
        )
        left = (
            rx - 5 * math.cos(self.robot_yaw) + 4 * math.sin(self.robot_yaw),
            ry + 5 * math.sin(self.robot_yaw) + 4 * math.cos(self.robot_yaw),
        )
        right = (
            rx - 5 * math.cos(self.robot_yaw) - 4 * math.sin(self.robot_yaw),
            ry + 5 * math.sin(self.robot_yaw) - 4 * math.cos(self.robot_yaw),
        )
        draw.polygon([tip, left, right], fill=(248, 250, 252), outline=(250, 204, 21))
        draw.text((x0 + 10, y0 + 8), 'mini map', fill=(148, 163, 184))


def main(args=None):
    rclpy.init(args=args)
    node = CameraStreamNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
