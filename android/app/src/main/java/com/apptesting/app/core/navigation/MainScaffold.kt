package com.apptesting.app.core.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.apptesting.app.feature.groups.GroupsScreen
import com.apptesting.app.feature.groups.details.GroupDetailsScreen
import com.apptesting.app.feature.home.HomeScreen
import com.apptesting.app.feature.myapps.MyAppsScreen
import com.apptesting.app.feature.myapps.add.AddAppScreen
import com.apptesting.app.feature.profile.ProfileScreen
import com.apptesting.app.feature.testapps.TestAppsScreen

/**
 * Scaffold that owns the bottom-nav tabs. Each tab has its own back stack via
 * saveState/restoreState + launchSingleTop, matching the standard Compose
 * bottom-nav pattern.
 */
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
                MyAppsScreen(onAddApp = { innerNav.navigate(Routes.AddApp) })
            }
            composable(Routes.Groups) {
                GroupsScreen(
                    onGroupClick = { groupId ->
                        innerNav.navigate(groupDetailsRoute(groupId))
                    },
                )
            }
            composable(Routes.Profile) {
                ProfileScreen(onSignOut = onSignOut)
            }

            composable(Routes.AddApp) {
                AddAppScreen(onDone = { innerNav.popBackStack() })
            }

            composable(
                route = Routes.GroupDetails,
                arguments = listOf(
                    navArgument(Routes.GroupDetailsArg) { type = NavType.StringType },
                ),
            ) { backStackEntry ->
                val groupId = backStackEntry.arguments?.getString(Routes.GroupDetailsArg).orEmpty()
                GroupDetailsScreen(
                    groupId = groupId,
                    onBack = { innerNav.popBackStack() },
                )
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

@Composable
private fun AppBottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
    ) {
        TopLevelTab.entries.forEach { tab ->
            val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    if (!selected) {
                        navController.navigate(tab.route) {
                            popUpTo(navController.graph.findStartDestination().id) {
                                saveState = true
                            }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                },
                icon = {
                    Icon(
                        imageVector = if (selected) tab.selectedIcon else tab.icon,
                        contentDescription = null,
                    )
                },
                label = { Text(stringResource(tab.labelRes)) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.primary,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
}
