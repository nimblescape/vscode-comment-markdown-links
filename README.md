# nimblescape Comment Markdown Links

This VS Code extension turns the Markdown links inside the comments of source
and configuration files into editor links. A language server links web
addresses at most, so the citation of a test, or a comment that names a
document, reaches its document through no link of its own:

```go
// Assures: [A-UNIT-001](docs/architecture/unit.md#a-unit-001)
func TestSomething(t *testing.T) {}
```

With the extension, only the label of such a link, `A-UNIT-001` above, shows,
and it is underlined. A click, or Ctrl+Click on Linux and Windows and
Cmd+Click on macOS, opens the Markdown file with the editor that the window
uses for Markdown files, at the heading the fragment names where that editor
can show one.

The link sits on the label, as in rendered Markdown, for one more reason. The
Go language server takes the file name of the target, `unit.md#a-unit-001`
above, for a web address, because `.md` is also a top-level domain, and links
it to `https://unit.md`. The editor keeps only one of two links that overlap:
the link of the provider that registered later. The Go language server
registers its provider after this extension and again after every restart,
so a link on the target would disappear behind that web-address link, and
the extension cannot remove it. The extension hides the target instead, as
the next sections explain, so that web-address link shows no underline.

Publisher: **nimblescape e.U.** (`https://nimblescape.com`). Extension ID:
`nimblescape.comment-markdown-links`.

## Installation

Install the extension from the Visual Studio Marketplace under the ID
`nimblescape.comment-markdown-links`, or run this command:

```sh
code --install-extension nimblescape.comment-markdown-links
```

Every [GitHub release](https://github.com/nimblescape/vscode-comment-markdown-links/releases)
also carries the `.vsix` file of its version. Install such a file with
`code --install-extension comment-markdown-links-<version>.vsix`. The extension needs
VS Code 1.95 or later.

## Languages

The extension scans the comments of these languages, named by the language
identifier of the editor. A string literal of the language is no comment, so
a link inside one receives no link. Markdown files keep the link handling of
the editor.

| Language identifiers | Comment markers |
| --- | --- |
| `go`, `go.mod` | `//` and `/* */` |
| `javascript`, `javascriptreact`, `typescript`, `typescriptreact` | `//` and `/* */` |
| `json`, `jsonc` | `//` and `/* */` |
| `css` | `/* */` |
| `scss`, `less` | `//` and `/* */` |
| `html`, `xml` | `<!-- -->` |
| `yaml`, `github-actions-workflow`, `shellscript`, `dockerfile`, `ignore`, `makefile`, `toml` | `#` at the start of a line or after white space |
| `properties`, `ini` | `#` and `;` at the start of a line or after white space |
| `sql` | `--` and `/* */` |

## Hidden targets

The extension hides the brackets and the target of every resolved link with
an editor decoration, so that a comment reads as rendered Markdown:

```go
// Assures: A-UNIT-001
```

The text stays in the file. The lines that a cursor or a selection touches
show the whole link, so that the link can be edited. A link whose target
resolves nowhere stays visible, so that a broken citation is seen. The editor
offers no interface for hidden text, so the decoration uses the `display`
style through its text decoration, as other extensions do.

## Link resolution

The extension registers one document link provider for the languages above.
For every document of such a language it scans the comments and finds each
Markdown link of the form `[label](target)`. The editor link covers the label.
A target with a scheme such as `https:`, an absolute path or a bare fragment
is left to the editor and receives no link.

A relative target resolves in this order:

1. Relative to the directory of the file that holds the link.
2. Relative to the workspace folder of that file.

The first candidate that names an existing file wins. A target that names a
directory or that resolves nowhere receives no link.

Every link opens through a command of the extension. The command opens the
target with the editor that the window associates with it, as the setting
`workbench.editorAssociations` and the menu "Set Default for '*.md'" record
it. A Markdown target with a fragment opens at the heading the fragment names
where that editor can show one:

| Default editor | Opens at |
| --- | --- |
| Text Editor | the heading, at the top of the view |
| Markdown Preview | the heading, through the fragment of the resource |
| Markdown Editor, or another editor | the start of the document, with the line of the heading as the requested selection |

For every editor other than the Markdown Preview, the command reads the
current text of the target and looks for the first heading whose anchor
equals the fragment. The anchor is the heading text in lower case, without
punctuation and with spaces turned into hyphens, as common Markdown renderers
form it. Headings inside fenced code blocks do not count. The command requests
the line of that heading as the selection of the editor. The text editor
shows the line at the top. The Markdown Editor ignores the requested
selection, because VS Code passes no selection to a custom editor, as
[microsoft/vscode#289785](https://github.com/microsoft/vscode/issues/289785)
records, and opens the document at its start. A fragment without a heading
requests the start of the document. A target without a fragment opens as the
editor opens files.

The editor moves the cursor to a mouse click before it follows a link. The
command puts the cursor of the source editor back to where it was before the
click, so that following a link with the mouse moves no cursor and reveals no
hidden target.

## Completion while writing a link

While a Markdown link to a local file is written in a comment, the extension
completes its target. Before a number sign it offers the folders and files of
the directory that the target names, resolved like a link: the entries beside
the file first, then the entries of the workspace folder. A folder inserts
its name with a slash and opens the next completion. After the number sign of
a Markdown target it offers the anchors of the headings of that document,
with the heading text as the detail. The completion opens on `(`, `/` and
`#`, and on the completion key of the editor. A link to a web address, an
absolute path or a bare fragment gets no completion.

## Settings

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `nimblescape.commentMarkdownLinks.hideTargets` | boolean | `true` | Hides the brackets and the target of a resolved link. The value `false` shows every link completely. |

## Scope and limits

The extension reads files through the workspace file system, changes no
file, runs no process and needs no opt-in. It supports untrusted and virtual
workspaces, because it only reads. It runs in the workspace host
(`extensionKind: workspace`), so it resolves links on a remote host, for
example in a Codespace.

The extension recognizes links in comments only. It resolves no link in a
string literal, in a generated documentation view, in a Markdown file or in a
language outside the table above. A script or style block inside an HTML
document follows the markup syntax, so the comment markers of the script or
style language are not recognized there.

## Source and issues

The source lives in the
[nimblescape/vscode-comment-markdown-links](https://github.com/nimblescape/vscode-comment-markdown-links)
repository. Report a problem as a
[GitHub issue](https://github.com/nimblescape/vscode-comment-markdown-links/issues). The
[contributor guide](https://github.com/nimblescape/vscode-comment-markdown-links/blob/main/CONTRIBUTING.md)
explains the development, the tests and the release.

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](https://github.com/nimblescape/vscode-comment-markdown-links/blob/main/LICENSE).
