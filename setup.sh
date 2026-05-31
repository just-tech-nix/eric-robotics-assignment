#!/bin/bash
# ============================================================
# ERIC Robotics - Insight.IO Dashboard
# One-Click Setup & Run Script
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

print_header() {
  echo -e "\n${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}ERIC Robotics — Insight.IO Dashboard${NC}           ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  One-Click Setup & Launch                        ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}\n"
}

print_step() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js not found. Please install Node.js 18+ from https://nodejs.org"
    exit 1
  fi
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ $NODE_VER -lt 18 ]]; then
    print_error "Node.js 18+ required. Found: $(node -v)"
    exit 1
  fi
  print_step "Node.js $(node -v) detected"
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if command -v docker.exe >/dev/null 2>&1; then
      alias docker='docker.exe'
      alias docker-compose='docker-compose.exe'
    else
      return 1
    fi
  fi
  docker info >/dev/null 2>&1
}

setup_frontend() {
  echo -e "\n${BOLD}Setting up React frontend...${NC}"
  cd "$SCRIPT_DIR/insight-io-dashboard"
  if [ ! -d "node_modules" ]; then
    print_step "Installing npm dependencies..."
    npm install --silent
  else
    print_step "Dependencies already installed"
  fi
  cd "$SCRIPT_DIR"
}

start_frontend_dev() {
  echo -e "\n${BOLD}Starting React frontend (demo/dev)...${NC}"
  cd "$SCRIPT_DIR/insight-io-dashboard"
  npm run dev &
  FRONTEND_PID=$!
  cd "$SCRIPT_DIR"
  sleep 3
  print_step "Frontend started (http://localhost:5173)"
}

start_ros() {
  echo -e "\n${BOLD}Starting ROS 2 backend container...${NC}"
  compose_cmd up -d --build ros2-backend
  print_step "ROS 2 backend started (ws://localhost:9090)"
  echo -e "  ${CYAN}Waiting 10s for ROS nodes to initialize...${NC}"
  sleep 10
}

start_full_stack() {
  echo -e "\n${BOLD}Starting full Docker stack...${NC}"
  compose_cmd up -d --build
  print_step "Dashboard started (http://localhost:8080)"
  print_step "Phone/LAN URL: http://<this-pc-lan-ip>:8080"
  print_step "ROS debug URL: ws://localhost:9090"
  echo -e "  ${CYAN}Waiting 10s for containers to initialize...${NC}"
  sleep 10
}

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    echo -e "\n${YELLOW}Shutting down frontend dev server...${NC}"
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

print_header
MODE="auto"
if [[ "${1:-}" == "--frontend-only" ]] || [[ "${1:-}" == "-f" ]]; then
  MODE="frontend"
elif [[ "${1:-}" == "--ros-only" ]] || [[ "${1:-}" == "-r" ]]; then
  MODE="ros"
elif [[ "${1:-}" == "--stop" ]]; then
  MODE="stop"
elif [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
  echo "Usage: ./setup.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  (no args)             Auto-detect: Docker full stack, else frontend demo"
  echo "  -f, --frontend-only   Start only the local React frontend (demo mode)"
  echo "  -r, --ros-only        Start only the ROS 2 backend container"
  echo "  --stop                Stop all running services"
  echo "  -h, --help            Show this help message"
  exit 0
fi

if [[ "$MODE" == "stop" ]]; then
  echo "Stopping services..."
  compose_cmd down 2>/dev/null || true
  pkill -f 'vite' 2>/dev/null || true
  print_step "All services stopped."
  exit 0
fi

if [[ "$MODE" == "frontend" ]]; then
  check_node
  print_warn "Running in FRONTEND-ONLY mode (demo/static data)"
  setup_frontend
  start_frontend_dev
  echo -e "\n${GREEN}${BOLD}Dashboard running at: http://localhost:5173${NC}"
  echo -e "${YELLOW}Running in demo mode — no ROS backend connected${NC}"
  echo -e "Press Ctrl+C to stop\n"
  wait "$FRONTEND_PID"
elif [[ "$MODE" == "ros" ]]; then
  if ! check_docker; then
    print_error "Docker is required for ROS backend. Install Docker Desktop."
    exit 1
  fi
  start_ros
  echo -e "\n${GREEN}${BOLD}ROS 2 backend running. ws://localhost:9090${NC}\n"
else
  if check_docker; then
    start_full_stack
    echo -e "\n${GREEN}${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  Full stack running!${NC}"
    echo -e "${GREEN}${BOLD}  Dashboard:  http://localhost:8080${NC}"
    echo -e "${GREEN}${BOLD}  Phone/LAN:  http://<this-pc-lan-ip>:8080${NC}"
    echo -e "${GREEN}${BOLD}  ROS Bridge: ws://localhost:9090 (debug only)${NC}"
    echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "\nRun './setup.sh --stop' to stop all services.\n"
  else
    check_node
    print_warn "Docker not found. Running in DEMO mode (frontend only)."
    setup_frontend
    start_frontend_dev
    echo -e "\n${GREEN}${BOLD}Dashboard running at: http://localhost:5173${NC}"
    echo -e "${YELLOW}Running in demo mode — no ROS backend${NC}"
    echo -e "Press Ctrl+C to stop\n"
    wait "$FRONTEND_PID"
  fi
fi
