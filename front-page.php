<?php get_header(); ?>

<!-- HERO -->
<?php get_template_part('template-parts/home/hero'); ?>

<!-- STATS -->
<?php get_template_part('template-parts/home/stats'); ?>

<!-- ABOUT -->
<section class="about-section section">
  <div class="container">
    <div class="about-grid">

      <div class="about-image-wrapper reveal">
        <div class="about-img-main">
          <?php
          $about_img_id = hps_get_option('hps_about_image');
          if ($about_img_id) {
              echo wp_get_attachment_image($about_img_id, 'hps-hero', false, ['alt' => 'HPS Academy Campus']);
          } else {
              echo '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#e8edf5,#c8d4e8);color:#8a96a8;">';
              echo hps_svg_icon('image');
              echo '</div>';
          }
          ?>
        </div>
        <div class="about-img-accent">
          <span class="years"><?php echo esc_html(hps_get_option('hps_years_established', '20')); ?>+</span>
          <span class="years-text"><?php esc_html_e('Years of Excellence', 'hps-academy'); ?></span>
        </div>
      </div>

      <div class="about-content">
        <div class="section-header">
          <span class="section-tag"><?php esc_html_e('About Us', 'hps-academy'); ?></span>
          <h2 class="section-title"><?php echo esc_html(hps_get_option('hps_about_title', 'Dedicated to Excellence in Education')); ?></h2>
          <p class="section-subtitle" style="max-width:100%;text-align:left;"><?php echo esc_html(hps_get_option('hps_about_text', 'HPS Academy is a leading educational institution committed to nurturing intellectual curiosity, moral character, and leadership skills in every student.')); ?></p>
        </div>

        <div class="about-features">
          <?php
          $features = [
            ['icon' => 'award',  'title' => 'Award-Winning Faculty',       'desc' => 'Experienced teachers with a passion for inspiring students to reach their full potential.'],
            ['icon' => 'book',   'title' => 'Comprehensive Curriculum',     'desc' => 'A well-rounded education blending academics, arts, and sports for holistic development.'],
            ['icon' => 'users',  'title' => 'Inclusive Community',          'desc' => 'A safe, welcoming environment where every student feels valued and supported.'],
          ];
          foreach ($features as $f) : ?>
            <div class="about-feature reveal">
              <div class="about-feature-icon"><?php echo hps_svg_icon($f['icon']); ?></div>
              <div class="about-feature-text">
                <h4><?php echo esc_html($f['title']); ?></h4>
                <p><?php echo esc_html($f['desc']); ?></p>
              </div>
            </div>
          <?php endforeach; ?>
        </div>

        <a href="<?php echo esc_url(home_url('/about')); ?>" class="btn btn-outline">
          <?php esc_html_e('Learn More About Us', 'hps-academy'); ?>
          <?php echo hps_svg_icon('arrow-right'); ?>
        </a>
      </div>

    </div>
  </div>
</section>

<!-- FEATURES / WHY CHOOSE US -->
<?php get_template_part('template-parts/home/features'); ?>

<!-- PROGRAMS -->
<section class="programs-section section">
  <div class="container">
    <div class="section-header reveal">
      <span class="section-tag"><?php esc_html_e('Our Programs', 'hps-academy'); ?></span>
      <h2 class="section-title"><?php esc_html_e('Academic Programs', 'hps-academy'); ?></h2>
      <p class="section-subtitle"><?php esc_html_e('Discover our comprehensive range of academic programs designed to challenge and inspire every student.', 'hps-academy'); ?></p>
    </div>

    <div class="programs-grid">
      <?php
      $programs = [
        ['tag' => 'Classes I–V',   'title' => 'Primary School',  'desc' => 'Building a strong foundation through play-based and structured learning in a nurturing environment.'],
        ['tag' => 'Classes VI–VIII', 'title' => 'Middle School', 'desc' => 'Expanding horizons with deeper subject knowledge and extracurricular exploration.'],
        ['tag' => 'Classes IX–XII', 'title' => 'Senior School',  'desc' => 'Rigorous academics preparing students for board examinations and higher education.'],
      ];
      foreach ($programs as $prog) : ?>
        <div class="program-card reveal">
          <div class="program-card-image">
            <div class="prog-icon"><?php echo hps_svg_icon('book'); ?></div>
          </div>
          <div class="program-card-body">
            <span class="program-card-tag"><?php echo esc_html($prog['tag']); ?></span>
            <h3><?php echo esc_html($prog['title']); ?></h3>
            <p><?php echo esc_html($prog['desc']); ?></p>
            <a href="<?php echo esc_url(home_url('/academics')); ?>" class="program-card-link">
              <?php esc_html_e('Learn more', 'hps-academy'); ?>
              <?php echo hps_svg_icon('arrow-right'); ?>
            </a>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</section>

