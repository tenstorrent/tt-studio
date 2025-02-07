// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import NavBar from "../components/NavBar";
import ChatUI from "../pages/ChatUIPage";
import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import RagManagement from "../components/rag/RagManagement";
import LogsPage from "../pages/LogsPage";
import ObjectDetectionPage from "../pages/ObjectDetectionPage";
import ImageGenPage from "../pages/ImageGenPage";
import NotFoundPage from "../pages/NotFoundPage";

const AppRouter = () => {
  return (
    <RefreshProvider>
      <ModelsProvider>
        <Router>
          <NavBar />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/models-deployed" element={<ModelsDeployed />} />
            <Route path="/chat-ui" element={<ChatUI />} />
            <Route path="/rag-management" element={<RagManagement />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/object-detection" element={<ObjectDetectionPage />} />
            <Route path="/image-generation" element={<ImageGenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Router>
      </ModelsProvider>
    </RefreshProvider>
  );
};

export default AppRouter;
