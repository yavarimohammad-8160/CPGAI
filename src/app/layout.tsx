import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const vazir = localFont({
  src: [
    {
      path: "../../public/fonts/Vazirmatn-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/Vazirmatn-Regular.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/Vazirmatn-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
});

export const metadata: Metadata = {
  title: "CPGAI",
  applicationName: "CPGAI",
  description: "دستیار هوشمند سی‌پی‌جی پارس",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CPGAI",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f2744",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0f2744" />
        <meta name="apple-web-app-capable" content="yes" />
        <meta name="apple-web-app-title" content="CPGAI" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("cpgai-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}',
          }}
        />
      </head>
      <body className={`${vazir.className} min-h-screen antialiased`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}