<!-- NEWS -->
<section class="news-section section">
  <div class="container">
    <div class="section-header reveal">
      <span class="section-tag"><?php esc_html_e('Latest Updates', 'hps-academy'); ?></span>
      <h2 class="section-title"><?php esc_html_e('News & Announcements', 'hps-academy'); ?></h2>
      <p class="section-subtitle"><?php esc_html_e('Stay updated with the latest happenings at HPS Academy.', 'hps-academy'); ?></p>
    </div>

    <div class="news-grid">
      <?php
      $news_query = new WP_Query([
        'post_type'      => ['post', 'announcement'],
        'posts_per_page' => 3,
        'orderby'        => 'date',
        'order'          => 'DESC',
      ]);

      if ($news_query->have_posts()) :
        while ($news_query->have_posts()) : $news_query->the_post(); ?>
          <article class="news-card reveal">
            <?php if (has_post_thumbnail()) : ?>
              <div class="news-card-image">
                <?php the_post_thumbnail('hps-card', ['alt' => get_the_title()]); ?>
              </div>
            <?php else : ?>
              <div class="news-card-image" style="background:linear-gradient(135deg,#1a3c6e,#2a5298);height:180px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);">
                <?php echo hps_svg_icon('image'); ?>
              </div>
            <?php endif; ?>
            <div class="news-card-body">
              <div class="news-meta">
                <span class="news-category"><?php the_category(', '); ?></span>
                <span class="news-date"><?php echo get_the_date(); ?></span>
              </div>
              <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
              <p><?php echo wp_trim_words(get_the_excerpt(), 18); ?></p>
            </div>
          </article>
        <?php endwhile;
        wp_reset_postdata();
      else :
        $sample_news = [
          ['title' => 'Annual Sports Day 2025 – A Grand Success', 'date' => 'May 20, 2025', 'cat' => 'Events'],
          ['title' => 'Board Examination Results – Outstanding Performance', 'date' => 'May 15, 2025', 'cat' => 'Academics'],
          ['title' => 'Admissions Open for Academic Year 2025–26', 'date' => 'May 10, 2025', 'cat' => 'Admissions'],
        ];
        foreach ($sample_news as $n) : ?>
          <div class="news-card reveal">
            <div class="news-card-image" style="background:linear-gradient(135deg,#1a3c6e,#2a5298);height:180px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);">
              <?php echo hps_svg_icon('image'); ?>
            </div>
            <div class="news-card-body">
              <div class="news-meta">
                <span class="news-category"><?php echo esc_html($n['cat']); ?></span>
                <span class="news-date"><?php echo esc_html($n['date']); ?></span>
              </div>
              <h3><a href="<?php echo esc_url(home_url('/news')); ?>"><?php echo esc_html($n['title']); ?></a></h3>
              <p><?php esc_html_e('Stay connected for updates on this exciting development at HPS Academy.', 'hps-academy'); ?></p>
            </div>
          </div>
        <?php endforeach;
      endif;
      ?>
    </div>

    <div class="gallery-center" style="margin-top:2.5rem;">
      <a href="<?php echo esc_url(home_url('/news')); ?>" class="btn btn-outline">
        <?php esc_html_e('View All News', 'hps-academy'); ?>
        <?php echo hps_svg_icon('arrow-right'); ?>
      </a>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="testimonials-section section">
  <div class="container">
    <div class="section-header reveal">
      <span class="section-tag"><?php esc_html_e('Testimonials', 'hps-academy'); ?></span>
      <h2 class="section-title"><?php esc_html_e('What Parents Say', 'hps-academy'); ?></h2>
      <p class="section-subtitle"><?php esc_html_e('Hear from our school community about their experience at HPS Academy.', 'hps-academy'); ?></p>
    </div>

    <div class="testimonials-grid">
      <?php
      $testimonials = [
        ['text' => '"HPS Academy has been the best decision for our child. The teachers are dedicated, the campus is beautiful, and our daughter has grown tremendously both academically and personally."',
         'name' => 'Priya Sharma', 'role' => 'Parent of Class VIII Student', 'initial' => 'P'],
        ['text' => '"The school maintains exceptional standards in education while ensuring every child gets personal attention. My son has become more confident and curious since joining HPS Academy."',
         'name' => 'Rajesh Verma', 'role' => 'Parent of Class V Student', 'initial' => 'R'],
        ['text' => '"From academics to sports and arts, HPS Academy offers everything a child needs to flourish. The faculty is passionate and the overall environment is truly nurturing."',
         'name' => 'Sunita Patel', 'role' => 'Parent of Class X Student', 'initial' => 'S'],
      ];
      foreach ($testimonials as $t) : ?>
        <div class="testimonial-card reveal">
          <div class="testimonial-quote"><?php echo hps_svg_icon('quote'); ?></div>
          <p class="testimonial-text"><?php echo esc_html($t['text']); ?></p>
          <div class="testimonial-author">
            <div class="testimonial-avatar"><?php echo esc_html($t['initial']); ?></div>
            <div class="testimonial-info">
              <div class="name"><?php echo esc_html($t['name']); ?></div>
              <div class="role"><?php echo esc_html($t['role']); ?></div>
            </div>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</section>

