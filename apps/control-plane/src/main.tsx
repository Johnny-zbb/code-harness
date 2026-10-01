import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/globals.css";
import "./styles.css";
import "./board.css";
import "./project-board.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
