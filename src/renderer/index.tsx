import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { initRendererAnalytics, setupUIErrorHandlers } from "./analytics";
import ErrorBoundary from "./components/ErrorBoundary";

// Initialize renderer analytics and error handlers
initRendererAnalytics();
setupUIErrorHandlers();

// PostHog Error Tracking is now working correctly with proper structure

// Direkt die App rendern, die Ladesequenz wird jetzt über App.tsx gesteuert
const Root: React.FC = () => {
  return (
    <ErrorBoundary>
      <App initialLoadingText="Searching for active licence..." />
    </ErrorBoundary>
  );
};

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
