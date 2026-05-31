import { useCallback, useState } from 'react';
import { Ros } from 'roslib';
import { getRos } from './rosClient';

/**
 * Hook to reset the SLAM map via the /slam_toolbox/clear_changes service.
 * Returns a function to call the reset and a boolean indicating if the call is in flight.
 */
export function useResetMap() {
  const [resetPending, setResetPending] = useState(false);

  const reset = useCallback(async () => {
    if (resetPending) return;
    setResetPending(true);
    try {
      const ros = getRos();
      // Ensure we are connected
      if (!ros.isConnected) {
        throw new Error('ROS bridge not connected');
      }
      // Create service client
      // @ts-ignore - roslib types may not match exactly but works at runtime
      const clearChangesService = new Ros.Service({
        ros,
        name: '/slam_toolbox/clear_changes',
        serviceType: 'std_srvs/srv/Empty',
      });
      // Call service (no request data)
      await new Promise<void>((resolve, reject) => {
        // @ts-ignore
        clearChangesService.callService(new Ros.ServiceRequest({}), (result) => {
          // std_srvs/srv/Empty response is empty
          resolve();
        }, (error: any) => {
          reject(new Error(`Service call failed: ${error}`));
        });
      });
    } catch (err: any) {
      console.error('Reset map failed:', err);
    } finally {
      setResetPending(false);
    }
  }, [resetPending]);

  return { reset, resetPending };
}