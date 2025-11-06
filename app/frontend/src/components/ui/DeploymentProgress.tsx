// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
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
}

const stageDisplayNames: Record<string, string> = {
  initialization: 'Initializing',
  setup: 'Setting up environment',
  model_preparation: 'Preparing model',
  container_setup: 'Creating container',
  finalizing: 'Finalizing deployment',
  complete: 'Complete',
  error: 'Error'
};

export const DeploymentProgress: React.FC<DeploymentProgressProps> = ({
  progress,
  className = ''
}) => {
  if (!progress) return null;

  const { status, stage, progress: progressPercent, message } = progress;
  const isError = status === 'error' || status === 'failed';
  const isComplete = status === 'completed';

  return (
    <div className={`mt-4 p-4 border rounded-lg bg-card shadow-sm ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
          {(status === 'running' || status === 'starting') && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2"></div>
          )}
          <span className="text-sm font-medium text-foreground">
            {stageDisplayNames[stage] || stage}
          </span>
        </div>
        <span className="text-sm text-muted-foreground font-mono">
          {isError ? 'Failed' : isComplete ? '100%' : `${progressPercent}%`}
        </span>
      </div>
      
      <div className="mb-3">
        <Progress 
          value={isError ? 100 : isComplete ? 100 : progressPercent} 
          className="h-2"
          indicatorClassName={
            isError 
              ? 'bg-destructive' 
              : isComplete 
                ? 'bg-green-500 dark:bg-green-600' 
                : undefined
          }
        />
      </div>
      
      <p className={`text-xs leading-relaxed ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
        {message}
      </p>
      
      {isError && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-destructive rounded-full mr-2"></div>
          <span className="text-xs text-destructive font-medium">Deployment failed</span>
        </div>
      )}
      
      {isComplete && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-green-500 dark:bg-green-600 rounded-full mr-2"></div>
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">Deployment successful</span>
        </div>
      )}
    </div>
  );
};
