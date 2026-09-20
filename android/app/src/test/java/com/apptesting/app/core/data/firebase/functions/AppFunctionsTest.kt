package com.apptesting.app.core.data.firebase.functions

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Privileged operations now fail on the server rather than in Firestore, so
 * what the user sees comes from this mapping.
 */
class AppFunctionsTest {

    @Test
    fun `server authored messages are shown verbatim`() {
        assertEquals(
            "Admin privileges are required.",
            messageFor("PERMISSION_DENIED", "Admin privileges are required."),
        )
        assertEquals(
            "This group is full.",
            messageFor("RESOURCE_EXHAUSTED", "This group is full."),
        )
    }

    @Test
    fun `a missing server message falls back to something actionable`() {
        assertEquals("You need to be signed in.", messageFor("UNAUTHENTICATED", null))
        assertEquals("You don't have permission to do that.", messageFor("PERMISSION_DENIED", ""))
        assertEquals("That item no longer exists.", messageFor("NOT_FOUND", null))
    }

    @Test
    fun `transport failures never leak SDK noise to the user`() {
        assertEquals(
            "Network problem — please try again.",
            messageFor("UNAVAILABLE", "UNAVAILABLE: Connection refused at 10.0.2.2:5001"),
        )
        assertEquals(
            "Network problem — please try again.",
            messageFor("DEADLINE_EXCEEDED", "context deadline exceeded"),
        )
    }

    @Test
    fun `an unrecognised code still produces a usable message`() {
        assertEquals("Something went wrong. Please try again.", messageFor("INTERNAL", "stack trace"))
        assertEquals("Something went wrong. Please try again.", messageFor("UNKNOWN", null))
    }
}
