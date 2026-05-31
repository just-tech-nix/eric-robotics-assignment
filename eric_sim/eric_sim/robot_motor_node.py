"""
robot_motor_node.py — Simulated differential-drive robot motor controller.

Subscribes:  /cmd_vel  (geometry_msgs/msg/Twist)
Publishes:   /odom     (nav_msgs/msg/Odometry)  @ 50 Hz
             TF:  odom → base_link  (dynamic)
             TF:  base_link → velodyne, base_link → camera_link  (static)
"""

import math
import os

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy

from geometry_msgs.msg import Twist, TransformStamped, Quaternion
from nav_msgs.msg import Odometry
from tf2_ros import TransformBroadcaster, StaticTransformBroadcaster

from ament_index_python.packages import get_package_share_directory
from eric_sim.world_model import WorldModel


def yaw_to_quaternion(yaw: float) -> Quaternion:
    """Convert a yaw angle (radians) to a quaternion message."""
    q = Quaternion()
    q.x = 0.0
    q.y = 0.0
    q.z = math.sin(yaw / 2.0)
    q.w = math.cos(yaw / 2.0)
    return q


class RobotMotorNode(Node):
    """Simulated motor controller with differential-drive kinematics."""

    # Velocity limits
    MAX_LINEAR = 1.0    # m/s
    MAX_ANGULAR = 1.5   # rad/s
    CMD_TIMEOUT = 0.3   # seconds — zero velocity if no /cmd_vel received

    def __init__(self):
        super().__init__('robot_motor_node')
        self.get_logger().info('Robot motor node starting...')

        # Load world model
        share_dir = get_package_share_directory('eric_sim')
        world_path = os.path.join(share_dir, 'maps', 'warehouse.yaml')
        self.world = WorldModel(world_path)

        # Robot state
        self.x = self.world.initial_x
        self.y = self.world.initial_y
        self.yaw = self.world.initial_yaw
        self.linear_vel = 0.0
        self.angular_vel = 0.0

        # Timing
        self.last_cmd_time = self.get_clock().now()

        # TF broadcasters
        self.tf_broadcaster = TransformBroadcaster(self)
        self.static_tf_broadcaster = StaticTransformBroadcaster(self)

        # Publish static transforms once
        self._publish_static_transforms()

        # Subscribe to /cmd_vel
        self.cmd_sub = self.create_subscription(
            Twist, '/cmd_vel', self._cmd_vel_callback, 10
        )

        # Publish /odom at 50 Hz
        odom_qos = QoSProfile(depth=10)
        self.odom_pub = self.create_publisher(Odometry, '/odom', odom_qos)
        self.timer = self.create_timer(1.0 / 50.0, self._tick)

        self.get_logger().info(
            f'Robot motor node ready — initial pose: '
            f'({self.x:.1f}, {self.y:.1f}, yaw={math.degrees(self.yaw):.0f}°)'
        )

    def _publish_static_transforms(self):
        """Publish static TF frames for sensors mounted on the robot."""
        now = self.get_clock().now().to_msg()
        transforms = []

        # base_link → velodyne  (z = +0.30 m above base)
        t_vel = TransformStamped()
        t_vel.header.stamp = now
        t_vel.header.frame_id = 'base_link'
        t_vel.child_frame_id = 'velodyne'
        t_vel.transform.translation.x = 0.0
        t_vel.transform.translation.y = 0.0
        t_vel.transform.translation.z = 0.3
        t_vel.transform.rotation.w = 1.0
        transforms.append(t_vel)

        # base_link → camera_link  (x = +0.15, z = +0.25)
        t_cam = TransformStamped()
        t_cam.header.stamp = now
        t_cam.header.frame_id = 'base_link'
        t_cam.child_frame_id = 'camera_link'
        t_cam.transform.translation.x = 0.15
        t_cam.transform.translation.y = 0.0
        t_cam.transform.translation.z = 0.25
        t_cam.transform.rotation.w = 1.0
        transforms.append(t_cam)

        self.static_tf_broadcaster.sendTransform(transforms)
        self.get_logger().info('Static TF published: base_link → velodyne, camera_link')

    def _cmd_vel_callback(self, msg: Twist):
        """Receive velocity commands and clamp them."""
        self.linear_vel = max(-self.MAX_LINEAR, min(self.MAX_LINEAR, msg.linear.x))
        self.angular_vel = max(-self.MAX_ANGULAR, min(self.MAX_ANGULAR, msg.angular.z))
        self.last_cmd_time = self.get_clock().now()

    def _tick(self):
        """Main 50 Hz control loop — integrate pose, check collision, publish."""
        now = self.get_clock().now()
        dt = 1.0 / 50.0

        # Safety timeout: zero velocity if no cmd received recently
        elapsed = (now - self.last_cmd_time).nanoseconds / 1e9
        if elapsed > self.CMD_TIMEOUT:
            self.linear_vel = 0.0
            self.angular_vel = 0.0

        # Integrate kinematics
        new_yaw = self.yaw + self.angular_vel * dt
        new_x = self.x + self.linear_vel * math.cos(new_yaw) * dt
        new_y = self.y + self.linear_vel * math.sin(new_yaw) * dt

        # Collision check — only move if no collision
        if not self.world.check_collision(new_x, new_y, self.world.robot_radius):
            self.x = new_x
            self.y = new_y
            self.yaw = new_yaw
        else:
            # Collided — stop linear velocity, keep angular
            self.yaw = new_yaw
            self.linear_vel = 0.0

        # Publish odometry
        self._publish_odom(now)

        # Publish dynamic TF: odom → base_link
        self._publish_tf(now)

    def _publish_odom(self, now):
        """Build and publish an Odometry message."""
        msg = Odometry()
        msg.header.stamp = now.to_msg()
        msg.header.frame_id = 'odom'
        msg.child_frame_id = 'base_link'

        msg.pose.pose.position.x = self.x
        msg.pose.pose.position.y = self.y
        msg.pose.pose.position.z = 0.0
        msg.pose.pose.orientation = yaw_to_quaternion(self.yaw)

        # Pose covariance (diagonal)
        cov = [0.0] * 36
        cov[0] = 0.01   # x
        cov[7] = 0.01   # y
        cov[35] = 0.01  # yaw
        msg.pose.covariance = cov

        msg.twist.twist.linear.x = self.linear_vel
        msg.twist.twist.angular.z = self.angular_vel

        # Twist covariance
        twist_cov = [0.0] * 36
        twist_cov[0] = 0.01
        twist_cov[35] = 0.01
        msg.twist.covariance = twist_cov

        self.odom_pub.publish(msg)

    def _publish_tf(self, now):
        """Broadcast odom → base_link transform."""
        t = TransformStamped()
        t.header.stamp = now.to_msg()
        t.header.frame_id = 'odom'
        t.child_frame_id = 'base_link'

        t.transform.translation.x = self.x
        t.transform.translation.y = self.y
        t.transform.translation.z = 0.0
        t.transform.rotation = yaw_to_quaternion(self.yaw)

        self.tf_broadcaster.sendTransform(t)


def main(args=None):
    rclpy.init(args=args)
    node = RobotMotorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.get_logger().info('Robot motor node shutting down.')
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
