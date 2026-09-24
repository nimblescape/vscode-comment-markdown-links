// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

/**
 * Turn the Markdown links inside the comments of source and configuration
 * files into editor links and show only their labels. A language server
 * links web addresses at most, so a citation such as
 * `[A-UNIT-001](docs/architecture/<level>/<unit>.md#a-unit-001)` reaches its
 * document through no link of its own. This extension registers a document
 * link provider for the languages that links.cjs lists. It puts a link on
 * the label of such a citation and resolves the target against the
 * directory of the file first and against the workspace folder second.
 * Every link opens through a command of the extension, which opens the
 * target with the editor that the window associates with it. A Markdown
 * target with a fragment opens at the heading the fragment names when that
 * editor can show one: the text editor and the Markdown preview can, and
 * another editor opens the document at its start. The command also keeps
 * the cursor of the source editor where it was before a mouse click on the
 * link, because the editor moves the cursor to the click before it follows
 * the link. The label carries the link because the Go language server takes
 * the file name of the target for a web address, and the editor keeps only
 * the later registered of two links that overlap. The extension hides the
 * brackets and the target of a resolved link behind its label with an editor
 * decoration, except on the lines of the cursor, so that the link reads as
 * rendered Markdown and the hidden web-address link shows no underline. A
 * setting turns the hiding off. While a link to a local file is written, the
 * extension completes the folders and files of the target under the same
 * resolution, and the headings of a Markdown target after its number sign.
 *
 * VS Code calls activate and owns the registrations through
 * context.subscriptions. The extension reads files through the workspace file
 * system, changes no file, runs no process and needs no opt-in. A target that
 * resolves nowhere receives no link and stays visible.
 */

const vscode = require("vscode");
const { syntaxes, commentLinks, headingLine, headings, linkUnderCursor, defaultEditor } = require("./links.cjs");

/** openCommand names the command that opens the target of a link. */
const openCommand = "nimblescape.commentMarkdownLinks.open";

/** previewEditor identifies the Markdown preview of the editor, which scrolls to a fragment of its resource. */
const previewEditor = "vscode.markdown.preview.editor";

/** clickWindow bounds, in milliseconds, how long after a mouse selection change a followed link restores the cursor. */
const clickWindow = 2000;

/** completionTriggers are the characters that open the completion of a link target: its start, a directory and a fragment. */
const completionTriggers = ["(", "/", "#"];

/** settingsSection names the configuration section of the extension. */
const settingsSection = "nimblescape.commentMarkdownLinks";

/**
 * activate registers the command, the document link provider for the listed
 * languages, the decoration that hides link targets and the listeners that
 * refresh the hiding. VS Code disposes everything with the extension.
 * @param {import("vscode").ExtensionContext} context The extension context.
 */
function activate(context) {
  /** resolved caches the resolved links of a document by its version. */
  const resolved = new Map();
  /** hiding is the decoration that renders no text for the decorated ranges. */
  const hiding = vscode.window.createTextEditorDecorationType({ textDecoration: "none; display: none;" });
  /** generations orders the refreshes of an editor, so that an older one never wins. */
  const generations = new WeakMap();
  /** selections keeps the last known selections of an editor, so that a mouse change can be undone. */
  const selections = new WeakMap();
  /** clicks keeps, per editor, the selections before its last mouse selection change and the time of that change. */
  const clicks = new WeakMap();
  /** refresh recomputes the hidden ranges of one editor and applies them unless a newer refresh started. */
  const refresh = async (editor) => {
    const generation = (generations.get(editor) ?? 0) + 1;
    generations.set(editor, generation);
    const ranges = await hiddenRanges(editor, (document) => resolvedLinks(document, undefined, resolved));
    if (generations.get(editor) === generation) editor.setDecorations(hiding, ranges);
  };
  /** refreshAll records the selections of every visible editor not seen before and refreshes every visible editor. */
  const refreshAll = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (!selections.has(editor)) selections.set(editor, editor.selections);
      refresh(editor);
    }
  };
  /**
   * restoreCursor puts the cursor of the source editor back to where it was
   * before a recent mouse click, so that following a link with the mouse
   * moves no cursor.
   */
  const restoreCursor = () => {
    const editor = vscode.window.activeTextEditor;
    const click = editor && clicks.get(editor);
    if (!click || Date.now() - click.at > clickWindow) return;
    clicks.delete(editor);
    if (click.selections.length) editor.selections = click.selections;
  };
  context.subscriptions.push(
    hiding,
    vscode.commands.registerCommand(openCommand, (parts, fragment) => {
      restoreCursor();
      return openTarget(parts, fragment);
    }),
    vscode.languages.registerDocumentLinkProvider(
      Object.keys(syntaxes).map((language) => ({ language })),
      {
        /**
         * provideDocumentLinks returns one editor link, on the label, per
         * Markdown link in a comment whose target resolves to a file. A
         * cancelled request returns no link.
         */
        async provideDocumentLinks(document, token) {
          const links = [];
          for (const link of await resolvedLinks(document, token, resolved)) {
            const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.end));
            const documentLink = new vscode.DocumentLink(range, link.uri);
            documentLink.tooltip = link.tooltip;
            links.push(documentLink);
          }
          return token.isCancellationRequested ? [] : links;
        },
      },
    ),
    vscode.languages.registerCompletionItemProvider(
      Object.keys(syntaxes).map((language) => ({ language })),
      {
        /** provideCompletionItems completes the target of a link that is being written in a comment. */
        provideCompletionItems: (document, position) => completeTarget(document, position),
      },
      ...completionTriggers,
    ),
    vscode.window.onDidChangeVisibleTextEditors(refreshAll),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
        clicks.set(event.textEditor, { selections: selections.get(event.textEditor) ?? [], at: Date.now() });
      }
      selections.set(event.textEditor, event.selections);
      return refresh(event.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) refresh(editor);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => resolved.delete(document.uri.toString())),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(settingsSection)) refreshAll();
    }),
  );
  refreshAll();
}

