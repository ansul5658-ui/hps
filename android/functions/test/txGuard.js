/**
 * Structural guard for the test fakes (Batch 9G): no QUERY read while a
 * transaction callback is running.
 *
 * Under contention the emulator kills a transaction mid-query with
 * "Transaction is invalid or closed" (INVALID_ARGUMENT), which the SDK does not
 * retry. Settlement transactions therefore read by document id only. This
 * wrapper makes a regression fail loudly and deterministically, whichever way
 * it creeps back in:
 *   * `tx.get(query)` or `tx.get(query.count())` - a transactional query;
 *   * `query.get()` called while a callback is running - a plain query issued
 *     from inside the transaction, including one buried in a helper.
 * Queries before or after the transaction (locating ids, sweeps choosing
 * candidates) stay allowed.
 *
 * Works on any fake whose queries come from `db.collection(...)` and whose
 * transactional queries/counts carry `__query`/`__count` markers.
 *
 * `afterRead(path, { attempt, store })`, when given, runs right after each
 * transactional point read resolves - the moment a concurrent writer committing
 * would leave this transaction holding a stale snapshot.
 */
const { AsyncLocalStorage } = require("node:async_hooks");

function forbidQueriesInTransactions(db, { afterRead } = {}) {
  // "Inside a transaction" is tracked per async flow, not globally: a query
  // that one operation issues BEFORE its own transaction must not be blamed
  // because another operation's transaction happens to be running at the time.
  const insideTx = new AsyncLocalStorage();
  let attempt = 0;
  const violations = [];

  function violation(what) {
    const message = `query read inside a transaction: ${what}`;
    violations.push(message);
    throw new Error(message);
  }

  function wrapQuery(query, label) {
    if (!query || typeof query !== "object") return query;
    return new Proxy(query, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== "function") return value;
        if (prop === "get") {
          return (...args) => {
            if (insideTx.getStore()) return Promise.reject(safeViolation(`${label}.get()`));
            return value.apply(target, args);
          };
        }
        // Builders return new queries; keep wrapping so a helper cannot shed
        // the guard by adding a filter.
        return (...args) => wrapQuery(value.apply(target, args), label);
      },
    });
  }

  function safeViolation(what) {
    try {
      violation(what);
    } catch (err) {
      return err;
    }
    return new Error(what);
  }

  const collection = db.collection.bind(db);
  db.collection = (name) => wrapQuery(collection(name), `collection(${name})`);

  const run = db.runTransaction.bind(db);
  db.runTransaction = (fn, ...rest) =>
    run((tx) => {
      attempt += 1;
      const thisAttempt = attempt;
      return insideTx.run(true, () =>
        fn({
          ...tx,
          get: async (target) => {
            if (target && (target.__query || target.__count)) {
              violation(target.__count ? "tx.get(query.count())" : "tx.get(query)");
            }
            const snap = await tx.get(target);
            if (afterRead && target && target.path) {
              afterRead(target.path, { attempt: thisAttempt, store: db.__store });
            }
            return snap;
          },
        }),
      );
    }, ...rest);

  db.__queryViolations = violations;
  return db;
}

module.exports = { forbidQueriesInTransactions };
