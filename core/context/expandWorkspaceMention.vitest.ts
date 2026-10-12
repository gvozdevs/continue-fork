import { afterEach, describe, expect, test } from "vitest";
import FileSystemIde from "../util/filesystem";
import { expandWorkspaceMention } from "./expandWorkspaceMention";
import {
  addToTestDir,
  setUpTestDir,
  tearDownTestDir,
  TEST_DIR,
} from "../test/testDir";

describe("expandWorkspaceMention", () => {
  afterEach(() => {
    tearDownTestDir();
  });

  test("inlines a mentioned file", async () => {
    setUpTestDir();
    addToTestDir([["notes.md", "# Hello\nFR2 is here.\n"]]);
    const ide = new FileSystemIde(TEST_DIR);
    const items = await expandWorkspaceMention(ide, "notes.md");
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain('<file_content path="notes.md">');
    expect(items[0].content).toContain("FR2 is here.");
  });

  test("inlines files in a mentioned folder without using folder names as special cases", async () => {
    setUpTestDir();
    addToTestDir([
      "specs/",
      ["specs/one.yaml", "title: one\n"],
      ["specs/two.md", "# FR2\nbody\n"],
      "specs/nested/",
      ["specs/nested/skip.md", "should not appear unless extra level\n"],
    ]);
    const ide = new FileSystemIde(TEST_DIR);
    const items = await expandWorkspaceMention(ide, "specs");
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain('<folder_content path="specs">');
    expect(items[0].content).toContain("one.yaml");
    expect(items[0].content).toContain("title: one");
    expect(items[0].content).toContain("# FR2");
    expect(items[0].content).not.toContain("should not appear");
  });

  test("expands one extra level when the folder only contains subfolders", async () => {
    setUpTestDir();
    addToTestDir([
      "root/",
      "root/skills/",
      ["root/skills/guide.md", "Skill body here.\n"],
    ]);
    const ide = new FileSystemIde(TEST_DIR);
    const items = await expandWorkspaceMention(ide, "root");
    expect(items[0].content).toContain("Skill body here.");
    expect(items[0].content).toContain('<file_content path="root/skills/guide.md">');
  });

  test("accepts a file URI", async () => {
    setUpTestDir();
    addToTestDir([["a.txt", "alpha"]]);
    const ide = new FileSystemIde(TEST_DIR);
    const items = await expandWorkspaceMention(ide, `${TEST_DIR}/a.txt`);
    expect(items[0].content).toContain("alpha");
  });
});
