"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Em desenvolvimento o SW serviria chunks JS antigos do cache (os nomes
    // não têm hash como em produção) — só registamos em produção, e em dev
    // limpamos qualquer SW/cache que tenha ficado de sessões anteriores.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()));
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // PWA é progressivo: se o SW falhar, a app continua a funcionar online.
    });
  }, []);

  return null;
}
