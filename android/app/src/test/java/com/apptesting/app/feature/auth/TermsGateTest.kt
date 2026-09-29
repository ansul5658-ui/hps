package com.apptesting.app.feature.auth

import com.apptesting.app.core.data.MockStore
import com.apptesting.app.core.data.MockUserRepository
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.data.firebase.functions.CallableException
import com.apptesting.app.core.model.User
import com.apptesting.app.core.util.AppConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Terms of Service + Privacy Policy gating (release audit F2). */
class TermsGateTest {

    private class FakeUsers(
        var accepted: Int?,
        private val acceptResult: Result<Unit> = Result.success(Unit),
    ) : UserRepository {
        val acceptCalls = mutableListOf<Int>()
        override val currentUser: Flow<User?> = flowOf(null)
        override suspend fun signOut() = Unit
        override suspend fun acceptedTermsVersion(): Int? = accepted
        override suspend fun acceptTerms(version: Int): Result<Unit> {
            acceptCalls += version
            if (acceptResult.isSuccess) accepted = version
            return acceptResult
        }
    }

    // ---- the rule ------------------------------------------------------

    @Test
    fun `nothing accepted or an older version needs acceptance`() {
        assertTrue(needsTermsAcceptance(acceptedVersion = null, currentVersion = 2))
        assertTrue(needsTermsAcceptance(acceptedVersion = 1, currentVersion = 2))
    }

    @Test
    fun `the current or a later version passes`() {
        assertEquals(false, needsTermsAcceptance(acceptedVersion = 2, currentVersion = 2))
        assertEquals(false, needsTermsAcceptance(acceptedVersion = 3, currentVersion = 2))
    }

    @Test
    fun `the default is the version this app displays`() {
        assertTrue(needsTermsAcceptance(AppConfig.TERMS_VERSION - 1))
        assertEquals(false, needsTermsAcceptance(AppConfig.TERMS_VERSION))
    }

    // ---- policy links ----------------------------------------------------

    @Test
    fun `an unconfigured or non-https policy link cannot be opened`() {
        assertNull(policyLinkOrNull(""))
        assertNull(policyLinkOrNull("   "))
        assertNull(policyLinkOrNull("https://"))
        assertNull(policyLinkOrNull("http://example.com/privacy"))
        assertNull(policyLinkOrNull("example.com/privacy"))
        assertEquals("https://example.com/privacy", policyLinkOrNull(" https://example.com/privacy "))
    }

    // ---- the screen's decisions ------------------------------------------

    @Test
    fun `an accepted user passes straight through without being asked again`() = runBlocking {
        val users = FakeUsers(accepted = 2)
        assertEquals(TermsUiState.Accepted, TermsGateController(users, currentVersion = 2).resolve())
        assertTrue("no acceptance is re-recorded", users.acceptCalls.isEmpty())
    }

    @Test
    fun `a user who never accepted, or accepted an older version, is shown the Terms`() = runBlocking {
        assertEquals(TermsUiState.Required(), TermsGateController(FakeUsers(null), 2).resolve())
        assertEquals(TermsUiState.Required(), TermsGateController(FakeUsers(1), 2).resolve())
    }

    @Test
    fun `accepting records exactly the displayed version and moves on`() = runBlocking {
        val users = FakeUsers(accepted = null)
        val gate = TermsGateController(users, currentVersion = 2)
        assertEquals(TermsUiState.Accepted, gate.accept())
        assertEquals(listOf(2), users.acceptCalls)
        assertEquals("and the next check passes", TermsUiState.Accepted, gate.resolve())
    }

    @Test
    fun `a failed acceptance keeps the user on the Terms with the server's message`() = runBlocking {
        val users = FakeUsers(
            accepted = null,
            acceptResult = Result.failure(IllegalStateException("These Terms are out of date.")),
        )
        val gate = TermsGateController(users, currentVersion = 2)
        assertEquals(TermsUiState.Required(error = "These Terms are out of date."), gate.accept())
        assertEquals("still not accepted", TermsUiState.Required(), gate.resolve())
    }

    @Test
    fun `a failure without a message still explains itself`() = runBlocking {
        val gate = TermsGateController(FakeUsers(null, Result.failure(RuntimeException())), 2)
        val state = gate.accept() as TermsUiState.Required
        assertEquals("Couldn't record your acceptance. Please try again.", state.error)
    }

    // ---- error copy: never a raw backend status ----------------------------

