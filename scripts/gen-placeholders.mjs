/**
 * Generates lightweight, on-brand SVG placeholder imagery so the site is
 * fully self-contained (no external image dependency). Swap these for real
 * campus photography by dropping JPG/WebP files into /public/images.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = `${__dirname}/../public/images`;
mkdirSync(OUT, { recursive: true });

// Cinematic dark palettes (base A, base B, accent glow).
const PALETTES = {
  main: ["#0c1424", "#0a0a0c", "#D4AF37"],
  smart: ["#101a2b", "#0a0a0c", "#5ea0d0"],
  science: ["#0d2018", "#0a0a0c", "#46b88a"],
  computer: ["#160f24", "#0a0a0c", "#9a7bd0"],
  library: ["#231405", "#0a0a0c", "#D4AF37"],
  sports: ["#04140a", "#0a0a0c", "#6fce6f"],
  sportsday: ["#1f0d0d", "#0a0a0c", "#e08a4a"],
  annual: ["#1a0a1f", "#0a0a0c", "#d06aa8"],
  tours: ["#06121f", "#0a0a0c", "#4aa0d0"],
  cultural: ["#1f1405", "#0a0a0c", "#e0b14a"],
  science_ex: ["#0a1f1a", "#0a0a0c", "#46c8b8"],
  hero: ["#0c1424", "#070708", "#D4AF37"],
  admissions: ["#160f05", "#070708", "#D4AF37"],
};

function svg([a, b, accent], { w = 1600, h = 1000, seed = 1 } = {}) {
  // Deterministic pseudo-random for sprinkled light dots.
  let s = seed * 9973;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let dots = "";
  for (let i = 0; i < 40; i++) {
    const cx = (rnd() * w).toFixed(0);
    const cy = (rnd() * h).toFixed(0);
    const r = (rnd() * 2 + 0.4).toFixed(1);
    const o = (rnd() * 0.5 + 0.1).toFixed(2);
    dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" opacity="${o}"/>`;
  }
  let grid = "";
  for (let x = 0; x <= w; x += 80)
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#ffffff" stroke-opacity="0.03"/>`;
  for (let y = 0; y <= h; y += 80)
    grid += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#ffffff" stroke-opacity="0.03"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
</linearGradient>
<radialGradient id="glow" cx="0.7" cy="0.25" r="0.8">
<stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
<stop offset="0.5" stop-color="${accent}" stop-opacity="0.08"/>
<stop offset="1" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="glow2" cx="0.2" cy="0.85" r="0.7">
<stop offset="0" stop-color="${accent}" stop-opacity="0.18"/>
<stop offset="1" stop-color="${accent}" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<g>${grid}</g>
<rect width="${w}" height="${h}" fill="url(#glow)"/>
<rect width="${w}" height="${h}" fill="url(#glow2)"/>
<g>${dots}</g>
</svg>`;
}

const FILES = {
  "campus-main": [PALETTES.main, 4],
  "campus-smart": [PALETTES.smart, 7],
  "campus-science": [PALETTES.science, 11],
  "campus-computer": [PALETTES.computer, 15],
  "campus-library": [PALETTES.library, 19],
  "campus-sports": [PALETTES.sports, 23],
  "life-sportsday": [PALETTES.sportsday, 31],
  "life-annual": [PALETTES.annual, 37],
  "life-tours": [PALETTES.tours, 41],
  "life-cultural": [PALETTES.cultural, 47],
  "life-science": [PALETTES.science_ex, 53],
  "hero-poster": [PALETTES.hero, 61],
  "admissions": [PALETTES.admissions, 67],
};

let count = 0;
for (const [name, [palette, seed]] of Object.entries(FILES)) {
  const dims =
    name === "hero-poster" || name === "admissions"
      ? { w: 1920, h: 1080, seed }
      : { w: 1600, h: 1000, seed };
  writeFileSync(`${OUT}/${name}.svg`, svg(palette, dims));
  count++;
}
console.log(`Generated ${count} placeholder images in public/images`);
