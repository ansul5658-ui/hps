'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

const facilities = [
  {
    name: 'Science & Innovation Labs',
    description: 'Fully equipped physics, chemistry, biology and AI labs with cutting-edge instruments for hands-on experimentation and discovery.',
    area: '12,000 sq ft',
    feature: 'AI-assisted research stations',
    gradient: 'linear-gradient(135deg, #0a1a2a 0%, #041020 100%)',
    accent: '#7AB4C9',
    icon: '⚗',
    number: '01',
  },
  {
    name: 'Digital Library & Resource Center',
    description: 'A 50,000-volume collection complemented by digital archives, e-journals, and silent study pods for deep academic focus.',
    area: '8,500 sq ft',
    feature: '50,000+ volumes + digital access',
    gradient: 'linear-gradient(135deg, #1a1a08 0%, #100f04 100%)',
    accent: '#C8A951',
    icon: '📚',
    number: '02',
  },
  {
    name: 'Olympic Sports Complex',
    description: 'International-standard tracks, courts, and training facilities. Home to state and national champions across 15+ sports disciplines.',
    area: '3.5 acres',
    feature: '15+ sports disciplines',
    gradient: 'linear-gradient(135deg, #0a1a0a 0%, #051005 100%)',
    accent: '#7AC9A8',
    icon: '🏅',
    number: '03',
  },
  {
    name: 'Performing Arts Theater',
    description: 'A 1,200-seat world-class auditorium with professional acoustics, lighting rigs, and broadcast facilities for live performances.',
    area: '1,200 seats',
    feature: 'Professional acoustic design',
    gradient: 'linear-gradient(135deg, #1a080f 0%, #100408 100%)',
    accent: '#C97A8B',
    icon: '🎭',
    number: '04',
  },
  {
    name: 'Innovation & Robotics Hub',
    description: 'India\'s first school-level innovation center with 3D printing, drone labs, VR studios, and a startup incubator for young entrepreneurs.',
    area: '10,000 sq ft',
    feature: 'VR, Drones, 3D Printing',
    gradient: 'linear-gradient(135deg, #0f0a1a 0%, #08041a 100%)',
    accent: '#9B8EC9',
    icon: '🤖',
    number: '05',
  },
  {
    name: 'Aquatic Center',
    description: 'An Olympic-size heated indoor swimming pool with training platforms, diving boards, and dedicated coaching facilities.',
    area: '50m × 25m pool',
    feature: 'Olympic standard heated pool',
    gradient: 'linear-gradient(135deg, #081520 0%, #040c18 100%)',
    accent: '#5BA8C9',
    icon: '🏊',
    number: '06',
  },
];

