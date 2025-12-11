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
  startPolling: (jobId: string, useSSE?: boolean) => void;
  stopPolling: () => void;
  error: string | null;
  isSSEConnected: boolean;
}

export const useDeploymentProgress = (
  pollingInterval: number = 1000
): UseDeploymentProgressReturn => {
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSSEConnected, setIsSSEConnected] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsSSEConnected(false);
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

  const startSSE = useCallback((jobId: string) => {
    try {
      console.log(`[Progress] Starting SSE for job: ${jobId}`);
      const eventSource = new EventSource(`/docker-api/deploy/progress/stream/${jobId}/`);
      
      eventSource.onopen = () => {
        console.log(`[Progress] SSE connection opened for job: ${jobId}`);
        setIsSSEConnected(true);
        setError(null);
      };
      
      eventSource.onmessage = (event) => {
        try {
          const progressData = JSON.parse(event.data);
          console.log(`[Progress] Received SSE progress data:`, progressData);
          setProgress(progressData);
          setError(null);
          
          // Stop SSE if deployment is complete or failed
          if (progressData.status === 'completed' || 
              progressData.status === 'failed' || 
              progressData.status === 'error' ||
              progressData.status === 'cancelled') {
            console.log(`[Progress] Stopping SSE - final status: ${progressData.status}`);
            stopPolling();
          }
        } catch (parseError) {
          console.error('Error parsing SSE data:', parseError);
          setError('Error parsing progress data');
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        setError('Connection error - falling back to polling');
        setIsSSEConnected(false);
        eventSource.close();
        
        // Fallback to polling
        console.log(`[Progress] SSE failed, falling back to polling for job: ${jobId}`);
        startPollingFallback(jobId);
      };
      
      eventSourceRef.current = eventSource;
      
    } catch (error) {
      console.error('Error starting SSE:', error);
      setError('SSE not supported - using polling');
      startPollingFallback(jobId);
    }
  }, [stopPolling]);

  const startPollingFallback = useCallback((jobId: string) => {
    console.log(`[Progress] Starting polling fallback for job: ${jobId}`);
    setIsPolling(true);
    
    // Initial fetch
    fetchProgress(jobId);
    
    // Start polling interval
    intervalRef.current = setInterval(() => {
      if (currentJobIdRef.current) {
        fetchProgress(currentJobIdRef.current);
      }
    }, pollingInterval);
  }, [fetchProgress, pollingInterval]);

  const startPolling = useCallback((jobId: string, useSSE: boolean = false) => {
    // Stop any existing polling
    stopPolling();
    
    currentJobIdRef.current = jobId;
    setError(null);
    setProgress(null);
    
    if (useSSE) {
      startSSE(jobId);
    } else {
      startPollingFallback(jobId);
    }
    
  }, [stopPolling, startSSE, startPollingFallback]);

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
    error,
    isSSEConnected
  };
};
