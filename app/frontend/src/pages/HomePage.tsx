import { useState, useEffect } from "react";
import StepperDemo from "../components/SelectionSteps";
import ConnectionLostAlert from "../components/ConnectionLostAlert";
import axios from "axios";

const HomePage = () => {
  const [connectionLost, setConnectionLost] = useState(false);

  const checkConnection = async () => {
    try {
      await axios.get("/api/health-check");
      setConnectionLost(false);
    } catch (error) {
      setConnectionLost(true);
    }
  };

  useEffect(() => {
    const intervalId = setInterval(checkConnection, 5000);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <>
      <div className="h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative flex items-center justify-center">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 20%, black 100%)",
          }}
        ></div>
        <div className="flex flex-grow justify-center items-center w-full h-screen">
          {connectionLost ? <ConnectionLostAlert /> : <StepperDemo />}
        </div>
      </div>
    </>
  );
};

export default HomePage;
