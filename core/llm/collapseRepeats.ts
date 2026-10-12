import { MessageContent, MessagePart } from "..";

const MIN_PARAGRAPH_LENGTH = 8;

function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Drop paragraphs that already appeared earlier in the same text.
 * A reply that repeats "Let me read the file" many times is sent to the model
 * once, so the pattern does not train the next reply. Code fences are kept as is.
 */
export function collapseRepeatedParagraphs(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const seen = new Set<string>();
  let inFence = false;
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) {
      return;
    }
    const joined = paragraph.join("\n");
    const key = normalizeParagraph(joined);
    if (key.length < MIN_PARAGRAPH_LENGTH || !seen.has(key)) {
      seen.add(key);
      out.push(...paragraph);
    } else if (out.length > 0 && out[out.length - 1] === "") {
      // The dropped paragraph leaves a duplicated blank line behind.
      out.pop();
    }
    paragraph = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      out.push(line);
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return out.join("\n");
}

export function collapseRepeatedContent(content: MessageContent): MessageContent {
  if (typeof content === "string") {
    return collapseRepeatedParagraphs(content);
  }
  return content.map((part: MessagePart) =>
    part.type === "text"
      ? { ...part, text: collapseRepeatedParagraphs(part.text) }
      : part,
  );
}
