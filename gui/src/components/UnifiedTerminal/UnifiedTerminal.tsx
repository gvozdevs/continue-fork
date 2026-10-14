import { ChevronDownIcon } from "@heroicons/react/24/outline";
import Anser, { AnserJsonEntry } from "anser";
import { ToolCallState } from "core";
import { escapeCarriageReturn } from "escape-carriage";
import { useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { useAppDispatch } from "../../redux/hooks";
import { moveTerminalProcessToBackground } from "../../redux/thunks/moveTerminalProcessToBackground";
import { getFontSize } from "../../util";
import { CopyButton } from "../StyledMarkdownPreview/StepContainerPreToolbar/CopyButton";
import { RunInTerminalButton } from "../StyledMarkdownPreview/StepContainerPreToolbar/RunInTerminalButton";

const blinkCursor = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;

const BlinkingCursor = styled.span`
  &::after {
    content: "█";
    animation: ${blinkCursor} 1s infinite;
    color: var(--foreground);
  }
`;

const AnsiSpan = styled.span<{
  bg?: string;
  fg?: string;
  decoration?: string;
}>`
  ${({ bg }) => bg && `background-color: rgb(${bg});`}
  ${({ fg }) => fg && `color: rgb(${fg});`}
  ${({ decoration }) => {
    switch (decoration) {
      case "bold":
        return "font-weight: bold;";
      case "dim":
        return "opacity: 0.5;";
      case "italic":
        return "font-style: italic;";
      case "hidden":
        return "visibility: hidden;";
      case "strikethrough":
        return "text-decoration: line-through;";
      case "underline":
        return "text-decoration: underline;";
      case "blink":
        return "text-decoration: blink;";
      default:
        return "";
    }
  }}
`;

const AnsiLink = styled.a`
  color: var(--link);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const StyledTerminalContainer = styled.div<{
  fontSize?: number;
}>`
  background-color: var(--background);
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "Helvetica Neue",
    Arial,
    "Noto Sans",
    sans-serif;
  font-size: ${(props) => props.fontSize || getFontSize()}px;
  color: var(--foreground);
  line-height: 1.5;

  > *:last-child {
    margin-bottom: 0;
  }
`;

const TerminalContent = styled.div`
  pre {
    white-space: pre-wrap;
    max-width: calc(100vw - 24px);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0;
    margin: 0;
    background: transparent;
  }

  code {
    span.line:empty {
      display: none;
    }
    word-wrap: break-word;
    background: transparent;
    font-size: ${getFontSize() - 2}px;
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono",
      Menlo, monospace;
  }
`;

function ansiToJSON(
  input: string,
  use_classes: boolean = false,
): AnserJsonEntry[] {
  input = escapeCarriageReturn(fixBackspace(input));
  return Anser.ansiToJson(input, {
    json: true,
    remove_empty: true,
    use_classes,
  });
}

function createClass(bundle: AnserJsonEntry): string | null {
  let classNames: string = "";

  if (bundle.bg) {
    classNames += `${bundle.bg}-bg `;
  }
  if (bundle.fg) {
    classNames += `${bundle.fg}-fg `;
  }
  if (bundle.decoration) {
    classNames += `ansi-${bundle.decoration} `;
  }

  if (classNames === "") {
    return null;
  }

  classNames = classNames.substring(0, classNames.length - 1);
  return classNames;
}

function convertBundleIntoReact(
  linkify: boolean,
  useClasses: boolean,
  bundle: AnserJsonEntry,
  key: number,
): JSX.Element {
  const className = useClasses ? createClass(bundle) : null;
  const decorationProp = bundle.decoration
    ? String(bundle.decoration)
    : undefined;

  if (!linkify) {
    return (
      <AnsiSpan
        key={key}
        className={className || undefined}
        bg={useClasses ? undefined : bundle.bg}
        fg={useClasses ? undefined : bundle.fg}
        decoration={decorationProp}
      >
        {bundle.content}
      </AnsiSpan>
    );
  }

  const content: React.ReactNode[] = [];
  const linkRegex = /(\s|^)(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]{2,})/g;

  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(bundle.content)) !== null) {
    const [, pre, url] = match;

    const startIndex = match.index + pre.length;
    if (startIndex > index) {
      content.push(bundle.content.substring(index, startIndex));
    }

    const href = url.startsWith("www.") ? `http://${url}` : url;

    content.push(
      <AnsiLink key={index} href={href} target="_blank">
        {url}
      </AnsiLink>,
    );

    index = linkRegex.lastIndex;
  }

  if (index < bundle.content.length) {
    content.push(bundle.content.substring(index));
  }

  return (
    <AnsiSpan
      key={key}
      className={className || undefined}
      bg={useClasses ? undefined : bundle.bg}
      fg={useClasses ? undefined : bundle.fg}
      decoration={decorationProp}
    >
      {content}
    </AnsiSpan>
  );
}

