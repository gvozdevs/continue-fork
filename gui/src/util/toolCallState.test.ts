import { ToolCallDelta, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import {
  addToolCallDeltaToState,
  extractRememberableBaseCommands,
  extractTerminalBaseCommand,
  getTerminalCommandFromArgs,
  isCommandAutoApproved,
  isCommandDangerous,
  isMcpTool,
  isValidBaseCommandName,
  resolveAutoRunPolicy,
  shouldAutoAcceptApplyDiff,
  shouldSkipToolPermissionPrompt,
} from "./toolCallState";

describe("addToolCallDeltaToState", () => {
  it("should initialize a new tool call state when current state is undefined", () => {
    const delta: ToolCallDelta = {
      id: "call123",
      type: "function",
      function: {
        name: "searchFiles",
        arguments: '{"query":',
      },
    };

    const result = addToolCallDeltaToState(delta, undefined);

    expect(result).toEqual({
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":',
        },
      },
      toolCallId: "call123",
      parsedArgs: {
        query: undefined,
      },
    });
  });

  it("should merge function name deltas correctly", () => {
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "search",
          arguments: '{"query":',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: undefined },
    };

    const delta: ToolCallDelta = {
      function: {
        name: "Files",
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);

    expect(result.toolCall.function.name).toBe("searchFiles");
  });

  it("should handle name streaming in full progressive chunks", () => {
    // Test case where model streams the name progressively but includes full prefix each time
    // e.g. "readFi" -> "readFil" -> "readFile"
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "readFi",
          arguments: "{}",
        },
      },
      toolCallId: "call123",
      parsedArgs: {},
    };

    const delta: ToolCallDelta = {
      function: {
        name: "readFil",
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);
    expect(result.toolCall.function.name).toBe("readFil");

    // Continue the streaming
    const nextDelta: ToolCallDelta = {
      function: {
        name: "readFile",
      },
    };

    const finalResult = addToolCallDeltaToState(nextDelta, result);
    expect(finalResult.toolCall.function.name).toBe("readFile");
  });

  it("should keep original name when receiving duplicate name chunks", () => {
    // Test case where model streams the complete name multiple times
    // e.g. "readFile" -> "readFile" -> "readFile"
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "readFile",
          arguments: "{}",
        },
      },
      toolCallId: "call123",
      parsedArgs: {},
    };

    const delta: ToolCallDelta = {
      function: {
        name: "readFile",
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);
    expect(result.toolCall.function.name).toBe("readFile");
  });

  it("should handle partial name streaming", () => {
    // Test case where model streams the name in parts
    // e.g. "read" -> "File"
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "read",
          arguments: "{}",
        },
      },
      toolCallId: "call123",
      parsedArgs: {},
    };

    const delta: ToolCallDelta = {
      function: {
        name: "File",
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);
    expect(result.toolCall.function.name).toBe("readFile");
  });

  it("should ignore new tool calls with different IDs", () => {
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":"test"}',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: "test" },
    };

    const delta: ToolCallDelta = {
      id: "call456", // Different ID
      type: "function",
      function: {
        name: "readFile",
        arguments: '{"path":"file.txt"}',
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);

    // Should keep the original state and ignore the new call
    expect(result).toBe(currentState);
    expect(result.toolCall.id).toBe("call123");
    expect(result.toolCall.function.name).toBe("searchFiles");
  });

  it("should merge function argument deltas correctly", () => {
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":"java',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: "java" },
    };

    const delta: ToolCallDelta = {
      function: {
        arguments: 'script"}',
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);

    expect(result.toolCall.function.arguments).toBe('{"query":"javascript"}');
    expect(result.parsedArgs).toEqual({ query: "javascript" });
  });

  it("should handle empty deltas gracefully", () => {
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":"test"}',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: "test" },
    };

    const delta: ToolCallDelta = {};

    const result = addToolCallDeltaToState(delta, currentState);

    expect(result).toEqual(currentState);
  });

  it("should handle streaming complex JSON arguments", () => {
    const initialState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "editFile",
          arguments: '{"path":"',
        },
      },
      toolCallId: "call123",
      parsedArgs: { path: undefined },
    };

    // First chunk - add to path
    const delta1: ToolCallDelta = {
      function: {
        arguments: 'src/main.js","changes":{"',
      },
    };

    const state1 = addToolCallDeltaToState(delta1, initialState);
    expect(state1.toolCall.function.arguments).toBe(
      '{"path":"src/main.js","changes":{"',
    );

    // Second chunk - add property name
    const delta2: ToolCallDelta = {
      function: {
        arguments: 'content":"cons',
      },
    };

    const state2 = addToolCallDeltaToState(delta2, state1);
    expect(state2.toolCall.function.arguments).toBe(
      '{"path":"src/main.js","changes":{"content":"cons',
    );
    expect(state2.parsedArgs).toEqual({
      path: "src/main.js",
      changes: { content: "cons" },
    });

    // Third chunk - complete JSON
    const delta3: ToolCallDelta = {
      function: {
        arguments: 't message = \\"Hello\\";"}}',
      },
    };

    const state3 = addToolCallDeltaToState(delta3, state2);
    expect(state3.toolCall.function.arguments).toBe(
      '{"path":"src/main.js","changes":{"content":"const message = \\"Hello\\";"}}',
    );
    expect(state3.parsedArgs).toEqual({
      path: "src/main.js",
      changes: { content: 'const message = "Hello";' },
    });
  });

  it("should handle tool call ids correctly", () => {
    // Test when ID comes from current state
    let currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "existing-id",
        type: "function",
        function: {
          name: "test",
          arguments: "{}",
        },
      },
      toolCallId: "existing-id",
      parsedArgs: {},
    };

    let delta: ToolCallDelta = {
      // No id in delta
      function: {
        name: "Function",
      },
    };

    let result = addToolCallDeltaToState(delta, currentState);
    expect(result.toolCallId).toBe("existing-id");

    // Test when ID comes from delta
    delta = {
      id: "new-id",
      function: {
        name: "test",
      },
    };

    result = addToolCallDeltaToState(delta, undefined);
    expect(result.toolCallId).toBe("new-id");
  });

  it("should handle invalid JSON gracefully", () => {
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: undefined },
    };

    const delta: ToolCallDelta = {
      function: {
        arguments: '"test"',
      },
    };

    const result = addToolCallDeltaToState(delta, currentState);

    expect(result.toolCall.function.arguments).toBe('{"query":"test"');
    // Expect partial parsing still works
    expect(result.parsedArgs).toEqual({ query: "test" });
  });

  it("should handle realistic weather API streaming pattern from OpenAI example", () => {
    // https://platform.openai.com/docs/guides/function-calling?api-mode=chat#streaming
    // Sequence of deltas as seen in the streaming example
    const streamSequence: ToolCallDelta[] = [
      {
        id: "call_DdmO9pD3xa9XTPNJ32zg2hcA",
        type: "function",
        function: {
          name: "get_weather",
          arguments: "",
        },
      },
      {
        function: {
          arguments: '{"',
        },
      },
      {
        function: {
          arguments: "location",
        },
      },
      {
        function: {
          arguments: '":"',
        },
      },
      {
        function: {
          arguments: "Paris",
        },
      },
      {
        function: {
          arguments: ",",
        },
      },
      {
        function: {
          arguments: " France",
        },
      },
      {
        function: {
          arguments: '"}',
        },
      },
    ];

    // Initialize with undefined state
    let currentState: ToolCallState | undefined = undefined;

    // Process each delta in sequence
    for (const delta of streamSequence) {
      currentState = addToolCallDeltaToState(delta, currentState);
    }

    // Check the final state
    expect(currentState).toEqual({
      status: "generating",
      toolCall: {
        id: "call_DdmO9pD3xa9XTPNJ32zg2hcA",
        type: "function",
        function: {
          name: "get_weather",
          arguments: '{"location":"Paris, France"}',
        },
      },
      toolCallId: "call_DdmO9pD3xa9XTPNJ32zg2hcA",
      parsedArgs: {
        location: "Paris, France",
      },
    });

    // Check the intermediate state after each delta to ensure incremental parsing works
    currentState = undefined;

    // First delta - initialize
    currentState = addToolCallDeltaToState(streamSequence[0], currentState);
    expect(currentState.toolCall.function.name).toBe("get_weather");
    expect(currentState.toolCall.function.arguments).toBe("");
    expect(currentState.parsedArgs).toEqual({});

    // Second delta - start JSON
    currentState = addToolCallDeltaToState(streamSequence[1], currentState);
    expect(currentState.toolCall.function.arguments).toBe('{"');
    expect(currentState.parsedArgs).toEqual({});

    // Third delta - add key name
    currentState = addToolCallDeltaToState(streamSequence[2], currentState);
    expect(currentState.toolCall.function.arguments).toBe('{"location');
    expect(currentState.parsedArgs).toEqual({ location: undefined });

    // Fourth delta - add key-value separator
    currentState = addToolCallDeltaToState(streamSequence[3], currentState);
    expect(currentState.toolCall.function.arguments).toBe('{"location":"');
    expect(currentState.parsedArgs).toEqual({ location: "" });

    // Fifth delta - add first part of value
    currentState = addToolCallDeltaToState(streamSequence[4], currentState);
    expect(currentState.toolCall.function.arguments).toBe('{"location":"Paris');
    expect(currentState.parsedArgs).toEqual({ location: "Paris" });

    // Sixth delta - add comma
    currentState = addToolCallDeltaToState(streamSequence[5], currentState);
    expect(currentState.toolCall.function.arguments).toBe(
      '{"location":"Paris,',
    );
    expect(currentState.parsedArgs).toEqual({ location: "Paris," });

    // Seventh delta - add rest of value
    currentState = addToolCallDeltaToState(streamSequence[6], currentState);
    expect(currentState.toolCall.function.arguments).toBe(
      '{"location":"Paris, France',
    );
    expect(currentState.parsedArgs).toEqual({ location: "Paris, France" });

    // Eighth delta - close JSON
    currentState = addToolCallDeltaToState(streamSequence[7], currentState);
    expect(currentState.toolCall.function.arguments).toBe(
      '{"location":"Paris, France"}',
    );
    expect(currentState.parsedArgs).toEqual({ location: "Paris, France" });
  });

  it("should handle when args are complete JSON and new deltas arrive", () => {
    // When args are already a valid JSON object, new deltas should not modify it
    const currentState: ToolCallState = {
      status: "generating",
      toolCall: {
        id: "call123",
        type: "function",
        function: {
          name: "searchFiles",
          arguments: '{"query":"test","limit":10}',
        },
      },
      toolCallId: "call123",
      parsedArgs: { query: "test", limit: 10 },
    };

    const delta: ToolCallDelta = {
      function: {
        arguments: ',"sort":"asc"}',
      },
    };

    // The complete JSON should not be modified
    const result = addToolCallDeltaToState(delta, currentState);
    expect(result.toolCall.function.arguments).toBe(
      '{"query":"test","limit":10}',
    );
    expect(result.parsedArgs).toEqual({ query: "test", limit: 10 });
  });
});

