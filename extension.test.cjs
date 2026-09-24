// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

/**
 * These tests run the real activation module in a VM with a fake editor API
 * over a temporary workspace. They check the registration for every listed
 * language, the resolution order of a link target, the command link of every
 * link, the editor that the command opens for the default editor of the
 * window, the cursor that a followed link keeps, the hiding of link targets
 * outside the lines of the cursor, the handling of a target that resolves
 * nowhere, the activation events and the setting of the manifest, and the
 * files of the package. No installed editor is touched.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { syntaxes } = require("./links.cjs");

/** openCommand is the command of the extension that opens a heading. */
const openCommand = "nimblescape.commentMarkdownLinks.open";

/** settingsSection is the configuration section of the extension, which the fake editor API serves alone. */
const settingsSection = "nimblescape.commentMarkdownLinks";

/**
 * plain copies a value created inside the VM realm into ordinary objects of
 * this realm, so that strict deep equality compares structure only.
 * @param {unknown} value The value to copy.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * uri builds a minimal file URI of the fake editor API over an absolute path.
 * @param {string} fsPath The absolute path.
 */
function uri(fsPath, fragment = "") {
  return {
    scheme: "file",
    authority: "",
    path: fsPath,
    fsPath,
    fragment,
    /** with copies the URI with another fragment, as the editor API does. */
    with: (change) => uri(fsPath, change.fragment ?? fragment),
    /** toString renders the URI as the editor API does, with its fragment. */
    toString: () => `file://${fsPath}${fragment ? "#" + fragment : ""}`,
  };
}

/**
 * fixture creates a temporary workspace with a Go file, a YAML file, a
 * Markdown file beside the Go file and a Markdown file at the root, loads
 * extension.cjs in a VM with a fake editor API and returns the registered
 * provider, the registered command, the captured listeners and the
 * documents. node:test removes the workspace.
 */
