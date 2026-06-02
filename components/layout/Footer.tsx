"use client";

import Icon from "@/components/ui/Icon";
import { NAV_LINKS, SCHOOL } from "@/lib/data";

export default function Footer() {
  const socials: { name: string; href: string }[] = [
    { name: "facebook", href: SCHOOL.social.facebook },
    { name: "instagram", href: SCHOOL.social.instagram },
    { name: "youtube", href: SCHOOL.social.youtube },
    { name: "linkedin", href: SCHOOL.social.linkedin },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-ink-900">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] -translate-x-1/2 rounded-full bg-gold/10 blur-[120px]"
      />
      <div className="container-x relative grid gap-12 py-16 md:grid-cols-12 md:py-20">
        {/* Brand */}
        <div className="md:col-span-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-gold/40 font-display text-lg font-bold text-gradient-gold">
              SVM
            </span>
            <div>
              <p className="font-display text-lg text-white">{SCHOOL.short}</p>
              <p className="text-xs uppercase tracking-widest text-gold/70">
                {SCHOOL.name}
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/55">
            {SCHOOL.tagline}. Nurturing curious minds and courageous hearts
            since 2001.
          </p>
          <div className="mt-6 flex gap-3">
            {socials.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.name}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 transition-all hover:-translate-y-0.5 hover:border-gold/60 hover:text-gold"
              >
                <Icon name={s.name} className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>

        {/* Explore */}
        <div className="md:col-span-3">
          <h4 className="text-sm font-semibold uppercase tracking-widest text-white">
            Explore
          </h4>
          <ul className="mt-5 space-y-3 text-sm text-white/55">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="transition-colors hover:text-gold">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div className="md:col-span-5">
          <h4 className="text-sm font-semibold uppercase tracking-widest text-white">
            Visit Us
          </h4>
          <ul className="mt-5 space-y-4 text-sm text-white/65">
            <li className="flex items-start gap-3">
              <Icon name="map-pin" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <span>{SCHOOL.address}</span>
            </li>
            <li className="flex items-center gap-3">
              <Icon name="phone" className="h-5 w-5 shrink-0 text-gold" />
              <a href={`tel:${SCHOOL.phone}`} className="hover:text-gold">
                {SCHOOL.phone}
              </a>
            </li>
            <li className="flex items-center gap-3">
              <Icon name="mail" className="h-5 w-5 shrink-0 text-gold" />
              <a href={`mailto:${SCHOOL.email}`} className="hover:text-gold">
                {SCHOOL.email}
              </a>
            </li>
          </ul>

          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
            <iframe
              title="School location map"
              src={`https://www.google.com/maps?q=${encodeURIComponent(SCHOOL.mapsQuery)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-44 w-full grayscale transition-all duration-500 hover:grayscale-0"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-x flex flex-col items-center justify-between gap-3 py-6 text-xs text-white/40 md:flex-row">
          <p>
            © {new Date().getFullYear()} {SCHOOL.name}. All rights reserved.
          </p>
          <p>Crafted as a cinematic experience · Privacy · Terms</p>
        </div>
      </div>
    </footer>
  );
}
