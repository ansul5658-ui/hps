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
  title: {
    default: "PriceRadar - AI-Powered Price Comparison",
    template: "%s | PriceRadar",
  },
  description:
    "Compare prices across Amazon, Flipkart, Myntra, Croma and 50+ stores. Find the best deals with AI-powered product matching and price history tracking.",
  keywords: ["price comparison", "best deals", "amazon", "flipkart", "price tracker", "shopping india"],
  authors: [{ name: "PriceRadar" }],
  creator: "PriceRadar",
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://priceradar.in",
    title: "PriceRadar - AI-Powered Price Comparison",
    description: "Compare prices across 50+ Indian stores. Save money on every purchase.",
    siteName: "PriceRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "PriceRadar",
    description: "AI-Powered Price Comparison for Indian Shoppers",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
