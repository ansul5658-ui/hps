'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface LoadingScreenProps {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement[]>([]);
  const percentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(containerRef.current, {
          yPercent: -100,
          duration: 1.2,
          ease: 'expo.inOut',
          onComplete,
        });
      },
    });

    // Animate lines in
    tl.from(linesRef.current, {
      scaleX: 0,
      duration: 0.8,
      stagger: 0.06,
      ease: 'expo.out',
      transformOrigin: 'left center',
    })
    // Logo reveal
    .from(logoRef.current, {
      opacity: 0,
      scale: 0.85,
      duration: 0.9,
      ease: 'expo.out',
    }, '-=0.3')
    // Progress bar
    .to(progressRef.current, {
      width: '100%',
      duration: 1.8,
      ease: 'power2.inOut',
    }, '-=0.4')
    // Percent counter
    .to({ val: 0 }, {
      val: 100,
      duration: 1.8,
      ease: 'power2.inOut',
      onUpdate: function () {
        if (percentRef.current) {
          percentRef.current.textContent = Math.round(this.targets()[0].val) + '';
        }
      },
    }, '<')
    // Lines exit
    .to(linesRef.current, {
      scaleX: 0,
      duration: 0.6,
      stagger: 0.04,
      ease: 'expo.in',
      transformOrigin: 'right center',
    }, '+=0.3');

    return () => { tl.kill(); };
  }, [onComplete]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-dark-100 flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Animated background lines */}
      <div className="absolute inset-0 flex flex-col justify-around px-8 opacity-20">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            ref={(el) => { if (el) linesRef.current[i] = el; }}
            className="h-px bg-gradient-to-r from-transparent via-gold to-transparent"
            style={{ width: `${60 + Math.random() * 40}%`, marginLeft: `${Math.random() * 20}%` }}
          />
        ))}
      </div>

      {/* Center content */}
      <div ref={logoRef} className="relative flex flex-col items-center gap-6">
        {/* Logo */}
        <img
          src="/hps-logo.svg"
          alt="HPS Academy"
          className="w-28 h-28 md:w-32 md:h-32 drop-shadow-2xl"
        />

        {/* School name */}
        <div className="text-center">
          <h1 className="font-display text-3xl md:text-4xl text-white font-light tracking-wide">
            HPS Academy
          </h1>
          <p className="font-alt text-xs tracking-[0.3em] text-white/40 uppercase mt-2">
            giving our students the world
          </p>
        </div>
      </div>

      {/* Progress section */}
      <div className="absolute bottom-16 left-0 right-0 px-12 md:px-20">
        <div className="flex justify-between items-center mb-3">
          <span className="font-alt text-xs text-white/30 tracking-widest uppercase">Loading</span>
          <div className="flex items-baseline gap-0.5">
            <span ref={percentRef} className="font-alt text-lg text-gold counter-value">0</span>
            <span className="font-alt text-xs text-gold/60">%</span>
          </div>
        </div>
        <div className="h-px bg-white/10 overflow-hidden">
          <div
            ref={progressRef}
            className="h-full w-0 bg-gradient-to-r from-gold-dark via-gold to-gold-light"
          />
        </div>
      </div>
    </div>
  );
}
