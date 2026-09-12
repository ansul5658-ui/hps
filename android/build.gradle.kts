// Top-level build file — plugin declarations are here for the version catalog to resolve;
// they are applied inside each module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.parcelize) apply false
    // Declared here so the plugin classpath is available; applied in :app
    // ONLY when google-services.json is present. Keeps the project buildable
    // without Firebase config while still supporting the real setup.
    alias(libs.plugins.google.services) apply false
}
