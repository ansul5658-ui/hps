/**
 * `runSettlementTransaction` (Batch 9G): retries a transaction the emulator
 * killed as "invalid or closed", and nothing else.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CLOSED_TRANSACTION_RETRIES,
  isClosedTransactionError,
  runSettlementTransaction,
} = require("../lib/transactions");

const closed = () => Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed."), { code: 3 });
const noSleep = async () => {};

/** A db whose runTransaction throws `errors` in order, then runs `fn`. */
function flakyDb(errors) {
  const calls = { count: 0 };
  return {
    calls,
    runTransaction: async (fn) => {
      calls.count += 1;
      const err = errors.shift();
      if (err) throw err;
      return fn("tx");
    },
  };
}

test("only the exact closed-transaction error is recognised", () => {
  assert.equal(isClosedTransactionError(closed()), true);
  // Same code, different meaning: never retried.
  assert.equal(isClosedTransactionError(Object.assign(new Error("3 INVALID_ARGUMENT: bad field"), { code: 3 })), false);
  // Same words, different code.
  assert.equal(isClosedTransactionError(Object.assign(new Error("Transaction is invalid or closed."), { code: 10 })), false);
  // Business refusals.
  assert.equal(isClosedTransactionError(Object.assign(new Error("closed short"), { code: "failed-precondition" })), false);
  assert.equal(isClosedTransactionError(null), false);
});

test("a closed transaction is retried and then succeeds", async () => {
  const db = flakyDb([closed(), closed()]);
  const out = await runSettlementTransaction(db, async (tx) => `ran with ${tx}`, { sleep: noSleep });
  assert.equal(out, "ran with tx");
  assert.equal(db.calls.count, 3);
});

test("every other error propagates on the first attempt, unretried", async () => {
  for (const err of [
    Object.assign(new Error("closed short"), { code: "failed-precondition" }),
    Object.assign(new Error("6 ALREADY_EXISTS: entity already exists"), { code: 6 }),
    Object.assign(new Error("3 INVALID_ARGUMENT: bad field"), { code: 3 }),
    new Error("boom"),
  ]) {
    const db = flakyDb([err]);
    await assert.rejects(runSettlementTransaction(db, async () => "never", { sleep: noSleep }), (e) => e === err);
    assert.equal(db.calls.count, 1, err.message);
  }
});

test("the retries are bounded: a transaction closed every time finally fails", async () => {
  const db = flakyDb(Array.from({ length: CLOSED_TRANSACTION_RETRIES + 5 }, closed));
  await assert.rejects(runSettlementTransaction(db, async () => "never", { sleep: noSleep }), /invalid or closed/);
  assert.equal(db.calls.count, CLOSED_TRANSACTION_RETRIES + 1);
});

test("a refusal thrown by the transaction body itself is never retried", async () => {
  let bodies = 0;
  const db = { runTransaction: (fn) => fn("tx") };
  const refusal = Object.assign(new Error("already settled"), { code: "failed-precondition" });
  await assert.rejects(
    runSettlementTransaction(db, async () => {
      bodies += 1;
      throw refusal;
    }, { sleep: noSleep }),
    (e) => e === refusal,
  );
  assert.equal(bodies, 1);
});
