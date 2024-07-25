import React, { useState } from "react";
import axios from "axios";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

const ResetButton: React.FC = () => {
  const [statusMessage, setStatusMessage] = useState<string>(
    "Click the button to reset the board."
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const resetBoard = async () => {
    setIsLoading(true);
    setStatusMessage("Resetting board...");
    try {
      const response = await axios.post("/reset-board/");
      setStatusMessage(response.data.message);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        setStatusMessage(
          "Error resetting board: " +
            (error.response?.data?.message || error.message)
        );
      } else if (error instanceof Error) {
        setStatusMessage("Error resetting board: " + error.message);
      } else {
        setStatusMessage("An unknown error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <Button onClick={resetBoard} disabled={isLoading} className="mb-4">
        {isLoading ? <Spinner /> : "Reset Board"}
      </Button>
      <p>{statusMessage}</p>
    </div>
  );
};

export default ResetButton;
