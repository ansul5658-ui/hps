package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.GroupMemberRole
import com.apptesting.app.core.model.GroupState
import com.apptesting.app.core.model.GroupVisibility
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.QuickTestSession
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.apptesting.app.core.util.AppConfig
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.UUID

/**
 * In-memory dataset that powers the app before Firebase is wired.
 *
 * Contents are fictional — placeholder app names, placeholder group emails.
 * There is no personal data of any real user; the "current user" is a
 * neutral demo account. Everything is held in [MutableStateFlow]s so screens
 * observing it react immediately when the mock repositories mutate the store.
 */
internal class MockStore {

    /** The signed-in user for the mock session. Nullable so sign-out can clear it. */
    val currentUser = MutableStateFlow<User?>(
        User(
            id = "u_me",
            displayName = "Developer",
            email = "developer@example.com",
            createdAtMillis = daysAgo(60),
            termsAcceptedAtMillis = daysAgo(60),
            coinBalance = 240,
            trustScore = 72,
            role = UserRole.Member,
        ),
    )

    /** Groups the admin has created. */
    val groups = MutableStateFlow(
        listOf(
            Group(
                id = AppConfig.OFFICIAL_GROUP_ID,
                name = "AppTesting Official Group",
                summary = "Community testing group for all Android apps.",
                rules = "Test for the full 14-day period. Provide honest feedback.",
                visibility = GroupVisibility.Open,
                state = GroupState.Active,
                memberCap = 1000,
                currentMemberCount = 28,
                createdByUserId = "u_admin",
                createdAtMillis = daysAgo(45),
                googleGroupEmail = AppConfig.OFFICIAL_GROUP_EMAIL,
            ),
            Group(
                id = "g_launch",
                name = "New App Launch",
                summary = "Prepare newly submitted apps for their first Play Store release.",
                rules = "Install through the opt-in link and use the app daily.",
                visibility = GroupVisibility.Open,
                state = GroupState.Open,
                memberCap = 20,
                currentMemberCount = 12,
                createdByUserId = "u_admin",
                createdAtMillis = daysAgo(20),
                googleGroupEmail = AppConfig.OFFICIAL_GROUP_EMAIL,
            ),
        ),
    )

    /** Current user's memberships. Starts as a single active membership. */
    val memberships = MutableStateFlow(
        listOf(
            GroupMember(
                id = "gm_me_official",
                groupId = AppConfig.OFFICIAL_GROUP_ID,
                userId = "u_me",
                joinedAtMillis = daysAgo(30),
                role = GroupMemberRole.Member,
                assignmentsCompleted = 6,
            ),
        ),
    )

    /** Apps — a mix owned by the current user and other developers. */
    val apps = MutableStateFlow(
        listOf(
            // Owned by "me"
            AppSubmission(
                id = "app_taskforge",
                ownerUserId = "u_me",
                name = "TaskForge",
                packageName = "com.example.taskforge",
                description = "A focused productivity app for engineers who plan their week in tasks.",
                versionName = "1.2.0 (14)",
                playStoreUrl = "https://play.google.com/store/apps/details?id=com.example.taskforge",
                optInUrl = "https://play.google.com/apps/testing/com.example.taskforge",
                createdAtMillis = daysAgo(21),
                approvalStatus = AppApprovalStatus.Approved,
                activeGroupId = AppConfig.OFFICIAL_GROUP_ID,
                testerCount = 12,
                completedTesterCount = 4,
            ),
            AppSubmission(
                id = "app_moodjot",
                ownerUserId = "u_me",
                name = "MoodJot",
                packageName = "com.example.moodjot",
                description = "Tiny mood journal that fits in a widget.",
                versionName = "0.9.1 (9)",
                playStoreUrl = "https://play.google.com/store/apps/details?id=com.example.moodjot",
                optInUrl = "https://play.google.com/apps/testing/com.example.moodjot",
                createdAtMillis = daysAgo(6),
                approvalStatus = AppApprovalStatus.PendingReview,
                activeGroupId = null,
                testerCount = 0,
                completedTesterCount = 0,
            ),
            // Owned by other developers — available for testing
            AppSubmission(
                id = "app_bytereader",
                ownerUserId = "u_dev_2",
                name = "ByteReader",
                packageName = "com.example.bytereader",
                description = "Minimal, keyboard-driven RSS reader for developers.",
                versionName = "2.1.0 (21)",
                playStoreUrl = "https://play.google.com/store/apps/details?id=com.example.bytereader",
                optInUrl = "https://play.google.com/apps/testing/com.example.bytereader",
                createdAtMillis = daysAgo(10),
                approvalStatus = AppApprovalStatus.Approved,
                activeGroupId = AppConfig.OFFICIAL_GROUP_ID,
                testerCount = 8,
                completedTesterCount = 3,
            ),
            AppSubmission(
                id = "app_pixelpacker",
                ownerUserId = "u_dev_3",
                name = "PixelPacker",
                packageName = "com.example.pixelpacker",
                description = "One-tap image optimizer for release-ready screenshots.",
                versionName = "1.0.4 (4)",
                playStoreUrl = "https://play.google.com/store/apps/details?id=com.example.pixelpacker",
                optInUrl = "https://play.google.com/apps/testing/com.example.pixelpacker",
                createdAtMillis = daysAgo(5),
                approvalStatus = AppApprovalStatus.Approved,
                activeGroupId = AppConfig.OFFICIAL_GROUP_ID,
                testerCount = 6,
                completedTesterCount = 1,
            ),
        ),
    )

