// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback, useRef } from 'react';

interface DeploymentProgress {
  status: string;
  stage: string;
  progress: number;
  message: string;
  last_updated?: number;
}

interface UseDeploymentProgressReturn {
  progress: DeploymentProgress | null;
  isPolling: boolean;
  startPolling: (jobId: string) => void;
  stopPolling: () => void;
  error: string | null;
}

export const useDeploymentProgress = (
  pollingInterval: number = 2000
): UseDeploymentProgressReturn => {
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentJobIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
    currentJobIdRef.current = null;
  }, []);

  const fetchProgress = useCallback(async (jobId: string) => {
    try {
      console.log(`[Progress] Fetching progress for job: ${jobId}`);
      const response = await fetch(`/docker-api/deploy/progress/${jobId}/`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const progressData = await response.json();
      console.log(`[Progress] Received progress data:`, progressData);
      setProgress(progressData);
      setError(null);
      
      // Stop polling if deployment is complete or failed
      if (progressData.status === 'completed' || 
          progressData.status === 'failed' || 
          progressData.status === 'error') {
        console.log(`[Progress] Stopping polling - final status: ${progressData.status}`);
        stopPolling();
      }
      
    } catch (err) {
      console.error('Error fetching deployment progress:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      stopPolling();
    }
  }, [stopPolling]);

  const startPolling = useCallback((jobId: string) => {
    // Stop any existing polling
    stopPolling();
    
    console.log(`[Progress] Starting polling for job: ${jobId}`);
    currentJobIdRef.current = jobId;
    setIsPolling(true);
    setError(null);
    setProgress(null);
    
    // Initial fetch
    fetchProgress(jobId);
    
    // Start polling interval
    intervalRef.current = setInterval(() => {
      if (currentJobIdRef.current) {
        fetchProgress(currentJobIdRef.current);
      }
    }, pollingInterval);
    
  }, [fetchProgress, stopPolling, pollingInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    progress,
    isPolling,
    startPolling,
    stopPolling,
    error
  };
};
