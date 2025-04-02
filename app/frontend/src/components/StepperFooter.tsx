// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useStepper } from "./ui/stepper";
import { Button } from "./ui/button";
import { Link } from "react-router-dom";
import { RefreshCw, List } from "lucide-react";
import { motion } from "framer-motion";

const RotatingIcon = () => (
  <motion.div
    whileHover={{ rotate: 360 }}
    transition={{ duration: 0.5, ease: "easeInOut" }}
    className="mr-2"
  >
    <RefreshCw className="w-5 h-5" />
  </motion.div>
);

const ScalingIcon = () => (
  <motion.div
    whileHover={{ scale: 1.2 }}
    transition={{ duration: 0.3, ease: "easeInOut" }}
    className="ml-2"
  >
    <List className="w-5 h-5" />
  </motion.div>
);

const StepperFooter = ({ removeDynamicSteps }: { removeDynamicSteps: () => void }) => {
  const { hasCompletedAllSteps, resetSteps } = useStepper();

  const handleReset = () => {
    removeDynamicSteps();
    resetSteps();
  };

  if (!hasCompletedAllSteps) {
    return null;
  }

  return (
    <div className="mt-8 flex justify-center space-x-4 w-full">
      <Button
        onClick={handleReset}
        className="bg-white text-gray-900 hover:bg-gray-100 rounded-md py-2 px-4 text-base font-medium transition-colors flex items-center"
      >
        <RotatingIcon />
        Deploy Another
      </Button>
      <Button
        asChild
        variant="outline"
        className="bg-gray-800 text-white hover:bg-gray-700 border-gray-700 rounded-md py-2 px-4 text-base font-medium transition-colors flex items-center"
      >
        <Link to="/models-deployed" className="flex items-center">
          View Deployed Models
          <ScalingIcon />
        </Link>
      </Button>
    </div>
  );
};

export default StepperFooter;
