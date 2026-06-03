"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type Lenis from "lenis";
import Crest from "@/components/ui/Crest";
import { NAV_LINKS, SCHOOL } from "@/lib/data";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    const lenis = (window as Window & { __lenis?: Lenis }).__lenis;
    const target = document.querySelector(href);
    if (lenis && target) {
      lenis.scrollTo(target as HTMLElement, { offset: -20, duration: 1.4 });
    } else if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-x-0 top-0 z-50"
      >
        <div
          className={`mx-auto mt-3 flex max-w-7xl items-center justify-between rounded-full px-5 py-3 transition-all duration-500 md:px-7 ${
            scrolled
              ? "glass-strong shadow-card md:mx-6"
              : "border border-transparent bg-transparent md:mx-6"
          }`}
        >
          <button
            onClick={() => go("#top")}
            className="flex items-center gap-3"
            aria-label={`${SCHOOL.short} home`}
          >
            <Crest size={44} />
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold tracking-wide text-white">
                {SCHOOL.short}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-gold/70">
                Est. {SCHOOL.founded}
              </span>
            </span>
          </button>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <button
                key={link.href}
                onClick={() => go(link.href)}
                className="rounded-full px-4 py-2 text-sm text-white/70 transition-colors hover:text-gold"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={() => go("#admissions")}
              className="btn-gold hidden h-10 px-5 py-0 text-xs md:inline-flex"
            >
              Admissions Open
            </button>
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 lg:hidden"
              aria-label="Toggle menu"
              aria-expanded={open}
            >
              <div className="flex flex-col gap-1.5">
                <span
                  className={`h-px w-5 bg-white transition-transform ${open ? "translate-y-[7px] rotate-45" : ""}`}
                />
                <span
                  className={`h-px w-5 bg-white transition-opacity ${open ? "opacity-0" : ""}`}
                />
                <span
                  className={`h-px w-5 bg-white transition-transform ${open ? "-translate-y-[7px] -rotate-45" : ""}`}
                />
              </div>
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-ink/95 backdrop-blur-xl lg:hidden"
          >
            {NAV_LINKS.map((link, i) => (
              <motion.button
                key={link.href}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                onClick={() => go(link.href)}
                className="font-display text-3xl text-white/80 hover:text-gold"
              >
                {link.label}
              </motion.button>
            ))}
            <button
              onClick={() => go("#admissions")}
              className="btn-gold mt-6"
            >
              Admissions Open
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
