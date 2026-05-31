<?php
defined('ABSPATH') || exit;

function hps_customizer_register($wp_customize) {

    /* ====== School Info ====== */
    $wp_customize->add_section('hps_school_info', [
        'title'    => __('School Information', 'hps-academy'),
        'priority' => 30,
    ]);

    $school_fields = [
        'hps_school_short_name'   => ['label' => 'School Short Name',     'default' => 'HPS Academy'],
        'hps_school_tagline_short'=> ['label' => 'Header Tagline',        'default' => 'Shaping Futures'],
        'hps_years_established'   => ['label' => 'Years Established',     'default' => '20'],
        'hps_phone'               => ['label' => 'Phone Number',          'default' => '+91 00000 00000'],
        'hps_email'               => ['label' => 'Email Address',         'default' => 'info@hpsacademy.in'],
        'hps_address'             => ['label' => 'School Address',        'default' => 'HPS Academy, School Road, City – 000000'],
        'hps_footer_about'        => ['label' => 'Footer About Text',     'default' => 'Nurturing young minds with excellence since 2005.'],
    ];

    foreach ($school_fields as $key => $args) {
        $wp_customize->add_setting($key, ['default' => $args['default'], 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'refresh']);
        $wp_customize->add_control($key, ['label' => $args['label'], 'section' => 'hps_school_info', 'type' => 'text']);
    }

    /* ====== Hero Section ====== */
    $wp_customize->add_section('hps_hero', [
        'title'    => __('Hero Section', 'hps-academy'),
        'priority' => 40,
    ]);

    $hero_fields = [
        'hps_hero_badge'    => ['label' => 'Hero Badge Text',    'default' => 'Top Rated School – 20+ Years of Excellence'],
        'hps_hero_title_1'  => ['label' => 'Hero Title Line 1',  'default' => 'Empowering Minds,'],
        'hps_hero_title_2'  => ['label' => 'Hero Title Line 2',  'default' => 'Shaping'],
        'hps_hero_title_3'  => ['label' => 'Hero Accent Word',   'default' => 'Futures'],
        'hps_hero_subtitle' => ['label' => 'Hero Subtitle',      'default' => 'At HPS Academy, we believe in holistic education that nurtures every child\'s unique talents.'],
    ];

    foreach ($hero_fields as $key => $args) {
        $wp_customize->add_setting($key, ['default' => $args['default'], 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'postMessage']);
        $wp_customize->add_control($key, ['label' => $args['label'], 'section' => 'hps_hero', 'type' => 'text']);
    }

    $wp_customize->add_setting('hps_hero_image', ['sanitize_callback' => 'absint', 'transport' => 'refresh']);
    $wp_customize->add_control(new WP_Customize_Media_Control($wp_customize, 'hps_hero_image', [
        'label'     => __('Hero Background / Main Image', 'hps-academy'),
        'section'   => 'hps_hero',
        'mime_type' => 'image',
    ]));

    /* ====== Stats ====== */
    $wp_customize->add_section('hps_stats', [
        'title'    => __('Statistics', 'hps-academy'),
        'priority' => 50,
    ]);

    $stats = [
        'hps_stat_students' => ['label' => 'Number of Students',  'default' => '2500'],
        'hps_stat_teachers' => ['label' => 'Number of Teachers',  'default' => '120'],
        'hps_stat_years'    => ['label' => 'Years of Excellence', 'default' => '20'],
        'hps_stat_awards'   => ['label' => 'Awards Won',          'default' => '50'],
    ];

    foreach ($stats as $key => $args) {
        $wp_customize->add_setting($key, ['default' => $args['default'], 'sanitize_callback' => 'absint', 'transport' => 'refresh']);
        $wp_customize->add_control($key, ['label' => $args['label'], 'section' => 'hps_stats', 'type' => 'number']);
    }

    /* ====== About ====== */
    $wp_customize->add_section('hps_about', [
        'title'    => __('About Section', 'hps-academy'),
        'priority' => 60,
    ]);

    $wp_customize->add_setting('hps_about_title', ['default' => 'Dedicated to Excellence in Education', 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'postMessage']);
    $wp_customize->add_control('hps_about_title', ['label' => __('About Title', 'hps-academy'), 'section' => 'hps_about', 'type' => 'text']);

    $wp_customize->add_setting('hps_about_text', ['default' => 'HPS Academy is a leading educational institution.', 'sanitize_callback' => 'sanitize_textarea_field', 'transport' => 'postMessage']);
    $wp_customize->add_control('hps_about_text', ['label' => __('About Text', 'hps-academy'), 'section' => 'hps_about', 'type' => 'textarea']);

    $wp_customize->add_setting('hps_about_image', ['sanitize_callback' => 'absint', 'transport' => 'refresh']);
    $wp_customize->add_control(new WP_Customize_Media_Control($wp_customize, 'hps_about_image', [
        'label'     => __('About Section Image', 'hps-academy'),
        'section'   => 'hps_about',
        'mime_type' => 'image',
    ]));

    /* ====== Social Media ====== */
    $wp_customize->add_section('hps_social', [
        'title'    => __('Social Media', 'hps-academy'),
        'priority' => 80,
    ]);

    $socials = [
        'hps_social_facebook'  => 'Facebook URL',
        'hps_social_twitter'   => 'Twitter / X URL',
        'hps_social_instagram' => 'Instagram URL',
        'hps_social_youtube'   => 'YouTube URL',
    ];

    foreach ($socials as $key => $label) {
        $wp_customize->add_setting($key, ['default' => '#', 'sanitize_callback' => 'esc_url_raw', 'transport' => 'refresh']);
        $wp_customize->add_control($key, ['label' => $label, 'section' => 'hps_social', 'type' => 'url']);
    }
}
add_action('customize_register', 'hps_customizer_register');
