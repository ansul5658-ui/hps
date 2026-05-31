'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';

const stats = [
  {
    value: 97,
    suffix: '%',
    label: 'Board Results',
    sublabel: '15 consecutive years',
    color: '#C8A951',
    description: 'Consistent excellence in CBSE board examinations',
  },
  {
    value: 3500,
    suffix: '+',
    label: 'Enrolled Students',
    sublabel: 'Across 40 sections',
    color: '#7AB4C9',
    description: 'A thriving community of curious learners',
  },
  {
    value: 150,
    suffix: '+',
    label: 'Expert Faculty',
    sublabel: 'Avg 18 yrs experience',
    color: '#7AC9A8',
    description: 'Nationally recognized educators and mentors',
  },
  {
    value: 500,
    suffix: '+',
    label: 'IIT/NIT Alumni',
    sublabel: '200+ at IITs alone',
    color: '#9B8EC9',
    description: 'A proud legacy in India\'s premier institutions',
  },
  {
    value: 200,
    suffix: '+',
    label: 'Awards Won',
    sublabel: 'State & National level',
    color: '#C97A8B',
    description: 'Recognition across academics, sports and arts',
  },
  {
    value: 40,
    suffix: '+',
    label: 'Years of Legacy',
    sublabel: 'Est. 1985',
    color: '#C9B07A',
    description: 'Decades of shaping exceptional individuals',
  },
];

const achievements = [
  { year: '2024', achievement: '100% Board Results', detail: '47 students scored 95%+', type: 'gold' },
  { year: '2024', achievement: 'National Robotics Finalist', detail: 'FIRST Robotics Competition', type: 'blue' },
  { year: '2023', achievement: 'State Science Champion', detail: 'KVPY — 12 selections', type: 'green' },
  { year: '2023', achievement: 'Cultural Excellence Award', detail: 'Ministry of Education', type: 'purple' },
  { year: '2022', achievement: 'Best School — North Zone', detail: 'Education Excellence Awards', type: 'gold' },
  { year: '2022', achievement: '5 Students at IIT Bombay', detail: 'JEE Advanced rank < 500', type: 'blue' },
];

function CounterStat({ stat, index }: { stat: (typeof stats)[0]; index: number }) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          const duration = 2000;
          const steps = 60;
          const increment = stat.value / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= stat.value) {
              setCount(stat.value);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [stat.value, started]);

  return (
    <motion.div
      ref={ref}
      className="relative p-7 rounded-2xl overflow-hidden group"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
        border: `1px solid ${stat.color}20`,
      }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
    >
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle at center, ${stat.color}08, transparent 70%)`,
        }}
      />

      {/* Top line */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, transparent, ${stat.color}60, transparent)` }}
      />

      {/* Value */}
      <div className="flex items-end gap-1 mb-2">
        <span
          className="font-display text-5xl md:text-6xl font-bold counter-value leading-none"
          style={{ color: stat.color }}
        >
          {count.toLocaleString()}
        </span>
        <span
          className="font-display text-3xl font-bold mb-1"
          style={{ color: stat.color }}
        >
          {stat.suffix}
        </span>
      </div>

      {/* Label */}
      <h3 className="font-display text-lg text-white font-semibold mb-0.5">{stat.label}</h3>
      <p className="font-alt text-xs text-white/30 tracking-wide mb-4">{stat.sublabel}</p>

      {/* Description */}
      <p className="font-body text-sm text-white/25 leading-relaxed">{stat.description}</p>

      {/* Index */}
      <div
        className="absolute bottom-5 right-6 font-display text-4xl font-bold opacity-5 select-none"
        style={{ color: stat.color }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>
    </motion.div>
  );
}

export default function ResultsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const achievementsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from(titleRef.current?.children ? Array.from(titleRef.current.children) : [], {
      opacity: 0, y: 50, duration: 1, stagger: 0.1, ease: 'expo.out',
      scrollTrigger: { trigger: titleRef.current, start: 'top 80%' },
    });

    gsap.from(achievementsRef.current?.querySelectorAll('.achievement-row') ?? [], {
      opacity: 0, x: -40, duration: 0.7, stagger: 0.1, ease: 'expo.out',
      scrollTrigger: { trigger: achievementsRef.current, start: 'top 80%' },
    });

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  const typeColors: Record<string, string> = {
    gold: '#C8A951',
    blue: '#7AB4C9',
    green: '#7AC9A8',
    purple: '#9B8EC9',
  };

  return (
    <section
      ref={sectionRef}
      id="results"
      className="bg-results py-28 md:py-36 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        {/* Title */}
        <div ref={titleRef} className="mb-20">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-10 bg-gold/50" />
            <span className="font-alt text-xs text-gold/60 tracking-[0.3em] uppercase">
              Numbers That Speak
            </span>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold text-white leading-tight">
            A Legacy of{' '}
            <span className="italic text-gold-gradient">Achievement</span>
          </h2>
          <p className="mt-6 text-white/40 font-body text-lg max-w-xl leading-relaxed">
            Forty years of relentless pursuit of excellence, measured in
            results, championships, and lives transformed.
          </p>
        </div>

        {/* Stats grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-20"
        >
          {stats.map((stat, i) => (
            <CounterStat key={stat.label} stat={stat} index={i} />
          ))}
        </div>

        {/* Recent achievements */}
        <div
          ref={achievementsRef}
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="p-7 border-b border-white/5">
            <h3 className="font-display text-2xl text-white font-semibold">
              Recent Milestones
            </h3>
            <p className="font-alt text-xs text-white/30 tracking-widest mt-1 uppercase">
              2022 – 2024 Highlights
            </p>
          </div>

          {achievements.map((a, i) => (
            <div
              key={i}
              className="achievement-row flex items-center gap-5 px-7 py-5 border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors duration-200 group"
            >
              {/* Year */}
              <div
                className="w-16 flex-shrink-0 font-alt text-sm font-medium"
                style={{ color: typeColors[a.type] }}
              >
                {a.year}
              </div>

              {/* Dot */}
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: typeColors[a.type],
                  boxShadow: `0 0 8px ${typeColors[a.type]}60`,
                }}
              />

              {/* Content */}
              <div className="flex-1">
                <p className="font-display text-white text-sm font-semibold">{a.achievement}</p>
                <p className="font-body text-white/35 text-xs mt-0.5">{a.detail}</p>
              </div>

              {/* Arrow on hover */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white/20">
                →
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
