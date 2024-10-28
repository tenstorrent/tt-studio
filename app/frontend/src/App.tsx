// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import "./App.css";
import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
import { QueryClient, QueryClientProvider } from "react-query";
function App() {
  const client = new QueryClient({
    defaultOptions: {},
  });

  return (
    <>
      <ThemeProvider>
        {/* <div className="h-screen"> */}
        <QueryClientProvider client={client}>
          <AppRouter />
        </QueryClientProvider>
        {/* </div> */}
      </ThemeProvider>
    </>
  );
}

export default App;
