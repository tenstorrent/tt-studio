import React from "react";
import { WifiOff } from "lucide-react";
import { motion } from "framer-motion";

interface ConnectionLostAlertProps {}

const ConnectionLostAlert: React.FC<ConnectionLostAlertProps> = () => {
  return (
    <motion.div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="bg-white dark:bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl"
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <motion.div
          className="flex items-center justify-center mb-4"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <WifiOff className="text-red-600 dark:text-red-400 w-16 h-16" />
        </motion.div>
        <h2 className="text-xl font-bold text-left text-gray-900 dark:text-white mb-2">
          Backend Connection Lost
        </h2>
        <p className="text-left text-gray-700 dark:text-gray-300">
          This may be caused by a network issue or the backend servers being
          down. Please check your connection and try again later.
        </p>
      </motion.div>
    </motion.div>
  );
};

export default ConnectionLostAlert;
