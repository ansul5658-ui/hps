package com.apptesting.app.feature.myapps.add

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.RateReview
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.ResponsivePane

/**
 * Validation helpers for Add App wizard.
 */
object AddAppValidator {
    private val PACKAGE_NAME_REGEX = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$")

    fun isValidAppName(name: String): Boolean {
        val trimmed = name.trim()
        return trimmed.isNotBlank() && trimmed.length in 1..80
    }

    fun isValidPackageName(pkg: String): Boolean {
        val trimmed = pkg.trim()
        return trimmed.isNotBlank() && PACKAGE_NAME_REGEX.matches(trimmed)
    }

    fun isValidVersionName(version: String): Boolean {
        val trimmed = version.trim()
        return trimmed.isEmpty() || trimmed.length <= 30
    }

    fun isValidDescription(desc: String): Boolean {
        val trimmed = desc.trim()
        return trimmed.isEmpty() || trimmed.length <= 1000
    }

    fun isValidPlayStoreUrl(urlStr: String): Boolean {
        val trimmed = urlStr.trim()
        if (trimmed.isBlank()) return true // Optional field
        val uri = try { trimmed.toUri() } catch (_: Exception) { return false }
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "http" && scheme != "https") return false
        val host = uri.host?.lowercase() ?: return false
        if (host != "play.google.com" && host != "www.play.google.com") return false
        val path = uri.path ?: return false
        if (path != "/store/apps/details") return false
        val appId = uri.getQueryParameter("id")?.trim() ?: return false
        return isValidPackageName(appId)
    }

    fun isValidTestingUrl(urlStr: String): Boolean {
        val trimmed = urlStr.trim()
        if (trimmed.isBlank()) return false // Required testing link
        val uri = try { trimmed.toUri() } catch (_: Exception) { return false }
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "http" && scheme != "https") return false
        val host = uri.host?.lowercase() ?: return false
        return host.isNotBlank() && host.contains(".")
    }
}

/**
 * Multi-step Add App flow.
 *
 * Steps: Info → Play → Icon → Review → Submit.
 */
@Composable
fun AddAppScreen(
    onDone: () -> Unit,
    viewModel: AddAppViewModel = viewModel(),
) {
    var step by rememberSaveable { mutableStateOf(0) }
    var appName by rememberSaveable { mutableStateOf("") }
    var packageName by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var versionName by rememberSaveable { mutableStateOf("") }
    var optInUrl by rememberSaveable { mutableStateOf("") }
    var selectedIconUri by rememberSaveable { mutableStateOf<Uri?>(null) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri != null) {
            selectedIconUri = uri
        }
    }

    val submitState by viewModel.submitState.collectAsStateWithLifecycle()
    val submitting = submitState is AddAppViewModel.SubmitState.Submitting
    val submitError = (submitState as? AddAppViewModel.SubmitState.Error)?.message

    LaunchedEffect(submitState) {
        if (submitState is AddAppViewModel.SubmitState.Success) onDone()
    }

    val steps = remember {
        listOf(
            StepMeta(Icons.Rounded.Info, "App information"),
            StepMeta(Icons.Rounded.Link, "Google Play"),
            StepMeta(Icons.Rounded.Image, "App icon"),
            StepMeta(Icons.Rounded.RateReview, "Review"),
        )
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Submit an app") },
                navigationIcon = {
                    IconButton(onClick = {
                        if (step == 0) onDone() else step--
                    }) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { inner ->
        ResponsivePane(modifier = Modifier.padding(inner)) {
            Column(Modifier.fillMaxSize()) {
                Stepper(steps = steps, current = step)
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Spacer(Modifier.height(4.dp))
                    when (step) {
                        0 -> StepInfo(
                            appName = appName, onName = { appName = it },
                            packageName = packageName, onPackage = { packageName = it },
                            description = description, onDescription = { description = it },
                            versionName = versionName, onVersion = { versionName = it },
                        )
                        1 -> StepPlay(
                            optInUrl = optInUrl, onOptIn = { optInUrl = it },
                        )
                        2 -> StepIcon(
                            selectedUri = selectedIconUri,
                            onPick = {
                                photoPickerLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            },
                        )
                        3 -> StepReview(
                            appName = appName,
                            packageName = packageName,
                            description = description,
                            versionName = versionName,
                            optInUrl = optInUrl,
                            selectedIconUri = selectedIconUri,
                            errorMessage = submitError,
                        )
                    }
                }
                NavBar(
                    step = step,
                    lastStep = steps.lastIndex,
                    canAdvance = canAdvance(step, appName, packageName, optInUrl, selectedIconUri) && !submitting,
                    submitting = submitting,
                    onBack = { if (step == 0) onDone() else step-- },
                    onNext = {
                        if (step < steps.lastIndex) {
                            step++
                        } else {
                            viewModel.submit(
                                appName = appName,
                                packageName = packageName,
                                description = description,
                                versionName = versionName,
                                playUrl = "",
                                optInUrl = optInUrl,
                                selectedIconUri = selectedIconUri,
                            )
                        }
                    },
                )
            }
        }
    }
}

