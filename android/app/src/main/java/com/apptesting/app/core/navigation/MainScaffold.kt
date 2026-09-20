package com.apptesting.app.core.navigation

import android.util.Log
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.apptesting.app.feature.admin.AdminDashboardScreen
import com.apptesting.app.feature.groups.GroupsScreen
import com.apptesting.app.feature.groups.details.GroupDetailsScreen
import com.apptesting.app.feature.home.HomeScreen
import com.apptesting.app.feature.myapps.MyAppsScreen
import com.apptesting.app.feature.myapps.add.AddAppScreen
import com.apptesting.app.feature.myapps.details.AppDetailsScreen
import com.apptesting.app.feature.profile.CoinWalletScreen
import com.apptesting.app.feature.profile.HelpFeedbackScreen
import com.apptesting.app.feature.profile.NotificationsScreen
import com.apptesting.app.feature.profile.ProfileScreen
import com.apptesting.app.feature.profile.TestingHistoryScreen
import com.apptesting.app.feature.profile.TrustScoreScreen
import com.apptesting.app.feature.testapps.TestAppsScreen

private const val TAG = "AUTH_DEBUG"

@Composable
fun MainScaffold(
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val innerNav = rememberNavController()

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = { AppBottomBar(innerNav) },
    ) { inner ->
        NavHost(
            navController = innerNav,
            startDestination = Routes.Home,
            modifier = Modifier.padding(inner),
        ) {
            composable(Routes.Home) {
                HomeScreen(
                    onGoToTestApps = { switchTab(innerNav, Routes.TestApps) },
                    onGoToMyApps = { switchTab(innerNav, Routes.MyApps) },
                )
            }
            composable(Routes.TestApps) { TestAppsScreen() }
            composable(Routes.MyApps) {
                MyAppsScreen(
                    onAddApp = { innerNav.navigate(Routes.AddApp) },
                    onAppClick = { appId -> innerNav.navigate("${Routes.AppDetails}/$appId") },
                )
            }
            composable(Routes.Groups) {
                Log.d(TAG, "[GROUPS_DEBUG] NavHost composing Routes.Groups")
                GroupsScreen(
                    onGroupClick = { groupId ->
                        val route = groupDetailsRoute(groupId)
                        innerNav.navigate(route)
                    },
                )
            }
            composable(Routes.Profile) {
                ProfileScreen(
                    onSignOut = onSignOut,
                    onNavigateToCoins = { innerNav.navigate(Routes.Coins) },
                    onNavigateToTrustScore = { innerNav.navigate(Routes.TrustScore) },
                    onNavigateToMyApps = { switchTab(innerNav, Routes.MyApps) },
                    onNavigateToTestingHistory = { innerNav.navigate(Routes.TestingHistory) },
                    onNavigateToNotifications = { innerNav.navigate(Routes.Notifications) },
                    onNavigateToHelpFeedback = { innerNav.navigate(Routes.HelpFeedback) },
                    onNavigateToAdmin = { innerNav.navigate(Routes.AdminDashboard) },
                )
            }
            composable(Routes.AdminDashboard) {
                AdminDashboardScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.Coins) {
                CoinWalletScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.TrustScore) {
                TrustScoreScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.TestingHistory) {
                TestingHistoryScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.Notifications) {
                NotificationsScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.HelpFeedback) {
                HelpFeedbackScreen(onBack = { innerNav.popBackStack() })
            }
            composable(Routes.AddApp) {
                AddAppScreen(onDone = { innerNav.popBackStack() })
            }
            composable("${Routes.AppDetails}/{appId}") { backStackEntry ->
                val appId = backStackEntry.arguments?.getString("appId").orEmpty()
                AppDetailsScreen(appId = appId, onBack = { innerNav.popBackStack() })
            }
            composable(Routes.GroupDetails) { backStackEntry ->
                val groupId = backStackEntry.arguments?.getString(Routes.GroupDetailsArg).orEmpty()
                GroupDetailsScreen(groupId = groupId, onBack = { innerNav.popBackStack() })
            }
        }
    }
}

private fun switchTab(navController: NavHostController, route: String) {
    navController.navigate(route) {
        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

// ── UPGRADED bottom bar — better colors + font weight ──
@Composable
private fun AppBottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
    ) {
        TopLevelTab.entries.forEach { tab ->
            val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    if (!selected) switchTab(navController, tab.route)
                },
                icon = {
                    Icon(
                        imageVector = if (selected) tab.selectedIcon else tab.icon,
                        contentDescription = stringResource(tab.labelRes),
                    )
                },
                label = {
                    Text(
                        text = stringResource(tab.labelRes),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    )
                },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor   = MaterialTheme.colorScheme.primary,
                    selectedTextColor   = MaterialTheme.colorScheme.primary,
                    indicatorColor      = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
}
