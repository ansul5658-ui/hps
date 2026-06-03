"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { STUDENT_LIFE } from "@/lib/data";

export default function StudentLife() {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const trackEl = track.current!;
      const panels = gsap.utils.toArray<HTMLElement>(".life-panel");

      const getScrollAmount = () =>
        -(trackEl.scrollWidth - window.innerWidth);

      const tween = gsap.to(trackEl, {
        x: getScrollAmount,
        ease: "none",
      });

      ScrollTrigger.create({
        trigger: root.current,
        start: "top top",
        end: () => `+=${trackEl.scrollWidth - window.innerWidth + window.innerHeight}`,
        pin: true,
        scrub: 1,
        snap: {
          snapTo: 1 / (panels.length - 1),
          duration: { min: 0.2, max: 0.6 },
          ease: "power1.inOut",
        },
        animation: tween,
        invalidateOnRefresh: true,
      });

      // Subtle parallax on each panel image while travelling horizontally.
      panels.forEach((panel) => {
        const img = panel.querySelector<HTMLElement>(".life-img");
        if (img) {
          gsap.fromTo(
            img,
            { xPercent: -8 },
            {
              xPercent: 8,
              ease: "none",
              scrollTrigger: {
                trigger: panel,
                containerAnimation: tween,
                start: "left right",
                end: "right left",
                scrub: true,
              },
            }
          );
        }
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="student-life"
      ref={root}
      className="relative h-screen overflow-hidden bg-ink"
    >
      <div className="pointer-events-none absolute left-6 top-24 z-20 md:left-10">
        <span className="eyebrow flex items-center gap-3">
          <span className="h-px w-8 bg-gold/60" />
          Student Life
        </span>
        <h2 className="mt-3 max-w-md font-display text-4xl font-semibold text-white md:text-5xl">
          Life beyond the <span className="text-gradient-gold">classroom</span>
        </h2>
      </div>

      <div
        ref={track}
        className="flex h-full items-center gap-6 px-6 will-change-transform md:gap-8 md:px-10"
      >
        {STUDENT_LIFE.map((item, i) => (
          <article
            key={item.title}
            className="life-panel relative h-[62vh] w-[78vw] shrink-0 overflow-hidden rounded-3xl border border-white/10 sm:w-[60vw] md:w-[42vw] lg:w-[34vw]"
          >
            <div className="life-img absolute inset-0 scale-110 will-change-transform">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
            <div className="absolute bottom-0 left-0 p-8">
              <span className="font-display text-5xl font-bold text-white/20">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 font-display text-2xl font-semibold text-white md:text-3xl">
                {item.title}
              </h3>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
