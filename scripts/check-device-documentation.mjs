import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const livingDeviceDocuments = [
  "AGENTS.md",
  "README.md",
  "docs/administration.md",
  "docs/calendar-integration.md",
  "docs/design.md",
  "docs/device-client-contract.md",
];
const obsoletePatterns = [
  { label: "double-click", expression: /\bdouble[- ]click(?:ed|ing|s)?\b/i },
  {
    label: "server-managed cursor",
    expression: /\bserver[- ]managed\s+(?:device\s+|view\s+)?cursor\b/i,
  },
  {
    label: "device cursor",
    expression: /\b(?:device|view)\s+cursor\b/i,
  },
];

const requestedPaths = process.argv.slice(2);
const documentPaths =
  requestedPaths.length > 0
    ? requestedPaths.map((path) => resolve(path))
    : livingDeviceDocuments.map((path) => resolve(repositoryRoot, path));

const violations = [];
for (const documentPath of documentPaths) {
  const content = await readFile(documentPath, "utf8");
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const pattern of obsoletePatterns) {
      if (pattern.expression.test(line)) {
        violations.push({
          path: relative(repositoryRoot, documentPath),
          line: index + 1,
          label: pattern.label,
        });
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line}: obsolete production device language: ${violation.label}`
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${documentPaths.length} living device documentation file(s).`
  );
}
