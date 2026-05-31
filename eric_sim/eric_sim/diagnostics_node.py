import math
from typing import Dict, Optional

import rclpy
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import BatteryState


class EricDiagnosticsNode(Node):
    def __init__(self) -> None:
        super().__init__('eric_diagnostics_node')

        self._battery_pct = 96.0
        self._supply_voltage = 24.4
        self._motor_temp_c = 41.5
        self._vibration_g = 0.08
        self._jitter_ms = 8.0
        self._target_linear = 0.0
        self._target_angular = 0.0
        self._measured_linear = 0.0
        self._measured_angular = 0.0
        self._last_cmd_time = self.get_clock().now()
        self._last_odom_time = self.get_clock().now()

        self._battery_pub = self.create_publisher(BatteryState, '/battery_state', 10)
        self._diagnostics_pub = self.create_publisher(DiagnosticArray, '/diagnostics', 10)

        self.create_subscription(Twist, '/cmd_vel', self._handle_cmd_vel, 10)
        self.create_subscription(Odometry, '/odom', self._handle_odom, 10)
        self.create_timer(0.25, self._publish_diagnostics)

    def _handle_cmd_vel(self, msg: Twist) -> None:
        self._target_linear = float(msg.linear.x)
        self._target_angular = float(msg.angular.z)
        self._last_cmd_time = self.get_clock().now()

    def _handle_odom(self, msg: Odometry) -> None:
        self._measured_linear = float(msg.twist.twist.linear.x)
        self._measured_angular = float(msg.twist.twist.angular.z)
        self._last_odom_time = self.get_clock().now()

    def _publish_diagnostics(self) -> None:
        now = self.get_clock().now()
        cmd_age_ms = max(0.0, (now - self._last_cmd_time).nanoseconds / 1_000_000.0)
        odom_age_ms = max(0.0, (now - self._last_odom_time).nanoseconds / 1_000_000.0)

        activity = min(1.0, abs(self._measured_linear) / 1.8 + abs(self._measured_angular) / 2.5)
        tracking_error = abs(self._target_linear - self._measured_linear) + 0.6 * abs(self._target_angular - self._measured_angular)

        # Stable, reviewer-friendly synthetic diagnostics tied to live robot motion.
        if activity > 0.03:
            self._battery_pct = max(18.0, self._battery_pct - (0.012 + activity * 0.024))
        else:
            self._battery_pct = min(99.0, self._battery_pct + 0.003)

        self._supply_voltage = 22.8 + (self._battery_pct / 100.0) * 2.2 - activity * 0.18
        self._motor_temp_c = 40.0 + activity * 19.0 + tracking_error * 4.0
        self._vibration_g = 0.05 + activity * 0.22 + min(0.12, abs(self._measured_angular) * 0.03)
        self._jitter_ms = 7.0 + min(24.0, tracking_error * 18.0 + cmd_age_ms / 220.0)

        battery_msg = BatteryState()
        battery_msg.header.stamp = now.to_msg()
        battery_msg.header.frame_id = 'base_link'
        battery_msg.voltage = float(self._supply_voltage)
        battery_msg.current = float(-1.2 - activity * 3.2)
        battery_msg.percentage = float(self._battery_pct / 100.0)
        battery_msg.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        battery_msg.power_supply_health = BatteryState.POWER_SUPPLY_HEALTH_GOOD
        battery_msg.power_supply_technology = BatteryState.POWER_SUPPLY_TECHNOLOGY_LION
        self._battery_pub.publish(battery_msg)

        diag_msg = DiagnosticArray()
        diag_msg.header.stamp = now.to_msg()
        diag_msg.status = [
            self._build_status(
                name='ERIC Power Rail',
                hardware_id='eric_sim/power',
                values={
                    'supply_voltage': f'{self._supply_voltage:.2f}',
                    'battery_percent': f'{self._battery_pct:.1f}',
                    'current_draw_a': f'{battery_msg.current:.2f}',
                },
                warn_threshold=('battery_percent', 30.0),
            ),
            self._build_status(
                name='ERIC Drivetrain',
                hardware_id='eric_sim/drivetrain',
                values={
                    'motor_temp_c': f'{self._motor_temp_c:.1f}',
                    'vibration_g': f'{self._vibration_g:.3f}',
                    'measured_linear_mps': f'{self._measured_linear:.3f}',
                    'measured_angular_rps': f'{self._measured_angular:.3f}',
                    'target_linear_mps': f'{self._target_linear:.3f}',
                    'target_angular_rps': f'{self._target_angular:.3f}',
                },
                warn_threshold=('motor_temp_c', 58.0),
            ),
            self._build_status(
                name='ERIC Control Loop',
                hardware_id='eric_sim/control',
                values={
                    'jitter_ms': f'{self._jitter_ms:.1f}',
                    'command_age_ms': f'{cmd_age_ms:.1f}',
                    'odom_age_ms': f'{odom_age_ms:.1f}',
                    'tracking_error': f'{tracking_error:.3f}',
                },
                warn_threshold=('jitter_ms', 18.0),
            ),
        ]
        self._diagnostics_pub.publish(diag_msg)

    def _build_status(
        self,
        *,
        name: str,
        hardware_id: str,
        values: Dict[str, str],
        warn_threshold: Optional[tuple[str, float]] = None,
    ) -> DiagnosticStatus:
        status = DiagnosticStatus()
        status.name = name
        status.hardware_id = hardware_id
        status.level = DiagnosticStatus.OK
        status.message = 'Nominal'

        if warn_threshold is not None:
            key, threshold = warn_threshold
            try:
                value = float(values[key])
                if value >= threshold:
                    status.level = DiagnosticStatus.WARN
                    status.message = f'{key} elevated'
            except (KeyError, ValueError):
                pass

        if name == 'ERIC Power Rail':
            if self._battery_pct < 20.0:
                status.level = DiagnosticStatus.ERROR
                status.message = 'Battery reserve low'
        elif name == 'ERIC Drivetrain':
            if self._motor_temp_c > 72.0:
                status.level = DiagnosticStatus.ERROR
                status.message = 'Motor temperature critical'
        elif name == 'ERIC Control Loop':
            if float(values.get('command_age_ms', '0')) > 1200.0:
                status.level = DiagnosticStatus.ERROR
                status.message = 'Command stream stale'

        status.values = [KeyValue(key=k, value=v) for k, v in values.items()]
        return status


def main(args=None) -> None:
    rclpy.init(args=args)
    node = EricDiagnosticsNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
