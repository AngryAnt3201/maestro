import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import "./styles/globals.css";

// Apply platform class for CSS overrides (e.g. Linux performance fixes)
if (navigator.userAgent.includes("Linux")) {
  document.documentElement.classList.add("platform-linux");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
