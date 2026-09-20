package com.apptesting.app.feature.auth

import android.util.Log
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.theme.BrandColors

private const val TAG = "AUTH_DEBUG"

@Composable
fun SignInScreen(
    onSignedIn: () -> Unit,
    viewModel: AuthViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(state) {
        Log.d(TAG, "SignInScreen state=${state::class.simpleName}")
        when (val s = state) {
            SignInUiState.Success -> { viewModel.consume(); onSignedIn() }
            is SignInUiState.Error -> { snackbar.showSnackbar(s.message); viewModel.consume() }
            else -> Unit
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { inner ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
        ) {
            // Subtle gradient header
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(320.dp)
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                                Color.Transparent,
                            )
                        )
                    )
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 28.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(52.dp))

                // Logo badge
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(80.dp),
                    shadowElevation = 8.dp,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Rounded.Science,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(42.dp),
                        )
                    }
                }

                Spacer(Modifier.height(32.dp))

                Text(
                    text = stringResource(R.string.auth_welcome_title),
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = stringResource(R.string.auth_welcome_subtitle),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(max = 340.dp),
                    lineHeight = 22.sp,
                )

                Spacer(Modifier.height(40.dp))

                // Value props — card style
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        ValueProp(icon = Icons.Rounded.PhoneAndroid,
                            text = "Test real apps from fellow developers")
                        ValueProp(icon = Icons.Rounded.Bolt,
                            text = "Submit your app — get 12 testers in 14 days")
                        ValueProp(icon = Icons.Rounded.Groups,
                            text = "Join groups, earn coins, build trust score")
                    }
                }

                Spacer(Modifier.weight(1f))

                val loading = state is SignInUiState.Loading
                Button(
                    onClick = { viewModel.onSignInPressed(context) },
                    enabled = !loading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    shape = MaterialTheme.shapes.large,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    elevation = ButtonDefaults.buttonElevation(defaultElevation = 4.dp),
                ) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.5.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    } else {
                        Icon(Icons.Rounded.AccountCircle, null, Modifier.size(22.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = stringResource(R.string.auth_sign_in_google),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))
                TermsFooter()
            }
        }
    }
}

@Composable
private fun ValueProp(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(36.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun TermsFooter() {
    val linkColor = MaterialTheme.colorScheme.primary
    val text = buildAnnotatedString {
        append(stringResource(R.string.auth_terms_prefix))
        append(' ')
        withStyle(SpanStyle(color = linkColor, fontWeight = FontWeight.SemiBold)) {
            append(stringResource(R.string.auth_terms))
        }
        append(' ')
        append(stringResource(R.string.auth_and))
        append(' ')
        withStyle(SpanStyle(color = linkColor, fontWeight = FontWeight.SemiBold)) {
            append(stringResource(R.string.auth_privacy))
        }
        append('.')
    }
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}