async function fixture(t, goText, yamlText = "") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ns-links-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "internal", "app", "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "architecture"), { recursive: true });
  await fs.writeFile(path.join(root, "internal", "app", "docs", "local.md"), "# Local\n\n## Section two\n");
  await fs.writeFile(
    path.join(root, "docs", "architecture", "unit.md"),
    "# Unit\n\nText.\n\n#### A-UNIT-001\n\nRule.\n",
  );
  await fs.writeFile(path.join(root, "docs", "architecture", "notes.txt"), "plain\n");
  const goPath = path.join(root, "internal", "app", "x_test.go");
  const yamlPath = path.join(root, "config.yaml");
  await fs.writeFile(goPath, goText);
  await fs.writeFile(yamlPath, yamlText);
  let selector;
  let provider;
  let completion;
  let triggers;
  const commands = {};
  const listeners = {};
  const shown = [];
  const visible = [];
  const config = {};
  const associations = {};
  const executed = [];
  /** listen captures the listener of one editor event under its name. */
  const listen = (name) => (listener) => {
    listeners[name] = listener;
    return {
      /** The captured listener owns no actual editor registration. */
      dispose() {},
    };
  };
  const vscode = {
    FileType: { File: 1, Directory: 2 },
    TextEditorRevealType: { AtTop: 3 },
    TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
    /** Position keeps a line and a character. */
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    /** Range keeps two positions. */
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    /** DocumentLink keeps the range and the target as the editor API does. */
    DocumentLink: class {
      constructor(range, target) {
        this.range = range;
        this.target = target;
      }
    },
    Uri: {
      /** joinPath resolves the segments against the base path, so that ".." leaves a file name. */
      joinPath: (base, ...segments) => uri(path.resolve(base.fsPath, ...segments)),
      /** parse keeps a command URI as the editor API does: the path is the command, the query is decoded. */
      parse: (value) => {
        const [head, query] = value.split("?");
        return { scheme: "command", path: head.slice("command:".length), query: decodeURIComponent(query), toString: () => value };
      },
      /** from rebuilds a file URI from its components. */
      from: (parts) => uri(parts.path),
    },
    commands: {
      /** Capture the registered command. */
      registerCommand: (name, handler) => {
        commands[name] = handler;
        return {
          /** The captured command owns no actual editor registration. */
          dispose() {},
        };
      },
      /** executeCommand records the editor commands that the extension runs, with every URI as a string. */
      executeCommand: async (name, ...args) => {
        executed.push([name, ...args.map((arg) => (arg && arg.scheme ? arg.toString() : arg))]);
      },
    },
    /** CompletionItem keeps a label and a kind, as the editor API does. */
    CompletionItem: class {
      constructor(label, kind) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: { File: 16, Reference: 17, Folder: 18 },
    languages: {
      /** Capture the completion registration of the extension with its trigger characters. */
      registerCompletionItemProvider: (value, given, ...characters) => {
        completion = given;
        triggers = characters;
        return {
          /** The captured provider owns no actual editor registration. */
          dispose() {},
        };
      },
      /** Capture the one link registration of the extension. */
      registerDocumentLinkProvider: (value, given) => {
        selector = value;
        provider = given;
        return {
          /** The captured provider owns no actual editor registration. */
          dispose() {},
        };
      },
    },
    window: {
      visibleTextEditors: visible,
      activeTextEditor: undefined,
      /** createTextEditorDecorationType keeps the rendering options of the hiding decoration. */
      createTextEditorDecorationType: (options) => ({
        options,
        /** The decoration type owns no actual editor registration. */
        dispose() {},
      }),
      onDidChangeVisibleTextEditors: listen("visible"),
      onDidChangeTextEditorSelection: listen("selection"),
      /** showTextDocument records the request and returns an editor that records reveals. */
      showTextDocument: async (document, options) => {
        const editor = { document, options, reveals: [] };
        editor.revealRange = (range, type) => editor.reveals.push({ range, type });
        shown.push(editor);
        return editor;
      },
    },
    workspace: {
      /** Every document of the fixture belongs to the temporary workspace folder. */
      getWorkspaceFolder: () => ({ uri: uri(root) }),
      /** asRelativePath renders a path relative to the workspace root. */
      asRelativePath: (target) => path.relative(root, target.fsPath),
      /**
       * getConfiguration reads the fixture settings of the configuration
       * section of the extension, or the editor associations of the
       * workbench. Another section returns the fallback of every key.
       */
      getConfiguration: (section) => ({
        get: (key, fallback) => {
          if (section === "workbench") return key === "editorAssociations" ? associations : fallback;
          return section === settingsSection && key in config ? config[key] : fallback;
        },
      }),
      onDidChangeTextDocument: listen("change"),
      onDidCloseTextDocument: listen("close"),
      onDidChangeConfiguration: listen("configuration"),
      /** openTextDocument returns the current text of a real temporary file. */
      openTextDocument: async (target) => {
        const text = await fs.readFile(target.fsPath, "utf8");
        return { uri: target, getText: () => text };
      },
      fs: {
        /** stat maps the editor file type onto the real temporary files. */
        stat: async (target) => {
          const stat = await fs.stat(target.fsPath);
          return { type: stat.isDirectory() ? 2 : 1, mtime: stat.mtimeMs, size: stat.size };
        },
        /** readDirectory lists the real temporary directory with the editor file types. */
        readDirectory: async (target) => {
          const entries = await fs.readdir(target.fsPath, { withFileTypes: true });
          return entries.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
        },
      },
    },
  };
  const source = await fs.readFile(path.join(__dirname, "extension.cjs"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    /** Substitute the editor API only and load the real local link module. */
    require: (name) => (name === "vscode" ? vscode : require(name)),
  });
  const subscriptions = [];
  module.exports.activate({ subscriptions });
  /** document builds a fake text document over a fixture file. */
  const document = (filePath, languageId, text) => ({
    uri: uri(filePath),
    languageId,
    version: 1,
    /** getText returns the complete text of the fixture document. */
    getText: () => text,
    /** positionAt converts an offset into the line and character of the editor API. */
    positionAt: (offset) => {
      const before = text.slice(0, offset).split("\n");
      return new vscode.Position(before.length - 1, before[before.length - 1].length);
    },
    /** offsetAt converts a line and character of the editor API into an offset. */
    offsetAt: (position) => text.split("\n").slice(0, position.line).reduce((sum, l) => sum + l.length + 1, 0) + position.character,
  });
  return {
    root,
    selector,
    subscriptions,
    commands,
    shown,
    config,
    associations,
    executed,
    /** activate makes an editor the active text editor of the fake window. */
    activate: (editor) => {
      vscode.window.activeTextEditor = editor;
    },
    /** click moves the cursor of an editor to a line as a mouse click does and runs the selection listener. */
    click: async (editor, line) => {
      const position = new vscode.Position(line, 0);
      editor.selections = [{ start: position, end: position }];
      await listeners.selection({ textEditor: editor, selections: editor.selections, kind: 2 });
    },
    /** complete runs the registered completion provider at a line and character of a document. */
    complete: (doc, line, character) => completion.provideCompletionItems(doc, new vscode.Position(line, character)),
    completionTriggers: () => triggers,
    /** links runs the registered provider over a document with a token that may be cancelled. */
    links: (doc, cancelled = false) => provider.provideDocumentLinks(doc, { isCancellationRequested: cancelled }),
    /** editor shows a document in a fake visible editor with the cursor on the given line. */
    editor: (doc, line) => {
      const editor = { document: doc, selections: [], decorations: undefined };
      editor.setDecorations = (type, ranges) => {
        editor.decorations = ranges;
      };
      visible.push(editor);
      return editor;
    },
    /** cursor moves the cursor of an editor to a line and runs the selection listener to completion. */
    cursor: async (editor, line) => {
      const position = new vscode.Position(line, 0);
      editor.selections = [{ start: position, end: position }];
      await listeners.selection({ textEditor: editor, selections: editor.selections });
    },
    go: document(goPath, "go", goText),
    yaml: document(yamlPath, "yaml", yamlText),
    /** markdown builds a document of a language the extension does not list. */
    markdown: document(path.join(root, "docs", "architecture", "unit.md"), "markdown", goText),
  };
}

