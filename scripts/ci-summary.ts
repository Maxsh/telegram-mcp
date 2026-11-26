/**
 * CI summary generator: renders the test + coverage dashboard that GitHub
 * Actions shows on the workflow run's Summary page (and job pages).
 *
 * Industry-standard inputs:
 *  - reports/junit.xml               (node:test --test-reporter junit)
 *  - coverage/coverage-summary.json  (c8 --reporter=json-summary, Istanbul)
 *
 * Writes to $GITHUB_STEP_SUMMARY when running inside Actions, otherwise to
 * stdout. Missing inputs are rendered as "not available" instead of failing —
 * a summary must be produced even when the test step failed.
 */

import * as fs from "fs";
import { pathToFileURL } from "url";

interface SuiteStats {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
}

interface FailedTest {
  suite: string;
  name: string;
  message: string;
}

const HEALTH_THRESHOLDS = [90, 80, 70]; // >=90 good, >=80 acceptable, >=70 weak, else bad

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, key: string): string {
  const match = tag.match(new RegExp(`${key}="([^"]*)"`));
  return match ? decodeEntities(match[1]) : "";
}

function num(tag: string, key: string): number {
  const value = Number(attr(tag, key));
  return Number.isFinite(value) ? value : 0;
}

function healthIndicator(pct: number, invert = false): string {
  const thresholds = HEALTH_THRESHOLDS;
  if (!invert) {
    if (pct >= thresholds[0]) return "🟢";
    if (pct >= thresholds[1]) return "🟡";
    if (pct >= thresholds[2]) return "🟠";
    return "🔴";
  }
  if (pct === 0) return "🟢";
  return "🔴";
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return "`" + "█".repeat(filled) + "·".repeat(width - filled) + "`";
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${Math.round(seconds - m * 60)}s`;
}

export function parseJUnit(path: string): { suites: SuiteStats[]; failures: FailedTest[] } | null {
  if (!fs.existsSync(path)) {
    return null;
  }
  const xml = fs.readFileSync(path, "utf8");
  const suites: SuiteStats[] = [];
  const failures: FailedTest[] = [];

  // Counts are derived from the <testcase> elements themselves, grouped by
  // their suite (classname). The <testsuite> attributes are not summed:
  // node:test nests suites for nested describe() blocks and counts child
  // suites in the parent's tests="", so summing them double-counts.
  const byName = new Map<string, SuiteStats>();
  const caseBlocks = [...xml.matchAll(/<testcase\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];
  for (const block of caseBlocks) {
    const header = block[1];
    const body = block[2] ?? "";
    const suiteName = attr(header, "classname") || "(no suite)";
    let suite = byName.get(suiteName);
    if (!suite) {
      suite = { name: suiteName, tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
      byName.set(suiteName, suite);
      suites.push(suite);
    }
    suite.tests += 1;
    suite.time += num(header, "time");

    if (/<skipped[\s/>]/.test(body)) {
      suite.skipped += 1;
      continue;
    }
    const isError = /<error[\s>]/.test(body);
    const isFailure = /<failure[\s>]/.test(body);
    if (!isError && !isFailure) {
      continue;
    }
    if (isFailure) {
      suite.failures += 1;
    } else {
      suite.errors += 1;
    }
    const messageMatch = body.match(/<(?:failure|error)\s+[^>]*message="([^"]*)"/);
    failures.push({
      suite: suiteName,
      name: attr(header, "name") || "(unnamed test)",
      message: messageMatch ? decodeEntities(messageMatch[1]).slice(0, 400) : "(no message)",
    });
  }

  return { suites, failures };
}

interface CoverageEntry {
  pct: number;
  covered: number;
  total: number;
}

function coverageEntry(raw: any): CoverageEntry {
  return {
    pct: Number(raw?.pct ?? 0),
    covered: Number(raw?.covered ?? 0),
    total: Number(raw?.total ?? 0),
  };
}

export function readCoverage(path: string): { total: Record<string, CoverageEntry>; files: Array<[string, Record<string, CoverageEntry>]> } | null {
  if (!fs.existsSync(path)) {
    return null;
  }
  try {
    const summary = JSON.parse(fs.readFileSync(path, "utf8"));
    const cwd = process.cwd();
    const files = Object.keys(summary)
      .filter((key) => key !== "total")
      .sort()
      .map((key) => [key.startsWith(cwd + "/") ? key.slice(cwd.length + 1) : key, summary[key]] as [string, Record<string, CoverageEntry>]);
    return { total: summary.total, files };
  } catch {
    return null;
  }
}

export function render(junit: ReturnType<typeof parseJUnit>, coverage: ReturnType<typeof readCoverage>): string {
  const lines: string[] = [];

  const totals = junit
    ? junit.suites.reduce(
        (acc, s) => ({
          tests: acc.tests + s.tests,
          failures: acc.failures + s.failures,
          errors: acc.errors + s.errors,
          skipped: acc.skipped + s.skipped,
          time: acc.time + s.time,
        }),
        { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 }
      )
    : { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };
  const failedTotal = totals.failures + totals.errors;

  const overall = junit
    ? failedTotal === 0
      ? "## ✅ Test & Coverage Report — all tests passed"
      : `## ❌ Test & Coverage Report — ${failedTotal} test${failedTotal === 1 ? "" : "s"} failed`
    : "## ⚠️ Test & Coverage Report — no test results published";
  lines.push(overall, "");

  lines.push(`| | |`);
  lines.push(`|---|---|`);
  if (process.env.GITHUB_EVENT_NAME) {
    lines.push(`| **Event / branch** | \`${process.env.GITHUB_EVENT_NAME}\` / \`${process.env.GITHUB_REF_NAME ?? "—"}\` |`);
  }
  if (process.env.GITHUB_SHA) {
    lines.push(`| **Commit** | \`${process.env.GITHUB_SHA.slice(0, 7)}\` |`);
  }
  lines.push(`| **Node** | \`${process.version}\` |`);
  lines.push("");

  // ---- Tests ----
  if (junit) {
    const passed = totals.tests - failedTotal - totals.skipped;

    lines.push("### 🧪 Tests");
    lines.push("");
    lines.push(`**${passed}/${totals.tests} passed** · ${failedTotal} failed · ${totals.skipped} skipped · ${formatDuration(totals.time)}`);
    lines.push("");
    lines.push(`| ✅ Passed | ❌ Failed | ⏭️ Skipped | Σ Total | ⏱️ Duration |`);
    lines.push(`|---:|---:|---:|---:|---:|`);
    lines.push(`| ${passed} | ${failedTotal} | ${totals.skipped} | ${totals.tests} | ${formatDuration(totals.time)} |`);
    lines.push("");
    lines.push("<details><summary>Per test suite (" + junit.suites.length + " suites)</summary>");
    lines.push("");
    lines.push(`| Suite | Tests | ✅ | ❌ | ⏭️ | Time |`);
    lines.push(`|---|---:|---:|---:|---:|---:|`);
    for (const suite of junit.suites) {
      const suiteFailed = suite.failures + suite.errors;
      const suitePassed = suite.tests - suiteFailed - suite.skipped;
      const name = suiteFailed > 0 ? `**${suite.name}**` : suite.name;
      lines.push(`| ${name} | ${suite.tests} | ${suitePassed} | ${suiteFailed || 0} | ${suite.skipped} | ${formatDuration(suite.time)} |`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  } else {
    lines.push("### 🧪 Tests");
    lines.push("");
    lines.push("_JUnit report (reports/junit.xml) not found — the test step likely did not run to completion._");
    lines.push("");
  }

  // ---- Failures ----
  if (junit && junit.failures.length > 0) {
    lines.push("### ❌ Failed tests");
    lines.push("");
    for (const failure of junit.failures) {
      lines.push(`<details><summary><code>${failure.suite} › ${failure.name}</code></summary>`);
      lines.push("");
      lines.push("```");
      lines.push(failure.message);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  // ---- Coverage ----
  if (coverage) {
    const t = coverage.total;
    const statements = coverageEntry(t.statements);
    const branches = coverageEntry(t.branches);
    const functions = coverageEntry(t.functions);
    const lineCov = coverageEntry(t.lines);

    lines.push("### 📊 Code coverage");
    lines.push("");
    lines.push(`| Metric | Coverage | Bar | Covered / Total | Health |`);
    lines.push(`|---|---:|:-:|---:|:-:|`);
    lines.push(`| Statements | ${statements.pct.toFixed(2)}% | ${bar(statements.pct)} | ${statements.covered}/${statements.total} | ${healthIndicator(statements.pct)} |`);
    lines.push(`| Branches | ${branches.pct.toFixed(2)}% | ${bar(branches.pct)} | ${branches.covered}/${branches.total} | ${healthIndicator(branches.pct)} |`);
    lines.push(`| Functions | ${functions.pct.toFixed(2)}% | ${bar(functions.pct)} | ${functions.covered}/${functions.total} | ${healthIndicator(functions.pct)} |`);
    lines.push(`| Lines | ${lineCov.pct.toFixed(2)}% | ${bar(lineCov.pct)} | ${lineCov.covered}/${lineCov.total} | ${healthIndicator(lineCov.pct)} |`);
    lines.push("");

    if (coverage.files.length > 0) {
      lines.push("<details><summary>Per file</summary>");
      lines.push("");
      lines.push(`| File | Lines | Branches | Functions |`);
      lines.push(`|---|---:|---:|---:|`);
      for (const [file, entry] of coverage.files) {
        const lc = coverageEntry(entry.lines);
        const br = coverageEntry(entry.branches);
        const fn = coverageEntry(entry.functions);
        lines.push(`| \`${file}\` | ${lc.pct.toFixed(1)}% ${healthIndicator(lc.pct)} | ${br.pct.toFixed(1)}% ${healthIndicator(br.pct)} | ${fn.pct.toFixed(1)}% ${healthIndicator(fn.pct)} |`);
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  } else {
    lines.push("### 📊 Code coverage");
    lines.push("");
    lines.push("_Coverage report (coverage/coverage-summary.json) not found — produced by c8 during the test step._");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `<sub>Health: 🟢 ≥${HEALTH_THRESHOLDS[0]}% · 🟡 ≥${HEALTH_THRESHOLDS[1]}% · 🟠 ≥${HEALTH_THRESHOLDS[2]}% · 🔴 below. ` +
    `Raw reports (JUnit XML, Cobertura, LCOV) are attached as workflow artifacts.</sub>`
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * shields.io "endpoint" badge JSON (https://shields.io/badges/endpoint-badge).
 * CI publishes these files to the `badges` branch on pushes to main; the
 * README badges read them via img.shields.io/endpoint?url=<raw file URL>.
 */
function badgeColor(pct: number): string {
  if (pct >= HEALTH_THRESHOLDS[0]) return "brightgreen";
  if (pct >= HEALTH_THRESHOLDS[1]) return "yellow";
  if (pct >= HEALTH_THRESHOLDS[2]) return "orange";
  return "red";
}

export function buildBadges(
  junit: ReturnType<typeof parseJUnit>,
  coverage: ReturnType<typeof readCoverage>
): Record<string, { schemaVersion: 1; label: string; message: string; color: string }> {
  const badges: Record<string, { schemaVersion: 1; label: string; message: string; color: string }> = {};

  if (junit) {
    const t = junit.suites.reduce(
      (acc, s) => ({ tests: acc.tests + s.tests, failed: acc.failed + s.failures + s.errors, skipped: acc.skipped + s.skipped }),
      { tests: 0, failed: 0, skipped: 0 }
    );
    const passed = t.tests - t.failed - t.skipped;
    badges.tests = {
      schemaVersion: 1,
      label: "tests",
      message: t.failed > 0 ? `${passed} passed, ${t.failed} failed` : `${passed} passed`,
      color: t.failed > 0 ? "red" : "brightgreen",
    };
  } else {
    badges.tests = { schemaVersion: 1, label: "tests", message: "unknown", color: "lightgrey" };
  }

  if (coverage) {
    const pct = coverageEntry(coverage.total.lines).pct;
    badges.coverage = { schemaVersion: 1, label: "coverage", message: `${pct.toFixed(1)}%`, color: badgeColor(pct) };
  } else {
    badges.coverage = { schemaVersion: 1, label: "coverage", message: "unknown", color: "lightgrey" };
  }

  return badges;
}

function main(): void {
  const junit = parseJUnit("reports/junit.xml");
  const coverage = readCoverage("coverage/coverage-summary.json");
  const markdown = render(junit, coverage);

  fs.mkdirSync("reports/badges", { recursive: true });
  for (const [name, badge] of Object.entries(buildBadges(junit, coverage))) {
    fs.writeFileSync(`reports/badges/${name}.json`, JSON.stringify(badge) + "\n");
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, markdown);
    console.log(`CI summary appended to ${summaryPath}`);
  } else {
    console.log(markdown);
  }
}

// Run only when executed directly (tsx scripts/ci-summary.ts), not when
// imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
