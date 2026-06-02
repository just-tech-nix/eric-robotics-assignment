# Technical Interview Prep Guide: Full-Stack Developer (Robotics Focus)
**Prepared for Nilesh Kowe**  
**Interview Date:** June 3, 2026, 7:00 PM IST  
**Target Project:** Insight.IO Robot Operator Dashboard  
**Deployment Ref:** `https://eric-robotics-unified-production.up.railway.app`  

---

## Part 1: ROS 2 (Robot Operating System) for Web Developers
*Since you are a first-time ROS user, explain it using web analogies. Say: "I approach ROS 2 as a distributed message-broker system for hardware, similar to RabbitMQ or Apache Kafka, but specialized for robotics."*

### 1. The Core Architecture
*   **Node (Microservice)**: A single executable process that performs a single task (e.g., `camera_stream_node` reads camera frames, `motor_controller_node` rotates wheels).
*   **Topic (Message Channel)**: An asynchronous communication channel. Nodes communicate by **publishing** to topics or **subscribing** to them.
*   **Message (Data Interface)**: Strongly typed structures passed over topics (e.g., `geometry_msgs/msg/Twist` for velocity, `sensor_msgs/msg/LaserScan` for 2D lidar).
*   **Service (RPC / HTTP POST)**: Synchronous request-response communication for instant actions (e.g., calling `/reset_map` returns a success code).
*   **Action (Long-Running Task)**: Asynchronous, goal-oriented pipelines with continuous feedback (e.g., "Navigate to Aisle 3" returns percent-complete until the robot arrives).
*   **`rosbridge_server`**: Web browsers cannot natively speak binary ROS 2 DDS protocols (UDP). We run `rosbridge_websocket` on the robot to translate ROS 2 topics into standard **JSON WebSockets** (TCP) that libraries like `roslibjs` can read.

### 2. Standard Robotics Topics in this Assignment
| Topic Name | Message Type | Direction | What It Does (Web Dev Translation) |
| :--- | :--- | :--- | :--- |
| **`/cmd_vel`** | `geometry_msgs/msg/Twist` | **Publish** | Sends speed commands: linear velocity (m/s) and angular velocity (rad/s). |
| **`/odom`** | `nav_msgs/msg/Odometry` | **Subscribe** | Streams the robot's calculated position (X, Y) and orientation (quaternion). |
| **`/map`** | `nav_msgs/msg/OccupancyGrid` | **Subscribe** | Streams the SLAM-built grid map: metadata (width, height, resolution) and cell values. |
| **`/velodyne_points`** | `sensor_msgs/msg/PointCloud2` | **Subscribe** | Streams raw 3D lidar coordinates for point cloud rendering. |
| **`/camera/image/compressed`** | `sensor_msgs/msg/CompressedImage`| **Subscribe**| Streams JPEG-compressed camera frames to the web dashboard. |

### 3. Coordinate Frames & The TF (Transform) Tree
Robots calculate coordinates in different frames of reference:
1.  **`map` (World Frame)**: Fixed coordinate system. The origin `(0,0)` is where mapping started.
2.  **`odom` (Odometry Frame)**: Calculated by wheel encoders. It drifts over time due to wheel slip.
3.  **`base_link` (Robot Frame)**: Rigidly attached to the center of the physical robot. Origin is the robot's center.
4.  **`laser_sensor` (Sensor Frame)**: Offset from the robot's center (e.g., 20cm forward, 10cm up).
*   **TF Buffer**: Translates coordinates automatically (e.g., "Translating a lidar dot at `(1,0)` in `laser_sensor` frame to `(2.1, 1.2)` in the global `map` frame").

---

## Part 2: System Design for Robot Dashboards
*If asked how you designed the fleet operator dashboard, describe this topology:*

```
 [ Browser Client ] ──(HTTPS/WSS)──> [ Nginx Proxy ] ──(Private Port 9090)──> [ rosbridge_server ] ──(DDS)──> [ ROS 2 Nodes ]
```

### 1. Reverse Proxy (Nginx same-origin proxying)
*   **The Problem**: If you hardcode `ws://192.168.1.50:9090` in your React code, it breaks:
    *   When the robot's LAN IP changes via DHCP.
    *   When running behind secure HTTPS (browsers block unencrypted `ws://` connections from `https://` pages).
*   **The Design**: Nginx serves the React app and proxies `/rosbridge` requests internally to the websocket port.
    *   The browser connects to: `ws://same-host/rosbridge`.
    *   Nginx forwards it to `ws://127.0.0.1:9090`.
    *   This eliminates cross-origin issues (CORS) and automatically wraps WebSockets in secure SSL (`wss://`) when the site is HTTPS.

### 2. Scalability: Single-Container vs. Multi-Container
*   **Multi-Container (Dev)**: Separate Docker containers for Nginx, ROS 2 simulator, and Rosbridge. Great for modular development.
*   **Unified Container (Prod)**: Single Docker image (`Dockerfile.unified`) combining Nginx and ROS 2 using `supervisord` to manage processes.
    *   *Why?* Drastically reduces memory footprint. Railway's free tier has 500MB RAM limits. Splitting containers introduces networking overhead; the unified stack runs on less than 150MB RAM by sharing the local loopback (`127.0.0.1`).

