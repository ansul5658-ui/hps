package com.apptesting.app.core.data

/**
 * Very small service locator for repositories.
 *
 * Kept intentionally minimal: Phase 2 wires the mock implementations here;
 * when Firebase lands, swap the singletons behind [Repositories] without
 * touching UI code. A real DI framework (Hilt/Koin) can be introduced then.
 */
object ServiceLocator {

    private val store = MockStore()

    val userRepository: UserRepository = MockUserRepository(store)
    val appRepository: AppRepository = MockAppRepository(store)
    val groupRepository: GroupRepository = MockGroupRepository(store)
    val assignmentRepository: AssignmentRepository = MockAssignmentRepository(store)
    val coinRepository: CoinRepository = MockCoinRepository(store)
    val notificationRepository: NotificationRepository = MockNotificationRepository(store)
}
