// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const preloadDir = dirname(fileURLToPath(import.meta.url));
const preloadSourcePath = resolve(preloadDir, "index.ts");
const bundledPreloadPath = resolve(preloadDir, "../../out/preload/index.js");

// Electron's sandboxed preload `require` can load `electron` plus a short
// list of Node builtins. `os` is not on that list — importing it throws
// `module not found: node:os`, contextBridge never attaches, and the
// renderer dies on `window.desktopAPI.appInfo`.
const DISALLOWED_SPECIFIERS = [
  "os",
  "node:os",
  "fs",
  "node:fs",
  "path",
  "node:path",
  "crypto",
  "node:crypto",
  "child_process",
  "node:child_process",
];

const VALUE_IMPORT =
  /(?:^|\n)import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']/g;
const REQUIRE_CALL = /require\(\s*["']([^"']+)["']\s*\)/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function collectSpecifiers(source: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const spec = match[1];
    if (spec) matches.push(spec);
  }
  return matches;
}

function disallowedImports(source: string): string[] {
  const code = stripComments(source);
  const specs = [
    ...collectSpecifiers(code, VALUE_IMPORT),
    ...collectSpecifiers(code, REQUIRE_CALL),
  ];
  return [...new Set(specs.filter((spec) => DISALLOWED_SPECIFIERS.includes(spec)))];
}

describe("sandboxed preload imports", () => {
  it("flags a node:os value import and ignores comments", () => {
    expect(disallowedImports('import { homedir } from "node:os";\n')).toEqual([
      "node:os",
    ]);
    expect(disallowedImports('const { homedir } = require("os");\n')).toEqual([
      "os",
    ]);
    expect(disallowedImports('// import { homedir } from "node:os";\n')).toEqual(
      [],
    );
  });

  it("does not import Node builtins the Electron sandbox cannot require", () => {
    const source = readFileSync(preloadSourcePath, "utf8");
    expect(disallowedImports(source)).toEqual([]);
  });

  it("does not leave node:os in the bundled preload when it has been built", () => {
    if (!existsSync(bundledPreloadPath)) return;
    const bundled = readFileSync(bundledPreloadPath, "utf8");
    expect(disallowedImports(bundled)).toEqual([]);
  });
});
