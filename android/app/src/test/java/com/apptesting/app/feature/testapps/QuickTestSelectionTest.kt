package com.apptesting.app.feature.testapps

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.QuickTestAllowance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the Apps screen actually shows in the Quick Tests section.
 *
 * This is presentation filtering, not authorization — every rule here is
 * re-derived server-side on the real `startQuickTest` call, and proven there
 * in functions/test-emulator/quickTests.concurrency.test.js. These tests pin
 * the part the server cannot: that the "at least 5" promise survives the
 * client's own filtering, and that the screen never offers a card the server
 * would immediately refuse.
 */
class QuickTestSelectionTest {

    private val today = "2026-09-20"
    private val me = "u_me"

    private fun app(
        id: String,
        owner: String = "dev1",
        status: AppApprovalStatus = AppApprovalStatus.Approved,
        description: String = "A useful app",
    ) = AppSubmission(
        id = id,
        ownerUserId = owner,
        name = "App $id",
        packageName = "com.example.$id",
        description = description,
        approvalStatus = status,
    )

    private fun allowance(
        used: Int = 0,
        limit: Int = 5,
        cooldowns: Map<String, String> = emptyMap(),
    ) = QuickTestAllowance(
        dayKey = today,
        usedToday = used,
        dailyLimit = limit,
        lastSessionDayByAppId = cooldowns,
    )

    private fun select(
        pool: List<String>,
        apps: List<AppSubmission>,
        allowance: QuickTestAllowance = allowance(),
        limit: Int = 5,
    ) = QuickTestSelection.select(
        poolAppIds = pool,
        apps = apps,
        currentUserId = me,
        allowance = allowance,
        todayKey = today,
        cooldownDays = 7,
        limit = limit,
    )

    // -----------------------------------------------------------------------
    // The "at least 5" promise
    // -----------------------------------------------------------------------

    @Test
    fun `an eight-app pool yields five cards`() {
        val pool = (1..8).map { "a$it" }
        val result = select(pool, pool.map { app(it) })
        assertEquals(5, result.size)
    }

    @Test
    fun `five still show after the viewer's own apps are filtered out`() {
        // The pool is shared between all users, so it cannot pre-exclude
        // anyone's own apps. This is exactly why the pool holds 8, not 5.
        val pool = (1..8).map { "a$it" }
        val apps = pool.mapIndexed { index, id ->
            if (index < 3) app(id, owner = me) else app(id)
        }
        val result = select(pool, apps)
        assertEquals(5, result.size)
        assertTrue(result.none { it.appId in listOf("a1", "a2", "a3") })
    }

    @Test
    fun `five still show after cooldowns and unavailable apps are filtered out`() {
        val pool = (1..8).map { "a$it" }
        val apps = pool.map { app(it) }.filterNot { it.id == "a2" } // a2 vanished
        val result = select(
            pool,
            apps,
            allowance(cooldowns = mapOf("a1" to today, "a3" to "2026-09-18")),
        )
        assertEquals(5, result.size)
        assertTrue(result.none { it.appId in listOf("a1", "a2", "a3") })
    }

    @Test
    fun `a pool of exactly five cannot survive filtering - which is why it is eight`() {
        // Documents the reason for the surplus rather than asserting a bug.
        val pool = (1..5).map { "a$it" }
        val apps = pool.mapIndexed { i, id -> if (i < 3) app(id, owner = me) else app(id) }
        assertEquals(2, select(pool, apps).size)
    }

    // -----------------------------------------------------------------------
    // Server order is preserved
    // -----------------------------------------------------------------------

    @Test
    fun `cards follow the server's pool order exactly`() {
        // Re-sorting here would hand rotation control to the client, which is
        // the thing the server-side pool exists to prevent.
        val pool = listOf("zulu", "alpha", "mike")
        val result = select(pool, pool.map { app(it) }, limit = 3)
        assertEquals(listOf("zulu", "alpha", "mike"), result.map { it.appId })
    }

    @Test
    fun `a rotated pool produces different cards`() {
        val apps = (1..12).map { app("a$it") }
        val first = select((1..8).map { "a$it" }, apps)
        val second = select((5..12).map { "a$it" }, apps)
        assertNotEquals(first.map { it.appId }, second.map { it.appId })
    }

    // -----------------------------------------------------------------------
    // Filtering rules
    // -----------------------------------------------------------------------

    @Test
    fun `the viewer's own app is never offered`() {
        val result = select(listOf("mine"), listOf(app("mine", owner = me)))
        assertTrue(result.isEmpty())
    }

