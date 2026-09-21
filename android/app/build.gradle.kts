plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.parcelize)
}

if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    println("Firebase enabled — using google-services.json")
}

android {
    namespace = "com.apptesting.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.apptesting.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        debug {
            // IMPORTANT:
            // No applicationIdSuffix here.
            // Firebase is configured for com.apptesting.app.
            isMinifyEnabled = false

            // Host of the local Firebase Emulator Suite, for DEBUG BUILDS ONLY.
            //
            // Empty by default, so an ordinary debug build behaves exactly as
            // before and talks to real Firebase. Set it to point a build at
            // local emulators instead:
            //
            //   ./gradlew assembleDebug -PfirebaseEmulatorHost=127.0.0.1
            //
            // 127.0.0.1 is correct for a USB-connected physical phone when the
            // emulator ports are tunnelled with `adb reverse` — the phone's own
            // localhost then reaches this PC. A LAN IP (e.g. 192.168.1.8) works
            // too when both are on the same network; adb reverse is preferred
            // because it does not depend on Wi-Fi.
            //
            // The release block below hard-codes "", and the wiring code is
            // additionally guarded by BuildConfig.DEBUG, so there is no way for
            // this to reach a production build.
            buildConfigField(
                "String",
                "FIREBASE_EMULATOR_HOST",
                "\"${project.findProperty("firebaseEmulatorHost") ?: ""}\"",
            )
        }

        release {
            isMinifyEnabled = false

            // Never an emulator in release. Belt and braces alongside
            // BuildConfig.DEBUG.
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"\"")

            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"

        freeCompilerArgs += listOf(
            "-opt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi"
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {

    // Kotlin & Coroutines
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // AndroidX Foundation
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.splashscreen)

    // Lifecycle
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // DataStore
    implementation(libs.androidx.datastore.preferences)

    // Jetpack Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)

    // Navigation
    implementation(libs.androidx.navigation.compose)

    // Image loading
    implementation(libs.coil.compose)

    // Firebase
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth.ktx)
    implementation(libs.firebase.firestore.ktx)
    implementation(libs.firebase.storage.ktx)
    implementation(libs.firebase.functions.ktx)
    implementation(libs.firebase.messaging.ktx)

    // Credential Manager / Google Sign-In
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(libs.play.services.auth)

    // Testing
    testImplementation(libs.junit)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