describe("shouldSkipToolPermissionPrompt", () => {
  it("skips prompts for file edit and create tools", () => {
    expect(
      shouldSkipToolPermissionPrompt(BuiltInToolNames.EditExistingFile),
    ).toBe(true);
    expect(
      shouldSkipToolPermissionPrompt(BuiltInToolNames.SingleFindAndReplace),
    ).toBe(true);
    expect(shouldSkipToolPermissionPrompt(BuiltInToolNames.MultiEdit)).toBe(
      true,
    );
    expect(shouldSkipToolPermissionPrompt(BuiltInToolNames.CreateNewFile)).toBe(
      true,
    );
  });

  it("does not skip prompts for terminal or read tools", () => {
    expect(
      shouldSkipToolPermissionPrompt(BuiltInToolNames.RunTerminalCommand),
    ).toBe(false);
    expect(shouldSkipToolPermissionPrompt(BuiltInToolNames.ReadFile)).toBe(
      false,
    );
  });
});

describe("extractTerminalBaseCommand", () => {
  it("takes the first whitespace-separated token", () => {
    expect(extractTerminalBaseCommand("git status")).toBe("git");
    expect(extractTerminalBaseCommand("  ls -la /tmp ")).toBe("ls");
  });

  it("uses the basename for path-qualified commands", () => {
    expect(extractTerminalBaseCommand("/usr/bin/git status")).toBe("git");
  });

  it("returns null for empty input", () => {
    expect(extractTerminalBaseCommand("")).toBeNull();
    expect(extractTerminalBaseCommand(null)).toBeNull();
  });

  it("ignores PowerShell UTF-8 boilerplate and assignments", () => {
    expect(
      extractTerminalBaseCommand(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; git status",
      ),
    ).toBe("git");
    expect(
      extractTerminalBaseCommand("$OutputEncoding = [Console]::OutputEncoding"),
    ).toBeNull();
  });
});

