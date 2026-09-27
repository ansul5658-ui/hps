/**
 * The Firestore transport configuration (Batch 9G root cause): streamed reads
 * must never be re-sent by the transport on its own. See lib/firestore.js.
 *
 * These run against the real @google-cloud/firestore client - no emulator,
 * no network: building the GAPIC client is enough to see the settings it
 * will use. The emulator reproduction lives in
 * test-emulator/transport.emulator.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Firestore } = require("@google-cloud/firestore");

const { FIRESTORE_SETTINGS, STREAMED_READ_METHODS, configureFirestore } = require("../lib/firestore");

const ROOT = path.join(__dirname, "..");

/** The GAPIC client a Firestore instance would send its requests through. */
async function gapicClientOf(db) {
  return db._clientPool.run("settings-test", /* requiresGrpc= */ false, async (client) => client);
}

const gapicName = (method) => method.charAt(0).toLowerCase() + method.slice(1);

test("configured: every streamed read uses the code-aware stream path with no transport retry codes", async () => {
  const db = configureFirestore(new Firestore({ projectId: "settings-test" }));
  const client = await gapicClientOf(db);
  for (const method of STREAMED_READ_METHODS) {
    const name = gapicName(method);
    assert.equal(client.descriptors.stream[name].gaxStreamingRetries, true, name);
    assert.deepEqual(client._defaults[name].retry.retryCodes, [], name);
  }
  await db.terminate();
});

test("configured: unary calls keep the SDK's own retry codes (commit and rollback are untouched)", async () => {
  const configured = configureFirestore(new Firestore({ projectId: "settings-test" }));
  const plain = new Firestore({ projectId: "settings-test" });
  const [a, b] = [await gapicClientOf(configured), await gapicClientOf(plain)];
  for (const name of ["commit", "rollback", "beginTransaction"]) {
    assert.deepEqual(a._defaults[name].retry.retryCodes, b._defaults[name].retry.retryCodes, name);
  }
  await configured.terminate();
  await plain.terminate();
});

test("unconfigured (the old behaviour): streamed reads sit on the legacy path that re-sends blindly", async () => {
  // This is the state that produced "Transaction is invalid or closed". If an
  // SDK upgrade ever changes the default, this test says so - and the reason
  // for lib/firestore.js should be re-checked rather than assumed.
  const db = new Firestore({ projectId: "settings-test" });
  const client = await gapicClientOf(db);
  assert.equal(Boolean(client.descriptors.stream.batchGetDocuments.gaxStreamingRetries), false);
  assert.ok(client._defaults.batchGetDocuments.retry.retryCodes.length > 0);
  await db.terminate();
});

test("configureFirestore is idempotent per instance, and refuses an instance already in use", async () => {
  const db = new Firestore({ projectId: "settings-test" });
  assert.equal(configureFirestore(db), db);
  assert.equal(configureFirestore(db), db, "a second call is a no-op, not a throw");

  // Settings freeze on first use or first settings() call; the latter needs
  // no network. An instance someone else already froze keeps its transport,
  // so configuring it must fail loudly rather than pretend.
  const used = new Firestore({ projectId: "settings-test" });
  used.settings({});
  assert.throws(() => configureFirestore(used), /already been initialized/);
  await used.terminate();
  await db.terminate();
});

test("the settings are frozen: no caller can loosen them at runtime", () => {
  assert.ok(Object.isFrozen(FIRESTORE_SETTINGS));
  assert.deepEqual(STREAMED_READ_METHODS, ["BatchGetDocuments", "RunQuery", "RunAggregationQuery"]);
});

test("structural: index.js configures the default Firestore before loading any function module", () => {
  const src = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
  const init = src.indexOf("admin.initializeApp(");
  const configure = src.indexOf("configureFirestore(getFirestore())");
  const firstModule = src.search(/require\("\.\/(?!lib\/)/);
  assert.ok(init >= 0 && configure > init, "configureFirestore(getFirestore()) must follow initializeApp");
  assert.ok(firstModule > configure, "and precede every function module require");
});

test("structural: every emulator test that opens Firestore runs on the production transport", () => {
  const dir = path.join(ROOT, "test-emulator");
  const offenders = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .filter((f) => {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const opens = /getFirestore\(\)|new Firestore\(/.test(src);
      return opens && !/configureFirestore\(/.test(src);
    });
  assert.deepEqual(offenders, []);
});

test("structural: no app-level retry of 'invalid or closed' remains to hide a regression", () => {
  const files = [
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".js")),
    ...fs.readdirSync(path.join(ROOT, "lib")).map((f) => `lib/${f}`),
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/invalid or closed/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${f} matches the closed-transaction message in code`);
    assert.ok(!/runSettlementTransaction/.test(src), `${f} still references runSettlementTransaction`);
  }
});
