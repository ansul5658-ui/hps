import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Signing credentials live in android/key.properties, which is gitignored.
// If the file is missing (fresh clone, CI without secrets) the release build
// falls back to debug signing so `flutter run --release` still works locally --
// but that APK can never be uploaded to Google Play.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasSigningConfig = keystorePropertiesFile.exists()
if (hasSigningConfig) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    // Internal only -- controls the generated R class and MainActivity's package.
    // Deliberately left as the original value so MainActivity.kt and its folder
    // structure do not have to move. Never shown to users or Google Play.
    namespace = "com.example.pdfviewer_new"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        // Permanent Play Store identity. Can never be changed once published.
        applicationId = "in.arpro.paperkit"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasSigningConfig) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasSigningConfig) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }

            // Code shrinking is off for the first release build on purpose.
            // Syncfusion and the PDF packages use reflection, and R8 can strip
            // classes they need at runtime -- the app builds fine and then
            // crashes on a real device. Turn these on later, one flag at a
            // time, and retest every tool after each change.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

flutter {
    source = "../.."
}