private data class StepMeta(val icon: ImageVector, val label: String)

@Composable
private fun Stepper(steps: List<StepMeta>, current: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        steps.forEachIndexed { index, meta ->
            val done = index < current
            val active = index == current
            val stateLabel = when {
                done -> "completed"
                active -> "in progress"
                else -> "upcoming"
            }
            Surface(
                shape = CircleShape,
                color = when {
                    done -> MaterialTheme.colorScheme.primary
                    active -> MaterialTheme.colorScheme.primaryContainer
                    else -> MaterialTheme.colorScheme.surfaceVariant
                },
                modifier = Modifier
                    .size(36.dp)
                    .semantics {
                        contentDescription =
                            "Step ${index + 1} of ${steps.size}: ${meta.label}, $stateLabel"
                    },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (done) Icons.Rounded.CheckCircle else meta.icon,
                        contentDescription = null,
                        tint = when {
                            done -> MaterialTheme.colorScheme.onPrimary
                            active -> MaterialTheme.colorScheme.onPrimaryContainer
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            if (index != steps.lastIndex) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 8.dp)
                        .height(2.dp)
                        .background(
                            if (index < current) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceVariant,
                        ),
                )
            }
        }
    }
}

@Composable
private fun StepInfo(
    appName: String, onName: (String) -> Unit,
    packageName: String, onPackage: (String) -> Unit,
    description: String, onDescription: (String) -> Unit,
    versionName: String, onVersion: (String) -> Unit,
) {
    Text("App information", style = MaterialTheme.typography.titleLarge)
    Text(
        "Give community members enough context to test your app well.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    val nameError = appName.isNotEmpty() && !AddAppValidator.isValidAppName(appName)
    OutlinedTextField(
        value = appName,
        onValueChange = onName,
        label = { Text("App name") },
        singleLine = true,
        isError = nameError,
        supportingText = if (nameError) { { Text("App name must be 1–80 characters.") } } else null,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
    )

    val pkgError = packageName.isNotEmpty() && !AddAppValidator.isValidPackageName(packageName)
    OutlinedTextField(
        value = packageName,
        onValueChange = onPackage,
        label = { Text("Package name") },
        placeholder = { Text("com.example.myapp") },
        singleLine = true,
        isError = pkgError,
        supportingText = if (pkgError) { { Text("Enter a valid Android package name (e.g. com.example.app).") } } else null,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Ascii,
            imeAction = ImeAction.Next,
        ),
    )

    val verError = versionName.isNotEmpty() && !AddAppValidator.isValidVersionName(versionName)
    OutlinedTextField(
        value = versionName,
        onValueChange = onVersion,
        label = { Text("Version (optional)") },
        placeholder = { Text("1.0.0 (1)") },
        singleLine = true,
        isError = verError,
        supportingText = if (verError) { { Text("Version name must be 30 characters or fewer.") } } else null,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
    )

    val descError = description.isNotEmpty() && !AddAppValidator.isValidDescription(description)
    OutlinedTextField(
        value = description,
        onValueChange = onDescription,
        label = { Text("Description") },
        minLines = 3,
        isError = descError,
        supportingText = if (descError) { { Text("Description must be 1000 characters or fewer.") } } else null,
        modifier = Modifier.fillMaxWidth(),
        leadingIcon = { Icon(Icons.Rounded.Description, contentDescription = null) },
    )
}

