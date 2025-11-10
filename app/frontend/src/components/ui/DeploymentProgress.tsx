// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from 'react';
import { Progress } from './progress';

interface DeploymentProgressProps {
  progress: {
    status: string;
    stage: string;
    progress: number;
    message: string;
    last_updated?: number;
  } | null;
  className?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  onViewLogs?: () => void;
  startTime?: number;
}

const stageDisplayNames: Record<string, string> = {
  initialization: 'Initializing',
  setup: 'Setting up environment',
  model_preparation: 'Preparing model',
  container_setup: 'Creating container',
  finalizing: 'Finalizing deployment',
  complete: 'Complete',
  error: 'Error',
  stalled: 'Stalled',
  cancelled: 'Cancelled',
  starting: 'Starting'
};

const stageIcons: Record<string, string> = {
  initialization: '⚙️',
  setup: '🔧',
  model_preparation: '📦',
  container_setup: '🐳',
  finalizing: '🔗',
  complete: '✅',
  error: '❌',
  stalled: '⏱️',
  cancelled: '🛑',
  starting: '🚀'
};

export const DeploymentProgress: React.FC<DeploymentProgressProps> = ({
  progress,
  className = '',
  onRetry,
  onCancel,
  onViewLogs,
  startTime
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  if (!progress) return null;

  const { status, stage, progress: progressPercent, message } = progress;
  const isError = status === 'error' || status === 'failed';
  const isComplete = status === 'completed';
  const isStalled = status === 'stalled';
  const isCancelled = status === 'cancelled';
  const isRunning = status === 'running' || status === 'starting';

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressBarColor = () => {
    if (isError) return 'bg-destructive';
    if (isComplete) return 'bg-green-500 dark:bg-green-600';
    if (isStalled) return 'bg-yellow-500 dark:bg-yellow-600';
    if (isCancelled) return 'bg-gray-500 dark:bg-gray-600';
    return undefined;
  };


  return (
    <div className={`mt-4 p-4 border rounded-lg bg-card shadow-sm ${className}`}>
      {/* Header with stage and progress */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
          {isRunning && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2"></div>
          )}
          <span className="text-lg mr-2">{stageIcons[stage] || '⚙️'}</span>
          <span className="text-sm font-medium text-foreground">
            {stageDisplayNames[stage] || stage}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {startTime && (
            <span className="text-xs text-muted-foreground">
              {formatTime(elapsedTime)}
            </span>
          )}
          <span className="text-sm text-muted-foreground font-mono">
            {isError ? 'Failed' : isComplete ? '100%' : `${progressPercent}%`}
          </span>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="mb-3">
        <Progress 
          value={isError ? 100 : isComplete ? 100 : progressPercent} 
          className="h-2"
          indicatorClassName={getProgressBarColor()}
        />
      </div>
      
      {/* Message */}
      <p className={`text-xs leading-relaxed ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
        {message}
      </p>
      
      {/* Status indicators */}
      {isError && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-destructive rounded-full mr-2"></div>
            <span className="text-xs text-destructive font-medium">Deployment failed</span>
          </div>
          <div className="flex space-x-2">
            {onViewLogs && (
              <button
                onClick={onViewLogs}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                View Logs
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}
      
      {isComplete && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-green-500 dark:bg-green-600 rounded-full mr-2"></div>
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">Deployment successful</span>
        </div>
      )}

      {isStalled && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-yellow-500 dark:bg-yellow-600 rounded-full mr-2"></div>
            <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">Deployment stalled</span>
          </div>
          <div className="flex space-x-2">
            {onViewLogs && (
              <button
                onClick={onViewLogs}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                View Logs
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-xs px-2 py-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-gray-500 dark:bg-gray-600 rounded-full mr-2"></div>
          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">Deployment cancelled</span>
        </div>
      )}

      {isRunning && onCancel && (
        <div className="flex justify-end mt-3">
          <button
            onClick={onCancel}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