describe("extractRememberableBaseCommands", () => {
  it("skips PowerShell noise and pipeline tails", () => {
    expect(
      extractRememberableBaseCommands(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; git status | Select-Object -First 5",
      ),
    ).toEqual(["git"]);
  });

  it("remembers the first command of each statement", () => {
    expect(
      extractRememberableBaseCommands("pwd; ls -la | Select-Object -First 3"),
    ).toEqual(["pwd", "ls"]);
  });

  it("accepts PowerShell cmdlets as valid names", () => {
    expect(isValidBaseCommandName("get-childitem")).toBe(true);
    expect(isValidBaseCommandName("$outputencoding")).toBe(false);
    expect(isValidBaseCommandName("[console]::outputencoding")).toBe(false);
    expect(extractRememberableBaseCommands("Get-ChildItem docs")).toEqual([
      "get-childitem",
    ]);
  });

  it("does not leak python -c payload into the allowlist", () => {
    expect(
      extractRememberableBaseCommands(
        `python -c "import os; print(os.getcwd()); x=1"`,
      ),
    ).toEqual(["python"]);
    expect(
      extractRememberableBaseCommands(
        `python3 -c 'import sys; print(sys.version)'`,
      ),
    ).toEqual(["python3"]);
    expect(
      extractRememberableBaseCommands(`py -3 -c "print(1); print(2)"`),
    ).toEqual(["py"]);
  });

  it("does not split on semicolons inside quotes for auto-approve", () => {
    expect(
      isCommandAutoApproved(`python -c "import os; print(1)"`, ["python"]),
    ).toBe(true);
    expect(
      isCommandAutoApproved(`python -c "import os; print(1)"`, ["print"]),
    ).toBe(false);
  });
});