    @Test
    fun `an unapproved app is never offered`() {
        for (status in listOf(
            AppApprovalStatus.PendingReview,
            AppApprovalStatus.Rejected,
            AppApprovalStatus.Archived,
        )) {
            val result = select(listOf("x"), listOf(app("x", status = status)))
            assertTrue("$status must not be offered", result.isEmpty())
        }
    }

    @Test
    fun `a pool id the client cannot resolve is skipped, not rendered blank`() {
        // The pool is a shared document refreshed hourly, so it can name an
        // app this client has not loaded or that was removed since.
        val result = select(listOf("ghost", "real"), listOf(app("real")))
        assertEquals(listOf("real"), result.map { it.appId })
    }

    @Test
    fun `duplicate pool ids collapse to a single card`() {
        val result = select(listOf("a1", "a1", "a2"), listOf(app("a1"), app("a2")))
        assertEquals(listOf("a1", "a2"), result.map { it.appId })
    }

    @Test
    fun `an empty pool yields no cards`() {
        assertTrue(select(emptyList(), listOf(app("a1"))).isEmpty())
    }

    @Test
    fun `a zero or negative limit yields no cards`() {
        assertTrue(select(listOf("a1"), listOf(app("a1")), limit = 0).isEmpty())
        assertTrue(select(listOf("a1"), listOf(app("a1")), limit = -3).isEmpty())
    }

    // -----------------------------------------------------------------------
    // Cooldown
    // -----------------------------------------------------------------------

    @Test
    fun `an app tested today is in cooldown`() {
        assertTrue(
            QuickTestSelection.isInCooldown(
                allowance(cooldowns = mapOf("a1" to today)), "a1", today, 7,
            ),
        )
    }

    @Test
    fun `cooldown covers days one through six and clears on day seven`() {
        val days = mapOf(
            "2026-09-19" to true, // 1 day ago
            "2026-09-17" to true, // 3
            "2026-09-14" to true, // 6
            "2026-09-13" to false, // exactly 7 — clear
            "2026-08-01" to false, // long past
        )
        for ((last, expected) in days) {
            assertEquals(
                "last session $last",
                expected,
                QuickTestSelection.isInCooldown(
                    allowance(cooldowns = mapOf("a1" to last)), "a1", today, 7,
                ),
            )
        }
    }

    @Test
    fun `an app never tested is not in cooldown`() {
        assertFalse(QuickTestSelection.isInCooldown(allowance(), "a1", today, 7))
    }

    @Test
    fun `a corrupt stored day key counts as in cooldown`() {
        // The server fails closed on a corrupt marker, so offering the card
        // would only produce an error the user cannot act on.
        assertTrue(
            QuickTestSelection.isInCooldown(
                allowance(cooldowns = mapOf("a1" to "not-a-date")), "a1", today, 7,
            ),
        )
        assertTrue(
            QuickTestSelection.isInCooldown(
                allowance(cooldowns = mapOf("a1" to "2026-99-99")), "a1", today, 7,
            ),
        )
    }

    @Test
    fun `one app's cooldown does not affect another`() {
        val result = select(
            listOf("a1", "a2"),
            listOf(app("a1"), app("a2")),
            allowance(cooldowns = mapOf("a1" to today)),
        )
        assertEquals(listOf("a2"), result.map { it.appId })
    }

    // -----------------------------------------------------------------------
    // Card contents — the "no coins" guarantee, asserted structurally
    // -----------------------------------------------------------------------

    @Test
    fun `a card carries app identity and developer but no coin field exists`() {
        val result = select(listOf("a1"), listOf(app("a1")))
        val card = result.single()
        assertEquals("a1", card.appId)
        assertEquals("App a1", card.appName)
        assertEquals("com.example.a1", card.packageName)
        assertEquals("Developer #dev1", card.developerLabel)
        assertEquals("A useful app", card.description)
        // QuickTestCandidate has no coin/amount/reward property at all. A card
        // that cannot express an amount cannot start implying one — which is
        // the whole point, since Quick Tests neither cost nor earn anything.
        val fieldNames = QuickTestCandidate::class.java.declaredFields.map { it.name.lowercase() }
        assertTrue(
            "QuickTestCandidate must not gain a coin-shaped field: $fieldNames",
            fieldNames.none { it.contains("coin") || it.contains("reward") || it.contains("amount") },
        )
    }

    @Test
    fun `a blank description becomes null rather than an empty line`() {
        val result = select(listOf("a1"), listOf(app("a1", description = "   ")))
        assertEquals(null, result.single().description)
    }

    @Test
    fun `an app with no owner id still renders a readable developer label`() {
        val result = select(listOf("a1"), listOf(app("a1", owner = "")))
        assertEquals("Community developer", result.single().developerLabel)
    }
}
