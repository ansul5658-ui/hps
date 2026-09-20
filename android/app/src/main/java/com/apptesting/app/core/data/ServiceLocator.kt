package com.apptesting.app.core.data

import android.content.Context
import com.apptesting.app.core.data.firebase.FirebaseAuthUserRepository
import com.apptesting.app.core.data.firebase.FirebaseAvailability
import com.apptesting.app.core.data.firebase.firestore.FirestoreAdminRepository
import com.apptesting.app.core.data.firebase.firestore.FirestoreAppRepository
import com.apptesting.app.core.data.firebase.firestore.FirestoreAssignmentRepository
import com.apptesting.app.core.data.firebase.firestore.FirestoreCoinRepository
import com.apptesting.app.core.data.firebase.firestore.FirestoreGroupRepository
import com.apptesting.app.core.data.firebase.firestore.FirestoreQuickTestRepository

/**
 * Very small service locator for repositories.
 *
 * Two-mode strategy:
 *   * If Firebase is initialized (i.e. google-services.json was present at
 *     build time and the plugin generated its resources), each repository
 *     resolves to its Firestore-backed implementation.
 *   * Otherwise the in-memory mocks back every repository, so the app
 *     stays runnable end-to-end during early development.
 *
 * The Notification repository has no Firestore equivalent yet — FCM
 * inbox handling lands in a later step — so it stays on the mock in
 * both modes for now.
 *
 * [init] must be called from [com.apptesting.app.AppTestingApplication.onCreate].
 */
object ServiceLocator {

    private lateinit var appContext: Context

    fun init(context: Context) {
        // Idempotent — repeated calls (e.g. from tests) are a no-op.
        if (::appContext.isInitialized) return
        appContext = context.applicationContext
    }

    /** True when the app is running against real Firebase. */
    val isFirebaseEnabled: Boolean by lazy {
        check(::appContext.isInitialized) {
            "ServiceLocator.init(context) must be called before repositories are accessed."
        }
        FirebaseAvailability.isConfigured(appContext)
    }

    // ---- Mock backing store (used in dev mode + kept for future tests). ----
    private val store by lazy { MockStore() }
    private val mockUsers by lazy { MockUserRepository(store) }
    private val mockApps by lazy { MockAppRepository(store) }
    private val mockGroups by lazy { MockGroupRepository(store) }
    private val mockAssignments by lazy { MockAssignmentRepository(store) }
    private val mockCoins by lazy { MockCoinRepository(store) }
    private val mockQuickTests by lazy { MockQuickTestRepository(store) }
    private val mockNotifications by lazy { MockNotificationRepository(store) }
    private val mockAdmin by lazy { MockAdminRepository(store) }

    // ---- Public repositories ---------------------------------------------
    val userRepository: UserRepository by lazy {
        if (isFirebaseEnabled) FirebaseAuthUserRepository(appContext) else mockUsers
    }
    val appRepository: AppRepository by lazy {
        if (isFirebaseEnabled) FirestoreAppRepository() else mockApps
    }
    val groupRepository: GroupRepository by lazy {
        if (isFirebaseEnabled) FirestoreGroupRepository() else mockGroups
    }
    val assignmentRepository: AssignmentRepository by lazy {
        if (isFirebaseEnabled) FirestoreAssignmentRepository() else mockAssignments
    }
    /**
     * Testing Coin wallet + ledger. Read-only in both modes — coins move only
     * inside Cloud Functions, and rules refuse every client write to both
     * paths. See [CoinRepository].
     */
    val coinRepository: CoinRepository by lazy {
        if (isFirebaseEnabled) FirestoreCoinRepository() else mockCoins
    }
    val quickTestRepository: QuickTestRepository by lazy {
        if (isFirebaseEnabled) FirestoreQuickTestRepository() else mockQuickTests
    }
    val notificationRepository: NotificationRepository by lazy {
        // FCM + notifications inbox lands in Step 6.
        mockNotifications
    }
    val adminRepository: AdminRepository by lazy {
        if (isFirebaseEnabled) FirestoreAdminRepository() else mockAdmin
    }
}
