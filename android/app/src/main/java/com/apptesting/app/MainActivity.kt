package com.apptesting.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.apptesting.app.core.designsystem.theme.AppTestingTheme
import com.apptesting.app.core.navigation.AppNavHost

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Platform splash — Compose owns the runtime theme once the first frame draws.
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        setContent {
            AppTestingTheme {
                AppNavHost()
            }
        }
    }
}
