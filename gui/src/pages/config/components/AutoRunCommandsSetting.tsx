import { XMarkIcon } from "@heroicons/react/24/outline";
import { FormEvent, KeyboardEvent, useState } from "react";
import { Button } from "../../../components/ui";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  addAutoRunCommand,
  removeAutoRunCommand,
} from "../../../redux/slices/uiSlice";

export function AutoRunCommandsSetting() {
  const dispatch = useAppDispatch();
  const autoRunCommands = useAppSelector((state) => state.ui.autoRunCommands);
  const [draft, setDraft] = useState("");

  const handleAdd = (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value) {
      return;
    }
    // Only store the base command name (before first space).
    const base = value.split(/\s+/)[0] ?? value;
    dispatch(addAutoRunCommand(base));
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">Auto-run commands</span>
        <p className="mt-0.5 text-xs text-gray-500">
          Base command names that run without confirmation for{" "}
          <code className="text-xs">run_terminal_command</code> (matched as the
          first word, e.g. <code className="text-xs">git</code> for{" "}
          <code className="text-xs">git status</code>).{" "}
          <code className="text-xs">find</code> still asks if it uses{" "}
          <code className="text-xs">-exec</code> /{" "}
          <code className="text-xs">-delete</code>. Commands on the Dangerous
          list always ask first.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {autoRunCommands.length === 0 && (
          <span className="text-description-muted text-xs italic">
            No commands yet — every terminal call will ask for confirmation.
          </span>
        )}
        {autoRunCommands.map((command) => (
          <span
            key={command}
            className="bg-badge text-badge-foreground border-border inline-flex items-center gap-1 rounded-full border border-solid px-2 py-0.5 font-mono text-xs"
          >
            {command}
            <button
              type="button"
              aria-label={`Remove ${command}`}
              className="hover:text-error -mr-0.5 flex items-center rounded-full p-0.5"
              onClick={() => dispatch(removeAutoRunCommand(command))}
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <div className="border-command-border bg-vsc-input-background focus-within:border-border-focus focus-within:ring-border-focus flex flex-1 overflow-hidden rounded-md border border-solid focus-within:ring-1">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add command (e.g. ls, curl)"
            className="text-vsc-foreground w-full border-none bg-inherit px-1.5 py-1 font-mono text-xs outline-none ring-0 focus:border-none focus:outline-none focus:ring-0"
            data-testid="auto-run-command-input"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!draft.trim()}
          data-testid="auto-run-command-add"
        >
          Add
        </Button>
      </form>
    </div>
  );
}
