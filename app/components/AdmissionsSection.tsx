'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle } from 'lucide-react';

const steps = [
  { step: '01', title: 'Online Application', desc: 'Submit your application form with academic records and required documents.' },
  { step: '02', title: 'Entrance Assessment', desc: 'Attend a friendly assessment for academic readiness and aptitude evaluation.' },
  { step: '03', title: 'Interview & Tour', desc: 'Join us for a school tour and a conversation with our admissions team.' },
  { step: '04', title: 'Admission Offer', desc: 'Receive your offer letter and complete enrollment formalities.' },
];

const openings = [
  { grade: 'Grade 1 – 5', seats: '12 seats', type: 'Primary' },
  { grade: 'Grade 6 – 8', seats: '8 seats', type: 'Middle School' },
  { grade: 'Grade 9 – 10', seats: '15 seats', type: 'Secondary' },
  { grade: 'Grade 11 – 12', seats: '20 seats', type: 'Senior Secondary' },
];

export default function AdmissionsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const [formState, setFormState] = useState({ name: '', phone: '', grade: '', submitted: false });

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    // Background parallax
    gsap.to(bgRef.current, {
      yPercent: 15,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });

    gsap.from(titleRef.current?.children ? Array.from(titleRef.current.children) : [], {
      opacity: 0, y: 60, duration: 1, stagger: 0.1, ease: 'expo.out',
      scrollTrigger: { trigger: titleRef.current, start: 'top 80%' },
    });

    gsap.from(stepsRef.current?.querySelectorAll('.step-item') ?? [], {
      opacity: 0, x: -50, duration: 0.9, stagger: 0.12, ease: 'expo.out',
      scrollTrigger: { trigger: stepsRef.current, start: 'top 75%' },
    });

    gsap.from(ctaRef.current, {
      opacity: 0, y: 40, duration: 1, ease: 'expo.out',
      scrollTrigger: { trigger: ctaRef.current, start: 'top 80%' },
    });

    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormState((s) => ({ ...s, submitted: true }));
  };

  return (
    <section
      ref={sectionRef}
      id="admissions"
      className="relative py-28 md:py-36 overflow-hidden bg-admissions"
    >
      {/* Animated background */}
      <div ref={bgRef} className="absolute inset-[-20%]">
        {/* Gradient mesh */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 20% 50%, rgba(200,169,81,0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 20%, rgba(155,142,201,0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 50% 80%, rgba(122,180,201,0.05) 0%, transparent 50%)
            `,
          }}
        />

        {/* Grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(200,169,81,0.8) 1px, transparent 1px),
              linear-gradient(90deg, rgba(200,169,81,0.8) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Floating orbs */}
      {[
        { size: 400, top: '10%', left: '5%', color: '#C8A951', opacity: 0.06 },
        { size: 300, top: '60%', right: '10%', color: '#9B8EC9', opacity: 0.05 },
      ].map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: orb.size,
            height: orb.size,
            top: orb.top,
            left: 'left' in orb ? orb.left : undefined,
            right: 'right' in orb ? (orb as { right: string }).right : undefined,
            background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
            opacity: orb.opacity,
            filter: 'blur(60px)',
          }}
          animate={{ scale: [1, 1.1, 1], rotate: [0, 10, 0] }}
          transition={{ duration: 8 + i * 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Left: Content */}
          <div>
            <div ref={titleRef}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold/10 border border-gold/20 mb-6">
                <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
                <span className="font-alt text-xs text-gold tracking-widest uppercase">
                  Admissions Open 2025–26
                </span>
              </div>

              <h2 className="font-display text-5xl md:text-7xl font-bold text-white leading-tight mb-6">
                Your Story{' '}
                <span className="italic text-gold-gradient">Begins</span>
                <br />
                Here.
              </h2>

              <p className="font-body text-white/50 text-lg leading-relaxed mb-10">
                Take the first step toward an extraordinary education. Limited
                seats available — apply today and join a community of
                exceptional learners.
              </p>

              {/* Available seats */}
              <div className="grid grid-cols-2 gap-3 mb-10">
                {openings.map((o) => (
                  <div
                    key={o.grade}
                    className="p-4 rounded-xl"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(200,169,81,0.15)',
                    }}
                  >
                    <p className="font-alt text-[10px] text-gold/50 tracking-widest uppercase mb-1">
                      {o.type}
                    </p>
                    <p className="font-display text-white text-sm font-semibold">{o.grade}</p>
                    <p className="font-alt text-xs text-gold mt-0.5">{o.seats}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Steps */}
            <div ref={stepsRef} className="space-y-4">
              <p className="font-alt text-xs text-white/30 tracking-[0.3em] uppercase mb-5">
                Admission Process
              </p>
              {steps.map((step, i) => (
                <div
                  key={step.step}
                  className="step-item flex gap-5 group"
                >
                  <div className="flex-shrink-0 flex flex-col items-center">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-alt text-xs font-bold border transition-all duration-300 group-hover:border-gold group-hover:text-gold"
                      style={{ borderColor: 'rgba(200,169,81,0.3)', color: 'rgba(200,169,81,0.6)' }}
                    >
                      {step.step}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="w-px flex-1 mt-2 bg-white/5" />
                    )}
                  </div>
                  <div className="pb-4">
                    <h4 className="font-display text-white text-base font-semibold mb-1">
                      {step.title}
                    </h4>
                    <p className="font-body text-sm text-white/35 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Form */}
          <div ref={ctaRef}>
            <div
              className="rounded-3xl p-8 md:p-10"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(200,169,81,0.15)',
                backdropFilter: 'blur(20px)',
              }}
            >
              {formState.submitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center text-center py-12"
                >
                  <CheckCircle size={56} className="text-gold mb-5" />
                  <h3 className="font-display text-2xl text-white font-semibold mb-3">
                    Application Received!
                  </h3>
                  <p className="font-body text-white/40 text-sm leading-relaxed max-w-xs">
                    Thank you, {formState.name || 'friend'}. Our admissions team will contact you
                    within 48 hours.
                  </p>
                </motion.div>
              ) : (
                <>
                  <h3 className="font-display text-2xl text-white font-semibold mb-2">
                    Request Information
                  </h3>
                  <p className="font-body text-white/35 text-sm mb-8">
                    Fill in your details and we'll get back to you shortly.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-5">
                    {[
                      { label: 'Parent / Guardian Name', key: 'name', type: 'text', placeholder: 'Full name' },
                      { label: 'Phone Number', key: 'phone', type: 'tel', placeholder: '+91 98765 43210' },
                    ].map((field) => (
                      <div key={field.key}>
                        <label className="block font-alt text-[11px] text-white/40 tracking-widest uppercase mb-2">
                          {field.label}
                        </label>
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          value={formState[field.key as 'name' | 'phone']}
                          onChange={(e) => setFormState((s) => ({ ...s, [field.key]: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder-white/20 font-body text-sm focus:outline-none focus:border-gold/40 transition-colors duration-200"
                        />
                      </div>
                    ))}

                    <div>
                      <label className="block font-alt text-[11px] text-white/40 tracking-widest uppercase mb-2">
                        Grade Applying For
                      </label>
                      <select
                        value={formState.grade}
                        onChange={(e) => setFormState((s) => ({ ...s, grade: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white font-body text-sm focus:outline-none focus:border-gold/40 transition-colors duration-200 appearance-none"
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                      >
                        <option value="" style={{ background: '#111' }}>Select grade</option>
                        {['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'].map((g) => (
                          <option key={g} value={g} style={{ background: '#111' }}>{g}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="group w-full flex items-center justify-center gap-3 py-4 bg-gold text-dark-100 font-alt font-bold text-sm tracking-[0.15em] uppercase rounded-xl hover:bg-gold-light transition-all duration-300 hover:shadow-[0_0_40px_rgba(200,169,81,0.3)]"
                    >
                      Submit Application
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform duration-200" />
                    </button>

                    <p className="text-center font-body text-xs text-white/20">
                      Or call us at{' '}
                      <span className="text-gold/60">+91 11 2345 6789</span>
                    </p>
                  </form>
                </>
              )}
            </div>

            {/* Trust badges */}
            <div className="flex items-center gap-6 mt-6 justify-center">
              {['CBSE Affiliated', 'ISO 9001:2015', 'Green School'].map((badge) => (
                <div key={badge} className="flex items-center gap-1.5">
                  <CheckCircle size={12} className="text-gold/60" />
                  <span className="font-alt text-[11px] text-white/30 tracking-wide">{badge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
