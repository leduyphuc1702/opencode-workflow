import { describe, expect, test } from "bun:test"
import { parseDiffFiles, reviewDiff, summarizeReview } from "../../src/security/review"

describe("security.review", () => {
  test("parses added lines only", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
 const keep = true
-eval(userInput)
+const safe = true
 unchanged()
\\ No newline at end of file`
    const files = parseDiffFiles(diff)

    expect(files).toEqual([{ path: "src/app.ts", addedLines: [{ line: 2, text: "const safe = true" }] }])
    expect(reviewDiff(diff)).toEqual([])
  })

  test("maps hunk numbering to new-file lines", () => {
    const files = parseDiffFiles(`diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -8,4 +10,5 @@
 context
-old
+new
 context2
+added`)

    expect(files[0]?.addedLines).toEqual([
      { line: 11, text: "new" },
      { line: 13, text: "added" },
    ])
  })

  test("parses multi-file diffs", () => {
    const files = parseDiffFiles(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
+a()
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -20 +20,2 @@
 keep()
+b()`)

    expect(files.map((file) => file.path)).toEqual(["a.ts", "b.ts"])
    expect(files[1]?.addedLines).toEqual([{ line: 21, text: "b()" }])
  })

  test("skips binary and pure rename diffs", () => {
    expect(
      parseDiffFiles(`diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`),
    ).toEqual([])
    expect(
      parseDiffFiles(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts`),
    ).toEqual([])
  })

  test("flags protected workflow path on added lines", () => {
    const findings = reviewDiff(`diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml
--- a/.github/workflows/deploy.yml
+++ b/.github/workflows/deploy.yml
@@ -0,0 +7,2 @@
+name: deploy
+on: push`)

    expect(findings).toContainEqual(
      expect.objectContaining({ path: ".github/workflows/deploy.yml", line: 7, pattern: "protected workflow config" }),
    )
  })

  test("summarizes secret findings without raw values", () => {
    const raw = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    const findings = reviewDiff(`diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -0,0 +3 @@
+const token = "${raw}"`)
    const summary = summarizeReview(findings)

    expect(summary).toContain("secret:github")
    expect(summary).toContain("ghp_...wxyz")
    expect(summary).not.toContain(raw)
    expect(JSON.stringify(findings)).not.toContain(raw)
  })
})