test("links resolve relative to the file first and to the workspace folder second", async (t) => {
  const f = await fixture(
    t,
    [
      "package app",
      "",
      "// Local: [two](docs/local.md#section-two)",
      "// Assures: [A-UNIT-001](docs/architecture/unit.md#a-unit-001)",
      "// Plain: [notes](docs/architecture/notes.txt#ignored)",
      "// Missing: [gone](docs/architecture/gone.md)",
      "// Unknown heading: [unit](docs/architecture/unit.md#nowhere)",
      "func Test(t *testing.T) {}",
    ].join("\n"),
  );
  assert.deepEqual(
    plain(f.selector),
    Object.keys(syntaxes).map((language) => ({ language })),
  );
  assert.equal(f.subscriptions.length, 9);
  const links = await f.links(f.go);
  assert.deepEqual(
    plain(links.map((link) => [link.target.scheme, link.target.path, link.tooltip])),
    [
      ["command", openCommand, "Open internal/app/docs/local.md#section-two"],
      ["command", openCommand, "Open docs/architecture/unit.md#a-unit-001"],
      ["command", openCommand, "Open docs/architecture/notes.txt"],
      ["command", openCommand, "Open docs/architecture/unit.md#nowhere"],
    ],
  );
  assert.deepEqual(JSON.parse(links[1].target.query), [
    { scheme: "file", authority: "", path: path.join(f.root, "docs", "architecture", "unit.md") },
    "a-unit-001",
  ]);
  assert.deepEqual(JSON.parse(links[2].target.query), [
    { scheme: "file", authority: "", path: path.join(f.root, "docs", "architecture", "notes.txt") },
    "",
  ]);
  // The link sits on the label, so that it never overlaps the web-address
  // link that the Go language server places on the file name of the target.
  assert.deepEqual(plain(links[1].range), {
    start: { line: 3, character: 13 },
    end: { line: 3, character: 13 + "A-UNIT-001".length },
  });
});

