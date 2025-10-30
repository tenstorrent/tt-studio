// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';

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
    <div className={`mt-4 p-4 border rounded-lg bg-white shadow-sm ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
          {(status === 'running' || status === 'starting') && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent mr-2"></div>
          )}
          <span className="text-sm font-medium text-gray-700">
            {stageDisplayNames[stage] || stage}
          </span>
        </div>
        <span className="text-sm text-gray-500 font-mono">
          {isError ? 'Failed' : isComplete ? '100%' : `${progressPercent}%`}
        </span>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div 
          className={`h-2 rounded-full transition-all duration-500 ease-out ${
            isError 
              ? 'bg-red-500' 
              : isComplete 
                ? 'bg-green-500' 
                : 'bg-blue-600'
          }`}
          style={{ 
            width: `${isError ? 100 : isComplete ? 100 : progressPercent}%` 
          }}
        />
      </div>
      
      <p className={`text-xs leading-relaxed ${isError ? 'text-red-600' : 'text-gray-600'}`}>
        {message}
      </p>
      
      {isError && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
          <span className="text-xs text-red-600 font-medium">Deployment failed</span>
        </div>
      )}
      
      {isComplete && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
          <span className="text-xs text-green-600 font-medium">Deployment successful</span>
        </div>
      )}
    </div>
  );
};
