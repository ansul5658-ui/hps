package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupState
import com.apptesting.app.core.model.GroupVisibility
import com.apptesting.app.core.model.TestAssignment
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot

/**
 * Manual Firestore field mapping.
 *
 * We deliberately do NOT use Firestore's reflection-based `.toObject()` here:
 *
 *  * The domain models pre-date the Firestore field spec, so several names
 *    differ (e.g. `AppSubmission.ownerUserId` vs `apps.ownerId`,
 *    `AppSubmission.name` vs `apps.appName`). Hand-mapping keeps the domain
 *    models Kotlin-clean and lets Firestore documents follow the Phase 3
 *    Step 2 spec exactly.
 *  * Explicit mapping surfaces every field crossing the network — enum
 *    strings, timestamps, defaults — instead of hiding them in reflection.
 *
 * Enum-string canonicalization: lowerCamelCase strings that match the enum
 * name once lower-cased. Unknown values fall back to sensible defaults.
 */

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.timestampMillis(field: String): Long =
    (get(field) as? Timestamp)?.toDate()?.time ?: 0L

// ---------------------------------------------------------------------------
// AppSubmission — apps/{appId}
// Fields per spec: ownerId, appName, packageName, versionName, playStoreUrl,
// closedTestingUrl, iconUrl, description, status, createdAt, updatedAt.
// activeGroupId / testerCount / completedTesterCount are extra denormalized
// fields written by future Cloud Functions; they are read-if-present and
// otherwise default to 0/null.
// ---------------------------------------------------------------------------

internal fun AppSubmission.toFirestoreCreate(): Map<String, Any?> = mapOf(
    "ownerId" to ownerUserId,
    "appName" to name,
    "packageName" to packageName,
    "versionName" to versionName,
    "playStoreUrl" to playStoreUrl,
    "closedTestingUrl" to optInUrl,
    "iconUrl" to iconStoragePath,
    "description" to description,
    "status" to approvalStatus.serialize(),
    "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
    "updatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
)

internal fun DocumentSnapshot.toAppSubmission(): AppSubmission = AppSubmission(
    id = id,
    ownerUserId = getString("ownerId").orEmpty(),
    name = getString("appName").orEmpty(),
    packageName = getString("packageName").orEmpty(),
    description = getString("description").orEmpty(),
    iconStoragePath = getString("iconUrl"),
    playStoreUrl = getString("playStoreUrl").orEmpty(),
    optInUrl = getString("closedTestingUrl").orEmpty(),
    versionName = getString("versionName").orEmpty(),
    createdAtMillis = timestampMillis("createdAt"),
    approvalStatus = parseApprovalStatus(getString("status")),
    activeGroupId = getString("activeGroupId"),
    testerCount = getLong("testerCount")?.toInt() ?: 0,
    completedTesterCount = getLong("completedTesterCount")?.toInt() ?: 0,
)

internal fun AppApprovalStatus.serialize(): String = when (this) {
    AppApprovalStatus.PendingReview -> "pendingReview"
    AppApprovalStatus.Approved -> "approved"
    AppApprovalStatus.Rejected -> "rejected"
    AppApprovalStatus.Archived -> "archived"
}

internal fun parseApprovalStatus(raw: String?): AppApprovalStatus = when (raw) {
    "approved" -> AppApprovalStatus.Approved
    "rejected" -> AppApprovalStatus.Rejected
    "archived" -> AppApprovalStatus.Archived
    else -> AppApprovalStatus.PendingReview
}

// ---------------------------------------------------------------------------
// Group — groups/{groupId}
// Fields per spec: name, googleGroupEmail, memberCount, status, createdAt,
// createdBy.
// Other domain fields (summary/rules/visibility/memberCap) are read from
// optional extra fields when present.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toGroup(): Group = Group(
    id = id,
    name = getString("name").orEmpty(),
    summary = getString("summary").orEmpty(),
    rules = getString("rules").orEmpty(),
    visibility = parseGroupVisibility(getString("visibility")),
    state = parseGroupState(getString("status")),
    memberCap = getLong("memberCap")?.toInt() ?: 0,
    currentMemberCount = getLong("memberCount")?.toInt() ?: 0,
    createdByUserId = getString("createdBy").orEmpty(),
    createdAtMillis = timestampMillis("createdAt"),
    googleGroupEmail = getString("googleGroupEmail").orEmpty(),
)

