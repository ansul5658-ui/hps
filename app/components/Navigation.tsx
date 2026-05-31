'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Journey', href: '#timeline' },
  { label: 'Academics', href: '#academics' },
  { label: 'Facilities', href: '#facilities' },
  { label: 'Student Life', href: '#gallery' },
  { label: 'Results', href: '#results' },
  { label: 'Contact', href: '#contact' },
];

export default function Navigation() {
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    gsap.from(navRef.current, {
      yPercent: -100,
      opacity: 0,
      duration: 1.2,
      delay: 3.5,
      ease: 'expo.out',
    });

    const handleScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (href: string) => {
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <nav
        ref={navRef}
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-700 ${
          scrolled
            ? 'py-3 bg-dark-100/90 backdrop-blur-xl border-b border-white/5'
            : 'py-6 bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-10 flex items-center justify-between">
          {/* Logo */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-3 group"
          >
            <div className="relative w-9 h-9">
              <div className="absolute inset-0 border border-gold/50 rotate-45 group-hover:rotate-[135deg] transition-transform duration-700" />
              <div className="absolute inset-1 border border-gold/20 rotate-45" />
              <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-bold text-gold">
                H
              </span>
            </div>
            <div className="hidden sm:block">
              <p className="font-display text-sm text-white font-medium leading-tight">
                HPS Academy
              </p>
              <p className="font-alt text-[9px] tracking-[0.25em] text-white/40 uppercase">
                Est. 1985
              </p>
            </div>
          </button>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <button
                key={link.label}
                onClick={() => handleNavClick(link.href)}
                className="font-alt text-sm text-white/60 hover:text-gold transition-colors duration-300 tracking-wide relative group"
              >
                {link.label}
                <span className="absolute -bottom-0.5 left-0 w-0 h-px bg-gold group-hover:w-full transition-all duration-300" />
              </button>
            ))}
          </div>

          {/* CTA + Mobile menu */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleNavClick('#admissions')}
              className="hidden sm:flex items-center gap-2 px-5 py-2 border border-gold/50 text-gold text-sm font-alt tracking-wide hover:bg-gold hover:text-dark-100 transition-all duration-300 rounded-sm"
            >
              Apply Now
            </button>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden text-white/80 hover:text-gold transition-colors"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-0 left-0 right-0 bottom-0 z-[99] bg-dark-100/97 backdrop-blur-2xl flex flex-col items-center justify-center gap-8"
          >
            <button
              onClick={() => setMenuOpen(false)}
              className="absolute top-6 right-6 text-white/60 hover:text-gold"
            >
              <X size={24} />
            </button>

            <div className="flex items-center gap-3 mb-8">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 border border-gold/50 rotate-45" />
                <span className="absolute inset-0 flex items-center justify-center font-display text-xl font-bold text-gold">H</span>
              </div>
              <div>
                <p className="font-display text-base text-white">HPS Academy</p>
                <p className="font-alt text-[9px] tracking-widest text-white/40 uppercase">Est. 1985</p>
              </div>
            </div>

            {navLinks.map((link, i) => (
              <motion.button
                key={link.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => handleNavClick(link.href)}
                className="font-display text-3xl text-white/80 hover:text-gold transition-colors duration-300"
              >
                {link.label}
              </motion.button>
            ))}

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              onClick={() => handleNavClick('#admissions')}
              className="mt-4 px-8 py-3 border border-gold text-gold font-alt tracking-widest text-sm uppercase hover:bg-gold hover:text-dark-100 transition-all duration-300"
            >
              Apply Now
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
