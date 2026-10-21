import { test } from "node:test";
import assert from "node:assert/strict";
import { Operations } from "../../apps/pwa/operations.ts";
test("blocks disconnected writes before invoking the SDK", async () => {
  const state = new Operations(); let calls = 0;
  await assert.rejects(state.run(async () => { calls++; }), /confirmed connection/);
  assert.equal(calls, 0);
});
test("keeps a dropped in-flight write pending and refuses activation until acknowledgment", async () => {
  const state = new Operations(); state.connection(true);
  let acknowledge;
  const promise = state.run(() => new Promise((resolve) => { acknowledge = resolve; }));
  state.connection(false);
  assert.equal(state.getSnapshot().pending, 1);
  assert.equal(state.freeze(), false);
  acknowledge("server confirmed");
  assert.equal(await promise, "server confirmed");
  assert.equal(state.getSnapshot().pending, 0);
});
test("uncertain outcomes block restart until explicitly reconciled", async () => {
  const state = new Operations(); state.connection(true);
  await assert.rejects(state.run(async () => { throw Object.assign(new Error("lost response"), { code: "functions/unavailable" }); }));
  assert.equal(state.getSnapshot().uncertain, true);
  assert.equal(state.freeze(), false);
  state.connection(true); state.reconcile();
  assert.equal(state.freeze(), true);
  await assert.rejects(state.run(async () => 1), /confirmed connection/);
  state.resume(); assert.equal(await state.run(async () => 2), 2);
});
test("server rejection is an error, never a saved result or an unknown outcome", async () => {
  const state = new Operations(); state.connection(true);
  await assert.rejects(state.run(async () => { throw { code: "permission-denied" }; }));
  assert.equal(state.getSnapshot().pending, 0);
  assert.equal(state.getSnapshot().uncertain, false);
});
