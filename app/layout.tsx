import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { SCHOOL } from "@/lib/data";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = "https://svmschool.edu.in";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SCHOOL.short} — ${SCHOOL.headline}`,
    template: `%s | ${SCHOOL.short}`,
  },
  description: `${SCHOOL.name}. ${SCHOOL.tagline}. Admissions open for session ${SCHOOL.session}.`,
  keywords: [
    "SVM School",
    "Saraswati Vidya Mandir",
    "best school",
    "admissions 2026",
    "smart classes",
    "CBSE school",
  ],
  authors: [{ name: SCHOOL.name }],
  openGraph: {
    title: `${SCHOOL.short} — ${SCHOOL.headline}`,
    description: SCHOOL.tagline,
    url: SITE_URL,
    siteName: SCHOOL.name,
    type: "website",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SCHOOL.short} — ${SCHOOL.headline}`,
    description: SCHOOL.tagline,
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: SCHOOL.name,
  alternateName: SCHOOL.short,
  url: SITE_URL,
  email: SCHOOL.email,
  telephone: SCHOOL.phone,
  address: {
    "@type": "PostalAddress",
    streetAddress: SCHOOL.address,
  },
  slogan: SCHOOL.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
