<footer id="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer-main">

      <!-- Brand Column -->
      <div class="footer-brand">
        <a href="<?php echo esc_url(home_url('/')); ?>" class="site-branding" style="margin-bottom:1rem;display:inline-flex;">
          <div class="logo-placeholder" style="width:44px;height:44px;font-size:1.1rem;">HPS</div>
          <div class="site-name" style="margin-left:0.75rem;">
            <span class="site-name-primary"><?php echo esc_html(hps_get_option('hps_school_short_name', 'HPS Academy')); ?></span>
          </div>
        </a>
        <p><?php echo esc_html(hps_get_option('hps_footer_about', 'Nurturing young minds with excellence in education, sports, and extracurricular activities since 2005. We believe every child deserves the best start in life.')); ?></p>
        <div class="social-links">
          <?php if ($fb = hps_get_option('hps_social_facebook')) : ?>
            <a href="<?php echo esc_url($fb); ?>" class="social-link" target="_blank" rel="noopener" aria-label="Facebook">
              <?php echo hps_svg_icon('facebook'); ?>
            </a>
          <?php else : ?>
            <a href="#" class="social-link" aria-label="Facebook"><?php echo hps_svg_icon('facebook'); ?></a>
          <?php endif; ?>
          <a href="<?php echo esc_url(hps_get_option('hps_social_twitter', '#')); ?>" class="social-link" target="_blank" rel="noopener" aria-label="Twitter"><?php echo hps_svg_icon('twitter'); ?></a>
          <a href="<?php echo esc_url(hps_get_option('hps_social_instagram', '#')); ?>" class="social-link" target="_blank" rel="noopener" aria-label="Instagram"><?php echo hps_svg_icon('instagram'); ?></a>
          <a href="<?php echo esc_url(hps_get_option('hps_social_youtube', '#')); ?>" class="social-link" target="_blank" rel="noopener" aria-label="YouTube"><?php echo hps_svg_icon('youtube'); ?></a>
        </div>
      </div>

      <!-- Quick Links -->
      <div class="footer-col">
        <h4><?php esc_html_e('Quick Links', 'hps-academy'); ?></h4>
        <?php
        wp_nav_menu([
          'theme_location' => 'footer',
          'container'      => false,
          'menu_class'     => 'footer-links',
          'fallback_cb'    => 'hps_footer_fallback_menu',
        ]);
        ?>
      </div>

      <!-- Academics -->
      <div class="footer-col">
        <h4><?php esc_html_e('Academics', 'hps-academy'); ?></h4>
        <ul class="footer-links">
          <li><a href="<?php echo esc_url(home_url('/primary-school')); ?>"><?php esc_html_e('Primary School', 'hps-academy'); ?></a></li>
          <li><a href="<?php echo esc_url(home_url('/middle-school')); ?>"><?php esc_html_e('Middle School', 'hps-academy'); ?></a></li>
          <li><a href="<?php echo esc_url(home_url('/high-school')); ?>"><?php esc_html_e('High School', 'hps-academy'); ?></a></li>
          <li><a href="<?php echo esc_url(home_url('/sports')); ?>"><?php esc_html_e('Sports Programs', 'hps-academy'); ?></a></li>
          <li><a href="<?php echo esc_url(home_url('/arts')); ?>"><?php esc_html_e('Arts & Culture', 'hps-academy'); ?></a></li>
          <li><a href="<?php echo esc_url(home_url('/admissions')); ?>"><?php esc_html_e('Admissions', 'hps-academy'); ?></a></li>
        </ul>
      </div>

      <!-- Contact Info -->
      <div class="footer-col">
        <h4><?php esc_html_e('Contact Us', 'hps-academy'); ?></h4>
        <div class="footer-contact-item">
          <?php echo hps_svg_icon('map-pin'); ?>
          <span><?php echo esc_html(hps_get_option('hps_address', 'HPS Academy, School Road, City – 000000')); ?></span>
        </div>
        <div class="footer-contact-item">
          <?php echo hps_svg_icon('phone'); ?>
          <span><?php echo esc_html(hps_get_option('hps_phone', '+91 00000 00000')); ?></span>
        </div>
        <div class="footer-contact-item">
          <?php echo hps_svg_icon('mail'); ?>
          <span><?php echo esc_html(hps_get_option('hps_email', 'info@hpsacademy.in')); ?></span>
        </div>
        <div class="footer-contact-item">
          <?php echo hps_svg_icon('globe'); ?>
          <span>www.hpsacademy.in</span>
        </div>
      </div>

    </div><!-- .footer-main -->

    <div class="footer-bottom">
      <p>&copy; <?php echo date('Y'); ?> <?php echo esc_html(get_bloginfo('name')); ?>. <?php esc_html_e('All rights reserved.', 'hps-academy'); ?></p>
      <div class="footer-bottom-links">
        <a href="<?php echo esc_url(home_url('/privacy-policy')); ?>"><?php esc_html_e('Privacy Policy', 'hps-academy'); ?></a>
        <a href="<?php echo esc_url(home_url('/terms')); ?>"><?php esc_html_e('Terms of Use', 'hps-academy'); ?></a>
        <a href="<?php echo esc_url(home_url('/sitemap')); ?>"><?php esc_html_e('Sitemap', 'hps-academy'); ?></a>
      </div>
    </div>
  </div>
</footer>

<?php wp_footer(); ?>
</body>
</html>

<?php
function hps_footer_fallback_menu() {
    echo '<ul class="footer-links">';
    $links = [
        home_url('/')            => 'Home',
        home_url('/about')       => 'About Us',
        home_url('/academics')   => 'Academics',
        home_url('/admissions')  => 'Admissions',
        home_url('/gallery')     => 'Gallery',
        home_url('/news')        => 'News & Events',
        home_url('/contact')     => 'Contact Us',
    ];
    foreach ($links as $url => $label) {
        echo '<li><a href="' . esc_url($url) . '">' . esc_html($label) . '</a></li>';
    }
    echo '</ul>';
}
