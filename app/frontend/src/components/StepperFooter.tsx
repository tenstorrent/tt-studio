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
        className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white dark:bg-blue-700 dark:hover:bg-blue-800 dark:text-blue-100 rounded-lg"
      >
        <RefreshCw className="w-5 h-5" />
        Reset and Deploy Another Model!
      </Button>

      <Button className="flex items-center gap-2 px-4 py-2 border border-blue-500 text-white hover:bg-blue-300 hover:text-white dark:border-blue-400 dark:text-white dark:hover:bg-blue-400 dark:hover:text-white rounded-lg group">
        <Package className="w-5 h-5" />
        <Link
          to={"/models-deployed"}
          className="no-underline text-white group-hover:text-white dark:text-white dark:group-hover:text-white"
        >
          Models Deployed
        </Link>
      </Button>
    </div>
  );
};

export default StepperFooter;
