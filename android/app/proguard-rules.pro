# Keep Firestore data classes reflected on by the SDK.
-keep class com.apptesting.app.core.model.** { *; }
-keepclassmembers class com.apptesting.app.core.model.** { *; }

# Coroutines — recommended rules
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
