package com.apptesting.app.feature.splash

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Science
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.firstOrNull

@Composable
fun SplashScreen(
    onSignedIn: () -> Unit,
    onNeedsSignIn: () -> Unit,
    userRepository: UserRepository = ServiceLocator.userRepository,
) {
    val scale by animateFloatAsState(
        targetValue = 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "scale",
    )
    var alpha by remember { mutableFloatStateOf(0f) }
    val animAlpha by animateFloatAsState(
        targetValue = alpha,
        animationSpec = tween(600),
        label = "alpha",
    )

    LaunchedEffect(Unit) {
        delay(100)
        alpha = 1f
        delay(2000)
        val user = userRepository.currentUser.firstOrNull()
        if (user != null) {
            onSignedIn()
        } else {
            onNeedsSignIn()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(
                shape = RoundedCornerShape(28.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier
                    .size(96.dp)
                    .scale(scale)
                    .alpha(animAlpha),
                shadowElevation = 12.dp,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Rounded.Science,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(52.dp),
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            Text(
                text = "AppTesting",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.alpha(animAlpha),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Developer Testing Community",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.alpha(animAlpha),
            )

            Spacer(Modifier.height(48.dp))
            LinearProgressIndicator(
                modifier = Modifier
                    .width(120.dp)
                    .height(3.dp)
                    .alpha(animAlpha),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.outlineVariant,
            )
        }
    }
}