function fixBackspace(txt: string) {
  let tmp = txt;
  do {
    txt = tmp;
    tmp = txt.replace(/[^\n]\x08/gm, "");
  } while (tmp.length < txt.length);
  return txt;
}

function AnsiRenderer({
  children,
  linkify = false,
}: {
  children?: string;
  linkify?: boolean;
}) {
  const ansiContent = ansiToJSON(children ?? "", false).map((bundle, i) =>
    convertBundleIntoReact(linkify, false, bundle, i),
  );

  return <>{ansiContent}</>;
}

interface StatusIconProps {
  status: "running" | "completed" | "failed" | "background";
}

function StatusIcon({ status }: StatusIconProps) {
  const getStatusColor = () => {
    switch (status) {
      case "running":
        return "bg-success";
      case "completed":
        return "bg-success";
      case "background":
        return "bg-accent";
      case "failed":
        return "bg-error";
      default:
        return "bg-success";
    }
  };

  return (
    <span
      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${getStatusColor()} ${
        status === "running" ? "animate-pulse" : ""
      }`}
    />
  );
}

function OutputToggle({
  hiddenLinesCount,
  isExpanded,
  onToggle,
}: {
  hiddenLinesCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-description hover:text-foreground mt-1.5 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-medium underline-offset-2 hover:underline"
      data-testid="terminal-output-toggle"
    >
      <span>
        {isExpanded ? "Show less" : `Show ${hiddenLinesCount} more lines`}
      </span>
      <ChevronDownIcon
        className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
      />
    </button>
  );
}

interface UnifiedTerminalCommandProps {
  command: string;
  /** Short command type label, e.g. "git" / "npm". Defaults to first token. */
  commandType?: string;
  output?: string;
  status?: "running" | "completed" | "failed" | "background";
  statusMessage?: string;
  toolCallState?: ToolCallState;
  toolCallId?: string;
  /** Collapsed output shows the first N lines, then ellipsis. */
  displayLines?: number;
}

function inferCommandType(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "shell";
  }
  const tokens = trimmed.split(/\s+/);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][\w]*=.*/.test(tokens[index])) {
    index++;
  }
  const raw = tokens[index] ?? "shell";
  return (raw.split(/[/\\]/).pop() ?? raw).toLowerCase() || "shell";
}

export function UnifiedTerminalCommand({
  command,
  commandType,
  output = "",
  status = "completed",
  statusMessage = "",
  toolCallState,
  toolCallId,
  displayLines = 2,
}: UnifiedTerminalCommandProps) {
  const dispatch = useAppDispatch();
  const [isExpanded, setIsExpanded] = useState(true);
  const [outputExpanded, setOutputExpanded] = useState(false);

  // Determine running state
  const isRunning = toolCallState?.status === "calling" || status === "running";
  const hasOutput = output.length > 0;
  const resolvedType = commandType || inferCommandType(command);

  // Process terminal content for line limiting — first N lines when collapsed
  const processedTerminalContent = useMemo(() => {
    if (!output) {
      return {
        fullContent: "",
        limitedContent: "",
        totalLines: 0,
        isLimited: false,
        hiddenLinesCount: 0,
      };
    }

    const lines = output.split("\n");
    const totalLines = lines.length;

    if (totalLines > displayLines) {
      const firstLines = lines.slice(0, displayLines);
      return {
        fullContent: output,
        limitedContent: `${firstLines.join("\n")}\n…`,
        totalLines,
        isLimited: true,
        hiddenLinesCount: totalLines - displayLines,
      };
    }

    return {
      fullContent: output,
      limitedContent: output,
      totalLines,
      isLimited: false,
      hiddenLinesCount: 0,
    };
  }, [output, displayLines]);

  // Determine status type
  let statusType: "running" | "completed" | "failed" | "background" = status;
  if (isRunning) {
    statusType = "running";
  } else if (statusMessage?.includes("failed")) {
    statusType = "failed";
  } else if (statusMessage?.includes("background")) {
    statusType = "background";
  }

  const handleMoveToBackground = () => {
    if (toolCallId) {
      void dispatch(
        moveTerminalProcessToBackground({
          toolCallId,
        }),
      );
    }
  };

  // Create combined content for copying (command + output)
  const copyContent = useMemo(() => {
    let content = command;
    if (hasOutput) {
      content += `\n\n${output}`;
    }
    return content;
  }, [command, output, hasOutput]);

  const showFullOutput = outputExpanded || isRunning;
  const outputText = showFullOutput
    ? processedTerminalContent.fullContent
    : processedTerminalContent.limitedContent;

  return (
    <StyledTerminalContainer
      fontSize={getFontSize()}
      className="mx-2 mb-3"
      data-testid="terminal-container"
    >
      <div className="border-border bg-input/40 my-1.5 flex min-w-0 flex-col overflow-hidden rounded-lg border border-solid">
        {/* Header */}
        <button
          type="button"
          className="hover:bg-list-hover find-widget-skip m-0 flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent px-2.5 py-1.5 text-left"
          style={{ fontSize: `${getFontSize() - 2}px` }}
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <ChevronDownIcon
              className={`text-description h-3.5 w-3.5 flex-shrink-0 transition-transform ${
                isExpanded ? "rotate-0" : "-rotate-90"
              }`}
            />
            <StatusIcon status={statusType} />
            <span
              className="text-foreground truncate font-mono text-xs font-medium"
              data-testid="terminal-command-type"
            >
              {resolvedType}
            </span>
            {isRunning ? (
              <span className="text-description-muted text-xs">Running…</span>
            ) : null}
          </div>

          {!isRunning && (
            <div
              className="xs:flex hidden items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <CopyButton text={copyContent} />
              <RunInTerminalButton command={command} />
            </div>
          )}
        </button>

        {isExpanded && (
          <div className="border-border border-0 border-t border-solid px-2.5 py-2">
            <TerminalContent>
              <pre>
                <code>
                  <div
                    className="text-foreground whitespace-pre-wrap break-all font-mono text-xs opacity-90"
                    data-testid="terminal-command"
                  >
                    <span className="text-description-muted select-none">
                      ${" "}
                    </span>
                    {command}
                  </div>

                  {isRunning && !hasOutput && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <BlinkingCursor />
                    </div>
                  )}

                  {hasOutput && (
                    <div className="text-description mt-2 font-mono text-[11px] leading-relaxed">
                      <AnsiRenderer linkify>{outputText}</AnsiRenderer>
                      {processedTerminalContent.isLimited && !isRunning && (
                        <div>
                          <OutputToggle
                            hiddenLinesCount={
                              processedTerminalContent.hiddenLinesCount
                            }
                            isExpanded={outputExpanded}
                            onToggle={() => setOutputExpanded(!outputExpanded)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </code>
              </pre>
            </TerminalContent>

            {(statusMessage || (isRunning && toolCallId)) && (
              <div className="text-description mt-2 flex items-center text-[11px]">
                {!isRunning && statusMessage ? statusMessage : null}
                {isRunning && toolCallId && (
                  <button
                    type="button"
                    onClick={handleMoveToBackground}
                    className="text-link cursor-pointer border-none bg-transparent p-0 text-[11px] underline-offset-2 hover:underline"
                  >
                    Move to background
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </StyledTerminalContainer>
  );
}
