import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles.css";

import * as Tooltip from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { App } from "./App";
import { Toaster } from "./components/Toast";
import { applyTheme } from "./theme";

applyTheme();

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider>
          <Router hook={useHashLocation}>
            <App />
          </Router>
          <Toaster />
        </Tooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
