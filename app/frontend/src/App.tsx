// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import "./App.css";

import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSetTitle } from "./api/utlis.ts";
import { HeroSectionProvider } from "./providers/HeroSectionContext.tsx";
import { FooterVisibilityProvider } from "./providers/FooterVisibilityContext.tsx";
// Development toolbar imports commented out - remove if not needed
// import { StagewiseToolbar } from "@stagewise/toolbar-react";
// import ReactPlugin from "@stagewise-plugins/react";

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
            <FooterVisibilityProvider>
              <AppRouter />
            </FooterVisibilityProvider>
          </HeroSectionProvider>
        </QueryClientProvider>
      </ThemeProvider>
      {/* Development toolbar commented out - remove if not needed
      {import.meta.env.DEV && (
        <StagewiseToolbar
          config={{
            plugins: [ReactPlugin],
          }}
        />
      )} */}
    </>
  );
}

export default App;
