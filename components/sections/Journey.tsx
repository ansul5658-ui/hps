"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import SectionHeading from "@/components/ui/SectionHeading";
import { TIMELINE } from "@/lib/data";

export default function Journey() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // The gold spine draws itself as the section scrolls.
      gsap.fromTo(
        ".timeline-spine",
        { scaleY: 0 },
        {
          scaleY: 1,
          transformOrigin: "top",
          ease: "none",
          scrollTrigger: {
            trigger: ".timeline-list",
            start: "top 70%",
            end: "bottom 70%",
            scrub: true,
          },
        }
      );

      // Each milestone emerges from darkness.
      gsap.utils.toArray<HTMLElement>(".timeline-item").forEach((item) => {
        gsap.from(item, {
          opacity: 0,
          y: 60,
          filter: "blur(10px)",
          duration: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: item, start: "top 85%" },
        });
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="journey"
      ref={root}
      className="relative overflow-hidden bg-ink py-28 md:py-40"
    >
      {/* Light emerging from darkness */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-gold/10 blur-[140px]"
      />

      <div className="container-x relative">
        <SectionHeading
          eyebrow="The Journey"
          title="From a single classroom to a legacy"
          subtitle="Two decades of relentless pursuit — every milestone a chapter in the story of SVM."
        />

        <div className="timeline-list relative mx-auto mt-20 max-w-3xl">
          {/* Spine */}
          <div className="absolute left-4 top-0 h-full w-px bg-white/10 md:left-1/2 md:-translate-x-1/2">
            <div className="timeline-spine h-full w-full bg-gradient-to-b from-gold-light via-gold to-gold-deep" />
          </div>

          <ul className="space-y-14">
            {TIMELINE.map((item, i) => (
              <li
                key={item.year}
                className={`timeline-item relative pl-14 md:w-1/2 md:pl-0 ${
                  i % 2 === 0
                    ? "md:ml-0 md:pr-12 md:text-right"
                    : "md:ml-auto md:pl-12"
                }`}
              >
                {/* Node */}
                <span
                  className={`absolute left-4 top-1.5 z-10 flex h-3 w-3 -translate-x-1/2 items-center justify-center rounded-full bg-gold shadow-glow md:left-auto ${
                    i % 2 === 0
                      ? "md:right-0 md:translate-x-1/2"
                      : "md:left-0 md:-translate-x-1/2"
                  }`}
                />
                <span className="font-display text-3xl font-semibold text-gradient-gold">
                  {item.year}
                </span>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
