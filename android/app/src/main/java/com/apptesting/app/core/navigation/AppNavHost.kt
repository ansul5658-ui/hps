package com.apptesting.app.core.navigation

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.apptesting.app.feature.auth.SignInScreen
import com.apptesting.app.feature.auth.TermsScreen
import com.apptesting.app.feature.splash.SplashScreen

/**
 * Root nav host. Two top-level graphs live here:
 *   1. Onboarding — Splash → SignIn → Terms.
 *   2. Main — a nested graph hosting the bottom-nav tabs (built in MainScaffold).
 *
 * The Main entry replaces the onboarding stack with popUpTo(Splash, inclusive)
 * so users can't back-swipe into the auth flow after signing in.
 */
@Composable
fun AppNavHost() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = Routes.Splash,
        enterTransition = { fadeIn(tween(220)) },
        exitTransition = { fadeOut(tween(180)) },
        popEnterTransition = { fadeIn(tween(220)) },
        popExitTransition = { fadeOut(tween(180)) },
    ) {
        onboardingGraph(
            onSplashFinished = {
                // TODO(auth): if Firebase Auth already has a signed-in user, route straight to Main.
                navController.navigate(Routes.SignIn) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
            onSignInSuccess = {
                navController.navigate(Routes.Terms) {
                    popUpTo(Routes.SignIn) { inclusive = true }
                }
            },
            onTermsAccepted = {
                navController.navigate(Routes.Main) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
        )

        composable(Routes.Main) {
            MainScaffold(
                onSignOut = {
                    navController.navigate(Routes.SignIn) {
                        popUpTo(Routes.Main) { inclusive = true }
                    }
                },
            )
        }
    }
}

private fun NavGraphBuilder.onboardingGraph(
    onSplashFinished: () -> Unit,
    onSignInSuccess: () -> Unit,
    onTermsAccepted: () -> Unit,
) {
    composable(Routes.Splash) { SplashScreen(onFinished = onSplashFinished) }
    composable(Routes.SignIn) { SignInScreen(onSignedIn = onSignInSuccess) }
    composable(Routes.Terms) { TermsScreen(onAccepted = onTermsAccepted) }
}
