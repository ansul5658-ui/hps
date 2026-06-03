"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { SCHOOL } from "@/lib/data";

export default function Admissions() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-15%", "15%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.15, 1]);

  return (
    <section
      id="admissions"
      ref={ref}
      className="relative flex min-h-[90vh] items-center overflow-hidden"
    >
      <motion.div style={{ y, scale }} className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/admissions.svg"
          alt="Students learning and participating in activities"
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-ink/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/80" />
      </motion.div>

      <div className="container-x relative z-10 text-center">
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="eyebrow inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-2"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
          </span>
          Now Enrolling
        </motion.span>

        <motion.h2
          initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-6 max-w-4xl text-balance font-display text-4xl font-semibold leading-tight text-white sm:text-6xl md:text-7xl"
        >
          Admissions Open For
          <br />
          <span className="text-gradient-gold">Session {SCHOOL.session}</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="mx-auto mt-6 max-w-xl text-balance text-base text-white/70 md:text-lg"
        >
          Seats are limited. Begin your child&apos;s journey toward excellence,
          innovation and character today.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.25 }}
          className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <a href="#admissions" className="btn-gold">
            Apply Now
          </a>
          <a href={`tel:${SCHOOL.phone}`} className="btn-ghost">
            Contact School
          </a>
        </motion.div>
      </div>
    </section>
  );
}