    private fun callable(code: String, message: String) =
        CallableException(code, reason = null, gaps = emptyList(), message = message)

    @Test
    fun `a missing acceptTerms callable shows an unavailable message, not NOT_FOUND`() = runBlocking {
        // What the Functions SDK produces when the callable is not deployed: the
        // HTTP status text passes through the generic mapping as the message.
        val gate = TermsGateController(FakeUsers(null, Result.failure(callable("NOT_FOUND", "NOT_FOUND"))), 2)
        val state = gate.accept() as TermsUiState.Required
        assertEquals(TERMS_ERROR_SERVICE_UNAVAILABLE, state.error)
        assertFalse(state.error!!.contains("NOT_FOUND"))
    }

    @Test
    fun `server-side breakage never leaks its status or message`() {
        for (code in listOf("NOT_FOUND", "UNIMPLEMENTED", "INTERNAL", "UNKNOWN", "DATA_LOSS")) {
            assertEquals(code, TERMS_ERROR_SERVICE_UNAVAILABLE, termsAcceptanceErrorMessage(callable(code, "That item no longer exists.")))
        }
    }

    @Test
    fun `connectivity and session failures get their own explanations`() {
        assertEquals(TERMS_ERROR_NETWORK, termsAcceptanceErrorMessage(callable("UNAVAILABLE", "Network problem — please try again.")))
        assertEquals(TERMS_ERROR_NETWORK, termsAcceptanceErrorMessage(callable("DEADLINE_EXCEEDED", "x")))
        assertEquals(TERMS_ERROR_SIGNED_OUT, termsAcceptanceErrorMessage(callable("UNAUTHENTICATED", "UNAUTHENTICATED")))
    }

    @Test
    fun `the server's human-written refusal still passes through`() {
        val outdated = "These Terms are out of date. Please update the app and review the current Terms."
        assertEquals(outdated, termsAcceptanceErrorMessage(callable("FAILED_PRECONDITION", outdated)))
    }

    @Test
    fun `a bare status token is never shown, whatever carries it`() {
        assertEquals(TERMS_ERROR_GENERIC, termsAcceptanceErrorMessage(callable("FAILED_PRECONDITION", "FAILED_PRECONDITION")))
        assertEquals(TERMS_ERROR_GENERIC, termsAcceptanceErrorMessage(IllegalStateException("NOT_FOUND")))
        assertEquals(TERMS_ERROR_GENERIC, termsAcceptanceErrorMessage(IllegalStateException("   ")))
    }

    // ---- whether the full documents can be read -----------------------------

    @Test
    fun `the documents count as available only when both links can be opened`() {
        assertTrue(policyDocumentsAvailable("https://example.com/terms", "https://example.com/privacy"))
        assertFalse(policyDocumentsAvailable("", "https://example.com/privacy"))
        assertFalse(policyDocumentsAvailable("https://example.com/terms", ""))
        assertFalse(policyDocumentsAvailable("", ""))
    }

    // ---- dev-mode persistence ----------------------------------------------

    @Test
    fun `mock mode persists acceptance once and never moves the original time`() = runBlocking {
        val store = MockStore()
        store.currentUser.value = store.currentUser.value!!.copy(
            termsAcceptedVersion = null,
            termsAcceptedAtMillis = null,
        )
        val repo = MockUserRepository(store)
        assertNull(repo.acceptedTermsVersion())

        assertTrue(repo.acceptTerms(AppConfig.TERMS_VERSION).isSuccess)
        assertEquals(AppConfig.TERMS_VERSION, repo.acceptedTermsVersion())
        val first = store.currentUser.value!!.termsAcceptedAtMillis
        assertTrue(first != null)

        assertTrue(repo.acceptTerms(AppConfig.TERMS_VERSION).isSuccess)
        assertEquals(first, store.currentUser.value!!.termsAcceptedAtMillis)
    }

    @Test
    fun `mock mode refuses acceptance when signed out`() = runBlocking {
        val store = MockStore()
        val repo = MockUserRepository(store)
        repo.signOut()
        assertTrue(repo.acceptTerms(AppConfig.TERMS_VERSION).isFailure)
        assertNull(repo.acceptedTermsVersion())
    }

    @Test
    fun `the dev-mode user has accepted the current Terms, so dev flows are unchanged`() = runBlocking {
        assertEquals(AppConfig.TERMS_VERSION, MockUserRepository(MockStore()).acceptedTermsVersion())
    }
}