describe("getTerminalCommandFromArgs / isCommandAutoApproved", () => {
  it("reads command or joins commands", () => {
    expect(getTerminalCommandFromArgs({ command: "ls -la" })).toBe("ls -la");
    expect(getTerminalCommandFromArgs({ commands: ["pwd", "ls"] })).toBe(
      "pwd; ls",
    );
  });

  it("matches allowlisted base commands case-insensitively", () => {
    expect(isCommandAutoApproved("Git Status", ["git", "ls"])).toBe(true);
    expect(isCommandAutoApproved("curl https://x", ["git"])).toBe(false);
  });

  it("auto-approves find without dangerous flags", () => {
    expect(isCommandAutoApproved("find . -name '*.ts'", ["find", "ls"])).toBe(
      true,
    );
  });

  it("asks for find with -exec / -delete / -ok", () => {
    expect(isCommandAutoApproved("find . -name x -delete", ["find"])).toBe(
      false,
    );
    expect(isCommandAutoApproved("find . -exec rm {} \\;", ["find"])).toBe(
      false,
    );
    expect(isCommandAutoApproved("find . -okdir ls \\;", ["find"])).toBe(false);
  });

  it("requires every chained segment to be allowlisted and safe", () => {
    expect(
      isCommandAutoApproved("find . -name x | head", ["find", "head"]),
    ).toBe(true);
    expect(
      isCommandAutoApproved("find . -name x | curl file://", ["find"]),
    ).toBe(false);
    expect(isCommandAutoApproved("find . -delete && ls", ["find", "ls"])).toBe(
      false,
    );
  });

  it("skips leading env assignments when parsing the base command", () => {
    expect(isCommandAutoApproved("FOO=1 find . -name x", ["find"])).toBe(true);
  });

  it("never auto-approves when the base command is on the dangerous list", () => {
    expect(
      isCommandAutoApproved("curl https://x", ["curl", "ls"], ["curl"]),
    ).toBe(false);
    expect(isCommandDangerous("sudo apt update", ["sudo", "rm"])).toBe(true);
    expect(isCommandDangerous("ls -la", ["sudo", "rm"])).toBe(false);
  });
});

