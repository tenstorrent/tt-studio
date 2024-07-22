import { useStepper } from "./ui/stepper";
import { Button } from "./ui/button";
import { Link } from "react-router-dom";
import { RefreshCw, Package } from "lucide-react";

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
        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-900 text-white rounded-lg dark:bg-gray-200 dark:hover:bg-gray-400 dark:text-black"
      >
        <RefreshCw className="w-5 h-5" />
        Reset and Deploy Another Model!
      </Button>

      <Button className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-900 text-white rounded-lg dark:bg-gray-200 dark:hover:bg-gray-400 dark:text-black">
        <Package className="w-5 h-5" />
        <Link
          to={"/models-deployed"}
          className="no-underline text-white hover:text-white dark:text-black dark:hover:text-black"
        >
          Models Deployed
        </Link>
      </Button>
    </div>
  );
};

export default StepperFooter;
