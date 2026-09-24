# nimblescape Comment Markdown Links

Makes the Markdown links in code comments clickable. A comment shows only the
label of a link, and a click opens the target at the heading that the link
names. While you write a link, the extension completes its paths and
headings.

```go
// Assures: [A-UNIT-001](docs/architecture/unit.md#a-unit-001)
```

The comment above shows `// Assures: A-UNIT-001`, and a click on
`A-UNIT-001` opens `unit.md` at the heading `A-UNIT-001`. The lines of the
cursor show the whole link, so that it can be edited.

## Link resolution

The extension reads links of the form `[label](target)` in comments. It
resolves a relative target in this order, and the first existing file wins:

1. Relative to the folder of the file that holds the comment.
2. Relative to the workspace folder.

A click opens the target with the editor that VS Code uses for its file type.
A fragment such as `#a-unit-001` opens a Markdown file at the heading with
that anchor. The anchor is the heading text in lower case, without
punctuation and with hyphens for spaces. The extension adds no link to a web
address, an absolute path, a bare fragment or a target without a file, and
such a link stays fully visible.

## Files

The extension reads the comments of these files. Text in a string is no
comment.

| Files | Comments |
| --- | --- |
| Go | `//` and `/* */` |
| Go module files (`go.mod`) | `//` |
| JavaScript, TypeScript, JSX and TSX | `//` and `/* */` |
| JSON and JSON with Comments | `//` and `/* */` |
| CSS | `/* */` |
| SCSS and Less | `//` and `/* */` |
| HTML and XML | `<!-- -->` |
| YAML, GitHub Actions workflows, shell scripts, Dockerfiles, ignore files, Makefiles and TOML | `#` |
| Properties and INI files | `#` and `;` |
| SQL | `--` and `/* */` |

A `#` or a `;` starts a comment only at the start of a line or after white
space. Markdown files keep the link handling of VS Code.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `nimblescape.commentMarkdownLinks.hideTargets` | `true` | Shows only the label of a resolved link. The value `false` shows every link completely. |

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](https://github.com/nimblescape/vscode-comment-markdown-links/blob/main/LICENSE).
