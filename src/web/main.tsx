import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import "./styles.css";

document.addEventListener(
  "keydown",
  (event) => {
    if (!event.metaKey && !event.altKey && !event.ctrlKey) {
      document.documentElement.dataset.input = "keyboard";
    }
  },
  true,
);

document.addEventListener(
  "pointerdown",
  () => {
    document.documentElement.dataset.input = "pointer";
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="vp-site">
      <App />
      <Toaster
        position="top-center"
        theme="light"
        offset={{ top: 64 }}
        mobileOffset={{ top: 60, left: 16, right: 16 }}
      />
    </div>
  </StrictMode>,
);
