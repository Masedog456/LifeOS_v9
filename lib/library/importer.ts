/**
 * Import pipeline (LIFEOS-028, Feature 11).
 *
 * Deterministic, offline parsers that turn imported text into a structured
 * ParsedDocument (sections → passages). Plain text and Markdown are implemented;
 * PDF, EPUB, and HTML parsers are declared against the same interface but NOT
 * implemented this sprint (they throw a clear error) so future formats plug in
 * without touching callers. No OCR, no format libraries, no AI.
 */

export interface ParsedPassage {
  heading?: string;
  text: string;
  page?: number;
  location?: string;
}
export interface ParsedSection {
  title: string;
  passages: ParsedPassage[];
}
export interface ParsedDocument {
  sections: ParsedSection[];
}

/** A pluggable importer for one source format. */
export interface DocumentParser {
  format: "plain" | "markdown" | "paste" | "pdf" | "epub" | "html";
  label: string;
  /** Whether this parser can handle the given input (cheap heuristic). */
  canParse(input: string, filename?: string): boolean;
  /** Parse into a structured document. Deterministic — same input, same output. */
  parse(input: string): ParsedDocument;
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

/** Split a block of text into paragraphs (blank-line separated), trimmed. */
function paragraphs(block: string): string[] {
  return block
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean);
}

/**
 * The Markdown parser: `#`/`##` headings open sections, `###`+ headings label
 * the next passage, blank-line-separated blocks become passages. Falls back to
 * a single "Body" section when there are no headings.
 */
export const markdownParser: DocumentParser = {
  format: "markdown",
  label: "Markdown",
  canParse: (input) => /^\s*#{1,6}\s+/m.test(input),
  parse(input) {
    const lines = input.replace(/\r\n?/g, "\n").split("\n");
    const sections: ParsedSection[] = [];
    let current: ParsedSection | null = null;
    let pendingHeading: string | undefined;
    let buffer: string[] = [];

    const ensureSection = () => {
      if (!current) { current = { title: "Body", passages: [] }; sections.push(current); }
      return current;
    };
    const flush = () => {
      const text = buffer.join("\n").trim();
      buffer = [];
      if (!text) return;
      ensureSection().passages.push({ heading: pendingHeading, text });
      pendingHeading = undefined;
    };

    for (const line of lines) {
      const m = line.match(MD_HEADING);
      if (m) {
        flush();
        const level = m[1].length;
        const title = m[2].trim();
        if (level <= 2) { current = { title, passages: [] }; sections.push(current); }
        else pendingHeading = title;
      } else if (line.trim() === "") {
        flush();
      } else {
        buffer.push(line);
      }
    }
    flush();
    if (sections.length === 0) sections.push({ title: "Body", passages: [] });
    return { sections: sections.filter((s) => s.passages.length > 0 || sections.length === 1) };
  },
};

/** The plain-text parser: paragraphs become passages under a single section. */
export const plainTextParser: DocumentParser = {
  format: "plain",
  label: "Plain text",
  canParse: () => true, // the universal fallback
  parse(input) {
    const passages = paragraphs(input).map((text): ParsedPassage => ({ text }));
    return { sections: [{ title: "Body", passages }] };
  },
};

/** Declared-but-unimplemented parsers (Feature 11 extension points). */
function unimplemented(format: DocumentParser["format"], label: string): DocumentParser {
  return {
    format, label,
    canParse: () => false,
    parse() { throw new Error(`${label} import is not implemented yet (LIFEOS-028 declares the interface; a future sprint will add the parser).`); },
  };
}
export const pdfParser = unimplemented("pdf", "PDF");
export const epubParser = unimplemented("epub", "EPUB");
export const htmlParser = unimplemented("html", "HTML");

/** All registered parsers, in priority order (specific → universal fallback). */
export const PARSERS: DocumentParser[] = [markdownParser, plainTextParser];

/** Pick a parser: honor an explicit format, else the first that can parse. */
export function pickParser(input: string, format?: DocumentParser["format"]): DocumentParser {
  if (format) {
    const named = [...PARSERS, pdfParser, epubParser, htmlParser].find((p) => p.format === format);
    if (named) return named;
  }
  return PARSERS.find((p) => p.canParse(input)) ?? plainTextParser;
}

/** Parse input into a ParsedDocument, auto-detecting the format when unspecified. */
export function parseInput(input: string, format?: DocumentParser["format"]): { parsed: ParsedDocument; format: DocumentParser["format"] } {
  const parser = pickParser(input, format);
  return { parsed: parser.parse(input), format: parser.format };
}

/** Total passage count in a parsed document (used for progress + previews). */
export function passageCount(parsed: ParsedDocument): number {
  return parsed.sections.reduce((n, s) => n + s.passages.length, 0);
}
