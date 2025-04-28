// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { cn } from '../../lib/utils';

interface LogoProps {
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ className }) => {
  try {
    // Try to import the logo
    const logo = require('../assets/logo/tt_logo.svg');
    return <img src={logo} alt="TT Logo" className={cn('h-6 w-auto', className)} />;
  } catch (error) {
    // If logo fails to load, return null instead of showing fallback
    return null;
  }
};

export default Logo; 