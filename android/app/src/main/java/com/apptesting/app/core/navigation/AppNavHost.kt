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
 * Splash now reads the actual auth state:
 *   * a signed-in user (Firebase persisted session, or the mock demo user)
 *     goes straight to Main;
 *   * a signed-out user goes to SignIn.
 *
 * Sign-in success routes to Terms so first-time users still see the
 * acknowledgement. A returning user who was already signed in on splash
 * skips both SignIn and Terms — an appropriate outcome given they must
 * have accepted before.
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
            onSignedInAtSplash = {
                navController.navigate(Routes.Main) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
            onNeedsSignInAtSplash = {
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
    onSignedInAtSplash: () -> Unit,
    onNeedsSignInAtSplash: () -> Unit,
    onSignInSuccess: () -> Unit,
    onTermsAccepted: () -> Unit,
) {
    composable(Routes.Splash) {
        SplashScreen(
            onSignedIn = onSignedInAtSplash,
            onNeedsSignIn = onNeedsSignInAtSplash,
        )
    }
    composable(Routes.SignIn) { SignInScreen(onSignedIn = onSignInSuccess) }
    composable(Routes.Terms) { TermsScreen(onAccepted = onTermsAccepted) }
}
