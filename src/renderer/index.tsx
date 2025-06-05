import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// Direkt die App rendern, die Ladesequenz wird jetzt über App.tsx gesteuert
const Root: React.FC = () => {
  return <App initialLoadingText="Searching for active licence..." />;
};


const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
