package com.apptesting.app

import android.app.Application

/**
 * Application entry point.
 *
 * Firebase auto-initializes via its ContentProvider once `google-services.json`
 * is present and the `com.google.gms.google-services` plugin is applied.
 * Deliberately keeping this class empty until concrete DI/initialization work
 * lands — no fake wiring, no side effects.
 */
class AppTestingApplication : Application()
