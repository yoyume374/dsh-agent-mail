import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  EDITABLE,
  applyOverrides,
  describeSettings,
  mergePatch,
  readOverrides,
  settingsFile,
  writeOverrides,
} from "../lib/settings.js";

const baseConfig = {
  dataDir: "",
  ratePerMinute: 6,
  ratePerSessionMinute: 20,
  maxDepth: 5,
  maxMailbox: 500,
  promptPreview: 5,
  bodyLimit: 8000,
  wakeOnSend: true,
  wakeOffline: true,
};

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "agent-mail-settings-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("mergePatch validates keys, types and ranges", () => {
  assert.deepEqual(mergePatch({}, { wakeOnSend: false }).overrides, { wakeOnSend: false });
  assert.deepEqual(mergePatch({}, { maxDepth: "3" }).overrides, { maxDepth: 3 });
  assert.throws(() => mergePatch({}, { nope: 1 }), /未知设置项 nope/);
  // 0.3.5 removed the hourly wake cap; a stale key must be rejected, not silently kept.
  assert.throws(() => mergePatch({}, { wakePerHour: 6 }), /未知设置项 wakePerHour/);
  assert.throws(() => mergePatch({}, { maxDepth: 999 }), /超出范围 0\.\.50/);
  assert.throws(() => mergePatch({}, { wakeOnSend: "maybe" }), /需要 true \/ false/);
  assert.throws(() => mergePatch({}, {}), /没有要保存的改动/);
});

test("null clears an override and falls back to the config value", () => {
  const patch = mergePatch({ maxDepth: 9 }, { maxDepth: null });
  assert.deepEqual(patch.overrides, {});
  assert.deepEqual(patch.changed, ["maxDepth"]);
  assert.equal(applyOverrides(baseConfig, patch.overrides).maxDepth, 5);
});

test("overrides round-trip through settings.json", () => {
  const dir = tempDir();
  assert.deepEqual(readOverrides(dir), {});
  const file = writeOverrides(dir, { wakeOnSend: false, maxDepth: 3 });
  assert.equal(file, settingsFile(dir));
  assert.deepEqual(readOverrides(dir), { wakeOnSend: false, maxDepth: 3 });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { wakeOnSend: false, maxDepth: 3 });
});

test("readOverrides ignores corrupt files and invalid values", () => {
  const dir = tempDir();
  const file = settingsFile(dir);
  writeFileSync(file, JSON.stringify({ maxMailbox: 900, wakePerHour: 999, ratePerMinute: 4, bogus: 1 }), "utf8");
  assert.deepEqual(readOverrides(dir), { maxMailbox: 900, ratePerMinute: 4 });
  writeFileSync(file, "{ not json", "utf8");
  assert.deepEqual(readOverrides(dir), {});
});

test("describeSettings marks overridden rows and summarizes waking", () => {
  const description = describeSettings(baseConfig, { wakeOnSend: false });
  const byKey = Object.fromEntries(description.rows.map((row) => [row.key, row]));
  assert.equal(byKey.wakeOnSend.value, false);
  assert.equal(byKey.wakeOnSend.configured, true);
  assert.equal(byKey.wakeOnSend.overridden, true);
  assert.equal(byKey.maxDepth.overridden, false);
  assert.equal(byKey.wakePerHour, undefined);
  assert.equal(description.wakeSummary, "当前：只投递，不自动唤醒");
  assert.equal(describeSettings(baseConfig, {}).wakeSummary, "当前：自动唤醒收件方（离线会话也会先加载）");
  assert.equal(
    describeSettings(baseConfig, { wakeOffline: false }).wakeSummary,
    "当前：在线会话自动唤醒，离线会话只投递",
  );
  assert.equal(Object.keys(EDITABLE).length, description.rows.length);
});
