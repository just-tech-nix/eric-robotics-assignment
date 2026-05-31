# Stage 1: Build the React Frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY insight-io-dashboard/package*.json ./
RUN npm ci
COPY insight-io-dashboard/ .
RUN npm run build

# Stage 2: Create the complete ROS 2 backend + frontend server image
FROM ros:humble
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies and Nginx
RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-humble-slam-toolbox \
    ros-humble-rosbridge-server \
    ros-humble-pointcloud-to-laserscan \
    ros-humble-tf2-ros \
    ros-humble-tf2-geometry-msgs \
    python3-pip \
    python3-yaml \
    python3-numpy \
    python3-pil \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Copy built React frontend to Nginx HTML directory
COPY --from=frontend-build /app/dist /var/www/html

# Copy Nginx Configuration
COPY docker/nginx-unified.conf /etc/nginx/sites-available/default

# Create ROS 2 workspace
WORKDIR /ros2_ws/src
COPY eric_sim/ ./eric_sim/

# Build ROS 2 workspace
WORKDIR /ros2_ws
RUN /bin/bash -c 'source /opt/ros/humble/setup.bash && colcon build --symlink-install'

# Setup entrypoint script
COPY docker/run-unified.sh /run-unified.sh
RUN chmod +x /run-unified.sh

# Expose port 80 (Nginx web serving + WebSocket proxy)
EXPOSE 80

ENTRYPOINT ["/run-unified.sh"]
