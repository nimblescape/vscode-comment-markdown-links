// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

/**
 * Find the Markdown links inside the comments of a source or configuration
 * file and locate the heading that a link fragment names in a Markdown
 * document. These functions read text only. They touch no editor API and no
 * file system, so the extension module can resolve the link targets and the
 * tests can run without an editor.
 */

/**
 * quote describes one string literal form of a language.
 * @param {string} mark The quote character.
 * @param {boolean} escapes Whether a backslash escapes the next character.
 * @param {boolean} multiline Whether the literal may span lines.
 */
const quote = (mark, escapes, multiline = false) => ({ mark, escapes, multiline });

/** cLike is the comment syntax of the languages with C-style comments and template strings. */
const cLike = {
  line: ["//"],
  block: [["/*", "*/"]],
  strings: [quote('"', true), quote("'", true), quote("`", true, true)],
};

/** jsonLike is the comment syntax of JSON documents that allow comments. */
const jsonLike = { line: ["//"], block: [["/*", "*/"]], strings: [quote('"', true)] };

/** styleLike is the comment syntax of style sheets with line comments. */
const styleLike = { line: ["//"], block: [["/*", "*/"]], strings: [quote('"', true), quote("'", true)] };

/** markup is the comment syntax of markup documents. */
const markup = { line: [], block: [["<!--", "-->"]], strings: [] };

/** hash is the comment syntax of the languages whose comments start with a number sign. */
const hash = { line: ["#"], block: [], strings: [quote('"', true), quote("'", false)] };

/**
 * syntaxes maps the language identifier of the editor to the comment syntax of
 * that language: the markers that start a line comment, the pairs that
 * delimit a block comment and the string literals that the scanner skips. A
 * number sign or a semicolon starts a line comment only at the start of a
 * line or after white space, so that a fragment inside a plain value is no
 * comment. Markdown is absent on purpose: the editor handles its links.
 */
const syntaxes = {
  go: { line: ["//"], block: [["/*", "*/"]], strings: [quote('"', true), quote("'", true), quote("`", false, true)] },
  "go.mod": { line: ["//"], block: [], strings: [quote('"', true), quote("`", false, true)] },
  javascript: cLike,
  javascriptreact: cLike,
  typescript: cLike,
  typescriptreact: cLike,
  json: jsonLike,
  jsonc: jsonLike,
  css: { line: [], block: [["/*", "*/"]], strings: [quote('"', true), quote("'", true)] },
  scss: styleLike,
  less: styleLike,
  html: markup,
  xml: markup,
  yaml: hash,
  "github-actions-workflow": hash,
  shellscript: hash,
  dockerfile: hash,
  ignore: hash,
  makefile: hash,
  toml: hash,
  properties: { line: ["#", ";"], block: [], strings: [] },
  ini: { line: ["#", ";"], block: [], strings: [] },
  sql: { line: ["--"], block: [["/*", "*/"]], strings: [quote("'", false, true), quote('"', false, true)] },
};

/**
 * startsLineComment reports whether a line comment marker starts at the
 * offset. A single-character marker counts only at the start of the text, at
 * the start of a line or after white space.
 * @param {string} text Complete source text.
 * @param {number} offset The offset to test.
 * @param {string} marker The line comment marker.
 * @returns {boolean} Whether a line comment starts at the offset.
 */
function startsLineComment(text, offset, marker) {
  if (!text.startsWith(marker, offset)) return false;
  if (marker.length > 1 || offset === 0) return true;
  return /\s/.test(text[offset - 1]);
}

/**
 * commentSpans returns the offset ranges of every comment in source text of
 * the given syntax, in document order. A small scanner skips the string
 * literals of the syntax, so that a comment marker inside a literal starts no
 * comment. An unterminated block comment runs to the end of the text.
 * @param {string} text Complete source text.
 * @param {{line: string[], block: string[][], strings: Array<{mark: string, escapes: boolean, multiline: boolean}>}} syntax The comment syntax of the language.
 * @returns {Array<{start: number, end: number}>} Comment ranges as offsets.
 */