internal fun parseGroupState(raw: String?): GroupState = when (raw) {
    "draft" -> GroupState.Draft
    "open" -> GroupState.Open
    "full" -> GroupState.Full
    "active" -> GroupState.Active
    "completed" -> GroupState.Completed
    "archived" -> GroupState.Archived
    "cancelled" -> GroupState.Cancelled
    else -> GroupState.Draft
}

internal fun parseGroupVisibility(raw: String?): GroupVisibility = when (raw) {
    "inviteOnly" -> GroupVisibility.InviteOnly
    "private" -> GroupVisibility.Private
    else -> GroupVisibility.Open
}

// ---------------------------------------------------------------------------
// TestAssignment — testingAssignments/{assignmentId}
// Fields per spec: appId, testerId, developerId, daysRequired, daysCompleted,
// coinReward, status, createdAt, updatedAt.
// Note: `daysCompleted` on the doc is server-authoritative (Cloud Functions
// will keep it in sync with the logs collection). For Step 2 the repository
// derives the "live" daysCompleted from the actual logs it sees, so the UI
// reflects check-ins immediately even without a CF running.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toAssignment(
    daysCompleted: Int,
    lastLoggedLocalDay: String?,
): TestAssignment = TestAssignment(
    id = id,
    groupId = getString("groupId").orEmpty(), // optional legacy field
    appId = getString("appId").orEmpty(),
    testerUserId = getString("testerId").orEmpty(),
    assignedAtMillis = timestampMillis("createdAt"),
    deadlineAtMillis = (get("deadline") as? Timestamp)?.toDate()?.time,
    daysRequired = getLong("daysRequired")?.toInt() ?: 14,
    daysCompleted = daysCompleted,
    status = parseAssignmentStatus(getString("status")),
    coinReward = getLong("coinReward")?.toInt() ?: 0,
    lastLoggedLocalDay = lastLoggedLocalDay,
)

internal fun AssignmentStatus.serialize(): String = when (this) {
    AssignmentStatus.Ready -> "ready"
    AssignmentStatus.InProgress -> "inProgress"
    AssignmentStatus.WaitingForVerification -> "waitingForVerification"
    AssignmentStatus.Completed -> "completed"
    AssignmentStatus.Missed -> "missed"
}

internal fun parseAssignmentStatus(raw: String?): AssignmentStatus = when (raw) {
    "inProgress" -> AssignmentStatus.InProgress
    "waitingForVerification" -> AssignmentStatus.WaitingForVerification
    "completed" -> AssignmentStatus.Completed
    "missed" -> AssignmentStatus.Missed
    else -> AssignmentStatus.Ready
}

// ---------------------------------------------------------------------------
// CoinTransaction — users/{uid}/coinTransactions/{txId}
// Written server-side (later — Cloud Functions). Client only reads.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toCoinTransaction(userId: String): CoinTransaction = CoinTransaction(
    id = id,
    userId = userId,
    amount = getLong("amount")?.toInt() ?: 0,
    kind = parseCoinKind(getString("kind")),
    reason = getString("reason").orEmpty(),
    relatedAssignmentId = getString("relatedAssignmentId"),
    createdAtMillis = timestampMillis("createdAt"),
    recordedByAdmin = getBoolean("recordedByAdmin") ?: false,
)

internal fun parseCoinKind(raw: String?): CoinTransactionKind = when (raw) {
    "spend" -> CoinTransactionKind.Spend
    "bonus" -> CoinTransactionKind.Bonus
    "penalty" -> CoinTransactionKind.Penalty
    "adjustment" -> CoinTransactionKind.Adjustment
    else -> CoinTransactionKind.Earn
}
