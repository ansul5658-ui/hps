'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

import LoadingScreen from './components/LoadingScreen';
import Navigation from './components/Navigation';
import HeroSection from './components/HeroSection';
import AcademicsSection from './components/AcademicsSection';
import ResultsSection from './components/ResultsSection';
import AdmissionsSection from './components/AdmissionsSection';
import FooterSection from './components/FooterSection';

// Dynamic imports for heavy animation components
const TimelineSection = dynamic(() => import('./components/TimelineSection'), { ssr: false });
const FacilitiesSection = dynamic(() => import('./components/FacilitiesSection'), { ssr: false });
const StudentLifeSection = dynamic(() => import('./components/StudentLifeSection'), { ssr: false });
const CustomCursor = dynamic(() => import('./components/CustomCursor'), { ssr: false });

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {/* Custom cursor (desktop only) */}
      {mounted && <CustomCursor />}

      {/* Loading screen */}
      {loading && (
        <LoadingScreen onComplete={() => setLoading(false)} />
      )}

      {/* Main content */}
      <main className={`transition-opacity duration-700 ${loading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Navigation />
        <HeroSection />
        <TimelineSection />
        <AcademicsSection />
        <FacilitiesSection />
        <StudentLifeSection />
        <ResultsSection />
        <AdmissionsSection />
        <FooterSection />
      </main>
    </>
  );
}
