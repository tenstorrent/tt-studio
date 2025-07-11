// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import "./App.css";

import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "react-query";
import { useSetTitle } from "./api/utlis.ts";
import { HeroSectionProvider } from "./providers/HeroSectionContext";
import { StagewiseToolbar } from "@stagewise/toolbar-react";
import ReactPlugin from "@stagewise-plugins/react";

function App() {
  const client = new QueryClient({
    defaultOptions: {},
  });

  useSetTitle();

  return (
    <>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <HeroSectionProvider>
            <AppRouter />
          </HeroSectionProvider>
        </QueryClientProvider>
      </ThemeProvider>
      {import.meta.env.DEV && (
        <StagewiseToolbar
          config={{
            plugins: [ReactPlugin],
          }}
        />
      )}
    </>
  );
}

export default App;
