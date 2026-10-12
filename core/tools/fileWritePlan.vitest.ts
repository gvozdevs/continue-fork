import { expect, test } from "vitest";
import { ContinueError, ContinueErrorReason } from "../util/errors";
import { prepareMultiEdit } from "./definitions/multiEdit";
import { prepareSingleFind } from "./definitions/singleFindAndReplace";
import { EDIT_ARG_CHAR_LIMIT } from "./fileWritePlan";

function ide(files: Record<string, string>) {
  return {
    async getWorkspaceDirs() {
      return ["file:///workspace"];
    },
    async fileExists(uri: string) {
      return Object.prototype.hasOwnProperty.call(files, uri);
    },
    async readFile(uri: string) {
      return files[uri] ?? "";
    },
    async getCurrentFile() {
      return undefined;
    },
  } as any;
}

test("contents creates a file that does not exist", async () => {
  const prepared = await prepareSingleFind(
    { filepath: "handler.go", contents: "package p\n" },
    ide({}),
  );
  expect(prepared.creating).toBe(true);
  if (!prepared.creating) {
    return;
  }
  expect(prepared.newFileContents).toBe("package p\n");
  expect(prepared.fileUri).toContain("handler.go");
});

test("contents is rejected when the file already exists", async () => {
  const created = await prepareSingleFind(
    { filepath: "handler.go", contents: "package p" },
    ide({}),
  );
  const existing = ide({ [created.fileUri]: "package p" });
  try {
    await prepareSingleFind(
      { filepath: "handler.go", contents: "overwrite" },
      existing,
    );
    throw new Error("expected existing file to reject contents");
  } catch (error) {
    expect(error).toBeInstanceOf(ContinueError);
    expect((error as ContinueError).reason).toBe(
      ContinueErrorReason.FileAlreadyExists,
    );
    expect((error as ContinueError).message).toContain("old_string");
    expect((error as ContinueError).message).toContain(
      "Do not resend this call with contents",
    );
  }
});

test("contents and replacements longer than 6000 characters are rejected before a write", async () => {
  const tooLong = "x".repeat(EDIT_ARG_CHAR_LIMIT + 1);
  try {
    await prepareSingleFind(
      { filepath: "dto.go", contents: tooLong },
      ide({}),
    );
    throw new Error("expected long contents to be rejected");
  } catch (error) {
    expect((error as ContinueError).reason).toBe(
      ContinueErrorReason.InvalidToolArgs,
    );
    expect((error as ContinueError).message).toContain(
      String(EDIT_ARG_CHAR_LIMIT),
    );
    expect((error as ContinueError).message).toContain("smaller tool calls");
  }

  const created = await prepareSingleFind(
    { filepath: "dto.go", contents: "package dto\n" },
    ide({}),
  );
  const existing = ide({ [created.fileUri]: "package dto\n" });
  try {
    await prepareSingleFind(
      {
        filepath: "dto.go",
        replacements: [{ old_string: "package dto", new_string: tooLong }],
      },
      existing,
    );
    throw new Error("expected a long replacement to be rejected");
  } catch (error) {
    expect((error as ContinueError).reason).toBe(
      ContinueErrorReason.InvalidToolArgs,
    );
  }
});

test("replacements edit an existing file and do not create a missing one", async () => {
  const created = await prepareSingleFind(
    { filepath: "handler.go", contents: "package p" },
    ide({}),
  );
  const existing = ide({ [created.fileUri]: "package p" });
  const edited = await prepareSingleFind(
    {
      filepath: "handler.go",
      replacements: [{ old_string: "package p", new_string: "package q" }],
    },
    existing,
  );
  expect(edited.creating).toBe(false);
  if (edited.creating) {
    return;
  }
  expect(edited.newFileContents).toBe("package q");

  try {
    await prepareSingleFind(
      {
        filepath: "missing.go",
        replacements: [{ old_string: "a", new_string: "b" }],
      },
      existing,
    );
    throw new Error("expected missing file to reject replacements");
  } catch (error) {
    expect((error as ContinueError).reason).toBe(
      ContinueErrorReason.FileNotFound,
    );
  }
});

test("multi_edit creates a missing file from contents", async () => {
  const prepared = await prepareMultiEdit(
    { filepath: "dto.go", contents: "package dto\n" },
    ide({}),
  );
  expect(prepared.creating).toBe(true);
  if (!prepared.creating) {
    return;
  }
  expect(prepared.newFileContents).toBe("package dto\n");
});