@Composable
private fun StepPlay(
    optInUrl: String, onOptIn: (String) -> Unit,
) {
    Text("Google Play Testing Link", style = MaterialTheme.typography.titleLarge)
    Text(
        "Paste the Google Play closed-testing opt-in link so community testers can join.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    val optInError = optInUrl.isNotEmpty() && !AddAppValidator.isValidTestingUrl(optInUrl)
    OutlinedTextField(
        value = optInUrl,
        onValueChange = onOptIn,
        label = { Text("Closed-testing / Opt-in URL") },
        placeholder = { Text("https://play.google.com/apps/testing/com.example.app") },
        singleLine = true,
        isError = optInError,
        supportingText = if (optInError) { { Text("Enter a valid closed-testing URL.") } } else null,
        modifier = Modifier.fillMaxWidth(),
        leadingIcon = { Icon(Icons.Rounded.Link, contentDescription = null) },
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Done,
        ),
    )
}

@Composable
private fun StepIcon(selectedUri: Uri?, onPick: () -> Unit) {
    Text("App icon", style = MaterialTheme.typography.titleLarge)
    Text(
        "Use a 512x512 PNG, JPEG, or WebP image. This is shown on the assignment card.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedButton(
        onClick = onPick,
        modifier = Modifier
            .fillMaxWidth()
            .height(140.dp),
        shape = MaterialTheme.shapes.large,
    ) {
        if (selectedUri != null) {
            AsyncImage(
                model = selectedUri,
                contentDescription = "Selected App Icon",
                modifier = Modifier
                    .size(80.dp)
                    .clip(MaterialTheme.shapes.medium),
                contentScale = ContentScale.Crop,
            )
            Spacer(Modifier.width(16.dp))
            Column {
                Text("Icon selected", style = MaterialTheme.typography.titleMedium)
                Text("Tap to change image", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            Icon(
                imageVector = Icons.Rounded.Image,
                contentDescription = null,
                modifier = Modifier.size(28.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text("Choose an image", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun StepReview(
    appName: String,
    packageName: String,
    description: String,
    versionName: String,
    optInUrl: String,
    selectedIconUri: Uri?,
    errorMessage: String?,
) {
    Text("Review", style = MaterialTheme.typography.titleLarge)
    Text(
        "Confirm everything looks right. An administrator will review your submission before it becomes visible to testers.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    ReviewLine("Name", appName)
    ReviewLine("Package", packageName)
    ReviewLine("Version", versionName.ifBlank { "1.0.0 (1)" })
    ReviewLine("Description", description)
    ReviewLine("Opt-in URL", optInUrl)
    ReviewLine("Icon", if (selectedIconUri != null) "Selected" else "Not selected")
    if (errorMessage != null) {
        Spacer(Modifier.size(8.dp))
        Text(
            text = errorMessage,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

@Composable
private fun ReviewLine(label: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value.ifBlank { "—" },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun NavBar(
    step: Int,
    lastStep: Int,
    canAdvance: Boolean,
    submitting: Boolean,
    onBack: () -> Unit,
    onNext: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(20.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onBack,
            enabled = !submitting,
            modifier = Modifier.weight(1f).height(52.dp),
            shape = MaterialTheme.shapes.large,
        ) {
            Text(if (step == 0) "Cancel" else stringResource(R.string.action_back))
        }
        Button(
            onClick = onNext,
            enabled = canAdvance,
            modifier = Modifier.weight(1f).height(52.dp),
            shape = MaterialTheme.shapes.large,
        ) {
            Text(
                text = when {
                    submitting -> "Submitting…"
                    step == lastStep -> stringResource(R.string.action_submit)
                    else -> stringResource(R.string.action_next)
                },
            )
        }
    }
}

private fun canAdvance(
    step: Int,
    appName: String,
    packageName: String,
    optInUrl: String,
    selectedIconUri: Uri?,
): Boolean = when (step) {
    0 -> AddAppValidator.isValidAppName(appName) && AddAppValidator.isValidPackageName(packageName)
    1 -> AddAppValidator.isValidTestingUrl(optInUrl)
    2 -> selectedIconUri != null
    else -> true
}
