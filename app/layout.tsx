import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HPS Academy | Where Excellence Meets Destiny',
  description:
    'HPS Academy – A legacy of academic excellence, holistic development, and world-class education since 1985. Shaping tomorrow\'s leaders today.',
  keywords: 'school, education, excellence, academics, admissions, CBSE, HPS, HPS Academy',
  openGraph: {
    title: 'HPS Academy',
    description: 'A legacy of excellence since 1985.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
