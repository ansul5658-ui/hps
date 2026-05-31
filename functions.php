<?php
defined('ABSPATH') || exit;

define('HPS_VERSION', '1.0.0');
define('HPS_DIR', get_template_directory());
define('HPS_URI', get_template_directory_uri());

/* -------------------------------------------------------
   Theme Setup
------------------------------------------------------- */
function hps_setup() {
    load_theme_textdomain('hps-academy', HPS_DIR . '/languages');

    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script']);
    add_theme_support('custom-logo', [
        'height'      => 100,
        'width'       => 100,
        'flex-height' => true,
        'flex-width'  => true,
    ]);
    add_theme_support('customize-selective-refresh-widgets');
    add_theme_support('responsive-embeds');
    add_theme_support('wp-block-styles');

    register_nav_menus([
        'primary' => esc_html__('Primary Menu', 'hps-academy'),
        'footer'  => esc_html__('Footer Menu', 'hps-academy'),
    ]);

    add_image_size('hps-hero', 1200, 700, true);
    add_image_size('hps-card', 600, 400, true);
    add_image_size('hps-thumb', 400, 300, true);
}
add_action('after_setup_theme', 'hps_setup');

/* -------------------------------------------------------
   Content Width
------------------------------------------------------- */
function hps_content_width() {
    $GLOBALS['content_width'] = 1200;
}
add_action('after_setup_theme', 'hps_content_width', 0);

/* -------------------------------------------------------
   Enqueue Scripts & Styles
------------------------------------------------------- */
function hps_enqueue_assets() {
    wp_enqueue_style('google-fonts',
        'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap',
        [], null
    );
    wp_enqueue_style('hps-style', get_stylesheet_uri(), ['google-fonts'], HPS_VERSION);

    wp_enqueue_script('hps-main', HPS_URI . '/assets/js/main.js', [], HPS_VERSION, true);

    wp_localize_script('hps-main', 'hpsData', [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'nonce'   => wp_create_nonce('hps_nonce'),
        'siteUrl' => get_site_url(),
    ]);

    if (is_singular() && comments_open() && get_option('thread_comments')) {
        wp_enqueue_script('comment-reply');
    }
}
add_action('wp_enqueue_scripts', 'hps_enqueue_assets');

/* -------------------------------------------------------
   Widget Areas
------------------------------------------------------- */
function hps_register_sidebars() {
    register_sidebar([
        'name'          => esc_html__('Sidebar', 'hps-academy'),
        'id'            => 'sidebar-1',
        'description'   => esc_html__('Add widgets here to appear in your sidebar.', 'hps-academy'),
        'before_widget' => '<section id="%1$s" class="widget %2$s">',
        'after_widget'  => '</section>',
        'before_title'  => '<h3 class="widget-title">',
        'after_title'   => '</h3>',
    ]);

    for ($i = 1; $i <= 4; $i++) {
        register_sidebar([
            'name'          => sprintf(esc_html__('Footer Column %d', 'hps-academy'), $i),
            'id'            => "footer-{$i}",
            'description'   => sprintf(esc_html__('Footer widget area %d', 'hps-academy'), $i),
            'before_widget' => '<div id="%1$s" class="footer-widget %2$s">',
            'after_widget'  => '</div>',
            'before_title'  => '<h4 class="footer-widget-title">',
            'after_title'   => '</h4>',
        ]);
    }
}
add_action('widgets_init', 'hps_register_sidebars');

/* -------------------------------------------------------
   Custom Post Types
------------------------------------------------------- */
function hps_register_post_types() {
    register_post_type('announcement', [
        'labels' => [
            'name'               => __('Announcements', 'hps-academy'),
            'singular_name'      => __('Announcement', 'hps-academy'),
            'add_new_item'       => __('Add New Announcement', 'hps-academy'),
            'edit_item'          => __('Edit Announcement', 'hps-academy'),
        ],
        'public'       => true,
        'supports'     => ['title', 'editor', 'thumbnail', 'excerpt'],
        'menu_icon'    => 'dashicons-megaphone',
        'has_archive'  => true,
        'rewrite'      => ['slug' => 'announcements'],
        'show_in_rest' => true,
    ]);

    register_post_type('gallery_item', [
        'labels' => [
            'name'          => __('Gallery', 'hps-academy'),
            'singular_name' => __('Gallery Item', 'hps-academy'),
        ],
        'public'       => true,
        'supports'     => ['title', 'thumbnail'],
        'menu_icon'    => 'dashicons-format-gallery',
        'has_archive'  => false,
        'rewrite'      => ['slug' => 'gallery'],
        'show_in_rest' => true,
    ]);
}
add_action('init', 'hps_register_post_types');

/* -------------------------------------------------------
   Customizer
------------------------------------------------------- */
require_once HPS_DIR . '/inc/customizer.php';

/* -------------------------------------------------------
   Contact Form AJAX
------------------------------------------------------- */
function hps_handle_contact_form() {
    check_ajax_referer('hps_nonce', 'nonce');

    $name    = sanitize_text_field($_POST['name'] ?? '');
    $email   = sanitize_email($_POST['email'] ?? '');
    $subject = sanitize_text_field($_POST['subject'] ?? '');
    $message = sanitize_textarea_field($_POST['message'] ?? '');

    if (empty($name) || empty($email) || empty($message) || !is_email($email)) {
        wp_send_json_error(['message' => __('Please fill in all required fields correctly.', 'hps-academy')]);
    }

    $to      = get_option('admin_email');
    $headers = ['Content-Type: text/html; charset=UTF-8', "Reply-To: {$name} <{$email}>"];

    $body = "<p><strong>Name:</strong> {$name}</p>
             <p><strong>Email:</strong> {$email}</p>
             <p><strong>Subject:</strong> {$subject}</p>
             <p><strong>Message:</strong><br>" . nl2br($message) . '</p>';

    $sent = wp_mail($to, "Contact Form: {$subject}", $body, $headers);

    if ($sent) {
        wp_send_json_success(['message' => __('Your message has been sent. We will get back to you soon!', 'hps-academy')]);
    } else {
        wp_send_json_error(['message' => __('Message could not be sent. Please try again later.', 'hps-academy')]);
    }
}
add_action('wp_ajax_hps_contact', 'hps_handle_contact_form');
add_action('wp_ajax_nopriv_hps_contact', 'hps_handle_contact_form');

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function hps_get_option($key, $default = '') {
    return get_theme_mod($key, $default);
}

function hps_svg_icon($name) {
    $icons = [
        'star' => '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
        'book' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        'users' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        'award' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
        'check' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
        'arrow-right' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
        'phone' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17.92z"/></svg>',
        'mail' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
        'map-pin' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        'quote' => '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>',
        'image' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        'calendar' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        'globe' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
        'facebook' => '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
        'twitter' => '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>',
        'instagram' => '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
        'youtube' => '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/></svg>',
    ];
    return $icons[$name] ?? '';
}
