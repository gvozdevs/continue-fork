import { XMarkIcon } from "@heroicons/react/24/outline";
import { FormEvent, KeyboardEvent, useState } from "react";
import { Button } from "../../../components/ui";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  addDangerousCommand,
  removeDangerousCommand,
} from "../../../redux/slices/uiSlice";

export function DangerousCommandsSetting() {
  const dispatch = useAppDispatch();
  const dangerousCommands = useAppSelector(
    (state) => state.ui.dangerousCommands,
  );
  const [draft, setDraft] = useState("");

  const handleAdd = (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value) {
      return;
    }
    const base = value.split(/\s+/)[0] ?? value;
    dispatch(addDangerousCommand(base));
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="border-border flex flex-col gap-2 border-t border-solid px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">Dangerous commands</span>
        <p className="mt-0.5 text-xs text-gray-500">
          Base command names that always require confirmation.{" "}
          <strong className="font-medium">Execute and remember</strong> removes
          the command from this list and adds it to Auto-run commands.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {dangerousCommands.length === 0 && (
          <span className="text-description-muted text-xs italic">
            No dangerous commands configured.
          </span>
        )}
        {dangerousCommands.map((command) => (
          <span
            key={command}
            className="bg-badge text-badge-foreground border-border inline-flex items-center gap-1 rounded-full border border-solid px-2 py-0.5 font-mono text-xs"
          >
            {command}
            <button
              type="button"
              aria-label={`Remove ${command}`}
              className="hover:text-error -mr-0.5 flex items-center rounded-full p-0.5"
              onClick={() => dispatch(removeDangerousCommand(command))}
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
            placeholder="Add command (e.g. sudo, rm)"
            className="text-vsc-foreground w-full border-none bg-inherit px-1.5 py-1 font-mono text-xs outline-none ring-0 focus:border-none focus:outline-none focus:ring-0"
            data-testid="dangerous-command-input"
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!draft.trim()}
          data-testid="dangerous-command-add"
        >
          Add
        </Button>
      </form>
    </div>
  );
}
