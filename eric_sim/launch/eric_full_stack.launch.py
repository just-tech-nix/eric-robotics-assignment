"""
eric_full_stack.launch.py — Single launch file for the complete ERIC simulation stack.

Launches:
  1. robot_motor_node       — /cmd_vel → /odom + TF
  2. velodyne_sim_node      — Simulated VLP-16 → /velodyne_points + /scan
  3. camera_stream_node     — Simulated camera → /camera/image/compressed
  4. diagnostics_node       — Simulated /battery_state + /diagnostics
  5. slam_toolbox           — /scan → /map (online async SLAM)
  6. rosbridge_server       — WebSocket bridge for React dashboard

Usage:
  ros2 launch eric_sim eric_full_stack.launch.py
"""

import os

from launch import LaunchDescription
from launch.actions import TimerAction
from launch_ros.actions import Node

from ament_index_python.packages import get_package_share_directory


def generate_launch_description():
    eric_sim_dir = get_package_share_directory('eric_sim')
    slam_config = os.path.join(eric_sim_dir, 'config', 'slam_toolbox.yaml')

    # ── 1. Robot Motor Node ─────────────────────────────────────────
    robot_motor = Node(
        package='eric_sim',
        executable='robot_motor_node',
        name='robot_motor_node',
        output='screen',
        emulate_tty=True,
    )

    # ── 2. Velodyne Simulator Node ──────────────────────────────────
    velodyne_sim = Node(
        package='eric_sim',
        executable='velodyne_sim_node',
        name='velodyne_sim_node',
        output='screen',
        emulate_tty=True,
    )

    # ── 3. Camera Stream Node ───────────────────────────────────────
    camera_stream = Node(
        package='eric_sim',
        executable='camera_stream_node',
        name='camera_stream_node',
        output='screen',
        emulate_tty=True,
    )

    diagnostics_node = Node(
        package='eric_sim',
        executable='diagnostics_node',
        name='eric_diagnostics_node',
        output='screen',
        emulate_tty=True,
    )

    # ── 4. SLAM Toolbox (online async) ──────────────────────────────
    # Delayed start to let TF tree and /scan stabilize
    slam_toolbox = TimerAction(
        period=8.0,  # increased delay to let TF and /scan settle before SLAM subscribes
        actions=[
            Node(
                package='slam_toolbox',
                executable='async_slam_toolbox_node',
                name='slam_toolbox',
                output='screen',
                emulate_tty=True,
                parameters=[slam_config],
            )
        ],
    )

    # ── 5. Rosbridge WebSocket Server ───────────────────────────────
    # Launch rosbridge directly as a Node (not via XML include)
    rosbridge_node = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        output='screen',
        emulate_tty=True,
        parameters=[{
            'port': 9090,
            'address': '',
            'unregister_timeout': 10.0,
            'max_message_size': 10000000,
        }],
    )

    # ── Assemble ────────────────────────────────────────────────────
    return LaunchDescription([
        robot_motor,
        velodyne_sim,
        camera_stream,
        diagnostics_node,
        slam_toolbox,
        rosbridge_node,
    ])