test("the command opens the target with the default editor and requests the heading that the fragment names", async (t) => {
  const f = await fixture(
    t,
    [
      "package app",
      "// [unit](docs/architecture/unit.md#a-unit-001)",
      "// [top](docs/architecture/unit.md#nowhere)",
      "// [notes](docs/architecture/notes.txt#ignored)",
    ].join("\n"),
  );
  const links = await f.links(f.go);
  const open = (index) => f.commands[openCommand](...JSON.parse(links[index].target.query));
  const unit = path.join(f.root, "docs", "architecture", "unit.md");
  // The text editor shows the heading at the top, or the start of the document for an unknown heading.
  for (const [index, line] of [
    [0, 4],
    [1, 0],
  ]) {
    await open(index);
    const editor = f.shown[f.shown.length - 1];
    assert.equal(editor.document.uri.fsPath, unit);
    assert.deepEqual(plain(editor.options.selection), { start: { line, character: 0 }, end: { line, character: 0 } });
    assert.deepEqual(plain(editor.reveals), [{ range: { start: { line, character: 0 }, end: { line, character: 0 } }, type: 3 }]);
  }
  // A target without a fragment opens as the editor opens files.
  await open(2);
  assert.deepEqual(f.executed.at(-1), ["vscode.open", `file://${path.join(f.root, "docs", "architecture", "notes.txt")}`]);
  // The Markdown preview scrolls to the fragment of its resource.
  f.associations["*.md"] = "vscode.markdown.preview.editor";
  await open(0);
  assert.deepEqual(f.executed.at(-1), ["vscode.openWith", `file://${unit}#a-unit-001`, "vscode.markdown.preview.editor"]);
  // Another editor receives the line of the heading as the requested selection, or the start of the document for an
  // unknown heading, and decides itself whether it shows the line. The text editor is named by "default".
  f.associations["*.md"] = "vscode.markdown.editor";
  for (const [index, line] of [
    [0, 4],
    [1, 0],
  ]) {
    await open(index);
    const at = { line, character: 0 };
    assert.deepEqual(plain(f.executed.at(-1)), [
      "vscode.openWith",
      `file://${unit}`,
      "vscode.markdown.editor",
      { selection: { start: at, end: at } },
    ]);
  }
  f.associations["*.md"] = "default";
  const shownBefore = f.shown.length;
  await open(0);
  assert.equal(f.shown.length, shownBefore + 1);
});

test("a link followed after a mouse click keeps the cursor where it was before the click", async (t) => {
  const f = await fixture(t, "package app\n\n// [unit](docs/architecture/unit.md#a-unit-001)\n");
  const editor = f.editor(f.go);
  await f.cursor(editor, 0);
  await f.click(editor, 2);
  assert.deepEqual(plain(editor.decorations), []);
  f.activate(editor);
  const links = await f.links(f.go);
  await f.commands[openCommand](...JSON.parse(links[0].target.query));
  assert.deepEqual(plain(editor.selections), [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }]);
  // A second use of the link without a new click restores nothing.
  await f.cursor(editor, 2);
  await f.commands[openCommand](...JSON.parse(links[0].target.query));
  assert.deepEqual(plain(editor.selections), [{ start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }]);
});

test("the brackets and the target of a resolved link hide except on the lines of the cursor", async (t) => {
  const f = await fixture(
    t,
    [
      "package app",
      "",
      "// Assures: [A-UNIT-001](docs/architecture/unit.md#a-unit-001)",
      "// Missing: [gone](docs/architecture/gone.md)",
      "func Test(t *testing.T) {}",
    ].join("\n"),
  );
  const editor = f.editor(f.go);
  await f.cursor(editor, 0);
  const hidden = "](docs/architecture/unit.md#a-unit-001)";
  assert.deepEqual(plain(editor.decorations), [
    { start: { line: 2, character: 12 }, end: { line: 2, character: 13 } },
    { start: { line: 2, character: 23 }, end: { line: 2, character: 23 + hidden.length } },
  ]);
  await f.cursor(editor, 2);
  assert.deepEqual(plain(editor.decorations), []);
  f.config.hideTargets = false;
  await f.cursor(editor, 0);
  assert.deepEqual(plain(editor.decorations), []);
  const unlisted = f.editor(f.markdown);
  await f.cursor(unlisted, 0);
  assert.deepEqual(plain(unlisted.decorations), []);
});

