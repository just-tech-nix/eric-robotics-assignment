# Reviewer Guide

## Fastest way to run

### Option 1 — Full stack (recommended)
Requires Docker.

#### Windows
- Double-click `run.bat`
- Or run: `./setup.ps1 -Mode full`

#### Linux / macOS / WSL
- Run: `./setup.sh`

This starts:
- ROS 2 backend container
- production frontend container
- automatic frontend ↔ ROS communication through `/rosbridge`

Open:
- Local desktop: `http://localhost:8080`
- Same Wi-Fi phone/tablet: `http://<pc-lan-ip>:8080`

### Option 2 — Demo mode fallback
Use this if Docker is unavailable.

#### Windows
- `./setup.ps1 -Mode frontend`

#### Linux / macOS / WSL
- `./setup.sh --frontend-only`

Open:
- `http://localhost:5173`

Demo mode uses bundled assets so the UI can still be evaluated without the ROS backend.

---

## What to check during evaluation

### Design fidelity
- dark Insight.IO layout
- left navigation rail
- map/camera split behavior
- analytics cards and console styling
- responsive desktop layout

### Functional behavior
- ROS connection state shown in live mode
- teleoperation updates robot motion
- LiDAR / point cloud renders
- occupancy grid map updates
- camera feed renders
- analytics panel shows live diagnostics

### Project qualities
- modular React + ROS hook structure
- Dockerized self-hosting
- local/offline runnable setup
- documented architecture and launch flow

---

## Architecture summary

### Frontend
- React 19 + TypeScript + Vite
- Three.js point cloud rendering
- ROS subscriptions via `roslib`
- production frontend served by Nginx

### Backend
- ROS 2 Humble
- custom robot motor simulator
- custom Velodyne-style LiDAR simulator
- camera stream simulator
- `slam_toolbox`
- `rosbridge_server`
- diagnostics publisher

### Communication
- browser connects to same-origin WebSocket endpoint:
  - `ws(s)://<host>/rosbridge`
- Nginx proxies `/rosbridge` to the ROS backend container
- this avoids hardcoded `localhost` issues and works better for phone/LAN access

---

## Known practical note for phone access

If the dashboard loads on desktop but not on the phone, the most likely cause is a Windows firewall prompt blocking inbound access to port `8080`.
Allow the prompt temporarily for the current network, then retry:
- `http://<pc-lan-ip>:8080`

Current detected LAN IP during packaging check:
- `192.168.1.9`

Temporary Windows helpers are included for reversible phone testing:
- `open-phone-access.bat` — requests Administrator approval and opens TCP `8080` only to the current LAN subnet
- `close-phone-access.bat` — removes that temporary allow rule after testing

---

## Stop commands

### Windows
- `./setup.ps1 -Mode stop`

### Linux / macOS / WSL
- `./setup.sh --stop`
