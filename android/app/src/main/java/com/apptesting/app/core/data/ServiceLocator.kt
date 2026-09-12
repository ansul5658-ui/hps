package com.apptesting.app.core.data

import android.content.Context
import com.apptesting.app.core.data.firebase.FirebaseAuthUserRepository
import com.apptesting.app.core.data.firebase.FirebaseAvailability

/**
 * Very small service locator for repositories.
 *
 * Two-mode strategy:
 *   * If Firebase is initialized (i.e. google-services.json was present at
 *     build time and the plugin generated its resources), the real
 *     [FirebaseAuthUserRepository] backs auth and profile writes.
 *   * Otherwise the in-memory mocks back every repository, so the app
 *     stays runnable end-to-end during early development.
 *
 * Non-auth repositories stay on the mock implementation for now — Phase 3
 * later steps will swap them one by one behind the same interfaces without
 * touching UI code.
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

    private val store by lazy { MockStore() }
    private val mockUsers by lazy { MockUserRepository(store) }

    val userRepository: UserRepository by lazy {
        if (isFirebaseEnabled) FirebaseAuthUserRepository(appContext) else mockUsers
    }
    val appRepository: AppRepository by lazy { MockAppRepository(store) }
    val groupRepository: GroupRepository by lazy { MockGroupRepository(store) }
    val assignmentRepository: AssignmentRepository by lazy { MockAssignmentRepository(store) }
    val coinRepository: CoinRepository by lazy { MockCoinRepository(store) }
    val notificationRepository: NotificationRepository by lazy { MockNotificationRepository(store) }
}
