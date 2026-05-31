# Insight.IO Cloud Deployment Guide (Railway)
**Target Platform:** [Railway.app](https://railway.app) (Free Trial / Starter Tier)

This guide details how to host the complete **Insight.IO** stack (both the React frontend and the ROS 2 Humble backend simulator) directly in the cloud on Railway, without needing a local PC or Cloudflare tunnels.

---

## 1. How It Works (Zero-Tunnel Architecture)

In the default local setup, Nginx acts as a reverse proxy that routes WebSocket traffic from the browser to the ROS 2 backend. When deployed to Railway, we use the same topology:

```
Browser Client ──(Public HTTPS/WSS)──> Nginx Frontend (Public URL)
                                            │
                                    (Private Network)
                                            ▼
                                  ROS 2 Backend (Private port 9090)
```

1. **Private Networking**: Railway automatically places all services in a project on a secure private network. Services can communicate using their service names as DNS hosts.
2. **Same-Origin Proxying**: The browser only communicates with the Nginx frontend. Nginx proxies the websocket endpoint (`/rosbridge`) internally to the ROS 2 service on port `9090`.
3. **No Tunnel Required**: Since the ROS 2 backend is not exposed directly to the public internet, no Cloudflare tunnel is needed. Only the frontend is given a public domain.

---

## 2. Step-by-Step Deployment (Option A: Direct GitHub Import)

This is the easiest path, where Railway builds your code directly from your GitHub repository.

### Step 1: Push Project to GitHub
Ensure your repository is pushed to GitHub (e.g., under your user `just-tech-nix` as seen in your screenshots).

### Step 2: Create a New Project on Railway
1. Log in to [Railway.app](https://railway.app).
2. Click **New Project** -> **GitHub Repository**.
3. Select your repository.

### Step 3: Configure the ROS 2 Backend Service
Railway will import the root directory as the first service. Let's configure it as the backend:
1. Rename the service to **`ros2-backend`** (this matches the hostname in Nginx config).
2. Under **Settings** -> **Build**:
   - Ensure the **Dockerfile Path** is set to `Dockerfile` (in the root directory).
3. Under **Settings** -> **Deploy**:
   - Ensure it does *not* have a public domain (keep it private).
   - Verify it exposes port `9090`.

### Step 4: Add the Frontend Service
1. In the Railway project canvas, click **+ New** -> **GitHub Repository** -> select the same repository again.
2. Rename this service to **`dashboard-frontend`**.
3. Under **Settings** -> **Build**:
   - Set the **Root Directory** to `/insight-io-dashboard`.
   - Set the **Dockerfile Path** to `Dockerfile` (which builds the Nginx + React image).
4. Under **Settings** -> **Networking**:
   - Click **Generate Domain** to get a public `xxx.railway.app` URL.

---

## 3. Alternative Deployment (Option B: Pre-built Docker Images)
> [!TIP]
> **Why use pre-built images?** ROS 2 Docker images are large, and running `colcon build` can occasionally exceed Railway's free build timeout or builder memory limits. Pushing pre-built images to a registry ensures 100% reliable deployment on Railway.

### Step 1: Build & Push Images Locally
On your local PC, build the Docker images and push them to Docker Hub (or GitHub Container Registry):

```bash
# 1. Login to Docker Hub
docker login

# 2. Build and push the ROS 2 backend
docker build -t your-dockerhub-username/eric-ros2:latest -f Dockerfile .
docker push your-dockerhub-username/eric-ros2:latest

# 3. Build and push the React frontend
cd insight-io-dashboard
docker build -t your-dockerhub-username/eric-dashboard:latest -f Dockerfile .
docker push your-dockerhub-username/eric-dashboard:latest
```

### Step 2: Deploy Images on Railway
1. In Railway, click **New Project** -> **Docker Image**.
2. Deploy the backend image: `your-dockerhub-username/eric-ros2:latest`. Rename the service to `ros2-backend`.
3. Click **+ New** -> **Docker Image** and deploy `your-dockerhub-username/eric-dashboard:latest`. Rename the service to `dashboard-frontend` and generate a public domain under Settings.

---

## 4. Single-Container Deployment (Option C: Unified Image - RECOMMENDED)

This option packages both the React frontend and the ROS 2 simulation backend together in a **single Docker container** (using `Dockerfile.unified`).

### Why use a unified container?
* **Resource Optimization**: Railway's free tier has a memory quota. Running Nginx and ROS 2 in a single container uses less overall overhead than two separate services.
* **One-Click Setup**: You only deploy a single service on Railway, expose port `80`, and generate a domain. No service mapping or private network variables are required.
* **Instant Routing**: Nginx proxies the websocket endpoint to `127.0.0.1:9090` locally within the same container, guaranteeing instant, latency-free bridge discovery.

### Step 1: Build the Unified Image Locally
Run the following build command on your machine (we have already run and verified this build on your PC, creating `eric-unified:latest`!):
```bash
# Tag and build the unified image
docker build -t your-dockerhub-username/eric-unified:latest -f Dockerfile.unified .
```

### Step 2: Push to Registry
```bash
docker push your-dockerhub-username/eric-unified:latest
```

### Step 3: Deploy on Railway
1. Go to Railway, click **New Project** -> **Docker Image**.
2. Enter your image: `your-dockerhub-username/eric-unified:latest`.
3. In the service **Settings** -> **Networking**:
   - Ensure the port is set to `80`.
   - Click **Generate Domain** to get your public URL.
4. Once running, open the generated domain. The system will connect to the ROS 2 simulation immediately inside the container!

---

## 5. Verification

Once your service shows a green status (Active):
1. Click the public URL generated by Railway.
2. The dashboard will load in your browser.
3. Check the status indicator: it will show **`ROS LIVE`** as Nginx successfully connects to the ROS 2 backend over the internal loopback.
4. Drive the simulated robot using `W`, `A`, `S`, `D` — telemetry metrics, sensor logs, and the SLAM occupancy grid will compile and update dynamically in the cloud!

