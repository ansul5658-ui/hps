package com.apptesting.app.feature.auth

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.apptesting.app.core.designsystem.theme.AppTestingTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The Terms & Privacy screen's visible behaviour (release audit F2 follow-up). */
@RunWith(AndroidJUnit4::class)
class TermsContentTest {

    @get:Rule
    val compose = createComposeRule()

    private var acceptClicks = 0

    private fun show(
        state: TermsUiState.Required = TermsUiState.Required(),
        termsUrl: String = "",
        privacyUrl: String = "",
        fontScale: Float? = null,
    ) {
        compose.setContent {
            val base = LocalDensity.current
            val density = fontScale?.let { Density(base.density, it) } ?: base
            CompositionLocalProvider(LocalDensity provides density) {
                AppTestingTheme {
                    TermsContent(
                        state = state,
                        onAccept = { acceptClicks++ },
                        termsUrl = termsUrl,
                        privacyUrl = privacyUrl,
                    )
                }
            }
        }
    }

    @Test
    fun unpublishedDocumentsAreSaidToBeUnavailable_andNotClaimedAsRead() {
        show()
        compose.onNodeWithText(TERMS_DOCUMENTS_UNAVAILABLE_TITLE).assertIsDisplayed()
        compose.onNodeWithText("Terms of Service").assertIsDisplayed()
        compose.onNodeWithText("Privacy Policy").assertIsDisplayed()
        compose.onNodeWithText(TERMS_AGREE_SUMMARY_ONLY).assertIsDisplayed()
        compose.onNodeWithText(TERMS_AGREE_WITH_DOCUMENTS).assertDoesNotExist()
        compose.onNodeWithText("not yet available", substring = true).assertDoesNotExist()
    }

    @Test
    fun publishedDocumentsAreLinked_andTheFullAgreementIsOffered() {
        show(termsUrl = "https://example.com/terms", privacyUrl = "https://example.com/privacy")
        compose.onNodeWithText(TERMS_DOCUMENTS_UNAVAILABLE_TITLE).assertDoesNotExist()
        compose.onNodeWithText(TERMS_AGREE_WITH_DOCUMENTS).assertIsDisplayed()
        compose.onNodeWithText("Privacy Policy").assertIsDisplayed()
    }

    @Test
    fun oneMissingDocumentStillCountsAsUnavailable() {
        show(termsUrl = "https://example.com/terms")
        compose.onNodeWithText(TERMS_DOCUMENTS_UNAVAILABLE_TITLE).assertIsDisplayed()
        compose.onNodeWithText(TERMS_AGREE_SUMMARY_ONLY).assertIsDisplayed()
    }

    @Test
    fun privacyPolicyIsNotSqueezed_atLargeFontScale() {
        show(fontScale = 1.5f)
        val root = compose.onRoot().getUnclippedBoundsInRoot()
        val terms = compose.onNodeWithText("Terms of Service").getUnclippedBoundsInRoot()
        val privacy = compose.onNodeWithText("Privacy Policy").getUnclippedBoundsInRoot()
        // Stacked, full-width rows: same left edge, and each label has at least
        // half the screen rather than whatever a sibling left over.
        assertEquals(terms.left.value, privacy.left.value, 0.5f)
        assertTrue(privacy.top >= terms.bottom)
        assertTrue(privacy.right - privacy.left >= (root.right - root.left) / 2)
    }

    @Test
    fun acceptingRequiresTheCheckbox_andTheLabelTogglesIt() {
        show()
        compose.onNodeWithTag(TERMS_TAG_ACCEPT).assertIsNotEnabled()
        compose.onNodeWithTag(TERMS_TAG_AGREE).assertIsOff()
        compose.onNodeWithText(TERMS_AGREE_SUMMARY_ONLY).performClick()
        compose.onNodeWithTag(TERMS_TAG_AGREE).assertIsOn()
        compose.onNodeWithTag(TERMS_TAG_ACCEPT).assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, acceptClicks) }
    }

    @Test
    fun aFailedAcceptanceShowsFriendlyCopy_neverTheRawStatus() {
        show(state = TermsUiState.Required(error = TERMS_ERROR_SERVICE_UNAVAILABLE))
        compose.onNodeWithTag(TERMS_TAG_ERROR).assertIsDisplayed()
        compose.onNodeWithText(TERMS_ERROR_SERVICE_UNAVAILABLE).assertIsDisplayed()
        compose.onNodeWithText("NOT_FOUND", substring = true).assertDoesNotExist()
    }

    @Test
    fun whileSubmittingTheAgreementCannotBeChanged() {
        show(state = TermsUiState.Required(submitting = true))
        compose.onNodeWithTag(TERMS_TAG_AGREE).assertIsNotEnabled()
        compose.onNodeWithTag(TERMS_TAG_ACCEPT).assertIsNotEnabled()
    }
}
