// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState, useEffect } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"

interface HealthBadgeProps {
  deployId: string
}

type HealthStatus = 'healthy' | 'unhealthy' | 'unknown'

const HealthBadge: React.FC<HealthBadgeProps> = ({ deployId }) => {
  console.log('HealthBadge component rendered', deployId)
  const [health, setHealth] = useState<HealthStatus>('unknown')
  const [isLoading, setIsLoading] = useState(true)

  const fetchHealth = async () => {
    try {
      const response = await fetch('/models/health/', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Deploy-Id': deployId,
        }
      })

      if (response.status === 200) {
        setHealth('healthy')
      } else if (response.status === 503) {
        setHealth('unhealthy')
      } else {
        setHealth('unknown')
      }
    } catch (e) {
      setHealth('unknown')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const intervalId = setInterval(fetchHealth, 360000) // 6 minutes
    return () => clearInterval(intervalId)
  }, [deployId])

  const getStatusColor = () => {
    switch (health) {
      case 'healthy':
        return 'bg-[#4CAF50] text-white'
      case 'unhealthy':
        return 'bg-red-500 text-white'
      default:
        return 'bg-yellow-500 text-white'
    }
  }

  const getDotColor = () => {
    switch (health) {
      case 'healthy':
        return 'bg-[#A5D6A7]'
      case 'unhealthy':
        return 'bg-red-300'
      default:
        return 'bg-yellow-300'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${getStatusColor()}`}>
            <div className={`w-2 h-2 rounded-full ${getDotColor()}`} />
            {isLoading ? "Loading..." : health}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Docker Container Health: {health} (refreshed every 6 minutes)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default HealthBadge

