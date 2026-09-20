package com.apptesting.app.feature.myapps.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.Group
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

class AppDetailsViewModel(
    private val appId: String,
    private val apps: AppRepository = ServiceLocator.appRepository,
    private val groups: GroupRepository = ServiceLocator.groupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<AppDetailsUiState>(AppDetailsUiState.Loading)
    val state: StateFlow<AppDetailsUiState> = _state.asStateFlow()

    private val _isDeleting = MutableStateFlow(false)
    val isDeleting: StateFlow<Boolean> = _isDeleting.asStateFlow()

    private val _deleteError = MutableStateFlow<String?>(null)
    val deleteError: StateFlow<String?> = _deleteError.asStateFlow()

    init {
        observe()
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
