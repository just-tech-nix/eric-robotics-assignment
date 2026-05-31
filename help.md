# Resource links for the assignment
This document contains useful links to various resources that can be used to implement the Insight.IO dashboard, including point cloud data, video files, and ROS bag files.

## Point Cloud Data (.pcd files)

### Sample PCD Files
- **Stanford 3D Scanning Repository**: https://graphics.stanford.edu/data/3Dscanrep/
- **PCL Sample Data**: https://github.com/PointCloudLibrary/pcl/tree/master/test
- **KITTI Dataset (Point Clouds)**: http://www.cvlibs.net/datasets/kitti/ (Preffered)
- **SemanticKITTI**: http://semantic-kitti.org/dataset.html

### Large Scale Point Cloud Datasets
- **Waymo Open Dataset**: https://waymo.com/open/
- **nuScenes Dataset**: https://www.nuscenes.org/
- **Apollo Scape**: http://apolloscape.auto/scene.html

## Video Files for Camera Feed

### Sample Video Files
- **Big Buck Bunny (Creative Commons)**: https://download.blender.org/peach/bigbuckbunny_movies/
- **Pexels Free Videos**: https://www.pexels.com/videos/

### Autonomous Driving Video Datasets
- **Cityscapes Dataset**: https://www.cityscapes-dataset.com/
- **Comma2k19**: https://github.com/commaai/comma2k19

## ROS2 Bag Files

### Sample ROS2 Bags
- **ROS2 Tutorials Bags**: https://docs.ros.org/en/humble/Tutorials/Beginner-CLI-Tools/Recording-And-Playing-Back-Data/Recording-And-Playing-Back-Data.html
- **TurtleBot4 Demo Bags**: https://github.com/turtlebot/turtlebot4
- **ROS2 Sample Data**: https://github.com/ros2/rosbag2_storage_default_plugins/tree/rolling/test/rosbag2_storage_default_plugins

### Large Scale ROS2 Datasets
- **Oxford RobotCar Dataset (ROS2)**: https://robotcar-dataset.robots.ox.ac.uk/
- **Canadian Planetary Emulation Terrain 3D Mapping Dataset**: http://asrl.utias.utoronto.ca/datasets/3dmap/
- **New College Dataset (ROS2 Compatible)**: http://www.robots.ox.ac.uk/NewCollegeData/
- **CARLA ROS2 Bridge Datasets**: https://github.com/carla-simulator/ros-bridge/tree/ros2

### Specific Sensor Data ROS2 Bags
- **Velodyne LiDAR ROS2**: https://github.com/ros-drivers/velodyne/tree/ros2
- **Intel RealSense ROS2**: https://github.com/IntelRealSense/realsense-ros/tree/ros2-development
- **ZED Camera ROS2**: https://github.com/stereolabs/zed-ros2-wrapper

## Web-Compatible Formats

### For Browser Compatibility
- **Video**: MP4 (H.264), WebM, OGV
- **Point Clouds**: PLY, JSON, Binary formats
- **Images**: JPEG, PNG, WebP

### JavaScript Libraries for Data Handling
- **Three.js**: https://threejs.org/ (3D rendering, point cloud visualization)
- **PCL.js**: https://pcljs.org/ (Point Cloud Library for JavaScript)
- **ROSLib.js**: https://github.com/RobotWebTools/roslibjs (ROS1/ROS2 communication in browser)
- **ROS3D.js**: https://github.com/RobotWebTools/ros3djs (3D visualization for ROS1/ROS2)
- **ROS2 Web Bridge**: https://github.com/RobotWebTools/ros2-web-bridge (Native ROS2 web communication)
- **FoxGlove Studio**: https://foxglove.dev/ (Modern robotics visualization platform for ROS2)

## Notes for Implementation

- Implement progressive loading for large point cloud files
- Use the proper video streaming protocols for large video files
- Just FYI, ROS2 bags use SQLite3 format by default
- Use `ros2 bag convert` for format conversion between ROS1 and ROS2 bags
- FoxGlove Studio provides excellent web-based visualization for ROS2 data
- Another open source tool that does great data viz. is [rosboard](https://github.com/dheera/rosboard)