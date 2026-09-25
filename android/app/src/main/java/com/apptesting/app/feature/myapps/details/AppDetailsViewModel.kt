package com.apptesting.app.feature.myapps.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.ConfirmSetupResult
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.TestingRepository
import com.apptesting.app.core.model.AppFeedbackItem
import com.apptesting.app.core.model.AppReadiness
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.Group
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

sealed interface AppDetailsUiState {
    object Loading : AppDetailsUiState
    data class Error(val message: String) : AppDetailsUiState
    data class Content(
        val app: AppSubmission,
        val activeGroup: Group? = null,
    ) : AppDetailsUiState
}

/** The developer's testing-setup checklist, from `getAppTestingReadiness`. */
sealed interface SetupUiState {
    object Loading : SetupUiState
    data class Error(val message: String) : SetupUiState
    data class Loaded(val readiness: AppReadiness, val confirming: Boolean = false) : SetupUiState
}

/** Anonymous feedback on this app, from `getAppFeedback`. */
sealed interface AppFeedbackUiState {
    object Loading : AppFeedbackUiState
    data class Error(val message: String) : AppFeedbackUiState
    data class Loaded(val items: List<AppFeedbackItem>) : AppFeedbackUiState
}

class AppDetailsViewModel(
    private val appId: String,
    private val apps: AppRepository = ServiceLocator.appRepository,
    private val groups: GroupRepository = ServiceLocator.groupRepository,
    private val testing: TestingRepository = ServiceLocator.testingRepository,
) : ViewModel() {

    private val _setup = MutableStateFlow<SetupUiState>(SetupUiState.Loading)
    val setup: StateFlow<SetupUiState> = _setup.asStateFlow()

    private val _feedback = MutableStateFlow<AppFeedbackUiState>(AppFeedbackUiState.Loading)
    val feedback: StateFlow<AppFeedbackUiState> = _feedback.asStateFlow()

    private val _messages = MutableSharedFlow<String>()
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    private val _state = MutableStateFlow<AppDetailsUiState>(AppDetailsUiState.Loading)
    val state: StateFlow<AppDetailsUiState> = _state.asStateFlow()

    private val _isDeleting = MutableStateFlow(false)
    val isDeleting: StateFlow<Boolean> = _isDeleting.asStateFlow()

    private val _deleteError = MutableStateFlow<String?>(null)
    val deleteError: StateFlow<String?> = _deleteError.asStateFlow()

    init {
        observe()
        observeSetupInputs()
        // Feedback is loaded by the screen on every resume (see
        // AppDetailsScreen) - a tab switch restores this ViewModel, and a
        // load made only here would go stale while the developer was away.
    }

    /**
     * Re-ask the server for readiness whenever a field it depends on changes -
     * including the developer's own edits, which the server treats as making
     * an earlier confirmation outdated. Readiness is never computed here.
     */
    private fun observeSetupInputs() {
        apps.observeApp(appId)
            .map { app -> app?.let { listOf(it.approvalStatus, it.packageName, it.optInUrl, it.playStoreUrl, it.activeGroupId) } }
            .distinctUntilChanged()
            .onEach { loadReadiness() }
            .catch { e -> _setup.value = SetupUiState.Error(e.message ?: "Couldn't load the testing setup.") }
            .launchIn(viewModelScope)
    }

    fun loadReadiness() {
        viewModelScope.launch {
            testing.appReadiness(appId).fold(
                onSuccess = { _setup.value = SetupUiState.Loaded(it) },
                onFailure = { _setup.value = SetupUiState.Error(it.message ?: "Couldn't load the testing setup.") },
            )
        }
    }

    fun loadFeedback() {
        viewModelScope.launch {
            testing.appFeedback(appId).fold(
                onSuccess = { _feedback.value = AppFeedbackUiState.Loaded(it) },
                onFailure = { _feedback.value = AppFeedbackUiState.Error(it.message ?: "Couldn't load feedback.") },
            )
        }
    }

    /**
     * Record the developer's self-confirmation. Called only after both boxes
     * are ticked on screen. The server checks the links, records who and when,
     * and reports whether the app is now ready; the checklist is then reloaded
     * from the server rather than updated locally.
     */
    fun confirmSetup() {
        val loaded = _setup.value as? SetupUiState.Loaded ?: return
        if (loaded.confirming) return
        _setup.value = loaded.copy(confirming = true)
        viewModelScope.launch {
            val message = when (val r = testing.confirmAppSetup(appId)) {
                is ConfirmSetupResult.Confirmed ->
                    if (r.ready) {
                        "Setup self-confirmed. Your app is ready for testers."
                    } else {
                        "Setup self-confirmed. Your app becomes ready once the remaining items are done."
                    }
                is ConfirmSetupResult.SetupIncomplete -> r.message
                is ConfirmSetupResult.Error -> r.message
            }
            _messages.emit(message)
            loadReadiness()
        }
    }

    fun clearDeleteError() {
        _deleteError.value = null
    }

    fun deleteApp(onDeleted: () -> Unit) {
        if (_isDeleting.value) return
        _isDeleting.value = true
        _deleteError.value = null

        viewModelScope.launch {
            val result = apps.deleteApp(appId)
            _isDeleting.value = false
            result.fold(
                onSuccess = {
                    onDeleted()
                },
                onFailure = { error ->
                    _deleteError.value = error.message ?: "Failed to delete app."
                },
            )
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        apps.observeApp(appId)
            .flatMapLatest { app ->
                if (app == null) {
                    flowOf(AppDetailsUiState.Error("App not found."))
                } else {
                    groups.observeGroups()
                        .map { allGroups ->
                            val active = allGroups.firstOrNull { it.id == app.activeGroupId }
                            AppDetailsUiState.Content(app = app, activeGroup = active)
                        }
                        .catch { emit(AppDetailsUiState.Content(app = app)) }
                }
            }
            .catch { e -> emit(AppDetailsUiState.Error(e.message ?: "Failed to load app details.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }
}

class AppDetailsViewModelFactory(private val appId: String) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return AppDetailsViewModel(appId = appId) as T
    }
}