function FacilityCard({ facility }: { facility: (typeof facilities)[0] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springX = useSpring(mouseX, { damping: 25, stiffness: 300 });
  const springY = useSpring(mouseY, { damping: 25, stiffness: 300 });

  const rotateX = useTransform(springY, [-0.5, 0.5], ['8deg', '-8deg']);
  const rotateY = useTransform(springX, [-0.5, 0.5], ['-8deg', '8deg']);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);

    if (glowRef.current) {
      glowRef.current.style.background = `radial-gradient(circle at ${e.clientX - rect.left}px ${e.clientY - rect.top}px, ${facility.accent}25 0%, transparent 60%)`;
    }
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
    if (glowRef.current) {
      glowRef.current.style.background = 'transparent';
    }
  };

  return (
    <motion.div
      ref={cardRef}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d', perspective: '1000px' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative group cursor-pointer rounded-2xl overflow-hidden"
      whileHover={{ scale: 1.02, transition: { duration: 0.3 } }}
    >
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{ background: facility.gradient }}
      />

      {/* Dynamic glow */}
      <div ref={glowRef} className="absolute inset-0 pointer-events-none" />

      {/* Border */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ border: `1px solid ${facility.accent}20` }}
      />

      {/* Corner accent */}
      <div
        className="absolute top-0 right-0 w-24 h-24 opacity-30"
        style={{
          background: `radial-gradient(circle at top right, ${facility.accent}60, transparent 70%)`,
        }}
      />

      {/* Number watermark */}
      <div
        className="absolute -right-3 -bottom-6 font-display text-[120px] font-bold opacity-[0.04] select-none leading-none"
        style={{ color: facility.accent }}
      >
        {facility.number}
      </div>

      <div className="relative p-7 md:p-8" style={{ transform: 'translateZ(30px)' }}>
        {/* Icon + Number */}
        <div className="flex items-center justify-between mb-6">
          <span className="text-4xl">{facility.icon}</span>
          <span
            className="font-alt text-xs tracking-widest"
            style={{ color: `${facility.accent}60` }}
          >
            {facility.number}
          </span>
        </div>

        {/* Name */}
        <h3 className="font-display text-xl md:text-2xl font-semibold text-white mb-3 leading-tight">
          {facility.name}
        </h3>

        {/* Description */}
        <p className="font-body text-sm text-white/40 leading-relaxed mb-6">
          {facility.description}
        </p>

        {/* Specs */}
        <div
          className="flex items-center justify-between pt-5 border-t"
          style={{ borderColor: `${facility.accent}15` }}
        >
          <div>
            <p className="font-alt text-[10px] tracking-widest text-white/25 uppercase mb-1">
              Area
            </p>
            <p className="font-alt text-sm font-medium" style={{ color: facility.accent }}>
              {facility.area}
            </p>
          </div>
          <div className="text-right">
            <p className="font-alt text-[10px] tracking-widest text-white/25 uppercase mb-1">
              Feature
            </p>
            <p className="font-body text-xs text-white/50">{facility.feature}</p>
          </div>
        </div>

        {/* Hover reveal arrow */}
        <div
          className="absolute bottom-7 right-8 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0"
          style={{ color: facility.accent }}
        >
          <span className="text-lg">→</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function FacilitiesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from(titleRef.current?.children ? Array.from(titleRef.current.children) : [], {
      opacity: 0, y: 50, duration: 1, stagger: 0.1, ease: 'expo.out',
      scrollTrigger: { trigger: titleRef.current, start: 'top 80%' },
    });

    const cards = gridRef.current?.querySelectorAll('.facility-item');
    if (cards) {
      gsap.from(Array.from(cards), {
        opacity: 0, y: 70, scale: 0.92,
        duration: 0.9, stagger: { amount: 0.5 }, ease: 'expo.out',
        scrollTrigger: { trigger: gridRef.current, start: 'top 75%' },
      });
    }

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <section
      ref={sectionRef}
      id="facilities"
      className="bg-facilities py-28 md:py-36 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        {/* Title */}
        <div ref={titleRef} className="mb-20">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-10 bg-gold/50" />
            <span className="font-alt text-xs text-gold/60 tracking-[0.3em] uppercase">
              World-Class Infrastructure
            </span>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold text-white leading-tight">
            Spaces That{' '}
            <span className="italic text-gold-gradient">Inspire</span>
          </h2>
          <p className="mt-6 text-white/40 font-body text-lg max-w-xl leading-relaxed">
            Every facility at HPS Academy is designed with one purpose: to give
            our students every advantage in their pursuit of excellence.
          </p>
        </div>

        {/* 3D Cards Grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          style={{ perspective: '2000px' }}
        >
          {facilities.map((f) => (
            <div key={f.name} className="facility-item">
              <FacilityCard facility={f} />
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-20 pt-12 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="font-body text-white/30 text-sm max-w-md text-center md:text-left">
            Our facilities are regularly upgraded to stay ahead of global
            educational standards. Every space is built to spark curiosity.
          </p>
          <div className="flex items-center gap-8">
            {[
              { val: '8+', label: 'Acres Campus' },
              { val: '15+', label: 'Specialized Labs' },
              { val: '100%', label: 'Wi-Fi Coverage' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-display text-2xl font-bold text-gold">{s.val}</p>
                <p className="font-alt text-[10px] text-white/30 tracking-widest uppercase mt-0.5">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
