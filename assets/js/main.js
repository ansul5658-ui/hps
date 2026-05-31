(function () {
  'use strict';

  /* ---- Sticky Header ---- */
  const header = document.getElementById('site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---- Mobile Menu ---- */
  const toggle = document.getElementById('menu-toggle');
  const nav    = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.classList.toggle('active', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });

    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    document.addEventListener('click', e => {
      if (!header.contains(e.target) && nav.classList.contains('open')) {
        nav.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* ---- Smooth Scroll ---- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 80;
        window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
      }
    });
  });

  /* ---- Scroll Reveal ---- */
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(el => observer.observe(el));
  }

  /* ---- Counter Animation ---- */
  function animateCounter(el) {
    const target = parseInt(el.dataset.target, 10);
    if (isNaN(target)) return;
    const duration = 2000;
    const step     = Math.ceil(target / (duration / 16));
    let current    = 0;

    const tick = () => {
      current = Math.min(current + step, target);
      el.textContent = current.toLocaleString() + '+';
      if (current < target) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const statNumbers = document.querySelectorAll('.stat-number[data-target]');
  if (statNumbers.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    statNumbers.forEach(el => counterObserver.observe(el));
  }

  /* ---- Contact Form ---- */
  const contactForm = document.getElementById('hps-contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn      = this.querySelector('[type="submit"]');
      const feedback = document.getElementById('form-feedback');
      const data     = new FormData(this);

      data.append('action', 'hps_contact');
      data.append('nonce', hpsData.nonce);

      btn.disabled    = true;
      btn.textContent = 'Sending…';

      fetch(hpsData.ajaxUrl, { method: 'POST', body: data })
        .then(r => r.json())
        .then(res => {
          feedback.textContent  = res.data.message;
          feedback.className    = 'form-feedback ' + (res.success ? 'success' : 'error');
          feedback.style.display = 'block';
          if (res.success) contactForm.reset();
        })
        .catch(() => {
          feedback.textContent  = 'Something went wrong. Please try again.';
          feedback.className    = 'form-feedback error';
          feedback.style.display = 'block';
        })
        .finally(() => {
          btn.disabled    = false;
          btn.textContent = 'Send Message';
        });
    });
  }
})();
