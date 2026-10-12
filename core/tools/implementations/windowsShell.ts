export const WINDOWS_UTF8_PREFIX =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; ";

/**
 * Rewrite unquoted `&&` / `||` to `;` so PowerShell 5 accepts the command.
 * Quoted spans are left unchanged.
 */
export function rewriteUnquotedShellOperators(command: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      out += ch;
      if (ch === quote && command[i - 1] !== "`") {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (command.startsWith("&&", i) || command.startsWith("||", i)) {
      out += ";";
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function prepareWindowsPowerShellCommand(command: string): string {
  return WINDOWS_UTF8_PREFIX + rewriteUnquotedShellOperators(command);
}

export function commandsFromArgs(args: Record<string, unknown>): string[] {
  const fromArray = stringList(args.commands);
  const fromSingle =
    typeof args.command === "string" && args.command.trim()
      ? [args.command]
      : typeof args.command === "string"
        ? []
        : stringList(args.command);

  const commands = [...fromArray, ...fromSingle];
  if (commands.length === 0) {
    throw new Error(
      "`command` argument is required and must not be empty or whitespace-only. Pass a command string, or a commands array.",
    );
  }
  return commands;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}
