// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useTitleBasedOnEnvironment } from "./api/utlis.ts";
import "./App.css";

import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "react-query";
function App() {
  const client = new QueryClient({
    defaultOptions: {},
  });

  useTitleBasedOnEnvironment();

  return (
    <>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <AppRouter />
        </QueryClientProvider>
      </ThemeProvider>
    </>
  );
}

export default App;
