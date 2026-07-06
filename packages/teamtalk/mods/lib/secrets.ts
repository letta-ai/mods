// Secret detection — patterns that signal likely credentials in
// proposed concept content. Used by `teamtalk_propose` to refuse
// writes that contain any of these tokens.
//
// The patterns are intentionally conservative — false positives are
// preferable to publishing a credential into a team's shared
// knowledge base. Each pattern's `source` is reported in the
// refusal message so the caller knows what triggered.

export const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,                       // AWS access key
  /sk-[A-Za-z0-9]{20,}/,                   // OpenAI project key
  /ghp_[A-Za-z0-9]{30,}/,                   // GitHub PAT
  /xoxb-[A-Za-z0-9-]{10,}/,                 // Slack bot token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,     // PEM private key
  /(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}/i, // quoted assignment
  // Unquoted .env-style: KEY=value or KEY="value". Common with
  // docker-compose, .env files, README secrets, and shell snippets.
  /\b(?:API_KEY|SECRET|PASSWORD|TOKEN|ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*\S{8,}/i,
];

// Return the source pattern that matched `text`, or null if none.
// The caller decides what to do with the result (typically: refuse
// the write and report which pattern triggered).
export function containsSecret(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}