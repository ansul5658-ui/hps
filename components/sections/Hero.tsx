"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import type Lenis from "lenis";
import { SCHOOL } from "@/lib/data";

// Three.js is heavy — load it only on the client, after hydration, so it
// never blocks first paint or inflates the initial JS payload.
const ParticleField = dynamic(() => import("@/components/ui/ParticleField"), {
  ssr: false,
});

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Cinematic slow-zoom + parallax fade as the hero scrolls away.
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.25]);
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "25%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "60%"]);

  const go = (href: string) => {
    const lenis = (window as Window & { __lenis?: Lenis }).__lenis;
    const target = document.querySelector(href);
    if (lenis && target) lenis.scrollTo(target as HTMLElement, { duration: 1.4 });
    else target?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      ref={ref}
      id="top"
      className="relative h-[100svh] w-full overflow-hidden"
    >
      {/* Video / image background with slow zoom */}
      <motion.div style={{ scale, y }} className="absolute inset-0">
        <video
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          poster="/images/hero-poster.svg"
        >
          <source src="/videos/hero.mp4" type="video/mp4" />
        </video>
        {/* Cinematic grade overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/40 to-ink" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(10,10,12,0.85)_100%)]" />
      </motion.div>

      {/* Three.js particles */}
      <ParticleField className="absolute inset-0 z-[1] opacity-70" />

      {/* Content */}
      <motion.div
        style={{ y: textY, opacity }}
        className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center"
      >
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="eyebrow mb-6"
        >
          {SCHOOL.name} · Est. 2001
        </motion.span>

        <h1 className="max-w-5xl font-display text-5xl font-semibold leading-[1.05] text-white sm:text-6xl md:text-7xl lg:text-8xl">
          {"Where Future Leaders".split(" ").map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                delay: 0.7 + i * 0.12,
                duration: 0.9,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="mr-3 inline-block"
            >
              {word}
            </motion.span>
          ))}
          <br />
          <motion.span
            initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 1.15, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="text-gradient-gold inline-block"
          >
            Are Created
          </motion.span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="mt-7 max-w-2xl text-balance text-base text-white/70 md:text-xl"
        >
          {SCHOOL.tagline}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.8 }}
          className="mt-10 flex flex-col gap-4 sm:flex-row"
        >
          <button onClick={() => go("#admissions")} className="btn-gold">
            Admissions Open
          </button>
          <button onClick={() => go("#campus")} className="btn-ghost">
            Explore Campus
          </button>
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.button
        onClick={() => go("#journey")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        style={{ opacity }}
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
        aria-label="Scroll down"
      >
        <span className="text-[10px] uppercase tracking-cinematic text-white/50">
          Scroll
        </span>
        <span className="flex h-9 w-5 justify-center rounded-full border border-white/30 pt-1.5">
          <span className="h-2 w-px animate-scroll-dot rounded-full bg-gold" />
        </span>
      </motion.button>
    </section>
  );
}
