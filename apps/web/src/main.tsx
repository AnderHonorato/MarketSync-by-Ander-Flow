import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

if (import.meta.env.DEV && window.location.hostname === "127.0.0.1") {
  const canonical = new URL(window.location.href);
  canonical.hostname = "localhost";
  window.location.replace(canonical);
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
