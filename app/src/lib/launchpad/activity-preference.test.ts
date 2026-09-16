import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Preference = typeof import("./activity-preference");
type StorageEventLike = { key: string | null; newValue: string | null; storageArea: unknown };
const source = readFileSync(new URL("./activity-preference.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

/** Each VM is a fresh page/module; the map represents persisted browser storage. */
function page(values = new Map<string, string>(), server = false) {
  let blockedRead = false;
  let blockedWrite = false;
  const events = new Set<(event: StorageEventLike) => void>();
  const hooks: unknown[][] = [];
  const storage = {
    getItem(key: string) { if (blockedRead) throw new Error("Storage denied"); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blockedWrite) throw new Error("Quota exceeded"); values.set(key, value); },
  };
  const exports = {} as Preference;
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      assert.equal(name, "react");
      return { useSyncExternalStore: (...args: [unknown, () => boolean, () => boolean]) => { hooks.push(args); return server ? args[2]() : args[1](); } };
    },
    ...(!server ? { window: {
      localStorage: storage,
      addEventListener: (name: string, fn: (event: StorageEventLike) => void) => { assert.equal(name, "storage"); events.add(fn); },
      removeEventListener: (name: string, fn: (event: StorageEventLike) => void) => { assert.equal(name, "storage"); events.delete(fn); },
    } } : {}),
  });
  return {
    api: exports, values, storage, events, hooks,
    blockRead: () => { blockedRead = true; },
    blockWrite: () => { blockedWrite = true; },
    external: (key: string | null, value: string | null, storageArea: unknown = storage) => {
      if (storageArea === storage) {
        if (key === null) values.clear();
        else if (value === null) values.delete(key);
        else values.set(key, value);
      }
      events.forEach((fn) => fn({ key, newValue: value, storageArea }));
    },
  };
}

test("activity is on by default, persists explicit choices, and only an explicit off turns it off", () => {
  const p = page();
  const key = p.api.ACTIVITY_NOTIFICATIONS_KEY;
  assert.equal(p.api.getActivityNotifications(), true);
  p.api.setActivityNotifications(false);
  assert.equal(p.values.get(key), "0");
  assert.equal(page(p.values).api.getActivityNotifications(), false);
  p.api.setActivityNotifications(true);
  assert.equal(p.values.get(key), "1");
  assert.equal(page(p.values).api.getActivityNotifications(), true);
  p.values.set(key, "true");
  assert.equal(p.api.getActivityNotifications(), true, "an unknown stored value falls back to the default");
});

test("SSR and hydration use the default (on) snapshot even when this browser turned it off", () => {
  const p = page();
  p.api.setActivityNotifications(false);
  assert.equal(p.api.useActivityNotifications(), false);
  const [subscribe, snapshot, serverSnapshot] = p.hooks[0];
  assert.equal(subscribe, p.api.subscribeActivityNotifications);
  assert.equal(snapshot, p.api.getActivityNotifications);
  assert.equal((serverSnapshot as () => boolean)(), true);
  const ssr = page(p.values, true);
  assert.equal(ssr.api.useActivityNotifications(), true);
  ssr.api.setActivityNotifications(false);
  assert.equal(ssr.api.getActivityNotifications(), true);
  assert.doesNotThrow(() => ssr.api.subscribeActivityNotifications(() => {})());
});

test("denied writes keep an in-memory choice even if old storage remains readable", () => {
  const p = page();
  p.api.setActivityNotifications(false);
  p.blockWrite();
  let notified = 0;
  const unsubscribe = p.api.subscribeActivityNotifications(() => notified++);
  p.api.setActivityNotifications(true);
  assert.equal(p.api.getActivityNotifications(), true);
  assert.equal(p.values.get(p.api.ACTIVITY_NOTIFICATIONS_KEY), "0");
  assert.equal(notified, 1);
  p.api.setActivityNotifications(false);
  assert.equal(p.api.getActivityNotifications(), false);
  assert.equal(notified, 2);
  unsubscribe();
});

test("denied reads fall back quietly and explicit changes still update the current page", () => {
  const p = page();
  p.blockRead();
  p.blockWrite();
  assert.equal(p.api.getActivityNotifications(), true);
  p.api.setActivityNotifications(false);
  assert.equal(p.api.getActivityNotifications(), false);
});

test("cross-tab updates and clears synchronize through one shared listener, with cleanup", () => {
  const p = page();
  const seen: boolean[] = [];
  const offOne = p.api.subscribeActivityNotifications(() => seen.push(p.api.getActivityNotifications()));
  const offTwo = p.api.subscribeActivityNotifications(() => {});
  assert.equal(p.events.size, 1);
  const key = p.api.ACTIVITY_NOTIFICATIONS_KEY;
  p.external(key, "0");
  p.external("unrelated", "0");
  p.external(key, "1", {}); // sessionStorage or another storage area is not this preference.
  assert.deepEqual(seen, [false]);
  p.external(key, "1");
  p.external(key, "0");
  p.external(null, null); // storage cleared: back to the default
  assert.deepEqual(seen, [false, true, false, true]);
  offOne();
  assert.equal(p.events.size, 1);
  offTwo();
  assert.equal(p.events.size, 0);
});

test("a first visit reads on without writing storage, and a saved off survives reloads until turned back on", () => {
  const first = page();
  assert.equal(first.api.getActivityNotifications(), true);
  assert.equal(first.api.useActivityNotifications(), true, "the settings switch shows On for a new visitor");
  assert.equal(first.values.size, 0, "reading the default must not persist a choice the visitor never made");

  first.api.setActivityNotifications(false);
  for (let reload = 0; reload < 3; reload++) assert.equal(page(first.values).api.getActivityNotifications(), false);
  const back = page(first.values);
  back.api.setActivityNotifications(true);
  assert.equal(page(first.values).api.getActivityNotifications(), true);
});

test("another tab removing the saved choice restores the default (on)", () => {
  const values = new Map([["ol:activity-notifications", "0"]]);
  const p = page(values);
  assert.equal(p.api.getActivityNotifications(), false);
  const seen: boolean[] = [];
  const off = p.api.subscribeActivityNotifications(() => seen.push(p.api.getActivityNotifications()));
  p.external(p.api.ACTIVITY_NOTIFICATIONS_KEY, null);
  assert.deepEqual(seen, [true]);
  assert.equal(p.api.getActivityNotifications(), true);
  off();
});

test("only the exact stored value \"0\" mutes activity", () => {
  for (const [stored, expected] of [["0", false], ["1", true], ["", true], ["false", true], ["off", true], [" 0", true]] as const) {
    assert.equal(page(new Map([["ol:activity-notifications", stored]])).api.getActivityNotifications(), expected, JSON.stringify(stored));
  }
});

test("activityPreferenceSaved reports whether the last choice reached storage", () => {
  const p = page();
  assert.equal(p.api.activityPreferenceSaved(), true);
  p.api.setActivityNotifications(false);
  assert.equal(p.api.activityPreferenceSaved(), true);
  p.blockWrite();
  p.api.setActivityNotifications(true);
  assert.equal(p.api.activityPreferenceSaved(), false, "a refused write lasts for this page only");

  const unreadable = page();
  unreadable.blockRead();
  unreadable.api.getActivityNotifications();
  assert.equal(unreadable.api.activityPreferenceSaved(), false);
});
