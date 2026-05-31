<?php get_header(); ?>

<main class="site-main">
  <div class="page-header">
    <div class="container">
      <h1><?php the_title(); ?></h1>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="<?php echo esc_url(home_url('/')); ?>"><?php esc_html_e('Home', 'hps-academy'); ?></a>
        <span class="breadcrumb-sep" aria-hidden="true">/</span>
        <span><?php the_title(); ?></span>
      </nav>
    </div>
  </div>

  <section class="section">
    <div class="container">
      <?php while (have_posts()) : the_post(); ?>
        <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
          <div class="entry-content">
            <?php the_content(); ?>
          </div>
        </article>
      <?php endwhile; ?>
    </div>
  </section>
</main>

<?php get_footer(); ?>
