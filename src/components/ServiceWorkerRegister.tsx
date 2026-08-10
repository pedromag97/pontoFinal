"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA é progressivo: se o SW falhar, a app continua a funcionar online.
      });
    }
  }, []);

  return null;
}
