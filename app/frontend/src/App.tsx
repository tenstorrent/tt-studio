// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import "./App.css";

import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "react-query";
import { setTitleBasedOnEnvironment } from "./api/utlis.ts";
function App() {
  const client = new QueryClient({
    defaultOptions: {},
  });

  setTitleBasedOnEnvironment();

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
