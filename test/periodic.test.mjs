import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, notePath, normaliseFolder, DEFAULT_FORMATS } from "../dist-test/periodic.js";

test("falls back to sane defaults with no settings at all", () => {
  const c = resolveConfig("day", {});
  assert.equal(c.format, "YYYY-MM-DD");
  assert.equal(c.folder, "");
  assert.equal(c.enabled, true, "daily notes work out of the box");
});

test("non-day granularities are opt-in, not silently enabled", () => {
  for (const g of ["week", "month", "year"]) {
    assert.equal(resolveConfig(g, {}).enabled, false,
      `${g} must not be enabled without configuration`);
  }
});

test("core Daily Notes settings are honoured", () => {
  const c = resolveConfig("day", { dailyNotes: { format: "DD-MM-YYYY", folder: "Journal/Daily" } });
  assert.equal(c.format, "DD-MM-YYYY");
  assert.equal(c.folder, "Journal/Daily");
});

test("Periodic Notes plugin wins over core Daily Notes", () => {
  const c = resolveConfig("day", {
    dailyNotes: { format: "DD-MM-YYYY", folder: "Old" },
    periodicNotes: { day: { enabled: true, format: "YYYY.MM.DD", folder: "New" } },
  });
  assert.equal(c.format, "YYYY.MM.DD");
  assert.equal(c.folder, "New");
});

test("a disabled Periodic Notes entry does not override core", () => {
  const c = resolveConfig("day", {
    dailyNotes: { format: "DD-MM-YYYY", folder: "Old" },
    periodicNotes: { day: { enabled: false, format: "IGNORED", folder: "Nope" } },
  });
  assert.equal(c.format, "DD-MM-YYYY");
  assert.equal(c.folder, "Old");
});

test("empty and whitespace settings fall back rather than producing junk paths", () => {
  const c = resolveConfig("day", { dailyNotes: { format: "   ", folder: "   " } });
  assert.equal(c.format, "YYYY-MM-DD");
  assert.equal(c.folder, "");
});

test("folder normalisation handles the slash cases users actually type", () => {
  assert.equal(normaliseFolder("/Journal/"), "Journal");
  assert.equal(normaliseFolder("Journal//Daily"), "Journal/Daily");
  const BS = String.fromCharCode(92);
  assert.equal(normaliseFolder("Journal" + BS + "Daily"), "Journal/Daily", "Windows separators");
  assert.equal(normaliseFolder(undefined), "");
  assert.equal(normaliseFolder("  /a/b/  "), "a/b");
});

test("notePath assembles correctly, including vault root", () => {
  assert.equal(notePath("Journal", "2026-09-20"), "Journal/2026-09-20.md");
  assert.equal(notePath("", "2026-09-20"), "2026-09-20.md", "root of vault");
  assert.equal(notePath("/Journal/", "2026-09-20"), "Journal/2026-09-20.md");
});

test("notePath does not produce a double slash when the format has nested folders", () => {
  assert.equal(notePath("Journal", "2026/09/2026-09-20"), "Journal/2026/09/2026-09-20.md");
  assert.equal(notePath("", "/2026-09-20"), "2026-09-20.md");
});

test("default formats are the documented Obsidian ones", () => {
  assert.equal(DEFAULT_FORMATS.day, "YYYY-MM-DD");
  assert.equal(DEFAULT_FORMATS.week, "gggg-[W]ww");
  assert.equal(DEFAULT_FORMATS.month, "YYYY-MM");
  assert.equal(DEFAULT_FORMATS.year, "YYYY");
});
