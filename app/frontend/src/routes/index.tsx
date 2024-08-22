import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import NavBar from "../components/NavBar";
import ChatUI from "../pages/ChatUIPage";
import { RefreshProvider } from "../providers/RefreshContext";

const AppRouter = () => {
  return (
    <RefreshProvider>
      <Router>
        <NavBar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/models-deployed" element={<ModelsDeployed />} />
          <Route path="/chat-ui" element={<ChatUI />} />
        </Routes>
      </Router>
    </RefreshProvider>
  );
};

export default AppRouter;
