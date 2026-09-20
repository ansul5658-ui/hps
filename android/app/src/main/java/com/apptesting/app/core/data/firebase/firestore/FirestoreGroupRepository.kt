package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.firebase.functions.AppFunctions
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.GroupMemberRole
import com.apptesting.app.core.util.AppConfig
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/**
 * Firestore-backed [GroupRepository].
 *
 * Groups themselves live at `groups/{groupId}` per the Step 2 spec.
 * Membership is stored in a subcollection under each user for cheap
 * per-user observation:
 *
 *   users/{uid}/memberships/{groupId}
 *
 * Storing membership there gives the client a subcollection query it can
 * observe with a real-time listener AND rules that trivially allow the
 * user to read/write only their own membership doc. `groups.memberCount`
 * remains a denormalized field, kept in sync by a future Cloud Function;
 * the client is not permitted to touch it.
 */
internal class FirestoreGroupRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: AppFunctions = AppFunctions(),
) : GroupRepository {

    private val groups = firestore.collection("groups")

    override fun observeGroups(): Flow<List<Group>> =
        groups.snapshots()
            .map { snap -> snap.documents.map { it.toGroup() } }

    override fun observeGroup(groupId: String): Flow<Group?> =
        groups.snapshots()
            .map { snap ->
                val all = snap.documents.map { it.toGroup() }
                all.firstOrNull { it.id == groupId }
                    ?: all.firstOrNull { it.id == AppConfig.OFFICIAL_GROUP_ID }
                    ?: all.firstOrNull()
            }

    override fun observeMembershipFor(userId: String): Flow<List<GroupMember>> =
        firestore.collection("users").document(userId).collection("memberships")
            .snapshots()
            .map { snap ->
                snap.documents.map { doc ->
                    GroupMember(
                        id = doc.id,
                        groupId = doc.id,
                        userId = userId,
                        joinedAtMillis = doc.timestampMillis("joinedAt"),
                        role = GroupMemberRole.Member,
                    )
                }
            }

    /**
     * Joining goes through the `joinGroup` callable, not a direct write.
     *
     * The server owns the checks that matter — account not suspended, group
     * joinable, member cap, no duplicate — and rules deny the membership
     * create to every client so they cannot be sidestepped. The call is
     * idempotent: joining a group you are already in succeeds quietly.
     */
    override suspend fun requestJoin(groupId: String, userId: String): Result<Unit> = runCatching {
        functions.call("joinGroup", mapOf("groupId" to groupId))
        Unit
    }

    override suspend fun leave(groupId: String, userId: String): Result<Unit> = runCatching {
        firestore.collection("users").document(userId)
            .collection("memberships").document(groupId)
            .delete()
            .await()
    }
}
