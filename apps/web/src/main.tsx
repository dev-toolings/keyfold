import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/ui/toast";

// Read by the focus-visible variant in index.css. Typing in a text field and a
// lone modifier key leave the modality alone; Tab always means keyboard.
const TEXT_ENTRY = 'textarea, select, [contenteditable], input:not([type="checkbox"], [type="radio"])';
window.addEventListener("pointerdown", () => (document.documentElement.dataset.modality = "pointer"), true);
window.addEventListener(
  "keydown",
  (event) => {
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    if (event.key !== "Tab" && event.target instanceof Element && event.target.matches(TEXT_ENTRY)) return;
    document.documentElement.dataset.modality = "keyboard";
  },
  true,
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
