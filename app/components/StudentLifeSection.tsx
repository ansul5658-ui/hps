'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, AnimatePresence } from 'framer-motion';

const galleryItems = [
  {
    id: 1,
    title: 'Annual Cultural Fest',
    category: 'Culture',
    description: 'Three days of music, dance, and art that bring 3,000 students together in celebration.',
    span: 'col-span-2 row-span-2',
    bg: 'linear-gradient(135deg, #1a0a14 0%, #2d0a20 50%, #1a0a14 100%)',
    accent: '#C97A8B',
    emoji: '🎭',
    size: 'large',
  },
  {
    id: 2,
    title: 'Science Olympiad',
    category: 'Academics',
    description: 'Our students consistently win national and international science competitions.',
    span: 'col-span-1 row-span-1',
    bg: 'linear-gradient(135deg, #0a1020 0%, #0a1828 100%)',
    accent: '#7AB4C9',
    emoji: '🔬',
    size: 'small',
  },
  {
    id: 3,
    title: 'State Championships',
    category: 'Sports',
    description: '45+ state and national titles across cricket, football, athletics, and swimming.',
    span: 'col-span-1 row-span-1',
    bg: 'linear-gradient(135deg, #0a1a0a 0%, #081408 100%)',
    accent: '#7AC9A8',
    emoji: '🏆',
    size: 'small',
  },
  {
    id: 4,
    title: 'Global Exchange',
    category: 'International',
    description: 'Students travel to 12 countries for cultural exchange, fostering global citizenship.',
    span: 'col-span-1 row-span-2',
    bg: 'linear-gradient(135deg, #15100a 0%, #201808 100%)',
    accent: '#C8A951',
    emoji: '✈️',
    size: 'medium',
  },
  {
    id: 5,
    title: 'Music Maestros',
    category: 'Arts',
    description: 'Classical and contemporary music training under nationally acclaimed musicians.',
    span: 'col-span-1 row-span-1',
    bg: 'linear-gradient(135deg, #120a1a 0%, #1a0a28 100%)',
    accent: '#9B8EC9',
    emoji: '🎵',
    size: 'small',
  },
  {
    id: 6,
    title: 'Community Service',
    category: 'Social',
    description: 'Our students log 50,000+ volunteer hours annually, serving communities across the state.',
    span: 'col-span-1 row-span-1',
    bg: 'linear-gradient(135deg, #0a1a14 0%, #081a10 100%)',
    accent: '#6AC9A0',
    emoji: '🤝',
    size: 'small',
  },
  {
    id: 7,
    title: 'Robotics League',
    category: 'Technology',
    description: 'National finalists in FIRST Robotics. Building the engineers of tomorrow, today.',
    span: 'col-span-2 row-span-1',
    bg: 'linear-gradient(135deg, #0f0a1a 0%, #120a20 100%)',
    accent: '#9B8EC9',
    emoji: '🤖',
    size: 'wide',
  },
];

export default function StudentLifeSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<number | null>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // Title
    gsap.from(titleRef.current?.children ? Array.from(titleRef.current.children) : [], {
      opacity: 0, y: 50, duration: 1, stagger: 0.1, ease: 'expo.out',
      scrollTrigger: { trigger: titleRef.current, start: 'top 80%' },
    });

    // Gallery items
    const items = gridRef.current?.querySelectorAll('.gallery-item');
    if (items) {
      gsap.from(Array.from(items), {
        opacity: 0,
        scale: 0.9,
        y: 40,
        duration: 0.8,
        stagger: { amount: 0.6, from: 'center' },
        ease: 'expo.out',
        scrollTrigger: { trigger: gridRef.current, start: 'top 75%' },
      });
    }

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <section
      ref={sectionRef}
      id="gallery"
      className="bg-gallery py-28 md:py-36 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        {/* Title */}
        <div ref={titleRef} className="mb-20">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-10 bg-dark-400/50" />
            <span className="font-alt text-xs text-dark-400/60 tracking-[0.3em] uppercase">
              Beyond Classrooms
            </span>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold text-dark-200 leading-tight">
            Life at{' '}
            <span className="text-gold-gradient italic">Horizon</span>
          </h2>
          <p className="mt-6 text-dark-400/50 font-body text-lg max-w-xl leading-relaxed">
            School is more than academics. It is where memories are forged,
            friendships are built, and character is shaped.
          </p>
        </div>

        {/* Gallery Grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 auto-rows-[180px]"
        >
          {galleryItems.map((item) => (
            <motion.div
              key={item.id}
              className={`gallery-item relative rounded-2xl overflow-hidden cursor-pointer group ${item.span}`}
              style={{ background: item.bg }}
              onHoverStart={() => setActiveItem(item.id)}
              onHoverEnd={() => setActiveItem(null)}
              whileHover={{ scale: 1.02 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Noise texture */}
              <div className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E")`,
                }}
              />

              {/* Glow overlay on hover */}
              <motion.div
                className="absolute inset-0"
                style={{ background: `radial-gradient(circle at center, ${item.accent}20, transparent 70%)` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: activeItem === item.id ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              />

              {/* Border */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ border: `1px solid ${item.accent}40` }}
              />

              {/* Content */}
              <div className="absolute inset-0 p-5 flex flex-col justify-between">
                {/* Top */}
                <div className="flex items-start justify-between">
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-alt tracking-wider uppercase"
                    style={{
                      backgroundColor: `${item.accent}20`,
                      color: item.accent,
                      border: `1px solid ${item.accent}30`,
                    }}
                  >
                    {item.category}
                  </span>
                  <motion.span
                    className="text-2xl"
                    animate={{ scale: activeItem === item.id ? 1.2 : 1, rotate: activeItem === item.id ? 10 : 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {item.emoji}
                  </motion.span>
                </div>

                {/* Bottom */}
                <div>
                  <h3 className="font-display text-white font-semibold text-base md:text-lg leading-tight mb-1.5">
                    {item.title}
                  </h3>
                  <AnimatePresence>
                    {activeItem === item.id && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="font-body text-xs text-white/50 leading-relaxed overflow-hidden"
                      >
                        {item.description}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Bottom accent */}
              <motion.div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: `linear-gradient(90deg, transparent, ${item.accent}, transparent)` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: activeItem === item.id ? 1 : 0 }}
                transition={{ duration: 0.4 }}
              />
            </motion.div>
          ))}
        </div>

        {/* Category pills */}
        <div className="flex flex-wrap gap-3 mt-12 justify-center">
          {['All', 'Culture', 'Sports', 'Technology', 'Arts', 'International', 'Social'].map((cat) => (
            <button
              key={cat}
              className="px-4 py-2 rounded-full font-alt text-xs tracking-wide border border-dark-400/20 text-dark-400/50 hover:border-gold/40 hover:text-gold transition-all duration-300"
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
