package com.apptesting.app.feature.myapps.add

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class AddAppViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
    )

    sealed interface SubmitState {
        object Idle : SubmitState
        object Submitting : SubmitState
        object Success : SubmitState
        data class Error(val message: String) : SubmitState
    }

    private val _submitState = MutableStateFlow<SubmitState>(SubmitState.Idle)
    val submitState: StateFlow<SubmitState> = _submitState.asStateFlow()

    fun submit(
        appName: String,
        packageName: String,
        description: String,
        versionName: String,
        playUrl: String,
        optInUrl: String,
        selectedIconUri: Uri? = null,
    ) {
        _submitState.value = SubmitState.Submitting
        viewModelScope.launch {
            try {
                val user = users.currentUser.first()
                if (user == null) {
                    _submitState.value = SubmitState.Error("You need to be signed in to submit an app.")
                    return@launch
                }

                val submission = AppSubmission(
                    ownerUserId = user.id,
                    name = appName.trim(),
                    packageName = packageName.trim(),
                    description = description.trim(),
                    versionName = versionName.ifBlank { "1.0.0 (1)" },
                    playStoreUrl = playUrl.trim(),
                    optInUrl = optInUrl.trim(),
                    approvalStatus = AppApprovalStatus.PendingReview,
                )
                val result = apps.addApp(submission, selectedIconUri)
                _submitState.value = if (result.isSuccess) SubmitState.Success
                    else SubmitState.Error(result.exceptionOrNull()?.message ?: "Submission failed.")
            } catch (t: Throwable) {
                _submitState.value = SubmitState.Error(t.message ?: "Submission failed.")
            }
        }
    }
}
