'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const milestones = [
  {
    year: '1985',
    title: 'The Foundation',
    description: 'Horizon Public School opened its doors with 120 students and 12 dedicated educators, driven by a singular vision: to build excellence from the ground up.',
    color: '#C8A951',
    icon: '◆',
  },
  {
    year: '1992',
    title: 'First Triumph',
    description: 'Our inaugural board batch achieved 100% results, setting a benchmark that would define our academic identity and inspire generations to come.',
    color: '#8BA7C9',
    icon: '◇',
  },
  {
    year: '1999',
    title: 'Champions Trophy',
    description: 'The school clinched the State Sports Championship for the first time — proving that excellence transcends the classroom.',
    color: '#9B8EC9',
    icon: '▲',
  },
  {
    year: '2005',
    title: 'New Horizons',
    description: 'A landmark year as our world-class 8-acre campus was inaugurated, housing state-of-the-art labs, auditorium, and sports facilities.',
    color: '#C97A8B',
    icon: '●',
  },
  {
    year: '2012',
    title: 'Digital Leap',
    description: 'Became one of the first schools in the region to adopt smart classrooms and AI-assisted personalized learning platforms.',
    color: '#7AC9A8',
    icon: '■',
  },
  {
    year: '2018',
    title: 'Global Recognition',
    description: 'Received the National Excellence in Education Award and launched international student exchange programs with 12 countries.',
    color: '#C9B07A',
    icon: '★',
  },
  {
    year: '2022',
    title: 'Innovation Hub',
    description: 'Inaugurated the Horizon Innovation Center — a 10,000 sq ft space dedicated to robotics, AI research, and entrepreneurship.',
    color: '#7AB4C9',
    icon: '◉',
  },
  {
    year: '2024',
    title: 'Record Excellence',
    description: 'Achieved an unprecedented 100% board results with 47 students scoring above 95% — the school\'s finest academic year in 40 years.',
    color: '#C8A951',
    icon: '✦',
  },
];

export default function TimelineSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // Title animation
    const titleEls = titleRef.current?.children;
    if (titleEls) {
      gsap.from(Array.from(titleEls), {
        opacity: 0, y: 40,
        duration: 1, stagger: 0.12,
        ease: 'expo.out',
        scrollTrigger: {
          trigger: titleRef.current,
          start: 'top 80%',
          toggleActions: 'play none none none',
        },
      });
    }

    // Horizontal scroll
    const cards = trackRef.current?.querySelectorAll('.timeline-card');
    const totalWidth = trackRef.current?.scrollWidth ?? 0;
    const viewportWidth = window.innerWidth;
    const scrollDistance = totalWidth - viewportWidth + 80;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: `+=${scrollDistance}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
      },
    });

    tl.to(trackRef.current, {
      x: -scrollDistance,
      ease: 'none',
    });

    // Individual card animations
    cards?.forEach((card, i) => {
      gsap.from(card, {
        opacity: 0.3,
        scale: 0.92,
        duration: 0.5,
        scrollTrigger: {
          trigger: card,
          containerAnimation: tl,
          start: 'left 85%',
          toggleActions: 'play none none reverse',
        },
      });
    });

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <section
      ref={sectionRef}
      id="timeline"
      className="bg-timeline overflow-hidden"
      style={{ minHeight: '100vh' }}
    >
      <div className="h-screen flex flex-col justify-center py-16">
        {/* Title */}
        <div ref={titleRef} className="px-10 md:px-20 mb-16">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="h-px w-10 bg-gold/50" />
            <span className="font-alt text-xs text-gold/60 tracking-[0.3em] uppercase">
              Our Journey
            </span>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold text-white leading-tight">
            Four Decades of{' '}
            <span className="text-gold-gradient italic">Excellence</span>
          </h2>
          <p className="text-white/40 font-body mt-4 max-w-lg text-base">
            Scroll to travel through time and witness the milestones that
            shaped a generation.
          </p>
        </div>

        {/* Horizontal scroll track */}
        <div
          ref={trackRef}
          className="flex items-start gap-6 pl-10 md:pl-20 pr-20"
          style={{ width: 'max-content' }}
        >
          {/* Progress line */}
          <div className="absolute left-10 md:left-20 right-0 top-1/2 h-px bg-white/5 z-0" />

          {milestones.map((m, i) => (
            <div
              key={m.year}
              className="timeline-card relative flex-shrink-0 w-[320px] md:w-[380px]"
            >
              {/* Connector dot */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-8 flex flex-col items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: m.color, boxShadow: `0 0 20px ${m.color}60` }}
                />
                <div className="w-px h-8" style={{ backgroundColor: `${m.color}40` }} />
              </div>

              {/* Card */}
              <div
                className="relative p-8 rounded-2xl overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)`,
                  border: `1px solid rgba(255,255,255,0.07)`,
                  backdropFilter: 'blur(10px)',
                }}
              >
                {/* Corner accent */}
                <div
                  className="absolute top-0 right-0 w-16 h-16 opacity-20"
                  style={{
                    background: `radial-gradient(circle at top right, ${m.color}, transparent 70%)`,
                  }}
                />

                {/* Year */}
                <div className="flex items-center justify-between mb-6">
                  <span
                    className="font-display text-5xl font-bold"
                    style={{ color: m.color, opacity: 0.8 }}
                  >
                    {m.year}
                  </span>
                  <span className="text-2xl" style={{ color: m.color }}>{m.icon}</span>
                </div>

                {/* Content */}
                <h3 className="font-display text-xl font-semibold text-white mb-3">
                  {m.title}
                </h3>
                <p className="font-body text-sm text-white/50 leading-relaxed">
                  {m.description}
                </p>

                {/* Bottom bar */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5 opacity-40"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${m.color}, transparent)`,
                  }}
                />
              </div>

              {/* Index */}
              <div className="mt-4 text-center">
                <span className="font-alt text-[10px] tracking-widest text-white/20 uppercase">
                  {String(i + 1).padStart(2, '0')} / {String(milestones.length).padStart(2, '0')}
                </span>
              </div>
            </div>
          ))}

          {/* End spacer */}
          <div className="flex-shrink-0 w-10" />
        </div>

        {/* Scroll hint */}
        <div className="px-10 md:px-20 mt-12">
          <div className="flex items-center gap-3 text-white/20">
            <div className="flex gap-1">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-6 h-0.5 bg-white/15 rounded" />
              ))}
            </div>
            <span className="font-alt text-xs tracking-widest">Drag to explore</span>
          </div>
        </div>
      </div>
    </section>
  );
}
