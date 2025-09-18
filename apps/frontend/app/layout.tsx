import "./globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";
import { PublicEnvScript } from "next-runtime-env";
import { Toaster } from "sonner";

import { ThemeProvider } from "../components/providers/theme-provider";
import { TRPCProvider } from "../components/providers/trpc-provider";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "MetaMCP",
  description:
    "MetaMCP is dev platform for dynamically configuring and deploying MCPs",
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html suppressHydrationWarning>
      <head>
        <PublicEnvScript />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ThemeProvider>
          <TRPCProvider>
            {children}
            <Toaster richColors position="top-right" closeButton />
          </TRPCProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
