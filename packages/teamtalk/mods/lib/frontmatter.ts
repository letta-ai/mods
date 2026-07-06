// parseFrontmatter — extract structured fields from a markdown file's
// YAML-style frontmatter, preserving the body for further processing.
//
// Constraints this parser does NOT handle (documented in
// assets/steward-schema.md):
//   - Block scalars (>- |). Lines must be single-line `key: value`.
//   - Nested mapping. Each line is treated as a top-level scalar/list/quoted
//     value only.
//   - Comments (#). Lines starting with `#` are silently dropped because
//     the parser only acts on lines that contain a colon.
//
// What it DOES handle:
//   - CRLF line endings (Windows-checked-out files).
//   - YAML lists in `[a, b, c]` form (single-line only).
//   - Quoted strings ("...") with surrounding double-quotes stripped.
//   - Numeric coercion for `ttl`.
//   - Boolean coercion for `cacheable` (true/yes/1 → true; everything
//     else → false), per the steward schema.

export type Frontmatter = {
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  timestamp?: string;
  trigger?: string;
  "trigger-description"?: string;
  ttl?: number | string;
  cacheable?: boolean | string;
};

export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  // Tolerate CRLF (Windows-checked-out files) by matching either line
  // ending. The strict `"\n"` check would miss `---\r\n` and return
  // empty frontmatter, breaking every search and count.
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const body = match[2];
  const fm: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value: string | string[] | undefined = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "type") fm.type = value as string;
    else if (key === "title") fm.title = value as string;
    else if (key === "description") fm.description = value as string;
    else if (key === "tags") fm.tags = value as string[];
    else if (key === "timestamp") fm.timestamp = value as string;
    else if (key === "trigger") fm.trigger = String(value);
    else if (key === "trigger-description") fm["trigger-description"] = String(value);
    else if (key === "ttl") {
      const n = Number.parseInt(String(value), 10);
      fm.ttl = Number.isFinite(n) && n > 0 ? n : undefined;
    } else if (key === "cacheable") {
      const v = String(value).toLowerCase();
      fm.cacheable = v === "true" || v === "yes" || v === "1";
    }
  }
  return { frontmatter: fm, body };
}