/**
 * resolvedLinks returns the Markdown links of the comments of a document
 * whose targets resolve to files, with the target of each. The result is
 * cached by the version of the document. A cancelled request returns the
 * links found so far and caches nothing.
 * @param {import("vscode").TextDocument} document The document.
 * @param {import("vscode").CancellationToken | undefined} token The cancellation token of a request, if any.
 * @param {Map<string, {version: number, links: object[]}>} cache Resolved links by document URI.
 * @returns {Promise<Array<{start: number, end: number, open: number, close: number, uri: import("vscode").Uri, tooltip: string}>>} The resolved links.
 */
async function resolvedLinks(document, token, cache) {
  const syntax = syntaxes[document.languageId];
  if (!syntax) return [];
  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === document.version) return cached.links;
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const links = [];
  for (const link of commentLinks(document.getText(), syntax)) {
    if (token?.isCancellationRequested) return links;
    const target = await resolveTarget(document.uri, folder?.uri, link);
    if (target) links.push({ ...link, ...target });
  }
  cache.set(key, { version: document.version, links });
  return links;
}

/**
 * hiddenRanges returns the ranges of an editor that the hiding decoration
 * covers: the opening bracket and the part from the closing bracket to the
 * closing parenthesis of every resolved link, except on the lines that a
 * selection of the editor touches. An editor of an unlisted language, or an
 * editor whose window turned the hiding off, gets no range.
 * @param {import("vscode").TextEditor} editor The editor.
 * @param {(document: import("vscode").TextDocument) => Promise<object[]>} links Returns the resolved links of a document.
 * @returns {Promise<import("vscode").Range[]>} The ranges to hide.
 */
async function hiddenRanges(editor, links) {
  const document = editor.document;
  const enabled = vscode.workspace.getConfiguration(settingsSection).get("hideTargets", true);
  if (!enabled || !syntaxes[document.languageId]) return [];
  const cursorLines = new Set();
  for (const selection of editor.selections) {
    for (let line = selection.start.line; line <= selection.end.line; line++) cursorLines.add(line);
  }
  const ranges = [];
  for (const link of await links(document)) {
    const open = document.positionAt(link.open);
    if (cursorLines.has(open.line)) continue;
    ranges.push(new vscode.Range(open, document.positionAt(link.open + 1)));
    ranges.push(new vscode.Range(document.positionAt(link.end), document.positionAt(link.close)));
  }
  return ranges;
}

/**
 * completeTarget completes the target of a Markdown link that is being
 * written in a comment. Before a number sign it offers the folders and files
 * of the directory that the target names, resolved against the directory of
 * the document first and against the workspace folder second, with the
 * entries beside the document first. A folder inserts its name with a slash
 * and opens the next completion. After the number sign of a Markdown target
 * it offers the anchors of the headings of that document. A cursor outside
 * a comment, outside a link or in a link to a web address gets nothing.
 * @param {import("vscode").TextDocument} document The document.
 * @param {import("vscode").Position} position The position of the cursor.
 * @returns {Promise<import("vscode").CompletionItem[] | undefined>} The completions.
 */
