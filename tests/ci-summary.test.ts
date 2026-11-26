import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseJUnit, readCoverage, render, buildBadges } from "../scripts/ci-summary.js";

const PASSING_JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="suite a" time="0.010" errors="0" tests="2" failures="0" skipped="0">
    <testcase name="one" time="0.001" classname="suite a"/>
    <testcase name="two" time="0.001" classname="suite a"/>
  </testsuite>
  <testsuite name="suite b" time="0.020" errors="0" tests="1" failures="0" skipped="1">
    <testcase name="three" time="0" classname="suite b"><skipped/></testcase>
  </testsuite>
</testsuites>
`;

const FAILING_JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="suite a" time="0.010" errors="0" tests="2" failures="1" skipped="0">
    <testcase name="ok" time="0.001" classname="suite a"/>
    <testcase name="broken &amp; bad" time="0.001" classname="suite a"><failure message="expected 1 to equal 2" type="AssertionError">stack</failure></testcase>
  </testsuite>
</testsuites>
`;

function coverageJson(pct: number, cwd: string): string {
  const entry = { total: 100, covered: pct, skipped: 0, pct };
  const metrics = { lines: entry, statements: entry, functions: entry, branches: entry };
  return JSON.stringify({ total: metrics, [`${cwd}/src/server.ts`]: metrics });
}

// node:test nests suites for nested describe() and counts child suites in the
// parent's tests="" attribute; totals must come from testcases only.
const NESTED_JUNIT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="outer" time="0.030" errors="0" tests="2" failures="0" skipped="0">
    <testsuite name="inner a" time="0.010" errors="0" tests="2" failures="0" skipped="0">
      <testcase name="a1" time="0.001" classname="inner a"/>
      <testcase name="a2" time="0.001" classname="inner a"/>
    </testsuite>
    <testsuite name="inner b" time="0.010" errors="0" tests="1" failures="0" skipped="0">
      <testcase name="b1" time="0.001" classname="inner b"/>
    </testsuite>
  </testsuite>
</testsuites>
`;

describe("ci-summary", () => {
  let dir: string;
  const file = (name: string, content: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-summary-test-"));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("parseJUnit", () => {
    it("returns null when the report is missing", () => {
      assert.equal(parseJUnit(path.join(dir, "nope.xml")), null);
    });

    it("collects per-suite stats", () => {
      const result = parseJUnit(file("pass.xml", PASSING_JUNIT));
      assert.ok(result);
      assert.equal(result.suites.length, 2);
      assert.deepEqual(
        result.suites.map((s) => [s.name, s.tests, s.failures, s.skipped]),
        [
          ["suite a", 2, 0, 0],
          ["suite b", 1, 0, 1],
        ]
      );
      assert.equal(result.failures.length, 0);
    });

    it("does not double-count nested suites", () => {
      const result = parseJUnit(file("nested.xml", NESTED_JUNIT));
      assert.ok(result);
      assert.deepEqual(
        result.suites.map((s) => [s.name, s.tests]),
        [
          ["inner a", 2],
          ["inner b", 1],
        ]
      );
      assert.equal(result.suites.reduce((n, s) => n + s.tests, 0), 3);
    });

    it("extracts failed tests with decoded names and messages", () => {
      const result = parseJUnit(file("fail.xml", FAILING_JUNIT));
      assert.ok(result);
      assert.deepEqual(result.failures, [
        { suite: "suite a", name: "broken & bad", message: "expected 1 to equal 2" },
      ]);
    });
  });

  describe("readCoverage", () => {
    it("returns null when missing or malformed", () => {
      assert.equal(readCoverage(path.join(dir, "nope.json")), null);
      assert.equal(readCoverage(file("bad.json", "{not json")), null);
    });

    it("makes file paths relative to the working directory", () => {
      const result = readCoverage(file("cov.json", coverageJson(91.9, process.cwd())));
      assert.ok(result);
      assert.deepEqual(result.files.map(([name]) => name), ["src/server.ts"]);
    });
  });

  describe("render", () => {
    it("reports success with totals and coverage", () => {
      const md = render(parseJUnit(file("p.xml", PASSING_JUNIT)), readCoverage(file("c.json", coverageJson(91.9, process.cwd()))));
      assert.match(md, /^## ✅ Test & Coverage Report — all tests passed/);
      assert.match(md, /\*\*2\/3 passed\*\* · 0 failed · 1 skipped/);
      assert.match(md, /\| Lines \| 91\.90% \|/);
      assert.doesNotMatch(md, /Failed tests/);
    });

    it("reports failures with details", () => {
      const md = render(parseJUnit(file("f.xml", FAILING_JUNIT)), null);
      assert.match(md, /^## ❌ Test & Coverage Report — 1 test failed/);
      assert.match(md, /### ❌ Failed tests/);
      assert.match(md, /suite a › broken & bad/);
      assert.match(md, /expected 1 to equal 2/);
      assert.match(md, /Coverage report .* not found/);
    });

    it("degrades gracefully when nothing was produced", () => {
      const md = render(null, null);
      assert.match(md, /^## ⚠️ Test & Coverage Report — no test results published/);
      assert.match(md, /JUnit report .* not found/);
    });
  });

  describe("buildBadges", () => {
    it("produces green shields.io endpoint badges for a passing run", () => {
      const badges = buildBadges(parseJUnit(file("p2.xml", PASSING_JUNIT)), readCoverage(file("c2.json", coverageJson(91.9, process.cwd()))));
      assert.deepEqual(badges.tests, { schemaVersion: 1, label: "tests", message: "2 passed", color: "brightgreen" });
      assert.deepEqual(badges.coverage, { schemaVersion: 1, label: "coverage", message: "91.9%", color: "brightgreen" });
    });

    it("turns the tests badge red on failures", () => {
      const badges = buildBadges(parseJUnit(file("f2.xml", FAILING_JUNIT)), null);
      assert.equal(badges.tests.message, "1 passed, 1 failed");
      assert.equal(badges.tests.color, "red");
    });

    it("colors coverage by health threshold", () => {
      const color = (pct: number) =>
        buildBadges(null, readCoverage(file(`c-${pct}.json`, coverageJson(pct, process.cwd())))).coverage.color;
      assert.equal(color(95), "brightgreen");
      assert.equal(color(85), "yellow");
      assert.equal(color(75), "orange");
      assert.equal(color(50), "red");
    });

    it("falls back to grey 'unknown' badges when reports are missing", () => {
      const badges = buildBadges(null, null);
      assert.equal(badges.tests.message, "unknown");
      assert.equal(badges.tests.color, "lightgrey");
      assert.equal(badges.coverage.message, "unknown");
      assert.equal(badges.coverage.color, "lightgrey");
    });
  });
});
