# Insight.IO — ERIC Robotics Operator Dashboard

## Candidate Details
- **Full Name:** `Nilesh Kowe`
- **Contact Number:** `<YOUR_CONTACT_NUMBER>`
- **Email ID:** `<YOUR_EMAIL_ID>`

> **Note**: An extensive assignment report and system walk-through has been prepared at [FSD_Assignment_1_Report.md](file:///F:/hermes/projects/Assignment%20-%20ERIC%20Robotics/681ec28e49cbdfeabb03a784ce838ff1-58711edafc6b1734880ace5a8b339bc0b2dfef70/FSD_Assignment_1_Report.md). It contains detailed explanations of our approach, design decisions, and screenshots of every component.


> A real-time ROS 2-connected robotics operator dashboard with live LiDAR mapping, camera visualization, and teleoperation — built with React 19, TypeScript, Three.js, and ROS 2 Humble.

![Stack](https://img.shields.io/badge/React-19-blue) ![ROS2](https://img.shields.io/badge/ROS%202-Humble-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![Three.js](https://img.shields.io/badge/Three.js-0.184-black) ![Docker](https://img.shields.io/badge/Docker-Ready-2496ED)

---

## Quick Start (One Click)

### Recommended reviewer path

Use **Docker full stack** if available. It now launches:
- ROS 2 backend container
- production frontend container
- automatic frontend ↔ ROS communication through same-origin `/rosbridge`

No local Node/Vite setup is required for this full mode.

### Windows

**Option A — Double-click**
```text
run.bat
```
- If Docker is installed: starts the full stack at `http://localhost:8080`
- If Docker is not installed: falls back to demo frontend mode

**Option B — PowerShell**
```powershell
.\setup.ps1                  # Auto: Docker full stack, else demo mode
.\setup.ps1 -Mode full       # Force Docker full stack
.\setup.ps1 -Mode ros        # Backend only
.\setup.ps1 -Mode frontend   # Demo/frontend only
.\setup.ps1 -Mode stop       # Stop all services
```

### Linux / macOS / WSL

```bash
chmod +x setup.sh
./setup.sh                  # Auto: Docker full stack, else demo mode
./setup.sh --ros-only       # Backend only
./setup.sh --frontend-only  # Demo/frontend only
./setup.sh --stop           # Stop all services
```

### URLs
- **Desktop/local:** `http://localhost:8080` (Docker full stack)
- **Phone on same Wi‑Fi:** `http://<your-pc-lan-ip>:8080`
- **Demo/frontend-only:** `http://localhost:5173`

### Windows phone/LAN access note
If desktop works but your phone cannot open `http://<your-pc-lan-ip>:8080`, the usual cause is Windows Firewall on the current network.

Temporary one-click helpers are included:
- `open-phone-access.bat` — adds a temporary inbound allow rule for TCP `8080` scoped to your current `/24` LAN subnet
- `close-phone-access.bat` — removes that temporary rule when you are done testing

These helpers request Administrator approval and keep the firewall change reversible.

### What you need
- **Docker Desktop / Docker Engine + Compose** — recommended for full evaluation flow
- **Node.js 18+** — only needed for frontend-only demo mode

> **No Docker?** The dashboard still runs in **demo mode** with bundled static assets.
> That preserves the UI walkthrough for reviewers even without the ROS stack.

### Submission docs
- `docs/REVIEWER_GUIDE.md`
- `docs/EVALUATION_MAP.md`
- `docs/SCREENSHOT_CHECKLIST.md`
- `docs/SUBMISSION_CHECKLIST.md`

---

## Features

### Dashboard Interface
| Feature | Description |
|---------|-------------|
| **3D LiDAR Point Cloud** | Real-time Three.js rendering of Velodyne VLP-16 scan data |
| **Camera Feed** | Live bird's-eye warehouse view or static video fallback |
| **SLAM Map** | Live occupancy grid built by `slam_toolbox` from LiDAR |
| **WASD Teleoperation** | Drive the robot with keyboard/touch → publishes `/cmd_vel` |
| **Mission Replay** | Timeline scrubbing with telemetry events |
| **Emergency Stop** | One-click E-Stop with actuator lockdown |
| **Telemetry HUD** | Battery, speed, heading, connection, failsafe status |
| **Mode Switching** | AUTO / MANUAL / ASSIST control modes |
| **Analytics Console** | Real-time SVG charts, operator log terminal |
| **Waypoint Routing** | Radar compass, 5-waypoint mission queue |

### Dual Mode Operation
- **LIVE Mode** — Connects to ROS 2 via rosbridge WebSocket, all data is real-time
- **DEMO Mode** — Falls back to bundled static assets (video, PCD, JSON telemetry)

The dashboard auto-detects the ROS bridge connection and switches modes automatically.

---

## Architecture

```
React Dashboard (Browser)
  ├── publishes  /cmd_vel           (geometry_msgs/msg/Twist)
  ├── subscribes /odom              (nav_msgs/msg/Odometry)
  ├── subscribes /scan              (sensor_msgs/msg/LaserScan)
  ├── subscribes /map               (nav_msgs/msg/OccupancyGrid)
  └── subscribes /camera/image/compressed  (sensor_msgs/msg/CompressedImage)
        ↕ Same-origin WebSocket proxy (/rosbridge)
Nginx Frontend Container
  └── serves static React build + proxies /rosbridge → ROS backend
ROS 2 Humble (Docker / WSL)
  ├── robot_motor_node      /cmd_vel → /odom + TF
  ├── velodyne_sim_node     Simulated VLP-16 → /velodyne_points + /scan
  ├── camera_stream_node    Bird's-eye view → /camera/image/compressed
  ├── slam_toolbox          /scan → /map (online async SLAM)
  └── rosbridge_server      WebSocket bridge for React
```

### Data Flow
```
Joystick (WASD)
  ↓ /cmd_vel
robot_motor_node → /odom + /tf (odom→base_link)
  ↓
velodyne_sim_node → /velodyne_points + /scan
  ↓
slam_toolbox → /map (OccupancyGrid)
  ↓
React Dashboard (renders map, point cloud, camera, telemetry)
```

### TF Tree
```
map (published by slam_toolbox)
 └── odom
      └── base_link
           ├── velodyne     (z=+0.30m)
           └── camera_link  (x=+0.15m, z=+0.25m)
```

---

## Project Structure

```
├── setup.sh                      # One-click install & run
├── Dockerfile                    # ROS 2 Humble container
├── docker-compose.yml            # Docker orchestration
├── docker/
│   └── entrypoint.sh             # Container entrypoint
│
├── eric_sim/                     # ROS 2 Python package
│   ├── package.xml
│   ├── setup.py / setup.cfg
│   ├── eric_sim/
│   │   ├── world_model.py        # Warehouse geometry + ray casting
│   │   ├── robot_motor_node.py   # Diff-drive motor simulator
│   │   ├── velodyne_sim_node.py  # VLP-16 LiDAR simulator
│   │   └── camera_stream_node.py # Bird's-eye camera simulator
│   ├── launch/
│   │   └── eric_full_stack.launch.py
│   ├── config/
│   │   ├── slam_toolbox.yaml
│   │   └── pointcloud_to_laserscan.yaml
│   └── maps/
│       └── warehouse.yaml        # World definition
│
├── insight-io-dashboard/         # React frontend
│   ├── src/
│   │   ├── App.tsx               # Main dashboard orchestration + teleop logic
│   │   ├── components/
│   │   │   ├── OccupancyMapPanel.tsx
│   │   │   └── PointCloudPanel.tsx # Three.js point cloud viewer
│   │   ├── ros/                  # ROS 2 integration hooks
│   │   │   ├── rosClient.ts      # Singleton connection manager
│   │   │   ├── useRosConnection.ts
│   │   │   ├── useCmdVelPublisher.ts
│   │   │   ├── useRosOdometry.ts
│   │   │   ├── useRosMap.ts
│   │   │   ├── useRosLidar.ts
│   │   │   └── useRosCameraCompressed.ts
│   │   ├── hooks/
│   │   │   └── useMissionReplay.ts
│   │   ├── data/
│   │   │   ├── assetManifest.ts
│   │   │   └── warehouseWorld.ts  # Frontend fallback map synced to warehouse.yaml
│   │   └── types.ts
│   └── public/assets/            # Static fallback assets
│       ├── camera-feed.mp4
│       ├── map-cloud.pcd
│       ├── telemetry.json
│       └── mission-events.json
│
├── FSD Assignment #1.md
└── help.md
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.9, Vite 8 |
| **3D Rendering** | Three.js 0.184 + OrbitControls |
| **ROS Bridge** | roslib (npm) via WebSocket |
| **ROS 2** | Humble Hawksbill (Ubuntu 22.04) |
| **SLAM** | slam_toolbox (online async) |
| **LiDAR** | Custom VLP-16 simulator (no Gazebo) |
| **Containerization** | Docker + Docker Compose |
| **Styling** | Vanilla CSS (glassmorphism, dark theme) |

---

## Keyboard Controls

| Key | Action |
|-----|--------|
| `W` / `A` / `S` / `D` | Manual teleoperation (forward/left/brake/right) |
| `Space` | Play/pause mission replay |
| `←` / `→` | Jump to previous/next timeline event |
| `M` | Swap main/PiP viewports |

---

## ROS 2 Topics

| Topic | Type | Direction | Purpose |
|-------|------|-----------|---------|
| `/cmd_vel` | `geometry_msgs/msg/Twist` | Dashboard → ROS | Velocity commands |
| `/odom` | `nav_msgs/msg/Odometry` | ROS → Dashboard | Robot pose & velocity |
| `/scan` | `sensor_msgs/msg/LaserScan` | ROS → Dashboard + SLAM | 2D LiDAR scan |
| `/velodyne_points` | `sensor_msgs/msg/PointCloud2` | ROS internal | 3D point cloud |
| `/map` | `nav_msgs/msg/OccupancyGrid` | ROS → Dashboard | SLAM-built map |
| `/camera/image/compressed` | `sensor_msgs/msg/CompressedImage` | ROS → Dashboard | Camera feed |
| `/tf` | `tf2_msgs/msg/TFMessage` | ROS internal | Coordinate frames |

---

## Design Decisions

1. **No Gazebo** — Custom world simulator (`world_model.py`) uses YAML-defined walls/obstacles with line-segment ray casting. Lighter, faster, no GPU needed.

2. **SLAM uses LiDAR only** — Camera feed is visualization-only, never connected to SLAM. The `/scan` topic from the Velodyne simulator feeds directly into `slam_toolbox`.

3. **Dual-mode frontend** — Dashboard auto-detects ROS bridge connection. Reviewers without Docker/ROS can still see the full UI with static demo assets.

4. **Deadman safety** — The `/cmd_vel` publisher auto-sends zero velocity if no joystick input for 300ms. The motor node also times out after 300ms.

5. **Direct /scan publication** — The Velodyne simulator publishes both `/velodyne_points` (PointCloud2) and `/scan` (LaserScan) directly, eliminating the need for an external `pointcloud_to_laserscan` node.

6. **Aligned fallback mapping** — The demo occupancy map now uses the same warehouse geometry as `eric_sim/maps/warehouse.yaml`, so fallback exploration more closely matches the ROS-backed simulator.

---

## Asset Provenance

| Asset | Source | License |
|-------|--------|---------|
| Camera video | Big Buck Bunny (test-videos.co.uk) | Creative Commons |
| Point cloud PCD | Zaghetto.pcd (Three.js examples) | MIT |
| Reference frame | Assignment GIF screenshot | ERIC Robotics |
| Telemetry/Events JSON | Authored locally | Original |

---

## Verification Checklist

```bash
# 1. ROS packages available
ros2 pkg list | grep -E 'slam_toolbox|rosbridge|eric_sim'

# 2. Topics active
ros2 topic list

# 3. Joystick publishes velocity
ros2 topic echo /cmd_vel

# 4. Robot moves
ros2 topic echo /odom

# 5. TF tree valid
ros2 run tf2_tools view_frames

# 6. LiDAR scan producing
ros2 topic hz /scan

# 7. SLAM map building
ros2 topic echo /map --once

# 8. Camera streaming
ros2 topic hz /camera/image/compressed

# 9. Dashboard showing live data
# Open http://localhost:8080 — status bar should show "ROS LIVE"
# Demo fallback: http://localhost:5173
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Dashboard shows "DEMO" | Ensure the full stack is running: `docker compose up -d --build` |
| WebSocket connection refused | Check rosbridge is on port 9090: `docker logs eric-ros2` |
| Phone cannot open the dashboard on LAN | Allow the Windows firewall prompt for port `8080`, then retry `http://<host-lan-ip>:8080` |
| rosbridge was live and then suddenly dropped | Restart the ROS container: `docker restart eric-ros2` and confirm `Rosbridge WebSocket server started on port 9090` appears in logs |
| No map building | Drive the robot around with WASD to generate scan data for SLAM |
| Docker build fails | Ensure Docker Desktop is running with WSL 2 backend |
| npm install fails | Ensure Node.js 18+ is installed: `node -v` |