### 3. The Deadman Switch (Failsafe)
*   **The Risk**: If the operator is driving the robot and the Wi-Fi drops, the robot keeps running at the last commanded speed, leading to crashes.
*   **The Solution**: A watchdog timer in the dashboard (`useCmdVelPublisher.ts`):
    *   The joystick publishes commands at 20Hz (every 50ms).
    *   Every time a command is published, we reset a 300ms watchdog timer.
    *   If the connection drops or the browser tab freezes, the timer expires and sends a zero-velocity `(0, 0)` command to immediately stop the robot.

---

## Part 3: Front-End & Rendering Optimizations
*This is the core of the Technical Round 2. Explain how you solved performance bottlenecks in the browser.*

### 1. 3D Point Cloud Optimization (Three.js)
*   **The Bottleneck**: Recreating Three.js geometry objects on every incoming lidar packet (10-20 times per second) triggers heavy garbage collection, causing the browser to freeze.
*   **The Optimization**: Allocate a single, fixed-size **`BufferGeometry`** in WebGL memory on load (e.g., size 30,000 points).
    *   When a new lidar packet arrives, modify the float array buffer in-place (`geometry.attributes.position.array`).
    *   Toggle `geometry.attributes.position.needsUpdate = true` to upload the new coordinate array to the GPU.
    *   This bypasses browser memory allocation completely, keeping rendering at a stable 60 FPS.

### 2. Live Map Optimization (HTML5 Canvas)
*   **The Bottleneck**: The occupancy map is a $400 \times 400$ grid (160,000 cells). Drawing 160,000 separate rectangles with `ctx.fillRect` every frame causes CPU rendering to lag.
*   **The Optimization**: Double Buffering / Offscreen Canvas.
    *   Create a hidden, off-screen canvas equal to the map size.
    *   Only draw the map cells to this off-screen canvas **once** when the map payload actually updates (usually every 1-2 seconds).
    *   In the main loop, stamp the pre-rendered image to the screen using `ctx.drawImage` (which is GPU-accelerated and takes less than 0.1ms).

### 3. State Throttle & Image Decoding
*   **The Bottleneck**: Subscribing to `/camera/image/compressed` at high speeds triggers massive React component re-renders.
*   **The Optimization**: 
    *   Decode the binary raw payload directly into a base64 Data URL (`data:image/jpeg;base64,...`).
    *   Update a ref or restrict state updates to match the camera's frame rate (e.g., 6 FPS) using a throttling wrapper, ensuring React does not waste CPU cycles updating unrelated HUD widgets.

---

## Part 4: Networking and Protocols
*Robotics frontend relies on unique network layers. Memorize these details:*

### 1. WebSocket (TCP) vs. DDS (UDP)
*   **DDS (UDP)**: Used inside the robot for inter-node communication. If a sensor packet drops, DDS drops it and waits for the next one. No retransmission delay.
*   **WebSocket (TCP)**: Used to cross to the browser. Browsers cannot speak raw UDP. TCP guarantees packet delivery, but means network congestion can cause "head-of-line blocking" (delayed packets bunching up).
*   **Operating Strategy**: Keep WebSocket payloads small (e.g., compress images, restrict LiDAR points) to prevent TCP queues from building up.

### 2. Telemetry Jitter & Latency HUD
*   We measure round-trip time (RTT) by pinging the WebSocket connection.
*   The dashboard calculates a running standard deviation of latency (jitter). If jitter spikes, we notify the operator so they can drive slower to prevent lag-overshoot.

---

## Part 5: Interview Strategies & Practice Questions

### Q1: "How did you manage the memory constraints of running a full simulator and ROS stack on Railway?"
> **Suggested Answer**: "Railway's free tier has a 500MB memory quota. Spawning Gazebo or separate microservices was impossible. I designed a unified container using `Dockerfile.unified` that compiles the React production build to static files and copies them into the Nginx directory inside the ROS 2 Humble base image. By running Nginx and ROS 2 as processes under a supervisor inside a single container, they communicate via local loopback (`127.0.0.1`), using only 120MB of RAM total."

### Q2: "Why use Vanilla CSS instead of Tailwind?"
> **Suggested Answer**: "Robotics dashboards require highly specific, pixel-perfect absolute placement for HUD overlays and picture-in-picture widgets. Vanilla CSS allows us to implement custom properties (CSS variables) that bind directly to React states (e.g., updating `--battery-fill` dynamically). It also gives us complete control over performance-optimized hardware animations (using CSS transforms and opacity rather than layout-triggering properties like width or margin)."

### Q3: "What happens if a user connects to the robot from a mobile phone?"
> **Suggested Answer**: "The layout adapts via CSS Grid. On narrow viewports, the sidebar shifts to a top header, and panels stack vertically. Since mobile devices lack keyboard inputs, I implemented virtual joystick triggers that translate touch drag coordinates into `/cmd_vel` linear and angular commands, using the same deadman switch safety architecture to prevent runaway commands on touch release."