<!-- GALLERY PREVIEW -->
<section class="gallery-section section">
  <div class="container">
    <div class="section-header reveal">
      <span class="section-tag"><?php esc_html_e('Gallery', 'hps-academy'); ?></span>
      <h2 class="section-title"><?php esc_html_e('Life at HPS Academy', 'hps-academy'); ?></h2>
      <p class="section-subtitle"><?php esc_html_e('A glimpse into the vibrant and enriching life at our campus.', 'hps-academy'); ?></p>
    </div>

    <div class="gallery-grid reveal">
      <?php
      $gallery_query = new WP_Query([
        'post_type'      => 'gallery_item',
        'posts_per_page' => 5,
        'orderby'        => 'date',
        'order'          => 'DESC',
      ]);

      if ($gallery_query->have_posts()) :
        while ($gallery_query->have_posts()) : $gallery_query->the_post(); ?>
          <div class="gallery-item">
            <?php if (has_post_thumbnail()) : ?>
              <?php the_post_thumbnail('hps-card', ['alt' => get_the_title()]); ?>
            <?php else : ?>
              <div class="gallery-placeholder"><?php echo hps_svg_icon('image'); ?></div>
            <?php endif; ?>
          </div>
        <?php endwhile;
        wp_reset_postdata();
      else :
        for ($gi = 0; $gi < 5; $gi++) :
          $colors = ['#1a3c6e', '#2a5298', '#f5a623', '#0f2547', '#1e4a7c'];
          ?>
          <div class="gallery-item">
            <div class="gallery-placeholder" style="background:<?php echo $colors[$gi]; ?>;">
              <?php echo hps_svg_icon('image'); ?>
            </div>
          </div>
        <?php endfor;
      endif;
      ?>
    </div>

    <div class="gallery-center">
      <a href="<?php echo esc_url(home_url('/gallery')); ?>" class="btn btn-outline">
        <?php esc_html_e('View Full Gallery', 'hps-academy'); ?>
        <?php echo hps_svg_icon('arrow-right'); ?>
      </a>
    </div>
  </div>
</section>

<!-- CTA -->
<section class="cta-section section-sm">
  <div class="container">
    <div class="cta-box">
      <div class="section-header" style="position:relative;z-index:1;">
        <span class="section-tag"><?php esc_html_e('Admissions Open', 'hps-academy'); ?></span>
        <h2 class="section-title"><?php esc_html_e('Ready to Join Our Community?', 'hps-academy'); ?></h2>
        <p class="section-subtitle"><?php esc_html_e('Give your child the best start in life. Apply now for the 2025–26 academic year and experience excellence in education.', 'hps-academy'); ?></p>
      </div>
      <div class="cta-buttons">
        <a href="<?php echo esc_url(home_url('/admissions')); ?>" class="btn btn-primary btn-lg">
          <?php esc_html_e('Apply for Admission', 'hps-academy'); ?>
          <?php echo hps_svg_icon('arrow-right'); ?>
        </a>
        <a href="<?php echo esc_url(home_url('/contact')); ?>" class="btn btn-secondary btn-lg">
          <?php esc_html_e('Contact Us', 'hps-academy'); ?>
        </a>
      </div>
    </div>
  </div>
</section>

<?php get_footer(); ?>
