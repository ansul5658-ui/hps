package com.apptesting.app.feature.testapps

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.util.daysBetweenDayKeys

/**
 * Which Quick Tests the Apps screen shows, as pure logic.
 *
 * Kept free of Compose, Firebase and coroutines — like `lib/quickTests.js` on
 * the backend — so the filtering that decides what a user actually sees can be
 * unit tested without an emulator or a device.
 *
 * WHAT THIS IS AND IS NOT
 * This is presentation filtering. It exists so the screen does not offer a
 * card that the server would immediately refuse, and so the "at least 5"
 * promise can be reasoned about. It is NOT an authorization check: eligibility
 * is re-derived server-side on every `startQuickTest` call, against documents
 * this layer cannot see. If the two ever disagree, the server wins and the
 * card simply fails with the server's message.
 *
 * WHY THE POOL IS ORDERED SERVER-SIDE
 * The pool arrives pre-ordered (least-recently-surfaced first) and this
 * function preserves that order rather than sorting. Re-sorting here would
 * hand rotation control to the client, which is exactly what the server-side
 * pool exists to prevent.
 */
object QuickTestSelection {

    /**
     * Pick the Quick Tests to show, in pool order.
     *
     * @param poolAppIds server-ordered pool, typically ~8 ids
     * @param apps the app documents the client can see
     * @param currentUserId used to drop the viewer's own apps
     * @param allowance the viewer's own daily count and per-app cooldowns
     * @param todayKey UTC `yyyy-MM-dd`
     * @param cooldownDays mirrors the server's cooldown
     * @param limit how many cards to return at most
     */
    fun select(
        poolAppIds: List<String>,
        apps: List<AppSubmission>,
        currentUserId: String,
        allowance: QuickTestAllowance,
        todayKey: String,
        cooldownDays: Int,
        limit: Int,
    ): List<QuickTestCandidate> {
        if (limit <= 0) return emptyList()
        val byId = apps.associateBy { it.id }
        val seen = mutableSetOf<String>()
        val picked = mutableListOf<QuickTestCandidate>()

        for (appId in poolAppIds) {
            if (picked.size >= limit) break
            if (!seen.add(appId)) continue

            // The pool is a shared document, so it can name an app this client
            // cannot see — unapproved since the last refresh, deleted, or
            // simply not in the page this client loaded. Skip rather than
            // render a placeholder.
            val app = byId[appId] ?: continue
            if (app.approvalStatus != AppApprovalStatus.Approved) continue

            // Own apps are filtered here as well as server-side: the pool is
            // shared between all users, so it cannot pre-exclude anyone's.
            if (app.ownerUserId == currentUserId) continue

            if (isInCooldown(allowance, appId, todayKey, cooldownDays)) continue

            picked += QuickTestCandidate(
                appId = app.id,
                appName = app.name,
                packageName = app.packageName,
                developerLabel = developerLabel(app.ownerUserId, currentUserId),
                description = app.description.trim().takeIf { it.isNotEmpty() },
            )
        }
        return picked
    }

    /**
     * True while [appId] is still inside its per-user cooldown.
     *
     * An unparseable stored day key counts as *in* cooldown: the server will
     * refuse the call anyway (it fails closed on a corrupt marker), so showing
     * the card would only produce an error the user cannot act on.
     */
    fun isInCooldown(
        allowance: QuickTestAllowance,
        appId: String,
        todayKey: String,
        cooldownDays: Int,
    ): Boolean {
        val last = allowance.lastSessionDayByAppId[appId] ?: return false
        val elapsed = daysBetweenDayKeys(last, todayKey) ?: return true
        return elapsed < cooldownDays
    }

    private fun developerLabel(ownerId: String, currentUserId: String): String = when {
        ownerId == currentUserId -> "You"
        ownerId.isBlank() -> "Community developer"
        else -> "Developer #" + ownerId.takeLast(4)
    }
}
