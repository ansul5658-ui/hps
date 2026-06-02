# SVM School — Cinematic Website

A luxury, scroll-driven, documentary-style website for **Saraswati Vidya
Mandir (SVM School)**. Built to feel like a cinematic film rather than a
traditional school site — premium dark theme, gold accents, glassmorphism,
and scroll-orchestrated storytelling.

## ✨ Tech stack

| Concern            | Choice                                  |
| ------------------ | --------------------------------------- |
| Framework          | Next.js 15 (App Router) + React 19      |
| Language           | TypeScript (strict)                     |
| Styling            | Tailwind CSS 3                          |
| Scroll storytelling| GSAP + ScrollTrigger                    |
| Smooth scrolling   | Lenis (synced to GSAP ticker)           |
| Micro-interactions | Motion (Framer Motion v11)              |
| 3D particles       | Three.js (vanilla, lazy-loaded)         |

## 🎬 Experience map

1. **Hero** — fullscreen video with slow zoom, Three.js gold particles,
   blur-in headline, dual CTAs, animated scroll indicator.
2. **The Journey** — animated, self-drawing gold timeline emerging from dark.
3. **Campus Reveal** — clip/blur reveals + parallax & scale on every space.
4. **Achievements** — counters that animate the moment they enter view.
5. **Facilities** — glass cards with pointer-tracked glow and 3D tilt.
6. **Student Life** — GSAP-pinned horizontal gallery with snap + parallax.
7. **Results & Success** — staggered animated ranking board.
8. **Testimonials** — dual auto-scrolling marquees, pause-on-hover.
9. **Admissions** — cinematic parallax CTA for Session 2026-27.
10. **Footer** — address, phone, email, socials, embedded Google Map.

Global flourishes: mouse-follower glow + ring, scroll progress bar,
cinematic preloader, and full `prefers-reduced-motion` support.

## 🚀 Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

## 🗂 Project structure

```
app/
  layout.tsx        # fonts, SEO metadata, JSON-LD
  page.tsx          # composes all sections
  globals.css       # Tailwind layers, glass/button utilities, Lenis CSS
  robots.ts / sitemap.ts
components/
  providers/SmoothScroll.tsx   # Lenis ↔ ScrollTrigger bridge
  layout/   Navbar.tsx, Footer.tsx
  sections/ Hero, Journey, CampusReveal, Achievements, Facilities,
            StudentLife, Results, Testimonials, Admissions
  ui/       Preloader, MouseFollower, ScrollProgress, ParticleField,
            Reveal, SectionHeading, Icon
lib/
  data.ts           # all editable copy & imagery
  gsap.ts           # registers ScrollTrigger once
public/videos/      # drop hero.mp4 here (see its README)
```

## ✏️ Customising content

All copy, stats, timeline entries, facilities, testimonials and image URLs
live in **`lib/data.ts`** — edit there, nothing in the components needs to
change. Swap the Unsplash placeholders for real campus photography and add a
`public/videos/hero.mp4` for the full effect.

## ⚡ Performance & SEO

- Statically prerendered; first-load JS ~210 kB with Three.js deferred.
- AVIF/WebP image formats, lazy-loaded media, `next/font` self-hosting.
- Open Graph + Twitter cards, JSON-LD `EducationalOrganization`, robots &
  sitemap routes.
- Honors reduced-motion and is mobile-first responsive.
