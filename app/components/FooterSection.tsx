'use client';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { MapPin, Phone, Mail, Instagram, Youtube, Facebook, Twitter } from 'lucide-react';

const footerLinks = {
  Academics: ['Science Stream', 'Commerce Stream', 'Humanities', 'Digital Innovation', 'Performing Arts', 'Sports Programs'],
  'Campus Life': ['Student Council', 'Cultural Fest', 'Sports Teams', 'Clubs & Societies', 'Community Service', 'Annual Events'],
  Resources: ['Admissions 2025–26', 'Fee Structure', 'Scholarship Program', 'Parent Portal', 'Alumni Network', 'Career Guidance'],
  School: ['About HPS', 'Vision & Mission', 'Leadership Team', 'Awards & Recognition', 'Media Gallery', 'News & Updates'],
};

export default function FooterSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from(logoRef.current, {
      opacity: 0, y: 40, duration: 1, ease: 'expo.out',
      scrollTrigger: { trigger: sectionRef.current, start: 'top 85%' },
    });

    const cols = linksRef.current?.querySelectorAll('.footer-col');
    if (cols) {
      gsap.from(Array.from(cols), {
        opacity: 0, y: 30, duration: 0.8, stagger: 0.08, ease: 'expo.out',
        scrollTrigger: { trigger: linksRef.current, start: 'top 85%' },
      });
    }

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  return (
    <footer
      ref={sectionRef}
      id="contact"
      className="bg-footer pt-24 pb-10 overflow-hidden relative"
    >
      {/* Top separator */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(200,169,81,0.04) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-10">
        {/* Top section: Logo + Contact */}
        <div
          ref={logoRef}
          className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10 pb-16 border-b border-white/5"
        >
          {/* Logo */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border border-gold/40 rotate-45" />
                <div className="absolute inset-1 border border-gold/20 rotate-45" />
                <span className="absolute inset-0 flex items-center justify-center font-display text-2xl font-bold text-gold">H</span>
              </div>
              <div>
                <h2 className="font-display text-xl text-white font-semibold">
                  Horizon Public School
                </h2>
                <p className="font-alt text-xs tracking-[0.25em] text-gold/50 uppercase mt-0.5">
                  Est. 1985 · Affiliated to CBSE, Delhi
                </p>
              </div>
            </div>
            <p className="font-body text-sm text-white/30 max-w-sm leading-relaxed">
              Illuminate. Inspire. Achieve. Four decades of shaping tomorrow's
              leaders, one student at a time.
            </p>

            {/* Social */}
            <div className="flex items-center gap-4 mt-2">
              {[
                { Icon: Instagram, label: 'Instagram' },
                { Icon: Youtube, label: 'YouTube' },
                { Icon: Facebook, label: 'Facebook' },
                { Icon: Twitter, label: 'Twitter' },
              ].map(({ Icon, label }) => (
                <motion.button
                  key={label}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white/30 hover:text-gold transition-colors duration-200"
                  style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                  whileHover={{ scale: 1.1, borderColor: 'rgba(200,169,81,0.4)' }}
                  aria-label={label}
                >
                  <Icon size={14} />
                </motion.button>
              ))}
            </div>
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                Icon: MapPin,
                label: 'Visit Us',
                lines: ['12, Knowledge Park', 'New Delhi – 110 020', 'India'],
              },
              {
                Icon: Phone,
                label: 'Call Us',
                lines: ['+91 11 2345 6789', '+91 11 2345 6790', 'Mon–Sat, 8am–6pm'],
              },
              {
                Icon: Mail,
                label: 'Write to Us',
                lines: ['admissions@horizonpublicschool.in', 'info@horizonpublicschool.in'],
              },
            ].map(({ Icon, label, lines }) => (
              <div key={label} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={13} className="text-gold/60" />
                  <span className="font-alt text-[10px] tracking-widest text-gold/50 uppercase">
                    {label}
                  </span>
                </div>
                {lines.map((line, i) => (
                  <p key={i} className="font-body text-sm text-white/35 leading-snug">
                    {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Links grid */}
        <div
          ref={linksRef}
          className="grid grid-cols-2 md:grid-cols-4 gap-10 py-16 border-b border-white/5"
        >
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category} className="footer-col">
              <h3 className="font-alt text-xs tracking-[0.3em] text-gold/50 uppercase mb-6">
                {category}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <button className="font-body text-sm text-white/30 hover:text-white/70 transition-colors duration-200 text-left">
                      {link}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-10">
          <p className="font-alt text-xs text-white/15 tracking-wide">
            © 2025 Horizon Public School. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            {['Privacy Policy', 'Terms of Use', 'RTI', 'Mandatory Disclosure'].map((item) => (
              <button
                key={item}
                className="font-alt text-[11px] text-white/20 hover:text-white/50 transition-colors duration-200 tracking-wide"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {/* Large watermark */}
        <div className="mt-12 overflow-hidden">
          <p
            className="font-display text-[clamp(60px,12vw,140px)] font-bold text-center opacity-[0.03] select-none leading-none tracking-tight"
          >
            HORIZON
          </p>
        </div>
      </div>
    </footer>
  );
}
