<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="profile" href="https://gmpg.org/xfn/11">
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header id="site-header" role="banner">
  <div class="container">
    <a href="<?php echo esc_url(home_url('/')); ?>" class="site-branding" aria-label="<?php bloginfo('name'); ?> – Home">
      <?php if (has_custom_logo()) : ?>
        <div class="site-logo"><?php the_custom_logo(); ?></div>
      <?php else : ?>
        <div class="logo-placeholder" aria-hidden="true">HPS</div>
      <?php endif; ?>
      <div class="site-name">
        <span class="site-name-primary"><?php echo esc_html(hps_get_option('hps_school_short_name', 'HPS Academy')); ?></span>
        <span class="site-name-secondary"><?php echo esc_html(hps_get_option('hps_school_tagline_short', 'Shaping Futures')); ?></span>
      </div>
    </a>

    <nav class="main-nav" id="main-nav" role="navigation" aria-label="Primary Navigation">
      <?php
      wp_nav_menu([
        'theme_location' => 'primary',
        'menu_class'     => '',
        'container'      => false,
        'fallback_cb'    => 'hps_fallback_menu',
      ]);
      ?>
    </nav>

    <button class="menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="Toggle navigation">
      <span></span>
      <span></span>
      <span></span>
    </button>
  </div>
</header>

<?php
function hps_fallback_menu() {
    echo '<ul>';
    echo '<li><a href="' . esc_url(home_url('/')) . '">Home</a></li>';
    echo '<li><a href="' . esc_url(home_url('/about')) . '">About</a></li>';
    echo '<li><a href="' . esc_url(home_url('/academics')) . '">Academics</a></li>';
    echo '<li><a href="' . esc_url(home_url('/admissions')) . '">Admissions</a></li>';
    echo '<li><a href="' . esc_url(home_url('/gallery')) . '">Gallery</a></li>';
    echo '<li><a href="' . esc_url(home_url('/contact')) . '" class="nav-cta">Contact</a></li>';
    echo '</ul>';
}
?>
