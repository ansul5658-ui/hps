package com.apptesting.app.core.navigation

import android.util.Log
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
import com.apptesting.app.feature.groups.onboarding.GroupOnboardingScreen
import com.apptesting.app.feature.splash.SplashScreen

private const val TAG = "AUTH_DEBUG"

/**
 * Root nav host. Two top-level graphs live here:
 *   1. Onboarding — Splash → SignIn → Terms → GroupOnboarding.
 *   2. Main — a nested graph hosting the bottom-nav tabs (built in MainScaffold).
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
                Log.d(TAG, "[FLOW] Navigation from Splash -> Main")
                navController.navigate(Routes.Main) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
            onNeedsSignInAtSplash = {
                Log.d(TAG, "[FLOW] Navigation from Splash -> SignIn")
                navController.navigate(Routes.SignIn) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
            onSignInSuccess = {
                Log.d(TAG, "[FLOW] Navigation to Terms")
                navController.navigate(Routes.Terms) {
                    popUpTo(Routes.SignIn) { inclusive = true }
                }
            },
            onTermsAccepted = {
                Log.d(TAG, "[FLOW] Navigation to GroupOnboarding")
                navController.navigate(Routes.GroupOnboarding) {
                    popUpTo(Routes.Terms) { inclusive = true }
                }
            },
            onGroupOnboardingCompleted = {
                Log.d(TAG, "[FLOW] Navigation to Main")
                navController.navigate(Routes.Main) {
                    popUpTo(Routes.Splash) { inclusive = true }
                }
            },
        )

        composable(Routes.Main) {
            MainScaffold(
                onSignOut = {
                    Log.d(TAG, "[FLOW] Navigation Main -> SignIn (Sign Out)")
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
    onGroupOnboardingCompleted: () -> Unit,
) {
    composable(Routes.Splash) {
        SplashScreen(
            onSignedIn = onSignedInAtSplash,
            onNeedsSignIn = onNeedsSignInAtSplash,
        )
    }
    composable(Routes.SignIn) { SignInScreen(onSignedIn = onSignInSuccess) }
    composable(Routes.Terms) { TermsScreen(onAccepted = onTermsAccepted) }
    composable(Routes.GroupOnboarding) {
        GroupOnboardingScreen(onCompleted = onGroupOnboardingCompleted)
    }
}
