'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const lines = headlineRef.current?.querySelectorAll('.headline-line');
    const tl = gsap.timeline({ delay: 3.2 });

    // Badge
    tl.from(badgeRef.current, {
      opacity: 0, y: 20, duration: 0.8, ease: 'expo.out',
    })
    // Headline lines stagger
    .from(lines || [], {
      yPercent: 110,
      duration: 1.1,
      stagger: 0.12,
      ease: 'expo.out',
    }, '-=0.4')
    // Subtitle
    .from(subtitleRef.current, {
      opacity: 0, y: 30, duration: 0.9, ease: 'expo.out',
    }, '-=0.6')
    // CTA buttons
    .from(ctaRef.current?.children ? Array.from(ctaRef.current.children) : [], {
      opacity: 0, y: 20, duration: 0.8, stagger: 0.1, ease: 'expo.out',
    }, '-=0.5')
    // Scroll indicator
    .from(scrollRef.current, {
      opacity: 0, y: -10, duration: 0.8, ease: 'expo.out',
    }, '-=0.2');

    // Parallax on scroll
    gsap.to(bgRef.current, {
      yPercent: 30,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    gsap.to(orb1Ref.current, {
      y: -80, x: 40,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: 1.5,
      },
    });
    gsap.to(orb2Ref.current, {
      y: 60, x: -30,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: 'bottom top',
        scrub: 2,
      },
    });

    return () => { ScrollTrigger.getAll().forEach((t) => t.kill()); };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="hero"
      className="relative min-h-screen bg-hero flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Animated background */}
      <div ref={bgRef} className="absolute inset-0">
        {/* Video-like gradient animation */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#040408] via-[#0a0a12] to-[#040404]" />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(200,169,81,0.5) 1px, transparent 1px),
              linear-gradient(90deg, rgba(200,169,81,0.5) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px',
          }}
        />

        {/* Glowing orbs */}
        <div
          ref={orb1Ref}
          className="absolute top-1/4 left-1/3 w-[600px] h-[600px] rounded-full opacity-[0.12]"
          style={{
            background: 'radial-gradient(circle, rgba(200,169,81,0.8) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          ref={orb2Ref}
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full opacity-[0.08]"
          style={{
            background: 'radial-gradient(circle, rgba(100,120,200,0.8) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />

        {/* Particles */}
        {Array.from({ length: 30 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-0.5 h-0.5 rounded-full bg-gold/40"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -30 - Math.random() * 50, 0],
              opacity: [0.2, 0.8, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{
              duration: 4 + Math.random() * 6,
              repeat: Infinity,
              delay: Math.random() * 4,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* Vignette */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-dark-100/60 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-10 text-center">
        {/* Badge */}
        <div ref={badgeRef} className="inline-flex items-center gap-2 mb-8">
          <div className="h-px w-8 bg-gold/60" />
          <span className="font-alt text-xs tracking-[0.35em] text-gold/80 uppercase">
            Est. 1985 · CBSE Affiliated · Excellence Award
          </span>
          <div className="h-px w-8 bg-gold/60" />
        </div>

        {/* Headline with line clip reveal */}
        <div ref={headlineRef} className="overflow-hidden mb-6">
          <div className="headline-line inline-block">
            <h1 className="font-display text-[13vw] md:text-[9vw] lg:text-[8vw] leading-none font-bold text-white">
              Where
            </h1>
          </div>
          <br />
          <div className="headline-line inline-block">
            <h1 className="font-display text-[13vw] md:text-[9vw] lg:text-[8vw] leading-none font-bold text-gold-gradient">
              Excellence
            </h1>
          </div>
          <br />
          <div className="headline-line inline-block">
            <h1 className="font-display text-[13vw] md:text-[9vw] lg:text-[8vw] leading-none font-bold text-white">
              Begins.
            </h1>
          </div>
        </div>

        {/* Subtitle */}
        <p
          ref={subtitleRef}
          className="max-w-2xl mx-auto text-white/50 font-body text-lg md:text-xl leading-relaxed mb-10"
        >
          Four decades of shaping exceptional minds. A sanctuary of learning
          where every student discovers their unique potential and graduates
          ready to change the world.
        </p>

        {/* CTA buttons */}
        <div ref={ctaRef} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => document.querySelector('#admissions')?.scrollIntoView({ behavior: 'smooth' })}
            className="group relative px-8 py-4 bg-gold text-dark-100 font-alt font-semibold text-sm tracking-[0.15em] uppercase overflow-hidden transition-all duration-300 hover:shadow-[0_0_40px_rgba(200,169,81,0.4)]"
          >
            <span className="relative z-10">Apply for Admissions</span>
            <div className="absolute inset-0 bg-gold-light translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-expo-out" />
          </button>

          <button
            onClick={() => document.querySelector('#timeline')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-2 px-8 py-4 border border-white/20 text-white/70 font-alt text-sm tracking-wide hover:border-gold/50 hover:text-gold transition-all duration-300"
          >
            Explore Our Story
            <ChevronDown size={16} className="animate-bounce" />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-center gap-8 md:gap-16 mt-16 pt-16 border-t border-white/8">
          {[
            { value: '40+', label: 'Years of Excellence' },
            { value: '97%', label: 'Board Results' },
            { value: '3,500+', label: 'Students' },
            { value: '500+', label: 'IIT/NIT Alumni' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-2xl md:text-3xl font-bold text-gold">{stat.value}</div>
              <div className="font-alt text-[10px] md:text-xs text-white/40 tracking-widest uppercase mt-1">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div ref={scrollRef} className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <span className="font-alt text-[10px] tracking-[0.3em] text-white/30 uppercase">Scroll</span>
        <div className="w-px h-12 bg-gradient-to-b from-white/30 to-transparent relative overflow-hidden">
          <motion.div
            className="absolute top-0 w-full h-1/2 bg-gold"
            animate={{ y: ['0%', '200%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      </div>
    </section>
  );
}
