// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import "./App.css";
import { ThemeProvider } from "./providers/ThemeProvider";
import AppRouter from "./routes/index.tsx";
function App() {
  return (
    <>
      <ThemeProvider>
        {/* <div className="h-screen"> */}
        <AppRouter />
        {/* </div> */}
      </ThemeProvider>
    </>
  );
}

export default App;
