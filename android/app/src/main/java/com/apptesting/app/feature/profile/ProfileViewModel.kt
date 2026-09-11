package com.apptesting.app.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

class ProfileViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val assignments: AssignmentRepository,
    private val coins: CoinRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        assignments = ServiceLocator.assignmentRepository,
        coins = ServiceLocator.coinRepository,
    )

    private val _state = MutableStateFlow<ProfileUiState>(ProfileUiState.Loading)
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    private val df: DateFormat = DateFormat.getDateInstance(DateFormat.MEDIUM)

    init {
        observe()
    }

    fun signOut() {
        viewModelScope.launch { users.signOut() }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) flowOf<ProfileUiState>(ProfileUiState.Loading)
                else combine(
                    apps.observeMyApps(user.id),
                    assignments.observeAssignmentsForUser(user.id),
                    coins.observeTransactions(user.id),
                ) { myApps, myAssignments, transactions ->
                    build(user, myApps, myAssignments, transactions)
                }
            }
            .catch { emit(ProfileUiState.Error(it.message ?: "Failed to load your profile.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun build(
        user: User,
        myApps: List<AppSubmission>,
        myAssignments: List<TestAssignment>,
        transactions: List<CoinTransaction>,
    ): ProfileUiState {
        val earned = transactions
            .filter { it.kind == CoinTransactionKind.Earn || it.kind == CoinTransactionKind.Bonus }
            .sumOf { it.amount }
        return ProfileUiState.Content(
            displayName = user.displayName.ifBlank { "Developer" },
            email = user.email,
            joinedIso = df.format(Date(user.createdAtMillis)),
            coinBalance = user.coinBalance,
            trustScore = user.trustScore,
            appsSubmitted = myApps.size,
            testsCompleted = myAssignments.count { it.status == AssignmentStatus.Completed },
            totalCoinsEarned = earned,
            recentTransactions = transactions.take(5).map {
                ProfileTransactionRow(
                    id = it.id,
                    amount = it.amount,
                    kind = it.kind,
                    reason = it.reason,
                    whenIso = df.format(Date(it.createdAtMillis)),
                )
            },
        )
    }
}
