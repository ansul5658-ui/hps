package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.CoinTransactionSource
import com.apptesting.app.core.model.CoinWallet
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupState
import com.apptesting.app.core.model.GroupVisibility
import com.apptesting.app.core.model.QuickTestSession
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.util.AppConfig
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue

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
    "createdAt" to FieldValue.serverTimestamp(),
    "updatedAt" to FieldValue.serverTimestamp(),
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

internal fun DocumentSnapshot.toGroup(): Group {
    val rawName = getString("name").orEmpty()
    val rawEmail = getString("googleGroupEmail").orEmpty()

    val name = if (rawName == "Beta Testers Group" || rawName.isBlank()) "App Testing" else rawName
    val email = if (rawEmail == "apptesting-beta@googlegroups.com" || rawEmail.isBlank()) {
        AppConfig.OFFICIAL_GROUP_EMAIL
    } else {
        rawEmail
    }

    return Group(
        id = if (id == "group_1") AppConfig.OFFICIAL_GROUP_ID else id,
        name = name,
        summary = getString("summary").orEmpty().ifBlank { "Official community testing group for all Android apps." },
        rules = getString("rules").orEmpty().ifBlank { "Participate in community app testing and provide constructive feedback." },
        visibility = parseGroupVisibility(getString("visibility")),
        state = parseGroupState(getString("status")),
        memberCap = getLong("memberCap")?.toInt() ?: 0,
        currentMemberCount = getLong("memberCount")?.toInt() ?: 1,
        createdByUserId = getString("createdBy").orEmpty(),
        createdAtMillis = timestampMillis("createdAt"),
        googleGroupEmail = email,
    )
}

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
// commitmentAmount (reward-era documents: coinReward), status, createdAt,
// updatedAt.
// Note: `daysCompleted` on the doc is server-authoritative (Cloud Functions
// will keep it in sync with the logs collection). For Step 2 the repository
// derives the "live" daysCompleted from the actual logs it sees, so the UI
// reflects check-ins immediately even without a CF running.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toAssignment(
    daysCompleted: Int,
    lastLoggedDayKey: String?,
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
    // `commitmentAmount` is what the server writes now. `coinReward` is the
    // reward-era field: assignments created before the wallet existed still
    // carry it, and reading it here keeps those records displaying a sensible
    // stake instead of 0. Nothing pays it out — see functions/completion.js.
    commitmentAmount = (getLong("commitmentAmount") ?: getLong("coinReward"))?.toInt() ?: 0,
    lastLoggedDayKey = lastLoggedDayKey,
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
    source = parseCoinSource(getString("source")),
    deltaAvailable = getLong("deltaAvailable")?.toInt() ?: 0,
    deltaLocked = getLong("deltaLocked")?.toInt() ?: 0,
    deltaForfeited = getLong("deltaForfeited")?.toInt() ?: 0,
    reason = getString("reason").orEmpty(),
    // v2 entries name it `assignmentId`; reward-era ones used
    // `relatedAssignmentId`. Both are read so history stays linkable.
    relatedAssignmentId = getString("assignmentId") ?: getString("relatedAssignmentId"),
    createdAtMillis = timestampMillis("createdAt"),
    actorId = getString("actorId"),
    // Absent means a pre-wallet document, which is exactly schema v1.
    schemaVersion = getLong("schemaVersion")?.toInt() ?: 1,
)

// ---------------------------------------------------------------------------
// CoinWallet — users/{uid}/wallet/balance
//
// Server-authoritative in full: written only by Cloud Functions inside a
// transaction, and refused to every client by security rules. A missing
// document is the normal state for an account that has never transacted, and
// maps to a real zero wallet rather than an error.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toCoinWallet(): CoinWallet = CoinWallet(
    available = getLong("available")?.toInt() ?: 0,
    locked = getLong("locked")?.toInt() ?: 0,
    forfeitedTotal = getLong("forfeitedTotal")?.toInt() ?: 0,
    purchasedTotal = getLong("purchasedTotal")?.toInt() ?: 0,
    adjustmentNet = getLong("adjustmentNet")?.toInt() ?: 0,
    ledgerCount = getLong("ledgerCount")?.toInt() ?: 0,
    lastEntryId = getString("lastEntryId"),
    updatedAtMillis = timestampMillis("updatedAt"),
    exists = exists(),
)

// ---------------------------------------------------------------------------
// QuickTestSession — quickTestSessions/{uid}__{appId}__{yyyy-MM-dd}
// Written server-side only (startQuickTest / completeQuickTest callables).
// Client reads its own sessions; security rules refuse every client write.
//
// Note the absence of an `assignmentId` mapping: the field does not exist on
// the document, and mapping one here would be the first step toward treating a
// Quick Test as commitment progress. It must stay absent.
// ---------------------------------------------------------------------------

internal fun DocumentSnapshot.toQuickTestSession(): QuickTestSession = QuickTestSession(
    id = id,
    userId = getString("uid").orEmpty(),
    appId = getString("appId").orEmpty(),
    dayKey = getString("dayKey").orEmpty(),
    openedAtMillis = timestampMillis("openedAt"),
    // Null until the session is completed — `timestampMillis` would flatten
    // that to 0L and lose the distinction between "open" and "completed at
    // the epoch", so the nullable read is deliberate.
    completedAtMillis = (get("completedAt") as? Timestamp)?.toDate()?.time,
)

/**
 * Mirrors `COIN_KINDS` in functions/lib/constants.js.
 *
 * The fallback is [CoinTransactionKind.Unknown], NOT a real kind. The old
 * mapper defaulted to `Earn`, which meant any unrecognised document rendered
 * as a credit — including the reward-era "earn" entries that no longer affect
 * a balance at all. An unknown movement must look unknown.
 */
internal fun parseCoinKind(raw: String?): CoinTransactionKind = when (raw) {
    "purchase" -> CoinTransactionKind.Purchase
    "lock" -> CoinTransactionKind.Lock
    "unlock" -> CoinTransactionKind.Unlock
    "forfeit" -> CoinTransactionKind.Forfeit
    "adjustment" -> CoinTransactionKind.Adjustment
    "reversal" -> CoinTransactionKind.Reversal
    else -> CoinTransactionKind.Unknown
}

/** Mirrors `COIN_SOURCES` in functions/lib/constants.js. */
internal fun parseCoinSource(raw: String?): CoinTransactionSource = when (raw) {
    "payment" -> CoinTransactionSource.Payment
    "commitment" -> CoinTransactionSource.Commitment
    "completion" -> CoinTransactionSource.Completion
    "failure" -> CoinTransactionSource.Failure
    "cancellation" -> CoinTransactionSource.Cancellation
    "adminGrant" -> CoinTransactionSource.AdminGrant
    "adminReversal" -> CoinTransactionSource.AdminReversal
    "migration" -> CoinTransactionSource.Migration
    else -> CoinTransactionSource.Unknown
}
