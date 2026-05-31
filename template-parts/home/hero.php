<section class="hero" id="hero">
  <div class="hero-shapes" aria-hidden="true">
    <div class="hero-shape hero-shape-1"></div>
    <div class="hero-shape hero-shape-2"></div>
    <div class="hero-shape hero-shape-3"></div>
  </div>

  <div class="container">
    <div class="hero-content">
      <div class="hero-text">
        <div class="badge">
          <?php echo hps_svg_icon('star'); ?>
          <span><?php echo esc_html(hps_get_option('hps_hero_badge', 'Top Rated School – 20+ Years of Excellence')); ?></span>
        </div>

        <h1 class="hero-title">
          <?php
          $title1 = hps_get_option('hps_hero_title_1', 'Empowering Minds,');
          $title2 = hps_get_option('hps_hero_title_2', 'Shaping');
          $title3 = hps_get_option('hps_hero_title_3', 'Futures');
          echo esc_html($title1) . '<br>';
          echo esc_html($title2) . ' <span>' . esc_html($title3) . '</span>';
          ?>
        </h1>

        <p class="hero-subtitle">
          <?php echo esc_html(hps_get_option('hps_hero_subtitle', 'At HPS Academy, we believe in holistic education that nurtures every child\'s unique talents, builds character, and prepares them for a successful future.')); ?>
        </p>

        <div class="hero-buttons">
          <a href="<?php echo esc_url(home_url('/admissions')); ?>" class="btn btn-primary btn-lg">
            <?php esc_html_e('Apply for Admission', 'hps-academy'); ?>
            <?php echo hps_svg_icon('arrow-right'); ?>
          </a>
          <a href="<?php echo esc_url(home_url('/about')); ?>" class="btn btn-secondary btn-lg">
            <?php esc_html_e('Discover Our School', 'hps-academy'); ?>
          </a>
        </div>
      </div>

      <div class="hero-image">
        <div class="hero-img-wrapper">
          <div class="hero-img-main">
            <?php
            $hero_img_id = hps_get_option('hps_hero_image');
            if ($hero_img_id) {
                echo wp_get_attachment_image($hero_img_id, 'hps-hero', false, ['alt' => get_bloginfo('name') . ' Campus']);
            } else {
                echo '<div class="img-placeholder">';
                echo hps_svg_icon('image');
                echo '<span>' . esc_html__('School Campus Image', 'hps-academy') . '</span>';
                echo '</div>';
            }
            ?>
          </div>

          <div class="hero-floating-card hero-floating-card-1">
            <div class="floating-card-icon blue"><?php echo hps_svg_icon('users'); ?></div>
            <div class="floating-card-text">
              <div class="label"><?php esc_html_e('Happy Students', 'hps-academy'); ?></div>
              <div class="value"><?php echo esc_html(hps_get_option('hps_stat_students', '2500')); ?>+</div>
            </div>
          </div>

          <div class="hero-floating-card hero-floating-card-2">
            <div class="floating-card-icon gold"><?php echo hps_svg_icon('award'); ?></div>
            <div class="floating-card-text">
              <div class="label"><?php esc_html_e('Awards Won', 'hps-academy'); ?></div>
              <div class="value"><?php echo esc_html(hps_get_option('hps_stat_awards', '50')); ?>+</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