describe("resolveAutoRunPolicy", () => {
  const baseAutoRun = {
    autoRunCommands: ["ls", "git"],
    dangerousCommands: ["curl", "sudo", "rm"],
    autoRunMcpTools: false,
  };
  const mcpTool = { uri: "mcp://server/tool" };

  it("auto-runs when the base command is on the allowlist", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "allowedWithoutPermission",
        "allowedWithPermission",
        baseAutoRun,
        "git status",
      ),
    ).toBe("allowedWithoutPermission");
  });

  it("asks when the base command is not on the allowlist", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "allowedWithoutPermission",
        "allowedWithoutPermission",
        baseAutoRun,
        "go test",
      ),
    ).toBe("allowedWithPermission");
  });

  it("always asks for dangerous commands even if also allowlisted", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "allowedWithoutPermission",
        "allowedWithoutPermission",
        {
          ...baseAutoRun,
          autoRunCommands: ["curl", "ls"],
          dangerousCommands: ["curl"],
        },
        "curl https://example.com",
      ),
    ).toBe("allowedWithPermission");
  });

  it("asks even when security marked the command disabled", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "allowedWithoutPermission",
        "disabled",
        baseAutoRun,
        "sudo apt update",
      ),
    ).toBe("allowedWithPermission");
  });

  it("auto-runs after a command is moved from dangerous to allowlist", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "allowedWithoutPermission",
        "disabled",
        {
          ...baseAutoRun,
          autoRunCommands: ["sudo"],
          dangerousCommands: ["curl", "rm"],
        },
        "sudo apt update",
      ),
    ).toBe("allowedWithoutPermission");
  });

  it("does not auto-run when the terminal tool itself is disabled", () => {
    expect(
      resolveAutoRunPolicy(
        BuiltInToolNames.RunTerminalCommand,
        undefined,
        "disabled",
        "disabled",
        {
          autoRunCommands: ["ls", "sudo"],
          dangerousCommands: [],
          autoRunMcpTools: true,
        },
        "ls",
      ),
    ).toBe("disabled");
  });

  it("auto-runs MCP tools when the MCP toggle is on", () => {
    expect(
      resolveAutoRunPolicy(
        "github_create_issue",
        mcpTool,
        "allowedWithPermission",
        "allowedWithPermission",
        { ...baseAutoRun, autoRunMcpTools: true },
      ),
    ).toBe("allowedWithoutPermission");
  });

  it("asks before running MCP tools when the MCP toggle is off", () => {
    expect(
      resolveAutoRunPolicy(
        "github_create_issue",
        mcpTool,
        "allowedWithPermission",
        "allowedWithPermission",
        baseAutoRun,
      ),
    ).toBe("allowedWithPermission");
  });

  it("does not auto-run a disabled MCP tool", () => {
    expect(
      resolveAutoRunPolicy(
        "github_create_issue",
        mcpTool,
        "disabled",
        "disabled",
        { ...baseAutoRun, autoRunMcpTools: true },
      ),
    ).toBe("disabled");
  });
});

describe("isMcpTool", () => {
  it("detects MCP tool URIs", () => {
    expect(isMcpTool({ uri: "mcp://server/tool" })).toBe(true);
    expect(isMcpTool({ uri: "https://example.com" })).toBe(false);
    expect(isMcpTool(undefined)).toBe(false);
  });
});

describe("shouldAutoAcceptApplyDiff", () => {
  it("auto-accepts edit tool diffs even when stored policy is ask first", () => {
    expect(
      shouldAutoAcceptApplyDiff(
        BuiltInToolNames.EditExistingFile,
        "allowedWithPermission",
      ),
    ).toBe(true);
  });

  it("does not auto-accept disabled tools", () => {
    expect(
      shouldAutoAcceptApplyDiff(BuiltInToolNames.EditExistingFile, "disabled"),
    ).toBe(false);
  });

  it("auto-accepts non-edit tools when policy is automatic", () => {
    expect(
      shouldAutoAcceptApplyDiff(
        BuiltInToolNames.CreateNewFile,
        undefined,
        "allowedWithoutPermission",
      ),
    ).toBe(true);
  });

  it("does not auto-accept non-edit tools that still ask first", () => {
    expect(
      shouldAutoAcceptApplyDiff(
        BuiltInToolNames.RunTerminalCommand,
        "allowedWithPermission",
      ),
    ).toBe(false);
  });
});
