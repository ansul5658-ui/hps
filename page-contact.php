<?php
/* Template Name: Contact Page */
get_header();
?>

<main class="site-main">
  <div class="page-header">
    <div class="container">
      <h1><?php esc_html_e('Contact Us', 'hps-academy'); ?></h1>
      <nav class="breadcrumb">
        <a href="<?php echo esc_url(home_url('/')); ?>"><?php esc_html_e('Home', 'hps-academy'); ?></a>
        <span class="breadcrumb-sep">/</span>
        <span><?php esc_html_e('Contact', 'hps-academy'); ?></span>
      </nav>
    </div>
  </div>

  <section class="contact-section section">
    <div class="container">
      <div class="contact-grid">

        <!-- Contact Info -->
        <div class="contact-info">
          <div class="section-header" style="text-align:left;margin-bottom:2rem;">
            <span class="section-tag"><?php esc_html_e('Get In Touch', 'hps-academy'); ?></span>
            <h2 class="section-title" style="font-size:2rem;"><?php esc_html_e('We\'d Love to Hear From You', 'hps-academy'); ?></h2>
            <p class="section-subtitle" style="max-width:100%;text-align:left;"><?php esc_html_e('Have questions about admissions, academics, or anything else? Our team is here to help.', 'hps-academy'); ?></p>
          </div>

          <div class="contact-item">
            <div class="contact-item-icon"><?php echo hps_svg_icon('map-pin'); ?></div>
            <div class="contact-item-text">
              <h4><?php esc_html_e('Our Address', 'hps-academy'); ?></h4>
              <p><?php echo esc_html(hps_get_option('hps_address', 'HPS Academy, School Road, City – 000000')); ?></p>
            </div>
          </div>

          <div class="contact-item">
            <div class="contact-item-icon"><?php echo hps_svg_icon('phone'); ?></div>
            <div class="contact-item-text">
              <h4><?php esc_html_e('Phone', 'hps-academy'); ?></h4>
              <a href="tel:<?php echo esc_attr(hps_get_option('hps_phone', '')); ?>"><?php echo esc_html(hps_get_option('hps_phone', '+91 00000 00000')); ?></a>
            </div>
          </div>

          <div class="contact-item">
            <div class="contact-item-icon"><?php echo hps_svg_icon('mail'); ?></div>
            <div class="contact-item-text">
              <h4><?php esc_html_e('Email', 'hps-academy'); ?></h4>
              <a href="mailto:<?php echo esc_attr(hps_get_option('hps_email', 'info@hpsacademy.in')); ?>">
                <?php echo esc_html(hps_get_option('hps_email', 'info@hpsacademy.in')); ?>
              </a>
            </div>
          </div>

          <div class="contact-item">
            <div class="contact-item-icon"><?php echo hps_svg_icon('calendar'); ?></div>
            <div class="contact-item-text">
              <h4><?php esc_html_e('Office Hours', 'hps-academy'); ?></h4>
              <p><?php esc_html_e('Monday – Saturday: 8:00 AM – 4:00 PM', 'hps-academy'); ?></p>
            </div>
          </div>
        </div>

        <!-- Contact Form -->
        <div class="contact-form">
          <h3 style="font-size:1.5rem;margin-bottom:1.5rem;"><?php esc_html_e('Send Us a Message', 'hps-academy'); ?></h3>

          <div id="form-feedback" style="display:none;padding:1rem;border-radius:8px;margin-bottom:1rem;font-size:0.875rem;font-weight:500;"></div>

          <style>
            .form-feedback.success { background:#dcfce7;color:#166534;border:1px solid #86efac; }
            .form-feedback.error   { background:#fee2e2;color:#991b1b;border:1px solid #fca5a5; }
          </style>

          <form id="hps-contact-form" novalidate>
            <div class="form-row">
              <div class="form-group">
                <label for="contact-name"><?php esc_html_e('Full Name *', 'hps-academy'); ?></label>
                <input type="text" id="contact-name" name="name" placeholder="<?php esc_attr_e('Your name', 'hps-academy'); ?>" required>
              </div>
              <div class="form-group">
                <label for="contact-email"><?php esc_html_e('Email Address *', 'hps-academy'); ?></label>
                <input type="email" id="contact-email" name="email" placeholder="<?php esc_attr_e('your@email.com', 'hps-academy'); ?>" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="contact-phone"><?php esc_html_e('Phone Number', 'hps-academy'); ?></label>
                <input type="tel" id="contact-phone" name="phone" placeholder="<?php esc_attr_e('+91 00000 00000', 'hps-academy'); ?>">
              </div>
              <div class="form-group">
                <label for="contact-subject"><?php esc_html_e('Subject', 'hps-academy'); ?></label>
                <select id="contact-subject" name="subject">
                  <option value=""><?php esc_html_e('Select a subject', 'hps-academy'); ?></option>
                  <option value="Admissions Enquiry"><?php esc_html_e('Admissions Enquiry', 'hps-academy'); ?></option>
                  <option value="Academic Information"><?php esc_html_e('Academic Information', 'hps-academy'); ?></option>
                  <option value="Fee Structure"><?php esc_html_e('Fee Structure', 'hps-academy'); ?></option>
                  <option value="General Query"><?php esc_html_e('General Query', 'hps-academy'); ?></option>
                  <option value="Other"><?php esc_html_e('Other', 'hps-academy'); ?></option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="contact-message"><?php esc_html_e('Message *', 'hps-academy'); ?></label>
              <textarea id="contact-message" name="message" placeholder="<?php esc_attr_e('Write your message here…', 'hps-academy'); ?>" required></textarea>
            </div>

            <?php wp_nonce_field('hps_contact_form', 'hps_contact_nonce'); ?>

            <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">
              <?php esc_html_e('Send Message', 'hps-academy'); ?>
              <?php echo hps_svg_icon('arrow-right'); ?>
            </button>
          </form>
        </div>

      </div>
    </div>
  </section>
</main>

<?php get_footer(); ?>
