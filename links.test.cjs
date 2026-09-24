// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

/**
 * These tests check the text functions of the link extension: the comment
 * syntaxes, the comment scanner, the link finder and the heading lookup.
 * They run on strings only. No editor and no file system is involved.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  syntaxes,
  commentSpans,
  commentLinks,
  headingSlug,
  headingLine,
  headings,
  linkUnderCursor,
  globPattern,
  defaultEditor,
} = require("./links.cjs");

/** spansOf returns the comment texts of source text in the given language. */
const spansOf = (language, source) =>
  commentSpans(source, syntaxes[language]).map((span) => source.slice(span.start, span.end));

test("comment spans cover line and block comments of Go and skip every literal", () => {
  const source = [
    "package x",
    "",
    "// first [a](docs/a.md)",
    'var s = "// not a comment" + `/* raw */` + \'/\' // second',
    "/* block",
    "   [b](docs/b.md) */ var t = 1",
    "var u = '\\'' // third",
  ].join("\n");
  assert.deepEqual(spansOf("go", source), [
    "// first [a](docs/a.md)",
    "// second",
    "/* block\n   [b](docs/b.md) */",
    "// third",
  ]);
});

test("comment spans follow the syntax of each listed language", () => {
  assert.deepEqual(
    spansOf("typescript", 'const u = `http://x/${"//"}` // after template\n/* block */ const v = 1;'),
    ["// after template", "/* block */"],
  );
  assert.deepEqual(
    spansOf("yaml", 'url: http://x/#frag # trailing\n# leading\nkey: "a # b" #c\nname: a#b'),
    ["# trailing", "# leading", "#c"],
  );
  assert.deepEqual(spansOf("shellscript", "echo '#x' # note\n#!/bin/sh"), ["# note", "#!/bin/sh"]);
  assert.deepEqual(spansOf("html", "<p>x</p><!-- one\n two --><!-- open"), ["<!-- one\n two -->", "<!-- open"]);
  assert.deepEqual(spansOf("css", "a { color: red; } /* [c](docs/c.md) */ b { content: '/* no */'; }"), [
    "/* [c](docs/c.md) */",
  ]);
  assert.deepEqual(spansOf("sql", "SELECT '--' -- trailing\n/* block */ SELECT 1;"), ["-- trailing", "/* block */"]);
  assert.deepEqual(spansOf("jsonc", '{ "a": "//x", // note\n "b": 1 /* block */ }'), ["// note", "/* block */"]);
  assert.deepEqual(spansOf("properties", "key=value ; note\n# leading\nurl=http://x#y"), ["; note", "# leading"]);
  assert.deepEqual(spansOf("dockerfile", "# base\nFROM x\nRUN echo '#' # tail"), ["# base", "# tail"]);
  assert.equal("markdown" in syntaxes, false);
});

test("comment links keep relative targets and report the exact label text", () => {
  const source = [
    "// Assures: [A-UNIT-001](docs/architecture/3-design/unit.md#a-unit-001)",
    "// See [web](https://example.test/x), [root](/etc/hosts), [here](#local) and [text](README.md).",
    'var s = "[in a string](docs/ignored.md)"',
  ].join("\n");
  const links = commentLinks(source, syntaxes.go);
  assert.deepEqual(
    links.map((link) => ({
      path: link.path,
      fragment: link.fragment,
      text: source.slice(link.start, link.end),
      whole: source.slice(link.open, link.close),
    })),
    [
      {
        path: "docs/architecture/3-design/unit.md",
        fragment: "a-unit-001",
        text: "A-UNIT-001",
        whole: "[A-UNIT-001](docs/architecture/3-design/unit.md#a-unit-001)",
      },
      { path: "README.md", fragment: "", text: "text", whole: "[text](README.md)" },
    ],
  );
  const yaml = "# The rule: [A-DEVOPS-002](docs/architecture/5-operations/devops.md#a-devops-002)\nkey: value\n";
  assert.deepEqual(
    commentLinks(yaml, syntaxes.yaml).map((link) => yaml.slice(link.start, link.end)),
    ["A-DEVOPS-002"],
  );
});

test("heading lookup matches the anchor of a heading outside fenced code", () => {
  const markdown = [
    "# Unit",
    "",
    "```text",
    "#### A-UNIT-001",
    "```",
    "",
    "~~~",
    "```",
    "#### A-UNIT-002",
    "~~~",
    "",
    "    #### A-UNIT-003",
    "",
    "#### A-UNIT-001",
    "",
    "Rule text.",
    "",
    "## Verification and status",
  ].join("\n");
  assert.equal(headingSlug("Verification and status"), "verification-and-status");
  assert.equal(headingLine(markdown, "a-unit-001"), 14);
  assert.equal(headingLine(markdown, "A-UNIT-001"), 14);
  assert.equal(headingLine(markdown, "a-unit-002"), 0);
  assert.equal(headingLine(markdown, "a-unit-003"), 0);
  assert.equal(headingLine(markdown, "verification-and-status"), 18);
  assert.equal(headingLine(markdown, "missing"), 0);
});

test("the headings of a document carry their line, anchor and text outside fenced code", () => {
  assert.deepEqual(headings("# Unit\n\n```\n## no\n```\n\n#### A-UNIT-001 ##\n"), [
    { line: 1, slug: "unit", text: "Unit" },
    { line: 7, slug: "a-unit-001", text: "A-UNIT-001" },
  ]);
});

test("a link being written is found in a comment only and only for a local relative target", () => {
  const source = ["package x", "// see [x](docs/arch", 'var s = "[y](docs/"', "// [z](docs/a.md#a-uni", "// [w](https://x/", "// [v](/etc/"].join("\n");
  const at = (needle) => source.indexOf(needle) + needle.length;
  assert.deepEqual(linkUnderCursor(source, at("docs/arch"), syntaxes.go), { start: source.indexOf("docs/arch"), path: "docs/arch", fragment: undefined });
  assert.equal(linkUnderCursor(source, at('"[y](docs/'), syntaxes.go), undefined);
  assert.deepEqual(linkUnderCursor(source, at("a.md#a-uni"), syntaxes.go), { start: source.indexOf("docs/a.md"), path: "docs/a.md", fragment: "a-uni" });
  assert.equal(linkUnderCursor(source, at("https://x/"), syntaxes.go), undefined);
  assert.equal(linkUnderCursor(source, at("/etc/"), syntaxes.go), undefined);
  assert.equal(linkUnderCursor(source, 5, syntaxes.go), undefined);
});

test("the default editor of a resource follows the editor associations as the editor matches them", () => {
  assert.equal(globPattern("*.md").test("readme.md"), true);
  assert.equal(globPattern("*.md").test("a/readme.md"), false);
  assert.equal(globPattern("**/docs/*.{md,txt}").test("file:/a/docs/x.txt"), true);
  assert.equal(defaultEditor({ "*.md": "vscode.markdown.editor" }, "file", "/a/b/X.MD"), "vscode.markdown.editor");
  assert.equal(defaultEditor({ "*.md": "default" }, "file", "/a/b/x.md"), "");
  assert.equal(defaultEditor({ "**/docs/*.md": "vscode.markdown.preview.editor" }, "file", "/a/docs/x.md"), "vscode.markdown.preview.editor");
  assert.equal(defaultEditor({ "*.txt": "e" }, "file", "/a/x.md"), "");
  assert.equal(defaultEditor(undefined, "file", "/a/x.md"), "");
});
