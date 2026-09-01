import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://gates.example.com"),
  title: "Gate Control — Turnage Automation",
  description: "Turnage Automation multi-gate MQTT operations console.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Gate Control",
  },
  icons: {
    icon: "/gate-icon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Gate Control",
    description: "A Turnage Automation multi-gate MQTT operations console for every screen.",
    images: [{ url: "/og.png", width: 1745, height: 910, alt: "Gate Control MQTT operations console" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#132936",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script dangerouslySetInnerHTML={{ __html: `try{const theme=localStorage.getItem("gate-control-theme");if(theme==="system"||theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
