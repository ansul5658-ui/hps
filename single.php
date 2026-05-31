<?php get_header(); ?>

<main class="site-main">
  <?php while (have_posts()) : the_post(); ?>
    <div class="page-header">
      <div class="container">
        <h1><?php the_title(); ?></h1>
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="<?php echo esc_url(home_url('/')); ?>"><?php esc_html_e('Home', 'hps-academy'); ?></a>
          <span class="breadcrumb-sep">/</span>
          <a href="<?php echo esc_url(home_url('/news')); ?>"><?php esc_html_e('News', 'hps-academy'); ?></a>
          <span class="breadcrumb-sep">/</span>
          <span><?php the_title(); ?></span>
        </nav>
      </div>
    </div>

    <section class="section">
      <div class="container">
        <div style="max-width:800px;margin:0 auto;">
          <?php if (has_post_thumbnail()) : ?>
            <div style="border-radius:1rem;overflow:hidden;margin-bottom:2rem;aspect-ratio:16/9;">
              <?php the_post_thumbnail('hps-hero', ['style' => 'width:100%;height:100%;object-fit:cover;']); ?>
            </div>
          <?php endif; ?>

          <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;">
            <span style="font-size:0.875rem;color:var(--color-text-light);"><?php the_date(); ?></span>
            <span style="font-size:0.875rem;color:var(--color-text-light);"><?php the_author(); ?></span>
            <span style="font-size:0.875rem;color:var(--color-accent-dark);"><?php the_category(', '); ?></span>
          </div>

          <article id="post-<?php the_ID(); ?>" <?php post_class('entry-content'); ?>>
            <?php the_content(); ?>
          </article>

          <div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--color-border);">
            <?php
            $prev = get_previous_post();
            $next = get_next_post();
            ?>
            <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
              <?php if ($prev) : ?>
                <a href="<?php echo esc_url(get_permalink($prev)); ?>" style="font-size:0.875rem;font-weight:600;color:var(--color-primary);">
                  ← <?php echo esc_html(get_the_title($prev)); ?>
                </a>
              <?php endif; ?>
              <?php if ($next) : ?>
                <a href="<?php echo esc_url(get_permalink($next)); ?>" style="font-size:0.875rem;font-weight:600;color:var(--color-primary);margin-left:auto;">
                  <?php echo esc_html(get_the_title($next)); ?> →
                </a>
              <?php endif; ?>
            </div>
          </div>
        </div>
      </div>
    </section>
  <?php endwhile; ?>
</main>

<?php get_footer(); ?>
