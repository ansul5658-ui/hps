"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import { TESTIMONIALS } from "@/lib/data";

type Quote = (typeof TESTIMONIALS)[number];

function Card({ t }: { t: Quote }) {
  return (
    <figure className="mx-3 flex w-[320px] shrink-0 flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-xl transition-colors hover:border-gold/40 md:w-[400px]">
      <span className="font-display text-5xl leading-none text-gold/40">“</span>
      <blockquote className="-mt-3 text-base leading-relaxed text-white/80">
        {t.quote}
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-gold-light to-gold-deep font-display font-bold text-ink">
          {t.name.charAt(0)}
        </span>
        <div>
          <p className="font-medium text-white">{t.name}</p>
          <p className="text-xs uppercase tracking-widest text-gold/70">
            {t.role}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}

function Marquee({
  items,
  reverse = false,
  duration = 40,
}: {
  items: Quote[];
  reverse?: boolean;
  duration?: number;
}) {
  const loop = [...items, ...items];
  return (
    <div className="group flex overflow-hidden mask-fade-x py-3">
      <div
        className="flex animate-marquee group-hover:[animation-play-state:paused]"
        style={{
          animationDuration: `${duration}s`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {loop.map((t, i) => (
          <Card key={`${t.name}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

export default function Testimonials() {
  const half = Math.ceil(TESTIMONIALS.length / 2);
  return (
    <section
      id="testimonials"
      className="relative overflow-hidden bg-ink-900 py-28 md:py-36"
    >
      <div className="container-x">
        <SectionHeading
          eyebrow="Testimonials"
          title="Voices from our community"
          subtitle="Parents, students and alumni on what makes SVM feel like home."
        />
      </div>

      <div className="mt-16 flex flex-col gap-2">
        <Marquee items={TESTIMONIALS.slice(0, half)} duration={45} />
        <Marquee items={TESTIMONIALS.slice(half)} reverse duration={50} />
      </div>

      {/* marquee keyframes (scoped via styled-jsx) */}
      <style jsx>{`
        @keyframes marquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          animation-name: marquee;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          width: max-content;
        }
        .mask-fade-x {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent,
            black 8%,
            black 92%,
            transparent
          );
          mask-image: linear-gradient(
            to right,
            transparent,
            black 8%,
            black 92%,
            transparent
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-marquee {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
