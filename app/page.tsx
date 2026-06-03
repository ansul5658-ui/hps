import SmoothScroll from "@/components/providers/SmoothScroll";
import Preloader from "@/components/ui/Preloader";
import MouseFollower from "@/components/ui/MouseFollower";
import ScrollProgress from "@/components/ui/ScrollProgress";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

import Hero from "@/components/sections/Hero";
import Journey from "@/components/sections/Journey";
import CampusReveal from "@/components/sections/CampusReveal";
import Achievements from "@/components/sections/Achievements";
import Facilities from "@/components/sections/Facilities";
import StudentLife from "@/components/sections/StudentLife";
import Results from "@/components/sections/Results";
import Testimonials from "@/components/sections/Testimonials";
import Admissions from "@/components/sections/Admissions";

export default function Home() {
  return (
    <SmoothScroll>
      <Preloader />
      <MouseFollower />
      <ScrollProgress />
      <Navbar />

      <main className="relative">
        <Hero />
        <Journey />
        <CampusReveal />
        <Achievements />
        <Facilities />
        <StudentLife />
        <Results />
        <Testimonials />
        <Admissions />
      </main>

      <Footer />
    </SmoothScroll>
  );
}
