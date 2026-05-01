import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StatusProvider } from "./hooks/useStatus";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <StatusProvider>
        <App />
      </StatusProvider>
    </StrictMode>,
  );
}
