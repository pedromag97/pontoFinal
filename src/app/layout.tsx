import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Ponto Final",
  description: "Registo de presenças na obra",
  manifest: "/manifest.json",
  icons: {
    // O separador do browser desenha a 16–32 px: aí entra a versão de
    // traço grosso. O SVG vem primeiro para quem o suporta (escala sem
    // perder nitidez); os PNG são o recurso para quem não suporta.
    icon: [
      { url: "/simbolo-ponto-pequeno.svg", type: "image/svg+xml" },
      { url: "/icons/ponto-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/ponto-favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/ponto-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/ponto-apple-touch.png",
  },
  appleWebApp: {
    capable: true,
    title: "Ponto Final",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#005e9c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
