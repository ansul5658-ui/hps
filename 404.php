<?php get_header(); ?>

<main class="site-main">
  <section class="not-found-section section">
    <div class="container">
      <div class="not-found-content">
        <div class="not-found-number" aria-hidden="true">404</div>
        <h2><?php esc_html_e('Oops! Page Not Found', 'hps-academy'); ?></h2>
        <p style="margin:1rem 0 2rem;max-width:480px;margin-left:auto;margin-right:auto;">
          <?php esc_html_e('The page you are looking for might have been moved, renamed, or does not exist.', 'hps-academy'); ?>
        </p>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          <a href="<?php echo esc_url(home_url('/')); ?>" class="btn btn-primary">
            <?php esc_html_e('Go to Homepage', 'hps-academy'); ?>
          </a>
          <a href="<?php echo esc_url(home_url('/contact')); ?>" class="btn btn-outline">
            <?php esc_html_e('Contact Us', 'hps-academy'); ?>
          </a>
        </div>
      </div>
    </div>
  </section>
</main>

<?php get_footer(); ?>
