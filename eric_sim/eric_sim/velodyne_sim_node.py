"""
velodyne_sim_node.py — Simulated Velodyne VLP-16 LiDAR sensor.

Subscribes:  /odom               (nav_msgs/msg/Odometry) — robot pose
Publishes:   /velodyne_points     (sensor_msgs/msg/PointCloud2)  @ 10 Hz

Simulates a 16-channel rotating LiDAR by ray-casting against the world model.
Also publishes a derived /scan (sensor_msgs/msg/LaserScan) for slam_toolbox
so we don't require an external pointcloud_to_laserscan node.
"""

import math
import os
import struct

import numpy as np
import rclpy
from rclpy.node import Node

from nav_msgs.msg import Odometry
from sensor_msgs.msg import PointCloud2, PointField, LaserScan
from std_msgs.msg import Header

from ament_index_python.packages import get_package_share_directory
from eric_sim.world_model import WorldModel


class VelodyneSimNode(Node):
    """Simulated VLP-16 LiDAR node."""

    # VLP-16 parameters
    H_SAMPLES = 540          # horizontal rays (~0.67° resolution, lighter CPU load)
    V_CHANNELS = 16          # vertical channels
    V_FOV_MIN = -15.0        # degrees
    V_FOV_MAX = 15.0         # degrees
    MIN_RANGE = 0.3          # metres
    MAX_RANGE = 25.0         # metres
    PUBLISH_RATE = 10.0      # Hz
    NOISE_STDDEV = 0.01      # metres
    SENSOR_HEIGHT = 0.3      # velodyne frame z offset from base_link

    def __init__(self):
        super().__init__('velodyne_sim_node')
        self.get_logger().info('Velodyne VLP-16 simulator starting...')

        # Load world
        share_dir = get_package_share_directory('eric_sim')
        world_path = os.path.join(share_dir, 'maps', 'warehouse.yaml')
        self.world = WorldModel(world_path)

        # Robot pose (updated from /odom)
        self.robot_x = self.world.initial_x
        self.robot_y = self.world.initial_y
        self.robot_yaw = self.world.initial_yaw

        # Pre-compute vertical angles
        if self.V_CHANNELS > 1:
            self.v_angles = [
                math.radians(self.V_FOV_MIN + i * (self.V_FOV_MAX - self.V_FOV_MIN) / (self.V_CHANNELS - 1))
                for i in range(self.V_CHANNELS)
            ]
        else:
            self.v_angles = [0.0]

        # Subscribe to /odom
        self.odom_sub = self.create_subscription(
            Odometry, '/odom', self._odom_callback, 10
        )

        # Publishers
        self.pc2_pub = self.create_publisher(PointCloud2, '/velodyne_points', 10)
        self.scan_pub = self.create_publisher(LaserScan, '/scan', 10)

        # Timer
        self.timer = self.create_timer(1.0 / self.PUBLISH_RATE, self._tick)
        self.get_logger().info(
            f'Velodyne sim ready — {self.H_SAMPLES}×{self.V_CHANNELS} rays @ {self.PUBLISH_RATE} Hz'
        )

    def _odom_callback(self, msg: Odometry):
        """Update robot pose from odometry."""
        self.robot_x = msg.pose.pose.position.x
        self.robot_y = msg.pose.pose.position.y
        # Extract yaw from quaternion
        q = msg.pose.pose.orientation
        siny = 2.0 * (q.w * q.z + q.x * q.y)
        cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
        self.robot_yaw = math.atan2(siny, cosy)

    def _tick(self):
        """Generate and publish one full LiDAR scan."""
        now = self.get_clock().now()
        stamp = now.to_msg()

        points = []       # list of (x, y, z, intensity, ring)
        scan_ranges = [float('inf')] * self.H_SAMPLES  # for LaserScan

        for h_idx in range(self.H_SAMPLES):
            h_angle_local = (h_idx / self.H_SAMPLES) * 2.0 * math.pi - math.pi
            h_angle_world = self.robot_yaw + h_angle_local

            best_2d_range = self.MAX_RANGE

            for v_idx, v_angle in enumerate(self.v_angles):
                distance = self.world.ray_cast(
                    self.robot_x, self.robot_y, h_angle_world, self.MAX_RANGE
                )

                if distance < self.MIN_RANGE:
                    continue

                # Add noise
                distance += np.random.normal(0.0, self.NOISE_STDDEV)
                distance = max(self.MIN_RANGE, min(self.MAX_RANGE, distance))

                # Track best 2D range for LaserScan
                if v_idx == self.V_CHANNELS // 2:  # middle ring
                    best_2d_range = min(best_2d_range, distance)

                if distance >= self.MAX_RANGE:
                    continue

                # Convert to velodyne frame (local XYZ)
                cos_v = math.cos(v_angle)
                sin_v = math.sin(v_angle)
                x = distance * math.cos(h_angle_local) * cos_v
                y = distance * math.sin(h_angle_local) * cos_v
                z = distance * sin_v

                intensity = max(0.0, 1.0 - distance / self.MAX_RANGE) * 255.0
                points.append((x, y, z, intensity, v_idx))

            # Store range for LaserScan
            if best_2d_range < self.MAX_RANGE:
                scan_ranges[h_idx] = best_2d_range

        # Publish PointCloud2
        self._publish_pointcloud2(stamp, points)

        # Publish LaserScan (for slam_toolbox)
        self._publish_laserscan(stamp, scan_ranges)

    def _publish_pointcloud2(self, stamp, points):
        """Build and publish a PointCloud2 message."""
        fields = [
            PointField(name='x', offset=0, datatype=PointField.FLOAT32, count=1),
            PointField(name='y', offset=4, datatype=PointField.FLOAT32, count=1),
            PointField(name='z', offset=8, datatype=PointField.FLOAT32, count=1),
            PointField(name='intensity', offset=12, datatype=PointField.FLOAT32, count=1),
            PointField(name='ring', offset=16, datatype=PointField.UINT16, count=1),
        ]

        # Pack binary data: 4+4+4+4+2 = 18 bytes per point, pad to 20
        point_step = 20
        data = bytearray()
        for x, y, z, intensity, ring in points:
            data.extend(struct.pack('<ffffHxx', x, y, z, intensity, ring))

        msg = PointCloud2()
        msg.header = Header(stamp=stamp, frame_id='velodyne')
        msg.height = 1
        msg.width = len(points)
        msg.fields = fields
        msg.is_bigendian = False
        msg.point_step = point_step
        msg.row_step = point_step * len(points)
        msg.data = bytes(data)
        msg.is_dense = True

        self.pc2_pub.publish(msg)

    def _publish_laserscan(self, stamp, ranges):
        """Build and publish a LaserScan message for slam_toolbox."""
        msg = LaserScan()
        msg.header = Header(stamp=stamp, frame_id='velodyne')
        msg.angle_min = -math.pi
        msg.angle_max = math.pi
        msg.angle_increment = (2.0 * math.pi) / self.H_SAMPLES
        msg.time_increment = 0.0
        msg.scan_time = 1.0 / self.PUBLISH_RATE
        msg.range_min = self.MIN_RANGE
        msg.range_max = self.MAX_RANGE
        msg.ranges = [float(r) for r in ranges]
        msg.intensities = []

        self.scan_pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = VelodyneSimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.get_logger().info('Velodyne sim node shutting down.')
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
