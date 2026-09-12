import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("build-only CI declares read-only token permissions for both jobs", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const permissions = workflow.match(/^permissions:[ \t]*\r?\n((?:[ \t]+[^\r\n]*\r?\n)+)/m)?.[1];
  assert.ok(permissions, "CI must explicitly declare workflow-level token permissions");
  assert.deepEqual(permissions.trim().split(/\r?\n/).map((line) => line.trim()), ["contents: read"]);
  assert.equal([...workflow.matchAll(/^[ \t]*permissions:/gm)].length, 1, "both jobs inherit the read-only policy without overrides");
});
