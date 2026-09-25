package com.apptesting.app.feature.testapps

import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.JoinBlocker
import com.apptesting.app.core.model.ReadinessGap
import com.apptesting.app.core.util.AppConfig

/*
 * User-facing wording for the server's Batch 9B-9D codes, in one place.
 *
 * Pure and unit tested. Two rules it must keep:
 *   * Plain language - no Firebase terms, no codes, no stack traces.
 *   * Honesty about verification. AppTesting cannot see a Google Group's
 *     members or a Play closed test's opt-ins, so group membership and
 *     developer setup are always "self-confirmed". Nothing here may say
 *     "verified" (a test enforces it).
 */
internal object TestingCopy {

    const val GROUP_FIRST = "Join the official AppTesting Google Group first."

    fun joinBlocker(code: String, commitmentAmount: Int = AppConfig.DEFAULT_COMMITMENT_AMOUNT): String = when (code) {
        JoinBlocker.SUSPENDED -> "Your account is suspended, so you can't join tests right now."
        JoinBlocker.APP_MISSING -> "This app is no longer available."
        JoinBlocker.OWN_APP -> "This is your own app - you can't test it yourself."
        JoinBlocker.ALREADY_JOINED -> "You're already testing this app."
        JoinBlocker.TARGET_NOT_READY -> "This app's testing setup isn't ready yet."
        JoinBlocker.NO_ELIGIBLE_OWN_APP ->
            "You need one of your own apps approved, with its testing setup confirmed, before you can join."
        JoinBlocker.GROUP_NOT_JOINED -> GROUP_FIRST
        JoinBlocker.INSUFFICIENT_COINS -> "You need $commitmentAmount available Testing Coins."
        JoinBlocker.CAPACITY_FULL -> "This app already has all the testers it needs."
        else -> "You can't join this app right now."
    }

    fun readinessGap(code: String): String = when (code) {
        ReadinessGap.NOT_APPROVED -> "Waiting for admin approval"
        ReadinessGap.INVALID_PACKAGE -> "Package name is missing or invalid"
        ReadinessGap.MISSING_OPT_IN_URL -> "Closed-testing opt-in link is missing"
        ReadinessGap.INVALID_OPT_IN_URL -> "Closed-testing opt-in link doesn't match this app"
        ReadinessGap.INVALID_PLAY_STORE_URL -> "Play Store listing link doesn't match this app"
        ReadinessGap.NOT_CONFIRMED -> "Setup confirmation required"
        ReadinessGap.CONFIRMATION_OUTDATED -> "Setup changed - confirm it again"
        else -> "Setup incomplete"
    }

    /** Short label for a status pill. */
    fun statePill(state: CommitmentState): String = when (state) {
        CommitmentState.Testing -> "Testing"
        CommitmentState.AwaitingSettlement -> "Ending"
        CommitmentState.Completed -> "Completed"
        CommitmentState.Cancelled -> "Cancelled"
        CommitmentState.RemovedForMisses -> "Removed"
        CommitmentState.Forfeited -> "Forfeited"
        CommitmentState.Missed -> "Expired"
        CommitmentState.Unknown -> "Unknown"
    }

    /**
     * One sentence explaining a commitment's state, including what happened
     * to the coins. [amount] is the stake the server reported.
     */
    fun stateExplanation(state: CommitmentState, endReason: String?, amount: Int): String = when (state) {
        CommitmentState.Testing -> "Testing is under way. $amount Testing Coins are locked for this commitment."
        CommitmentState.AwaitingSettlement ->
            if (endReason == "tooManyMisses") {
                "This commitment has missed more than ${AppConfig.COMMITMENT_ALLOWED_MISSES} testing days, so it is " +
                    "being closed. The $amount locked Testing Coins will be forfeited."
            } else {
                "The testing window has closed without ${AppConfig.COMMITMENT_DAYS_REQUIRED} testing days, so it is " +
                    "being closed. The $amount locked Testing Coins will be forfeited."
            }
        CommitmentState.Completed -> "Completed - your $amount Testing Coins were unlocked and returned."
        CommitmentState.Cancelled -> "Cancelled - your $amount Testing Coins were returned to your available balance."
        CommitmentState.RemovedForMisses ->
            "Removed after a third missed testing day. The $amount locked Testing Coins were forfeited."
        CommitmentState.Forfeited ->
            "The testing window closed before ${AppConfig.COMMITMENT_DAYS_REQUIRED} testing days were recorded. " +
                "The $amount locked Testing Coins were forfeited."
        CommitmentState.Missed -> "This testing assignment expired without completion."
        CommitmentState.Unknown -> "We couldn't read this commitment's status. Pull to refresh."
    }

    /** The rules, stated before a user stakes anything. */
    fun commitmentRules(amount: Int): List<String> = listOf(
        "$amount Testing Coins will be locked for this commitment - not spent. You get the same coins back when you finish.",
        "Test for ${AppConfig.COMMITMENT_DAYS_REQUIRED} days within a ${AppConfig.COMMITMENT_WINDOW_DAYS}-day window, checking in once a day.",
        "You can miss up to ${AppConfig.COMMITMENT_ALLOWED_MISSES} days. Today never counts as missed until it's over.",
        "A third missed day removes you from the test and the locked coins are forfeited.",
        "You can cancel any time before that and get your coins back.",
    )

    const val GROUP_SELF_CONFIRM_NOTE =
        "AppTesting can't check Google Group membership - this is self-confirmed. " +
            "If you haven't really joined, the developer's closed test won't let you install the app."

    const val SETUP_SELF_CONFIRM_NOTE =
        "AppTesting can't see your Play Console or the Google Group's members, so this setup is self-confirmed by you. " +
            "Testers rely on it being true."

    const val FEEDBACK_ANONYMOUS_NOTE =
        "Your feedback is anonymous - the developer sees your rating and comment, never who you are."
}
