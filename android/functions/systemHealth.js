/**
 * Declared service outages: `systemHealth/{yyyy-MM-dd}`.
 *
 * One document per calendar day, the document id IS the day key. That shape
 * is the point: a day cannot carry two conflicting declarations, nothing
 * downstream has to de-duplicate them, and `tx.create` versus `tx.set` is a
 * meaningful distinction rather than a guess about which record is newest.
 *
 * WHY THIS IS ADMIN-ONLY AND SERVER-WRITTEN
 * A declared outage day extends every affected tester's window, which is
 * exactly the thing a tester would want to forge to escape a commitment they
 * were about to fail. So there is no client write path at all: security rules
 * refuse every write to `systemHealth`, and this callable re-verifies the
 * caller's admin role against their user document on every invocation. The
 * client cannot name the number of days to credit either - it names a day that
 * was degraded, and the extension is DERIVED from the declarations that exist
 * (see `lib/outages.js`).
 *
 * WHAT A DECLARATION DOES NOT DO
 * It writes nothing to any assignment. No deadline is rewritten, no
 * `creditedOutageDays` is stamped anywhere, no backfill runs. Declaring a day
 * degraded changes what the evaluator COMPUTES, and nothing else - which is
 * why declaring one is safe to do late, twice, or after some commitments have
 * already been evaluated.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const { REGION, SYSTEM_HEALTH_COLLECTION, ACTOR_KIND_ADMIN } = require("./lib/constants");
const { isValidDayKey } = require("./lib/testingDays");
const {
  OUTAGE_SCOPE_GLOBAL,
  OUTAGE_SCOPE_APP,
  isValidOutageScope,
} = require("./lib/outages");
const { requireAuth, requireAdmin, requireDocId, optionalString } = require("./lib/guards");

function systemHealthPath(dayKey) {
  return `${SYSTEM_HEALTH_COLLECTION}/${dayKey}`;
}

/**
 * Read every declaration overlapping a day-key range.
 *
 * The range is on the DOCUMENT ID, because the id is the day key - so this is
 * a key range scan with no index to maintain and no extra field to keep in
 * step with the id. Scope filtering happens in memory afterwards: a window is
 * at most a few dozen days, so the saving from a compound query would not pay
 * for the index or for the second code path.
 *
 * Takes an optional transaction so the forfeiture path can read declarations
 * INSIDE its transaction - which is what makes "an outage was declared while
 * the evaluator was running" resolve correctly instead of racing.
 */
async function readOutageRecords(db, { fromDayKey, toDayKey, tx = null }) {
  if (!isValidDayKey(fromDayKey) || !isValidDayKey(toDayKey)) return [];
  const query = db
    .collection(SYSTEM_HEALTH_COLLECTION)
    .where("__name__", ">=", db.doc(systemHealthPath(fromDayKey)))
    .where("__name__", "<=", db.doc(systemHealthPath(toDayKey)));

  const snap = tx ? await tx.get(query) : await query.get();
  return snap.docs.map((doc) => ({
    // The id is authoritative for the day, not the stored field: they are
    // written together, but only one of them can be the document's identity.
    dayKey: doc.id,
    degraded: doc.get("degraded") === true,
    scope: doc.get("scope"),
    appId: doc.get("appId") || null,
    reason: doc.get("reason") || null,
  }));
}

/**
 * Declare (or clear) a degraded day. Admin-only, idempotent.
 *
 * `set` with merge:false rather than `create`, so correcting a
 * mis-declared day is one call rather than a delete-then-create dance - and
 * so re-running the same declaration is a genuine no-op. Clearing is
 * `degraded: false` rather than a delete: the record of who declared what,
 * and who withdrew it, is worth more than a tidy collection.
 */
async function runDeclareOutage(
  db,
  { dayKey, degraded, reason, scope, appId, adminUid },
) {
  if (!isValidDayKey(dayKey)) {
    throw new HttpsError("invalid-argument", "dayKey must be a valid yyyy-MM-dd date.");
  }
  if (typeof degraded !== "boolean") {
    throw new HttpsError("invalid-argument", "degraded must be true or false.");
  }
  if (!isValidOutageScope(scope)) {
    throw new HttpsError(
      "invalid-argument",
      `scope must be "${OUTAGE_SCOPE_GLOBAL}" or "${OUTAGE_SCOPE_APP}".`,
    );
  }
  // An app-scoped declaration that names no app would protect nobody, and
  // would read as a silent no-op rather than the mistake it is.
  if (scope === OUTAGE_SCOPE_APP && !appId) {
    throw new HttpsError("invalid-argument", "An app-scoped outage must name an appId.");
  }
  if (scope === OUTAGE_SCOPE_GLOBAL && appId) {
    throw new HttpsError(
      "invalid-argument",
      "A global outage must not name an appId - use scope \"app\" for one app.",
    );
  }

  const record = {
    dayKey,
    degraded,
    reason: reason || null,
    scope,
    appId: scope === OUTAGE_SCOPE_APP ? appId : null,
    declaredBy: adminUid,
    declaredByKind: ACTOR_KIND_ADMIN,
    declaredAt: FieldValue.serverTimestamp(),
  };

  await db.doc(systemHealthPath(dayKey)).set(record);

  logger.info(
    `admin ${adminUid} declared ${dayKey} ${degraded ? "DEGRADED" : "healthy"} ` +
      `(scope=${scope}${appId ? ` app=${appId}` : ""})`,
  );

  return { dayKey, degraded, scope, appId: record.appId };
}

async function adminDeclareOutageImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);

  const data = request.data || {};
  const dayKey = requireDocId(data.dayKey, "dayKey");
  const scope = data.scope || OUTAGE_SCOPE_GLOBAL;
  const appId = data.appId ? requireDocId(data.appId, "appId") : null;
  const reason = optionalString(data.reason, "reason", 500);
  const degraded = data.degraded === undefined ? true : data.degraded;

  return runDeclareOutage(db, { dayKey, degraded, reason, scope, appId, adminUid: uid });
}

/**
 * Callable: declare a day degraded. Admin-only.
 *
 * There is deliberately no tester-facing counterpart. A tester who could
 * declare an outage could extend their own deadline, which is the same thing
 * as choosing not to lose their stake.
 */
const adminDeclareOutage = onCall({ region: REGION }, (request) =>
  adminDeclareOutageImpl(getFirestore(), request),
);

module.exports = {
  adminDeclareOutage,
  // Exported for tests and for the evaluator - no Functions runtime required.
  adminDeclareOutageImpl,
  runDeclareOutage,
  readOutageRecords,
  systemHealthPath,
};
