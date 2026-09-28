package com.apptesting.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Drives [TermsScreen]: checks whether the signed-in user has accepted the
 * current Terms version and records acceptance through the server. The
 * decisions live in [TermsGateController]; this only runs them.
 */
class TermsViewModel internal constructor(
    private val gate: TermsGateController,
) : ViewModel() {

    constructor() : this(ServiceLocator.userRepository)

    internal constructor(users: UserRepository) : this(TermsGateController(users))

    private val _state = MutableStateFlow<TermsUiState>(TermsUiState.Checking)
    val state: StateFlow<TermsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { _state.value = gate.resolve() }
    }

    fun onAccept() {
        val current = _state.value
        if (current !is TermsUiState.Required || current.submitting) return
        _state.value = TermsUiState.Required(submitting = true)
        viewModelScope.launch { _state.value = gate.accept() }
    }
}
