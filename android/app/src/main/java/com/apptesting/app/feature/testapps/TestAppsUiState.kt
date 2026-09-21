package com.apptesting.app.feature.testapps

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinWallet

sealed interface TestAppsUiState {
    object Loading : TestAppsUiState
    data class Error(val message: String) : TestAppsUiState

    @Immutable
    data class Content(
        val filter: TestFilter,
        /** Section 1 — free, no coin commitment. */
        val quickTests: List<QuickTestCandidate>,
        val quickTestsRemainingToday: Int,
        val quickTestDailyLimit: Int,
        /** Section 2 — structured multi-day commitments. */
        val rows: List<TestRow>,
        /**
         * Read-only Testing Coin wallet, from `users/{uid}/wallet/balance`.
         *
         * The chip shows [CoinWallet.available] — what the user could actually
         * commit to a new test. Showing a combined total here would overstate
         * what is spendable the moment anything is locked.
         */
        val wallet: CoinWallet,
        val unreadNotifications: Int,
    ) : TestAppsUiState {
        val hasQuickTestQuota: Boolean get() = quickTestsRemainingToday > 0
    }
}

enum class TestFilter { All, InProgress, Available }

/**
 * One Quick Test card.
 *
 * Deliberately carries no coin field of any kind. Quick Tests cost nothing and
 * earn nothing, and a card that cannot express an amount cannot accidentally
 * start implying one.
 */
@Immutable
data class QuickTestCandidate(
    val appId: String,
    val appName: String,
    val packageName: String,
    val developerLabel: String,
    val description: String?,
)

@Immutable
data class TestRow(
    val assignmentId: String?, // null when the app is discoverable but not yet assigned
    val appId: String,
    val appName: String,
    val packageName: String,
    val developerLabel: String,
    val daysRequired: Int,
    val daysCompleted: Int,
    val status: AssignmentStatus?,
    /**
     * True when the tester has already recorded a testing day for the current
     * LOCAL day, as the server defines it.
     *
     * Derived from the server-stamped check-in boundary instant, never from a
     * day key computed on the device — see `TestAssignment.hasLoggedTodayAt`.
     */
    val loggedToday: Boolean,
    /**
     * Testing Coins STAKED on this assignment, 0 when there is no commitment.
     *
     * Displayed as "committed", never as a reward: completing returns these
     * same coins rather than adding any.
     */
    val committedAmount: Int = 0,
    /**
     * The server's last eligible local day (`yyyy-MM-dd`), or null for an
     * assignment with no pinned window.
     *
     * Rendered verbatim. The client deliberately does not compute how many
     * days remain from it — that arithmetic belongs to the server, which
     * already returns progress on every check-in.
     */
    val lastEligibleDayKey: String? = null,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}