function commentSpans(text, syntax) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (syntax.line.some((marker) => startsLineComment(text, i, marker))) {
      let end = text.indexOf("\n", i);
      if (end === -1) end = text.length;
      spans.push({ start: i, end });
      i = end;
      continue;
    }
    const block = syntax.block.find(([open]) => text.startsWith(open, i));
    if (block) {
      let end = text.indexOf(block[1], i + block[0].length);
      end = end === -1 ? text.length : end + block[1].length;
      spans.push({ start: i, end });
      i = end;
      continue;
    }
    const literal = syntax.strings.find((form) => text[i] === form.mark);
    if (literal) {
      i = skipLiteral(text, i, literal);
      continue;
    }
    i++;
  }
  return spans;
}

/**
 * skipLiteral returns the offset after a string literal that starts at the
 * given offset. A backslash escapes the next character when the form allows
 * escapes. A literal of a single-line form ends at the end of its line when
 * it is not terminated. An unterminated multiline literal runs to the end of
 * the text.
 * @param {string} text Complete source text.
 * @param {number} start Offset of the opening quote.
 * @param {{mark: string, escapes: boolean, multiline: boolean}} form The string literal form.
 * @returns {number} The offset after the literal.
 */
function skipLiteral(text, start, form) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (form.escapes && c === "\\") {
      i += 2;
      continue;
    }
    if (c === form.mark) return i + 1;
    if (c === "\n" && !form.multiline) return i;
    i++;
  }
  return text.length;
}

/** linkPattern matches one Markdown link with a non-empty label and target. */
const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** schemePattern matches a target that starts with a URI scheme, such as https:. */
const schemePattern = /^[a-z][a-z0-9+.-]*:/i;

/**
 * commentLinks returns every Markdown link inside the comments of source text
 * of the given syntax whose target is a relative path, in document order. A
 * target with a scheme, an absolute path or a bare fragment is skipped. Each
 * result carries the offsets of the label text, the offsets of the whole
 * link from its opening bracket to its closing parenthesis, the path part of
 * the target and the fragment without its number sign. The editor link sits
 * on the label, as in rendered Markdown: the Go language server links the
 * file name of the target as a web address, and the editor keeps only the
 * later registered of two links that overlap, so a link on the target would
 * disappear behind that one.
 * @param {string} text Complete source text.
 * @param {{line: string[], block: string[][], strings: Array<{mark: string, escapes: boolean, multiline: boolean}>}} syntax The comment syntax of the language.
 * @returns {Array<{start: number, end: number, open: number, close: number, path: string, fragment: string}>} The links.
 */
function commentLinks(text, syntax) {
  const links = [];
  for (const span of commentSpans(text, syntax)) {
    const comment = text.slice(span.start, span.end);
    linkPattern.lastIndex = 0;
    let match;
    while ((match = linkPattern.exec(comment)) !== null) {
      const target = match[2];
      if (schemePattern.test(target) || target.startsWith("/") || target.startsWith("#")) continue;
      const hashIndex = target.indexOf("#");
      const labelStart = span.start + match.index + 1;
      links.push({
        start: labelStart,
        end: labelStart + match[1].length,
        open: span.start + match.index,
        close: span.start + match.index + match[0].length,
        path: hashIndex === -1 ? target : target.slice(0, hashIndex),
        fragment: hashIndex === -1 ? "" : target.slice(hashIndex + 1),
      });
    }
  }
  return links;
}

/**
 * headingSlug returns the anchor of a Markdown heading text the way common
 * Markdown renderers form it: lower case, punctuation removed, spaces turned
 * into hyphens.
 * @param {string} heading Heading text without its number signs.
 * @returns {string} The anchor.
 */
function headingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/** fencePattern matches the opening or closing line of a fenced code block. */
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;

/**
 * headingLine returns the one-based line of the first heading of a Markdown
 * document whose anchor equals the fragment, or zero when no heading matches.
 * Headings inside fenced code blocks are ignored. A fence closes only with a
 * fence of the same character that is at least as long, as Markdown defines
 * it, so that a backtick line inside a tilde block hides no later heading.
 * @param {string} markdown Complete Markdown text.
 * @param {string} fragment The anchor without its number sign.
 * @returns {number} The line number, or zero.
 */
