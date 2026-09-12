package com.apptesting.app

import android.app.Application
import com.apptesting.app.core.data.ServiceLocator

/**
 * Application entry point.
 *
 * Firebase auto-initializes via its ContentProvider once google-services.json
 * is present and the `com.google.gms.google-services` plugin has been applied
 * (see app/build.gradle.kts). This class simply primes the ServiceLocator so
 * the first ViewModel that touches [ServiceLocator.userRepository] gets the
 * correct implementation (Firebase-backed if configured, mock otherwise).
 */
class AppTestingApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ServiceLocator.init(this)
    }
}