    /** Current user's testing assignments. */
    val assignments = MutableStateFlow(
        listOf(
            TestAssignment(
                id = "as_bytereader_me",
                groupId = AppConfig.OFFICIAL_GROUP_ID,
                appId = "app_bytereader",
                testerUserId = "u_me",
                assignedAtMillis = daysAgo(7),
                deadlineAtMillis = daysFromNow(7),
                daysRequired = 14,
                daysCompleted = 7,
                status = AssignmentStatus.InProgress,
                coinReward = 50,
            ),
            TestAssignment(
                id = "as_pixelpacker_me",
                groupId = AppConfig.OFFICIAL_GROUP_ID,
                appId = "app_pixelpacker",
                testerUserId = "u_me",
                assignedAtMillis = daysAgo(2),
                deadlineAtMillis = daysFromNow(12),
                daysRequired = 14,
                daysCompleted = 2,
                status = AssignmentStatus.InProgress,
                coinReward = 50,
            ),
        ),
    )

    /** Coin ledger for the current user. */
    val transactions = MutableStateFlow(
        listOf(
            CoinTransaction(
                id = "ct_1",
                userId = "u_me",
                amount = 50,
                kind = CoinTransactionKind.Earn,
                reason = "Completed ByteReader testing",
                relatedAssignmentId = "as_bytereader_me",
                createdAtMillis = daysAgo(6),
            ),
            CoinTransaction(
                id = "ct_2",
                userId = "u_me",
                amount = 30,
                kind = CoinTransactionKind.Bonus,
                reason = "First completed assignment bonus",
                createdAtMillis = daysAgo(28),
            ),
        ),
    )

    /** Current user's notifications. */
    /**
     * Quick Test sessions opened in this mock session.
     *
     * Starts empty: a fresh dev session should see a full Quick Test
     * allowance, and seeding history here would mean some cards render as
     * already-tested for no reason a developer can see.
     */
    val quickTestSessions = MutableStateFlow(emptyList<QuickTestSession>())

    val notifications = MutableStateFlow(
        listOf(
            Notification(
                id = "n_1",
                userId = "u_me",
                title = "TaskForge is under review",
                body = "An administrator will confirm testing eligibility soon.",
                createdAtMillis = daysAgo(1),
            ),
        ),
    )

    // -- Helpers ----------------------------------------------------------------

    fun newId(prefix: String): String = "${prefix}_${UUID.randomUUID().toString().take(8)}"

    private fun daysAgo(days: Int): Long =
        System.currentTimeMillis() - days.toLong() * 24 * 60 * 60 * 1000

    private fun daysFromNow(days: Int): Long =
        System.currentTimeMillis() + days.toLong() * 24 * 60 * 60 * 1000
}