async function completeTarget(document, position) {
  const syntax = syntaxes[document.languageId];
  if (!syntax) return undefined;
  const link = linkUnderCursor(document.getText(), document.offsetAt(position), syntax);
  if (!link) return undefined;
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const bases = [{ uri: vscode.Uri.joinPath(document.uri, ".."), detail: "beside the file" }];
  if (folder) bases.push({ uri: folder.uri, detail: "in the workspace folder" });
  if (link.fragment !== undefined) {
    if (!/\.md$/i.test(link.path)) return undefined;
    const range = new vscode.Range(document.positionAt(link.start + link.path.length + 1), position);
    for (const base of bases) {
      let markdown;
      try {
        markdown = (await vscode.workspace.openTextDocument(vscode.Uri.joinPath(base.uri, link.path))).getText();
      } catch {
        continue;
      }
      return headings(markdown).map((heading) => {
        const item = new vscode.CompletionItem(heading.slug, vscode.CompletionItemKind.Reference);
        item.detail = heading.text;
        item.range = range;
        return item;
      });
    }
    return undefined;
  }
  const slash = link.path.lastIndexOf("/");
  const directory = slash === -1 ? "" : link.path.slice(0, slash + 1);
  const range = new vscode.Range(document.positionAt(link.start + directory.length), position);
  const items = new Map();
  for (const base of bases) {
    let entries;
    try {
      entries = await vscode.workspace.fs.readDirectory(directory ? vscode.Uri.joinPath(base.uri, directory) : base.uri);
    } catch {
      continue;
    }
    for (const [name, type] of entries) {
      if (items.has(name)) continue;
      const isFolder = (type & vscode.FileType.Directory) !== 0;
      const item = new vscode.CompletionItem(
        isFolder ? `${name}/` : name,
        isFolder ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File,
      );
      item.detail = base.detail;
      item.range = range;
      item.sortText = `${isFolder ? "0" : "1"}${name}`;
      if (isFolder) item.command = { command: "editor.action.triggerSuggest", title: "Suggest" };
      items.set(name, item);
    }
  }
  return [...items.values()];
}

/**
 * resolveTarget finds the file that a relative link target names: first the
 * path relative to the directory of the document, then the path relative to
 * the workspace folder of the document. The result is a command link that
 * opens the file, at the heading of the fragment when the target is a
 * Markdown file with a fragment. A target that names a directory or that
 * resolves nowhere yields undefined.
 * @param {import("vscode").Uri} documentUri The URI of the document.
 * @param {import("vscode").Uri | undefined} folderUri The workspace folder of the document, if any.
 * @param {{path: string, fragment: string}} link The path and the fragment of the link.
 * @returns {Promise<{uri: import("vscode").Uri, tooltip: string} | undefined>} The resolved target.
 */
async function resolveTarget(documentUri, folderUri, link) {
  const candidates = [vscode.Uri.joinPath(documentUri, "..", link.path)];
  if (folderUri) candidates.push(vscode.Uri.joinPath(folderUri, link.path));
  for (const candidate of candidates) {
    let stat;
    try {
      stat = await vscode.workspace.fs.stat(candidate);
    } catch {
      continue;
    }
    if (stat.type & vscode.FileType.Directory) continue;
    const relative = vscode.workspace.asRelativePath(candidate, false);
    const fragment = /\.md$/i.test(link.path) ? link.fragment : "";
    const parts = { scheme: candidate.scheme, authority: candidate.authority, path: candidate.path };
    const query = encodeURIComponent(JSON.stringify([parts, fragment]));
    return {
      uri: vscode.Uri.parse(`command:${openCommand}?${query}`),
      tooltip: `Open ${relative}${fragment ? "#" + fragment : ""}`,
    };
  }
  return undefined;
}

/**
 * openTarget opens the target of a link with the editor that the window
 * associates with it. For a Markdown target with a fragment, the command
 * looks up the first heading whose anchor equals the fragment in the current
 * text of the document and requests the line of that heading as the
 * selection. The text editor shows that line at the top. The Markdown
 * preview receives the fragment of its resource instead and scrolls to it.
 * Another editor receives the requested selection and decides whether it
 * shows the line: the Markdown Editor of the editor ignores it and opens the
 * document at its start. A fragment without a heading requests the start of
 * the document. A target without a fragment opens as the editor opens files.
 * @param {{scheme: string, authority: string, path: string}} parts The components of the target URI.
 * @param {string} fragment The anchor without its number sign, or an empty string.
 */
async function openTarget(parts, fragment) {
  const uri = vscode.Uri.from(parts);
  if (!fragment) {
    await vscode.commands.executeCommand("vscode.open", uri);
    return;
  }
  const associations = vscode.workspace.getConfiguration("workbench", uri).get("editorAssociations");
  const editor = defaultEditor(associations, uri.scheme, uri.path);
  if (editor === previewEditor) {
    await vscode.commands.executeCommand("vscode.openWith", uri.with({ fragment }), editor);
    return;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const line = headingLine(document.getText(), fragment);
  const position = new vscode.Position(line > 0 ? line - 1 : 0, 0);
  const range = new vscode.Range(position, position);
  if (editor) {
    await vscode.commands.executeCommand("vscode.openWith", uri, editor, { selection: range });
    return;
  }
  const shown = await vscode.window.showTextDocument(document, { selection: range });
  shown.revealRange(range, vscode.TextEditorRevealType.AtTop);
}

/** deactivate has nothing to release: VS Code disposes the registrations. */
function deactivate() {}

module.exports = { activate, deactivate };
