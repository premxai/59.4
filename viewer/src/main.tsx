import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setConsoleFunction } from "three";
import App from "./App";
import "./styles.css";

// Our code times everything with THREE.Timer (src/lib/clock.ts). The only THREE.Clock left is
// inside @react-three/fiber 9.8.1's store (`clock: new THREE.Clock()`), which we can't change
// without patching the package, so drop just that one deprecation notice and forward the rest.
setConsoleFunction((type, message, ...params) => {
  if (type === "warn" && message.startsWith("THREE.Clock: This module has been deprecated")) return;
  console[type](message, ...params);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
