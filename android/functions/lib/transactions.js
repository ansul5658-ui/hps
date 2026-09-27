/**
 * Retrying a settlement transaction the SDK gave up on (Batch 9G).
 *
 * THE FAILURE
 * Under lock contention the Firestore emulator can kill a losing transaction
 * and answer its next RPC - a point read, a query or the commit - with
 * `3 INVALID_ARGUMENT: Transaction is invalid or closed`. The Admin SDK retries
 * ABORTED (how contention is normally reported) but treats INVALID_ARGUMENT as
 * final, apart from "transaction has expired". So a settlement that merely
 * lost a race surfaced as a hard error, and the expiry sweep logged "could not
 * settle" for a commitment it would have settled, or correctly skipped, on a
 * retry. Removing query reads from the transactions made this rarer; it did not
 * make it impossible - point reads hit it too.
 *
 * WHY RETRYING IS SAFE FOR MONEY
 * A transaction that failed with this error did not commit: the error means
 * its id was already dead. And every settlement is idempotent regardless - a
 * deterministic ledger id written with `tx.create`, plus a terminal status the
 * next attempt re-reads - so a retry can only settle once or refuse. This is
 * the SDK's own retry, extended to one more spelling of "you lost a race".
 *
 * Narrow on purpose: only that exact code and message, a bounded number of
 * attempts, and only around the settlement primitives.
 */

const CLOSED_TRANSACTION = /Transaction is invalid or closed/;

/** Extra whole-transaction attempts after the first, on a closed transaction only. */
const CLOSED_TRANSACTION_RETRIES = 5;

/** Is this the emulator's "your transaction was killed" answer - and nothing else? */
function isClosedTransactionError(err) {
  return Boolean(err) && err.code === 3 && CLOSED_TRANSACTION.test(String(err.message));
}

/**
 * `db.runTransaction(fn)`, retried when - and only when - the transaction was
 * killed as closed. Each retry waits a little longer, with jitter, so the
 * transaction that won the race can commit first. Every other error, including
 * every business refusal, propagates on the first attempt exactly as before.
 */
async function runSettlementTransaction(db, fn, { retries = CLOSED_TRANSACTION_RETRIES, sleep = defaultSleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.runTransaction(fn);
    } catch (err) {
      if (!isClosedTransactionError(err) || attempt >= retries) throw err;
      await sleep(25 * (attempt + 1) + Math.floor(Math.random() * 25));
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  CLOSED_TRANSACTION_RETRIES,
  isClosedTransactionError,
  runSettlementTransaction,
};
