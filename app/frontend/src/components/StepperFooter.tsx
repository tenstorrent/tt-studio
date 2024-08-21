import { useStepper } from "./ui/stepper";
import { Button } from "./ui/button";
import { Link } from "react-router-dom";
import { RefreshCw, ExternalLink } from "lucide-react";

const StepperFooter = ({
  removeDynamicSteps,
}: {
  removeDynamicSteps: () => void;
}) => {
  const { hasCompletedAllSteps, resetSteps } = useStepper();

  const handleReset = () => {
    removeDynamicSteps();
    resetSteps();
  };

  if (!hasCompletedAllSteps) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        onClick={handleReset}
        className="flex items-center gap-2 px-4 py-2 text-gray-800 bg-gray-300 border border-gray-400 hover:bg-gray-400 hover:text-white rounded-lg dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600 dark:hover:text-white"
      >
        Reset and Deploy Another Model!
        <RefreshCw className="w-5 h-5 ml-2" />
      </Button>

      <Button className="flex items-center gap-2 px-4 py-2 text-gray-800 bg-gray-300 border border-gray-400 hover:bg-gray-400 hover:text-white rounded-lg dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600 dark:hover:text-white">
        <Link
          to={"/models-deployed"}
          className="no-underline text-gray-800 hover:text-white dark:text-gray-300 dark:hover:text-white"
        >
          Models Deployed
        </Link>
        <ExternalLink className="w-5 h-5 ml-2" />
      </Button>
    </div>
  );
};

export default StepperFooter;
