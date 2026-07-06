// Path utilities for cross-platform (POSIX + Windows) display and
// traversal checks. Both functions produce paths that use forward
// slashes for display and for relative-path semantics, regardless of
// the host OS, so the OKF bundle and the system/rules.md render
// are consistent everywhere.

import { homedir } from "node:os";
import { relative } from "node:path";

// Forward-slash version of path.relative(). On POSIX this is a no-op;
// on Windows it normalizes `\` to `/` so consumers (catalog renderers,
// display paths, conceptual IDs) get a single canonical form.
export function relativePosix(from: string, to: string): string {
  return relative(from, to).replace(/\\/g, "/");
}

// Display a path for /teamtalk status / debug output.
//
// Prefer `~/`-prefix when the path is under the user's $HOME. Falls
// back to relative-to-cwd when the path is outside $HOME but within
// the cwd. Otherwise returns the absolute path unchanged.
//
// Cross-platform behavior:
//   - POSIX: `~/foo` for `$HOME/foo`.
//   - Windows: `~/foo` for `C:\Users\name\foo` (we strip the drive
//     and leading slash, not just the platform-specific separator).
export function formatDisplayPath(absolutePath: string, cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (home) {
    // Normalize to forward slashes for comparison. Both home and
    // absolutePath are platform-native strings; we want bytewise
    // equality on the home segment.
    const normalizedHome = home.replace(/\\/g, "/");
    const normalizedPath = absolutePath.replace(/\\/g, "/");
    if (normalizedPath === normalizedHome) {
      return "~";
    }
    if (normalizedPath.startsWith(normalizedHome + "/")) {
      return "~/" + normalizedPath.slice(normalizedHome.length + 1);
    }
  }
  // Fall back to relative-to-cwd for paths outside $HOME.
  try {
    const rel = relativePosix(cwd, absolutePath);
    if (rel && !rel.startsWith("..")) return rel;
  } catch {
    // fall through
  }
  return absolutePath;
}

// True when `target` is `parent` itself or a descendant of `parent`.
// Cross-platform safe — uses relativePosix so Windows backslash
// separators don't fool the comparison.
//
// Returns false when target is outside parent (the common case that
// would-be path traversal would hit). Returns false on resolution
// errors rather than throwing.
export function isInside(parent: string, target: string): boolean {
  try {
    const rel = relativePosix(parent, target);
    // Empty means target === parent (allowed). ".." or absolute means
    // target is outside parent. Forward slashes are guaranteed by
    // relativePosix.
    if (rel === "") return true;
    if (rel.startsWith("..")) return false;
    // An absolute path returned by relative() means the inputs are
    // on different drives (Windows) — treat as outside.
    return !rel.startsWith("/") && !/^[A-Za-z]:\//.test(rel);
  } catch {
    return false;
  }
}