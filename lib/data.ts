/**
 * Central content for SVM School (Saraswati Vidya Mandir).
 * All copy/imagery is sourced here so sections stay declarative.
 * Replace the Unsplash URLs with real campus photography for production.
 */

export const SCHOOL = {
  name: "Saraswati Vidya Mandir",
  short: "SVM School",
  tagline: "Excellence in Education, Innovation and Character Building",
  headline: "Where Future Leaders Are Created",
  session: "2026-27",
  phone: "+91 98765 43210",
  email: "info@svmschool.edu.in",
  address: "Saraswati Vidya Mandir, Vidya Marg, Education City — 110001",
  mapsQuery: "Saraswati Vidya Mandir School",
  social: {
    facebook: "https://facebook.com",
    instagram: "https://instagram.com",
    youtube: "https://youtube.com",
    linkedin: "https://linkedin.com",
  },
};

export const NAV_LINKS = [
  { label: "Journey", href: "#journey" },
  { label: "Campus", href: "#campus" },
  { label: "Achievements", href: "#achievements" },
  { label: "Facilities", href: "#facilities" },
  { label: "Student Life", href: "#student-life" },
  { label: "Admissions", href: "#admissions" },
];

export const TIMELINE = [
  {
    year: "2001",
    title: "The Foundation",
    body: "Saraswati Vidya Mandir opened its doors with 60 students and a single resolve — to build character before careers.",
  },
  {
    year: "2008",
    title: "Growing Roots",
    body: "Senior wing established. Science and computer laboratories brought modern inquiry into every classroom.",
  },
  {
    year: "2015",
    title: "Smart Campus",
    body: "A fully digital, smart-class campus rises — blending tradition with technology across every grade.",
  },
  {
    year: "2021",
    title: "National Recognition",
    body: "Ranked among the region's top institutions with 100% board results, three years running.",
  },
  {
    year: "Today",
    title: "A Legacy in Motion",
    body: "Over 1000 students, 50+ mentors and 25+ years of excellence — and the story is still being written.",
  },
];

export const CAMPUS = [
  {
    title: "Main Building",
    caption: "The heart of the campus",
    image:
      "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Smart Classes",
    caption: "Where lessons come alive",
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Science Labs",
    caption: "Curiosity, engineered",
    image:
      "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Computer Labs",
    caption: "Coding the future",
    image:
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Library",
    caption: "A universe of pages",
    image:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1600&q=80",
  },
  {
    title: "Sports Ground",
    caption: "Where champions train",
    image:
      "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1600&q=80",
  },
];

export const STATS = [
  { value: 1000, suffix: "+", label: "Students" },
  { value: 100, suffix: "%", label: "Board Results" },
  { value: 50, suffix: "+", label: "Faculty Members" },
  { value: 25, suffix: "+", label: "Years of Excellence" },
];

export const FACILITIES = [
  {
    title: "Smart Classrooms",
    body: "Interactive digital boards and recorded lessons in every room.",
    icon: "monitor",
  },
  {
    title: "Science Labs",
    body: "Physics, chemistry and biology labs equipped for real discovery.",
    icon: "flask",
  },
  {
    title: "Computer Labs",
    body: "High-speed workstations for coding, robotics and design.",
    icon: "cpu",
  },
  {
    title: "Library",
    body: "20,000+ titles, digital archives and quiet reading lounges.",
    icon: "book",
  },
  {
    title: "Transport",
    body: "GPS-tracked, attendant-supervised bus fleet across the city.",
    icon: "bus",
  },
  {
    title: "CCTV Security",
    body: "24×7 monitored campus with controlled access at every gate.",
    icon: "shield",
  },
];

export const STUDENT_LIFE = [
  {
    title: "Sports Day",
    image:
      "https://images.unsplash.com/photo-1571260899304-425eee4c7efc?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Annual Function",
    image:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Educational Tours",
    image:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Cultural Activities",
    image:
      "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Science Exhibitions",
    image:
      "https://images.unsplash.com/photo-1564981797816-1043664bf78d?auto=format&fit=crop&w=1400&q=80",
  },
];

export const RESULTS = [
  {
    category: "Class XII Toppers",
    rows: [
      { name: "Aarav Mehta", detail: "Science — 98.6%", rank: "1" },
      { name: "Ishita Sharma", detail: "Commerce — 98.2%", rank: "2" },
      { name: "Kabir Nair", detail: "Science — 97.8%", rank: "3" },
    ],
  },
  {
    category: "Class X Toppers",
    rows: [
      { name: "Diya Verma", detail: "99.0%", rank: "1" },
      { name: "Reyansh Gupta", detail: "98.4%", rank: "2" },
      { name: "Anaya Singh", detail: "98.0%", rank: "3" },
    ],
  },
  {
    category: "Olympiad & Competitions",
    rows: [
      { name: "National Science Olympiad", detail: "12 Gold Medals", rank: "★" },
      { name: "Inter-School Maths League", detail: "State Champions", rank: "★" },
      { name: "International Spell Bee", detail: "3 National Finalists", rank: "★" },
    ],
  },
];

export const TESTIMONIALS = [
  {
    quote:
      "SVM didn't just prepare my daughter for exams — it prepared her for life. The mentorship is extraordinary.",
    name: "Sunita Rao",
    role: "Parent",
  },
  {
    quote:
      "The smart classes and labs made learning feel like an adventure. I found my love for engineering here.",
    name: "Rohan Desai",
    role: "Alumnus, IIT Delhi",
  },
  {
    quote:
      "Teachers know every student by name and by dream. That's the SVM difference.",
    name: "Priya Menon",
    role: "Parent",
  },
  {
    quote:
      "From sports day to science fairs — every week here is a memory. I never want to leave.",
    name: "Ananya Iyer",
    role: "Student, Class XII",
  },
  {
    quote:
      "The values I learned at SVM still guide my work as a doctor today.",
    name: "Dr. Vikram Shah",
    role: "Alumnus, Class of 2010",
  },
  {
    quote:
      "A campus that feels safe, modern and full of warmth. We couldn't have asked for more.",
    name: "Neha Kapoor",
    role: "Parent",
  },
];
