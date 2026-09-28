package com.apptesting.app.core.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Person
import androidx.compose.ui.graphics.vector.ImageVector
import com.apptesting.app.R

/**
 * Top-level nav routes.
 */
object Routes {
    // Onboarding stack
    const val Splash = "splash"
    const val SignIn = "signIn"
    const val Terms = "terms"
    /** Re-acceptance at app start (not yet accepted, or a newer version) - leads to Main. */
    const val TermsUpdate = "terms/update"
    const val GroupOnboarding = "onboarding/group"

    // Main app graph
    const val Main = "main"

    // Bottom-nav tabs
    const val Home = "main/home"
    const val TestApps = "main/testApps"
    const val MyApps = "main/myApps"
    const val Groups = "main/groups"
    const val Profile = "main/profile"

    // Feature detail routes
    const val AddApp = "myApps/add"
    const val AppDetails = "myApps/details"
    const val Coins = "profile/coins"
    const val TrustScore = "profile/trustScore"
    const val TestingHistory = "profile/testingHistory"
    const val Notifications = "profile/notifications"
    const val HelpFeedback = "profile/help"
    const val AdminDashboard = "admin/dashboard"

    // Group details — nav arg placeholder is filled by [groupDetailsRoute].
    const val GroupDetailsArg = "groupId"
    const val GroupDetails = "groups/details/{$GroupDetailsArg}"

    // A tester's commitment status for one app - progress, misses, group, feedback.
    const val CommitmentStatusArg = "appId"
    const val CommitmentStatus = "testing/status/{$CommitmentStatusArg}"
}

/** Build a concrete route to [Routes.CommitmentStatus] for [appId]. */
fun commitmentStatusRoute(appId: String): String = "testing/status/$appId"

/** Build a concrete route to [Routes.GroupDetails] for [groupId]. */
fun groupDetailsRoute(groupId: String): String = "groups/details/$groupId"

/** One tab of the bottom-navigation bar. */
enum class TopLevelTab(
    val route: String,
    @StringRes val labelRes: Int,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
) {
    Home(
        route = Routes.Home,
        labelRes = R.string.nav_home,
        icon = Icons.Outlined.Home,
        selectedIcon = Icons.Rounded.Home,
    ),
    TestApps(
        route = Routes.TestApps,
        labelRes = R.string.nav_test_apps,
        icon = Icons.Outlined.CardGiftcard,
        selectedIcon = Icons.Rounded.CardGiftcard,
    ),
    MyApps(
        route = Routes.MyApps,
        labelRes = R.string.nav_my_apps,
        icon = Icons.Outlined.Apps,
        selectedIcon = Icons.Rounded.Apps,
    ),
    Groups(
        route = Routes.Groups,
        labelRes = R.string.nav_groups,
        icon = Icons.Outlined.Groups,
        selectedIcon = Icons.Rounded.Groups,
    ),
    Profile(
        route = Routes.Profile,
        labelRes = R.string.nav_profile,
        icon = Icons.Outlined.Person,
        selectedIcon = Icons.Rounded.Person,
    ),
}
