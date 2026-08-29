import type { Metadata } from "next";
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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "RifleLeagues — Every round matters",
    template: "%s | RifleLeagues",
  },
  description:
    "A modern home for target shooting leagues, clubs, competitors, and every score that moves the season forward.",
  openGraph: {
    title: "RifleLeagues — Every round matters",
    description:
      "A modern home for target shooting leagues, clubs, competitors, and every score that moves the season forward.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RifleLeagues — Every round matters",
    description:
      "A modern home for target shooting leagues, clubs, competitors, and every score that moves the season forward.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
