<section class="features-section section">
  <div class="container">
    <div class="section-header reveal">
      <span class="section-tag"><?php esc_html_e('Why Choose Us', 'hps-academy'); ?></span>
      <h2 class="section-title"><?php esc_html_e('The HPS Academy Difference', 'hps-academy'); ?></h2>
      <p class="section-subtitle"><?php esc_html_e('We combine academic excellence with holistic development to create confident, compassionate, and capable individuals.', 'hps-academy'); ?></p>
    </div>

    <div class="features-grid">
      <?php
      $features = [
        [
          'icon'  => 'book',
          'title' => 'Academic Excellence',
          'desc'  => 'Our rigorous curriculum, experienced faculty, and outcome-based learning ensures every student achieves their academic best.',
        ],
        [
          'icon'  => 'award',
          'title' => 'Sports & Co-curriculars',
          'desc'  => 'State-of-the-art sports facilities and diverse extracurricular programs help students discover and develop their talents.',
        ],
        [
          'icon'  => 'users',
          'title' => 'Caring Community',
          'desc'  => 'A warm, inclusive school community that supports every student\'s social-emotional well-being and personal growth.',
        ],
        [
          'icon'  => 'globe',
          'title' => 'Global Perspective',
          'desc'  => 'We prepare students to thrive in a globalized world through international exposure and 21st-century skills.',
        ],
        [
          'icon'  => 'check',
          'title' => 'Safe Environment',
          'desc'  => 'A secure, well-maintained campus with CCTV surveillance and trained staff ensures complete safety of every child.',
        ],
        [
          'icon'  => 'calendar',
          'title' => 'Modern Infrastructure',
          'desc'  => 'Smart classrooms, well-equipped labs, library, and technology-rich facilities support modern teaching and learning.',
        ],
      ];
      foreach ($features as $i => $feat) : ?>
        <div class="feature-card reveal reveal-delay-<?php echo ($i % 3) + 1; ?>">
          <div class="feature-icon"><?php echo hps_svg_icon($feat['icon']); ?></div>
          <h3><?php echo esc_html($feat['title']); ?></h3>
          <p><?php echo esc_html($feat['desc']); ?></p>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</section>
