<?php get_header(); ?>

<main class="site-main">
  <div class="page-header">
    <div class="container">
      <h1><?php esc_html_e('Blog', 'hps-academy'); ?></h1>
    </div>
  </div>

  <section class="section">
    <div class="container">
      <div class="news-grid">
        <?php if (have_posts()) : while (have_posts()) : the_post(); ?>
          <article id="post-<?php the_ID(); ?>" <?php post_class('news-card'); ?>>
            <?php if (has_post_thumbnail()) : ?>
              <div class="news-card-image"><?php the_post_thumbnail('hps-card'); ?></div>
            <?php endif; ?>
            <div class="news-card-body">
              <div class="news-meta">
                <span class="news-category"><?php the_category(', '); ?></span>
                <span class="news-date"><?php the_date(); ?></span>
              </div>
              <h2 style="font-size:1.25rem;"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
              <p><?php the_excerpt(); ?></p>
            </div>
          </article>
        <?php endwhile; endif; ?>
      </div>

      <div style="margin-top:2rem;text-align:center;">
        <?php the_posts_pagination(['mid_size' => 2]); ?>
      </div>
    </div>
  </section>
</main>

<?php get_footer(); ?>
