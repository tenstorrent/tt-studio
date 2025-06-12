// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback } from "react";

interface SystemStatus {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: string;
  boardName: string;
  temperature: number;
  devices: Array<{
    index: number;
    board_type: string;
    temperature: number;
    power: number;
    voltage: number;
  }>;
  hardware_status?: "healthy" | "error" | "unknown";
  hardware_error?: string;
  error?: string;
}

interface HardwareStatusHook {
  isHardwareError: boolean;
  hardwareError: string | null;
  boardName: string | null;
  showModal: boolean;
  dismissModal: () => void;
  systemStatus: SystemStatus | null;
  loading: boolean;
}

const HARDWARE_CHECK_INTERVAL = 10000; // Check every 10 seconds
const MODAL_DISMISS_DURATION = 300000; // Don't show modal again for 5 minutes after dismissal

export const useHardwareStatus = (): HardwareStatusHook => {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [lastDismissed, setLastDismissed] = useState<number | null>(null);
  const [lastErrorTime, setLastErrorTime] = useState<number | null>(null);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await fetch("/board-api/footer-data/");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected application/json but got ${contentType}`);
      }

      const data: SystemStatus = await response.json();
      setSystemStatus(data);
      
      // Check if hardware is in error state
      const isError = data.hardware_status === "error" || !!data.hardware_error || !!data.error;
      
      if (isError) {
        const currentTime = Date.now();
        
        // Set error time if this is a new error
        if (!lastErrorTime) {
          setLastErrorTime(currentTime);
        }
        
        // Show modal if:
        // 1. Hardware is in error state
        // 2. Modal hasn't been dismissed recently (within MODAL_DISMISS_DURATION)
        // 3. This is a new error or enough time has passed since last dismissal
        const shouldShowModal = !lastDismissed || 
          (currentTime - lastDismissed > MODAL_DISMISS_DURATION);
        
        if (shouldShowModal && !showModal) {
          setShowModal(true);
        }
      } else {
        // Hardware is healthy, clear error state
        setLastErrorTime(null);
        if (showModal) {
          setShowModal(false);
        }
      }
      
    } catch (error) {
      console.error("Failed to fetch hardware status:", error);
      // On fetch error, we don't immediately show the modal as this might be a network issue
      // But we keep the previous status to avoid false positives
    } finally {
      setLoading(false);
    }
  }, [lastDismissed, lastErrorTime, showModal]);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    setLastDismissed(Date.now());
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchSystemStatus();

    // Set up polling
    const interval = setInterval(fetchSystemStatus, HARDWARE_CHECK_INTERVAL);

    // Cleanup
    return () => clearInterval(interval);
  }, [fetchSystemStatus]);

  // Determine if hardware is in error state
  const isHardwareError = systemStatus?.hardware_status === "error" || 
    !!systemStatus?.hardware_error || 
    !!systemStatus?.error;

  const hardwareError = systemStatus?.hardware_error || 
    systemStatus?.error || 
    (systemStatus?.hardware_status === "error" ? "Hardware communication failed" : null);

  const boardName = systemStatus?.boardName || null;

  return {
    isHardwareError,
    hardwareError,
    boardName,
    showModal,
    dismissModal,
    systemStatus,
    loading,
  };
}; 