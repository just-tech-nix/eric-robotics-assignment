import os
from glob import glob
from setuptools import find_packages, setup

package_name = 'eric_sim'

setup(
    name=package_name,
    version='1.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'),
            glob(os.path.join('launch', '*launch.[pxy][yma]*'))),
        (os.path.join('share', package_name, 'config'),
            glob(os.path.join('config', '*.yaml'))),
        (os.path.join('share', package_name, 'maps'),
            glob(os.path.join('maps', '*.yaml'))),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='ERIC Robotics',
    maintainer_email='eric@robotics.dev',
    description='ERIC Robotics warehouse simulation package',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'robot_motor_node = eric_sim.robot_motor_node:main',
            'velodyne_sim_node = eric_sim.velodyne_sim_node:main',
            'camera_stream_node = eric_sim.camera_stream_node:main',
            'diagnostics_node = eric_sim.diagnostics_node:main',
        ],
    },
)
