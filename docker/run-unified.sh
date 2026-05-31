#!/bin/bash
set -e

# Start Nginx in background
echo "Starting Nginx daemon..."
service nginx start

# Source ROS 2 environments
echo "Sourcing ROS 2 Humble setup..."
source /opt/ros/humble/setup.bash
source /ros2_ws/install/setup.bash

# Launch ROS 2 full stack simulation in foreground
echo "Launching ROS 2 simulation backend..."
exec ros2 launch eric_sim eric_full_stack.launch.py
