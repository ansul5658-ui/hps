'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { Atom, TrendingUp, BookOpen, Music, Cpu, Dumbbell } from 'lucide-react';

const programs = [
  {
    icon: Atom,
    stream: 'Science & Technology',
    tagline: 'Explore the universe of possibilities',
    subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Computer Science'],
    topStat: '94.7%',
    statLabel: 'Avg Board Score',
    color: '#7AB4C9',
    gradient: 'from-[#0a1a24] to-[#0a1015]',
    borderColor: 'rgba(122,180,201,0.2)',
  },
  {
    icon: TrendingUp,
    stream: 'Commerce & Economics',
    tagline: 'Build the business world of tomorrow',
    subjects: ['Accounts', 'Economics', 'Business Studies', 'Mathematics', 'Informatics'],
    topStat: '93.2%',
    statLabel: 'Avg Board Score',
    color: '#7AC9A8',
    gradient: 'from-[#0a1a15] to-[#0a1010]',
    borderColor: 'rgba(122,201,168,0.2)',
  },
  {
    icon: BookOpen,
    stream: 'Humanities & Arts',
    tagline: 'Give voice to culture and ideas',
    subjects: ['History', 'Geography', 'Political Science', 'Psychology', 'Sociology'],
    topStat: '95.1%',
    statLabel: 'Avg Board Score',
    color: '#C97A8B',
    gradient: 'from-[#1a0a0f] to-[#150a0a]',
    borderColor: 'rgba(201,122,139,0.2)',
  },
  {
    icon: Cpu,
    stream: 'Digital Innovation',
    tagline: 'Code, create, and innovate',
    subjects: ['AI & ML', 'Data Science', 'Web Dev', 'Robotics', 'Cybersecurity'],
    topStat: '96.8%',
    statLabel: 'Placement Rate',
    color: '#9B8EC9',
    gradient: 'from-[#0f0a1a] to-[#0a0a15]',
    borderColor: 'rgba(155,142,201,0.2)',
  },
  {
    icon: Music,
    stream: 'Performing Arts',
    tagline: 'Express what words cannot say',
    subjects: ['Classical Music', 'Dance', 'Theatre', 'Visual Arts', 'Film Studies'],
    topStat: '200+',
    statLabel: 'Annual Performances',
    color: '#C9B07A',
    gradient: 'from-[#1a150a] to-[#150e0a]',
    borderColor: 'rgba(201,176,122,0.2)',
  },
  {
    icon: Dumbbell,
    stream: 'Sports & Wellness',
    tagline: 'Strength in body, clarity in mind',
    subjects: ['Cricket', 'Football', 'Athletics', 'Swimming', 'Yoga & Mindfulness'],
    topStat: '45+',
    statLabel: 'State Champions',
    color: '#C8A951',
    gradient: 'from-[#1a1408] to-[#100e05]',
    borderColor: 'rgba(200,169,81,0.2)',
  },
];

export default function AcademicsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from(titleRef.current?.children ? Array.from(titleRef.current.children) : [], {
      opacity: 0, y: 50,
      duration: 1, stagger: 0.1,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: titleRef.current,
        start: 'top 80%',
      },
    });

    const cards = gridRef.current?.querySelectorAll('.academic-card');
    if (cards) {
      gsap.from(Array.from(cards), {
        opacity: 0,
        y: 60,
        scale: 0.95,
        duration: 0.9,
        stagger: { amount: 0.6, from: 'start' },
        ease: 'expo.out',
        scrollTrigger: {
          trigger: gridRef.current,
          start: 'top 75%',
        },
      });
    }

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <section
      ref={sectionRef}
      id="academics"
      className="bg-academics py-28 md:py-36 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        {/* Title */}
        <div ref={titleRef} className="mb-20">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-10 bg-gold/50" />
            <span className="font-alt text-xs text-gold/60 tracking-[0.3em] uppercase">
              Academic Programs
            </span>
          </div>
          <h2 className="font-display text-5xl md:text-7xl font-bold text-white leading-tight max-w-3xl">
            Education{' '}
            <span className="italic text-gold-gradient">Beyond</span>
            <br />
            the Textbook
          </h2>
          <p className="mt-6 text-white/40 font-body text-lg max-w-xl leading-relaxed">
            Six pathways to mastery. Each designed to ignite passion,
            develop expertise, and launch careers that matter.
          </p>
        </div>

        {/* Grid */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {programs.map((p) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.stream}
                className="academic-card group relative overflow-hidden rounded-2xl cursor-pointer"
                style={{
                  background: `linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))`,
                  border: `1px solid ${p.borderColor}`,
                }}
                whileHover={{ y: -6, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
              >
                {/* Background gradient on hover */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${p.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
                />

                {/* Corner glow */}
                <div
                  className="absolute top-0 left-0 w-32 h-32 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: `radial-gradient(circle at top left, ${p.color}30, transparent 70%)`,
                  }}
                />

                <div className="relative p-7">
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                    style={{ backgroundColor: `${p.color}15`, border: `1px solid ${p.color}30` }}
                  >
                    <Icon size={22} style={{ color: p.color }} />
                  </div>

                  {/* Stream name */}
                  <h3 className="font-display text-xl font-semibold text-white mb-2">
                    {p.stream}
                  </h3>
                  <p className="font-body text-sm text-white/40 mb-6">{p.tagline}</p>

                  {/* Subjects */}
                  <div className="flex flex-wrap gap-1.5 mb-6">
                    {p.subjects.map((sub) => (
                      <span
                        key={sub}
                        className="text-[10px] font-alt px-2.5 py-1 rounded-full tracking-wide"
                        style={{
                          backgroundColor: `${p.color}10`,
                          color: `${p.color}90`,
                          border: `1px solid ${p.color}20`,
                        }}
                      >
                        {sub}
                      </span>
                    ))}
                  </div>

                  {/* Stat */}
                  <div className="flex items-end gap-2 pt-5 border-t border-white/5">
                    <span
                      className="font-display text-3xl font-bold"
                      style={{ color: p.color }}
                    >
                      {p.topStat}
                    </span>
                    <span className="font-alt text-xs text-white/30 tracking-wide mb-1">
                      {p.statLabel}
                    </span>
                  </div>
                </div>

                {/* Bottom accent line */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left"
                  style={{ background: `linear-gradient(90deg, ${p.color}, transparent)` }}
                />
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