function headingLine(markdown, fragment) {
  const wanted = fragment.toLowerCase();
  let fence = "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opening = fencePattern.exec(line);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
        fence = "";
      }
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match && headingSlug(match[1]) === wanted) return i + 1;
  }
  return 0;
}

/**
 * globPattern turns a glob of the editor associations of the editor into a
 * regular expression over a lower-case target: `**` matches across slashes,
 * `*` and `?` match within a segment, and a brace group lists alternatives.
 * The editor matches a pattern without a slash against the file name and a
 * pattern with a slash against the scheme and the path, both in lower case.
 * @param {string} glob The glob pattern.
 * @returns {RegExp} The anchored expression.
 */
function globPattern(glob) {
  let source = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      source += ".*";
      i++;
    } else if (c === "*") {
      source += "[^/]*";
    } else if (c === "?") {
      source += "[^/]";
    } else if (c === "{") {
      source += "(?:";
    } else if (c === "}") {
      source += ")";
    } else if (c === ",") {
      source += "|";
    } else if ("\\^$+.()|[]".includes(c)) {
      source += "\\" + c;
    } else {
      source += c;
    }
  }
  return new RegExp(source + "$");
}

/**
 * defaultEditor returns the editor that the associations of the editor select
 * for a resource, as the associations of the setting name it, or an empty
 * string for the text editor. The first association whose pattern matches
 * wins, as in the editor. The value `default` names the text editor.
 * @param {Record<string, string> | undefined} associations The editor associations of the setting.
 * @param {string} scheme The scheme of the resource.
 * @param {string} path The path of the resource.
 * @returns {string} The identifier of the editor, or an empty string for the text editor.
 */
function defaultEditor(associations, scheme, path) {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const full = `${scheme}:${path}`.toLowerCase();
  for (const [pattern, editor] of Object.entries(associations ?? {})) {
    if (typeof editor !== "string") continue;
    if (globPattern(pattern.toLowerCase()).test(pattern.includes("/") ? full : name)) {
      return editor === "default" ? "" : editor;
    }
  }
  return "";
}

/**
 * headings returns every heading of a Markdown document outside fenced code
 * blocks, in document order, with its one-based line, its anchor and its
 * text, under the same fence rules as headingLine.
 * @param {string} markdown Complete Markdown text.
 * @returns {Array<{line: number, slug: string, text: string}>} The headings.
 */
function headings(markdown) {
  const found = [];
  let fence = "";
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opening = fencePattern.exec(line);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
        fence = "";
      }
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) found.push({ line: i + 1, slug: headingSlug(match[1]), text: match[1].trim() });
  }
  return found;
}

/**
 * linkUnderCursor returns the target that a Markdown link is being written
 * with at an offset of source text of the given syntax, or undefined when
 * the offset is outside a comment, outside the target part of a link, or in
 * a target that is no local relative path, such as a web address or an
 * absolute path. The result carries the text of the target before the
 * offset, split into the path part and the fragment part, and the offset
 * where the target starts.
 * @param {string} text Complete source text.
 * @param {number} offset The offset of the cursor.
 * @param {{line: string[], block: string[][], strings: Array<{mark: string, escapes: boolean, multiline: boolean}>}} syntax The comment syntax of the language.
 * @returns {{start: number, path: string, fragment: string | undefined} | undefined} The target being written.
 */
function linkUnderCursor(text, offset, syntax) {
  const span = commentSpans(text, syntax).find((s) => s.start <= offset && offset <= s.end);
  if (!span) return undefined;
  const before = text.slice(span.start, offset);
  const match = /\[[^\]\n]*\]\(([^)\s]*)$/.exec(before);
  if (!match) return undefined;
  const target = match[1];
  if (schemePattern.test(target) || target.startsWith("/") || target.startsWith("#")) return undefined;
  const hashIndex = target.indexOf("#");
  return {
    start: offset - target.length,
    path: hashIndex === -1 ? target : target.slice(0, hashIndex),
    fragment: hashIndex === -1 ? undefined : target.slice(hashIndex + 1),
  };
}

module.exports = {
  syntaxes,
  commentSpans,
  commentLinks,
  headingSlug,
  headingLine,
  headings,
  linkUnderCursor,
  globPattern,
  defaultEditor,
};