test("a comment of every listed language carries the link and a string literal or an unlisted language does not", async (t) => {
  const f = await fixture(
    t,
    ['package app\nvar s = "[a](docs/architecture/unit.md)"', "// [b](docs/architecture/unit.md)"].join("\n"),
    "# Rule: [A-UNIT-001](docs/architecture/unit.md#a-unit-001)\nurl: http://example.test/#not-a-comment\n",
  );
  assert.deepEqual(plain(await f.links(f.go, true)), []);
  assert.equal((await f.links(f.go)).length, 1);
  const yaml = await f.links(f.yaml);
  assert.deepEqual(plain(yaml.map((link) => link.tooltip)), ["Open docs/architecture/unit.md#a-unit-001"]);
  assert.deepEqual(plain(await f.links(f.markdown)), []);
});

test("a link being written completes folders, files and headings, and a web link or a string completes nothing", async (t) => {
  const lines = [
    "package app",
    "// start [x](",
    "// deep [x](docs/architecture/",
    "// heading [x](docs/architecture/unit.md#a",
    "// web [x](https://example.test/",
    'var s = "[x](docs/"',
  ];
  const f = await fixture(t, lines.join("\n"));
  assert.deepEqual(f.completionTriggers(), ["(", "/", "#"]);
  const start = await f.complete(f.go, 1, lines[1].length);
  assert.deepEqual(
    plain(start.map((item) => [item.label, item.kind, item.detail])),
    [
      ["docs/", 18, "beside the file"],
      ["x_test.go", 16, "beside the file"],
      ["config.yaml", 16, "in the workspace folder"],
      ["internal/", 18, "in the workspace folder"],
    ],
  );
  assert.equal(start[0].command.command, "editor.action.triggerSuggest");
  assert.deepEqual(plain(start[0].range), { start: { line: 1, character: 13 }, end: { line: 1, character: 13 } });
  const deep = await f.complete(f.go, 2, lines[2].length);
  assert.deepEqual(plain(deep.map((item) => item.label)), ["notes.txt", "unit.md"]);
  assert.deepEqual(plain(deep[0].range), { start: { line: 2, character: 30 }, end: { line: 2, character: 30 } });
  const heading = await f.complete(f.go, 3, lines[3].length);
  assert.deepEqual(plain(heading.map((item) => [item.label, item.kind, item.detail])), [
    ["unit", 17, "Unit"],
    ["a-unit-001", 17, "A-UNIT-001"],
  ]);
  assert.deepEqual(plain(heading[0].range), { start: { line: 3, character: 41 }, end: { line: 3, character: 42 } });
  assert.equal(await f.complete(f.go, 4, lines[4].length), undefined);
  assert.equal(await f.complete(f.go, 5, lines[5].length - 1), undefined);
  assert.equal(await f.complete(f.markdown, 1, lines[1].length), undefined);
});

test("the manifest activates the extension for every listed language and contributes the hiding setting", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "package.json"), "utf8"));
  assert.deepEqual(
    manifest.activationEvents,
    Object.keys(syntaxes).map((language) => `onLanguage:${language}`),
  );
  const setting = manifest.contributes.configuration.properties[`${settingsSection}.hideTargets`];
  assert.equal(setting.type, "boolean");
  assert.equal(setting.default, true);
});

test("the package includes the entry point and every local module that it requires", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "package.json"), "utf8"));
  const pending = [path.normalize(manifest.main)];
  const required = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (required.has(file)) continue;
    required.add(file);
    const source = await fs.readFile(path.join(__dirname, file), "utf8");
    for (const match of source.matchAll(/require\("(\.\/[^"]+)"\)/g)) pending.push(path.normalize(match[1]));
  }
  assert.ok(required.has("links.cjs"), "the scan finds the modules that the entry point requires");
  for (const file of required) assert.ok(manifest.files.includes(file), `${file} is missing from the files of the package`);
});

// The package keeps the Markdown links of its documents unchanged, so that the
// examples in code show relative targets. A relative link outside code would
// therefore break on the Marketplace page.
test("the documents of the package link outside code to web addresses or fragments only", async () => {
  for (const name of ["README.md", "CHANGELOG.md"]) {
    const text = (await fs.readFile(path.join(__dirname, name), "utf8"))
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
      .replace(/`[^`\n]*`/g, "");
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      assert.match(match[1], /^(https:\/\/|#)/, `${name} links to the relative target ${match[1]}`);
    }
  }
});
