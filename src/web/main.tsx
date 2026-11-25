import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import "./theme.css";
import "./files.css";
import "./teams.css";
import "./identity.css";
import "./App.css";

document.addEventListener("keydown", event => {
  if (!event.metaKey && !event.altKey && !event.ctrlKey) document.documentElement.dataset.input = "keyboard";
}, true);
document.addEventListener("pointerdown", () => { document.documentElement.dataset.input = "pointer"; }, true);

createRoot(document.getElementById("root")!).render(
  <StrictMode><div className="vp-site">
    <App />
    <Toaster position="top-center" offset={{ top: 72 }} mobileOffset={{ top: 66, left: 16, right: 16 }} />
  </div></StrictMode>,
);
