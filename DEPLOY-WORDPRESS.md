# Adding this site to your WordPress website

**Important:** this is a **Next.js (React) app**, not a WordPress theme or
plugin. A normal WordPress (PHP) host cannot *run* it the way it runs PHP.
So you don't install it "inside" WordPress — instead you pick one of the
approaches below. They're ordered from best-quality to quickest.

---

## Option 1 — Subdomain or main domain (recommended) ✅

Host the Next.js app on a free Node host (Vercel/Netlify) and point a
domain at it. Keep WordPress for your blog/admin on another address.

**Typical setup**
- `www.yourschool.com` → this cinematic site (Vercel)
- `blog.yourschool.com` or `yourschool.com/blog` → existing WordPress

**Steps (Vercel, ~5 min, free):**
1. Push this repo to GitHub (already done on your branch).
2. Go to vercel.com → **New Project** → import the repo → pick the branch.
3. It auto-detects Next.js. Click **Deploy**. You get a live URL instantly.
4. In Vercel → **Settings → Domains**, add your domain/subdomain and update
   the DNS record at your registrar as Vercel instructs.

Best performance and keeps every animation intact. No server maintenance.

---

## Option 2 — Static export uploaded to your WordPress host 📁

Turn the site into plain HTML/CSS/JS files and upload them to your existing
hosting via cPanel/FTP — no Node server needed.

**A. Whole subdomain (e.g. `admissions.yourschool.com`)**
```bash
npm install
npm run export          # creates the ./out folder
```
Upload **everything inside `out/`** to that subdomain's web root
(e.g. `public_html/admissions/`). Done.

**B. A subfolder of your WordPress site (e.g. `yourschool.com/campus`)**
Asset paths must know the folder, so build with a base path:
```bash
NEXT_BASE_PATH=/campus npm run export
```
Then upload the contents of `out/` into `public_html/campus/`.
Visit `yourschool.com/campus/`.

> Note: keep it in its **own folder/subdomain**, not mixed into WordPress's
> root, so it doesn't collide with WordPress's `index.php` routing.

---

## Option 3 — Embed inside a WordPress page (iframe) 🪟

Quickest if you just want it living at a WordPress URL. First host the site
(Option 1 or 2), then in WordPress:

1. Create a new Page (e.g. "Welcome"), use a **Custom HTML** block:
   ```html
   <iframe
     src="https://your-deployed-site-url.com"
     style="width:100%;height:100vh;border:0;"
     loading="lazy"
     title="SVM School"></iframe>
   ```
2. Optionally set it as your homepage in **Settings → Reading**.

Trade-offs: iframes are less ideal for SEO and can feel boxed-in on mobile.
Options 1–2 are better for a flagship site.

---

## 👉 Your setup: iframe on Hostinger — step by step

You'll (A) host the static site on a Hostinger **subdomain**, then
(B) embed it in a WordPress page with an iframe.

### A. Host the static files on a subdomain
1. Build the static files: `npm install && npm run export` → this creates
   the `out/` folder. (Or use the prebuilt `svm-cinematic-site.zip`.)
2. Hostinger **hPanel → Domains → Subdomains**. Create one, e.g. `campus`
   → you get `campus.yourdomain.com`. Note its **document root** folder.
3. hPanel **Files → File Manager**. Open that subdomain's folder.
4. Upload the **zip**, then right-click → **Extract** so that `index.html`
   sits directly in the folder (NOT inside an extra `out/` subfolder).
5. hPanel **Security → SSL** — make sure SSL is active for the subdomain,
   then open `https://campus.yourdomain.com` to confirm it works.

### B. Embed it in WordPress
1. WP Admin → **Pages → Add New** (e.g. title "Welcome"/"Home").
2. Add a **Custom HTML** block and paste:
   ```html
   <iframe src="https://campus.yourdomain.com"
     title="Saraswati Vidya Mandir"
     style="display:block;width:100%;height:100vh;border:0;margin:0;"
     loading="lazy" allowfullscreen></iframe>
   ```
3. Pick a **full-width / blank** page template (in the page's settings, or
   your theme's template options) so there's no sidebar around the iframe.
4. **Publish**. To make it the homepage: **Settings → Reading → A static
   page → Homepage = this page**.

### Gotchas
- Both your WordPress site and the subdomain must be **https** (Hostinger
  gives free SSL) — otherwise the iframe is blocked as mixed content.
- 100vh makes it full-screen; the cinematic site scrolls inside the frame.
- Updating later = re-run `npm run export` and re-upload `out/`.

---

## Option 4 — Headless WordPress (advanced)

Keep WordPress purely as the content editor and let this Next.js app fetch
pages/posts via the WordPress REST API (`/wp-json/wp/v2/...`) or WPGraphQL.
Most flexible, but a development project in itself. Ask if you want this.

---

## Which should you pick?

| You want…                                   | Use        |
| ------------------------------------------- | ---------- |
| The best result, easiest hosting            | Option 1   |
| To stay on your current cPanel/FTP hosting  | Option 2   |
| It live at a WordPress URL, fastest         | Option 3   |
| WordPress editors managing all content      | Option 4   |

For most schools: **Option 1** (cinematic site on the main domain via
Vercel) + WordPress moved to `/blog`. Want me to tailor the exact steps to
your host (e.g. Hostinger, GoDaddy, Bluehost, SiteGround)? Just tell me who
hosts your site.
