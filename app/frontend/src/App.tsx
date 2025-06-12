// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import "./App.css";

import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "react-query";
import { setTitleBasedOnEnvironment } from "./api/utlis.ts";
import { HeroSectionProvider } from "./providers/HeroSectionContext";
import HardwareWarningModal from "./components/HardwareWarningModal";
import { useHardwareStatus } from "./hooks/useHardwareStatus";

function App() {
  const client = new QueryClient({
    defaultOptions: {},
  });

  setTitleBasedOnEnvironment();

  const { showModal, dismissModal, hardwareError, boardName } =
    useHardwareStatus();

  return (
    <>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <HeroSectionProvider>
            <AppRouter />
            <HardwareWarningModal
              isOpen={showModal}
              onClose={dismissModal}
              hardwareError={hardwareError || undefined}
              boardName={boardName || undefined}
            />
          </HeroSectionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </>
  );
}

export default App;
