# Submission Checklist

## Must be true before sending repo
- [x] `run.bat` launches on Windows
- [x] `setup.ps1 -Mode full` works on Windows with Docker
- [x] `setup.sh` works on Linux/WSL with Docker
- [x] `http://localhost:8080` opens successfully
- [x] ROS-backed dashboard shows `ROS LIVE`
- [x] demo fallback still works if Docker is unavailable

## Documentation
- [x] `README.md` is current
- [x] `docs/REVIEWER_GUIDE.md` is present
- [x] `docs/EVALUATION_MAP.md` is present
- [x] `docs/SCREENSHOT_CHECKLIST.md` is present
- [x] `docs/DEPLOYMENT_GUIDE.md` is present (Railway cloud hosting guide)

## Assets for evaluation
- [x] dashboard overview screenshot (`docs/screenshots/01-dashboard-overview.png`)
- [x] map screenshot (`docs/screenshots/02-map-view.png`)
- [x] camera screenshot (`docs/screenshots/03-camera-view.png`)
- [x] LiDAR screenshot (captured as hardware diagnostics configuration detail in `docs/screenshots/04-diagnostics-view.png`)
- [x] analytics screenshot (`docs/screenshots/05-analytics-view.png`)
- [x] waypoints screenshot (`docs/screenshots/06-waypoints-view.png`)
- [x] responsive screenshot (`docs/screenshots/07-responsive-view-01.png` and `07-responsive-view-02.png`)
- [x] architecture diagram (`docs/screenshots/architecture_diagram.png`)

## Quality gate
- [x] no critical overlap in core views
- [x] map view is usable
- [x] teleop works
- [x] analytics page loads correctly
- [x] containers start cleanly

## Final delivery
- [ ] public GitHub repo updated
- [x] screenshots added under `docs/screenshots/`
- [x] short approach explanation included in README, reviewer guide, and `FSD_Assignment_1_Report.md`

