<section class="stats-section">
  <div class="container">
    <div class="stats-grid">
      <?php
      $stats = [
        ['number' => hps_get_option('hps_stat_students', '2500'), 'suffix' => '+', 'label' => 'Happy Students'],
        ['number' => hps_get_option('hps_stat_teachers', '120'),  'suffix' => '+', 'label' => 'Expert Teachers'],
        ['number' => hps_get_option('hps_stat_years', '20'),      'suffix' => '+', 'label' => 'Years of Excellence'],
        ['number' => hps_get_option('hps_stat_awards', '50'),     'suffix' => '+', 'label' => 'Awards & Recognition'],
      ];
      foreach ($stats as $stat) : ?>
        <div class="stat-item">
          <div class="stat-number" data-target="<?php echo esc_attr($stat['number']); ?>"><?php echo esc_html($stat['number']); ?><?php echo esc_html($stat['suffix']); ?></div>
          <div class="stat-label"><?php echo esc_html($stat['label']); ?></div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</section>
