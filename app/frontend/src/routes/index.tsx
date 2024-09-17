// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import NavBar from "../components/NavBar";
import ChatUI from "../pages/ChatUIPage";
import { RefreshProvider } from "../providers/RefreshContext";
import RagManagement from "../pages/rag/RagManagement";

const AppRouter = () => {
  return (
    <RefreshProvider>
    <Router>
      <NavBar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/models-deployed" element={<ModelsDeployed />} />
        <Route path="/chat-ui" element={<ChatUI />} />
        <Route path="/rag-management" element={<RagManagement />} />
      </Routes>
    </Router>
    </RefreshProvider>
  );
};

export default AppRouter;
