# Contributing

This guide explains the files, the development, the tests and the release of
the extension. The [README](README.md) describes the use in short, and the
section [How the extension works](#how-the-extension-works) keeps the details.

## Files

| File | Purpose |
| --- | --- |
| `extension.cjs` | The editor wiring: the link provider, the command that opens a target, the choice of the editor, the hiding of targets and the completion. |
| `links.cjs` | The text functions: the comment syntaxes, the comment scanner, the link finder and the heading lookup. They use no editor API and no file system. |
| `extension.test.cjs`, `links.test.cjs` | The tests of the two modules. |
| `package.json` | The extension manifest. The section [Manifest](#manifest) explains it. |
| `package-lock.json` | The locked development tools. npm writes this file, and nobody edits it by hand. |
| `.node-version` | The Node release of the development tools. `actions/setup-node` in the workflows and local Node version managers read it. |
| `.github/workflows/ci.yml` | Tests and packages every push to `main` and every pull request. |
| `.github/workflows/release.yml` | Builds a released version, creates its GitHub release and publishes it to the Marketplace. The section [Release](#release) explains it. |
| `.github/workflows/marketplace-identity.yml` | Prints the Marketplace member ID of the publishing identity for the one-time setup. |
| `.vscode/launch.json` | Starts a VS Code window that loads the extension from this folder. |

## Development

The extension uses Node built-ins and VS Code APIs and has no npm runtime
dependency. The only development tool is
[`@vscode/vsce`](https://github.com/microsoft/vscode-vsce), the Microsoft tool
that packages and publishes extensions. It needs Node 22 or later.

| Command | Effect |
| --- | --- |
| `npm ci --ignore-scripts` | Installs the locked development tools and runs no install script of a dependency. |
| `npm test` | Runs the tests with `node --test`. The tests touch no installed editor. |
| `npm run package` | Builds `comment-markdown-links-<version>.vsix` with vsce. vsce also validates the manifest and the README. |
| `code --install-extension comment-markdown-links-<version>.vsix` | Installs the built package. Reload the window after an update of an active extension. |

The launch configuration "Run the extension" starts a second VS Code window
that loads the extension from this folder, so that a change can be tried
without a package.

## Manifest

`package.json` is the extension manifest. It has these parts:

- The name and the publisher define the extension ID `nimblescape.comment-markdown-links`.
- The version is the only source of the package version, and the tag of a release names it.
- The engine range defines the compatible VS Code versions.
- `main` selects the entry point.
- `files` lists the files of the package beside `package.json` and `README.md`. A test checks that the list holds every module that the entry point requires.
- `extensionKind` selects the workspace host.
- The activation events activate the extension when a document of a listed language opens. A test keeps them equal to the language table of `links.cjs`.
- The configuration contribution declares the setting that turns the hiding of targets off.
- The untrusted-workspace and virtual-workspace capabilities state that the extension only reads.
- The development dependency pins vsce. The manifest declares no runtime dependency.

The file table of the README follows the language table of `links.cjs`, and
the settings table of the README follows the configuration contribution. A
test checks that the README names every setting.

## How the extension works

### Links on the label

The extension registers one document link provider for the listed
languages. The editor link covers the label of `[label](target)`, as in
rendered Markdown, for one more reason. The Go language server takes the file
name of a target such as `unit.md#a-unit-001` for a web address, because
`.md` is also a top-level domain, and links it to `https://unit.md`. The
editor keeps only one of two links that overlap: the link of the provider
that registered later. The Go language server registers its provider after
this extension and again after every restart, so a link on the target would
disappear behind that web-address link, and the extension cannot remove it.
The extension hides the target instead, so that the web-address link shows
no underline.

### Hidden targets

An editor decoration hides the brackets and the target of every resolved
link. The text stays in the file. The lines that a cursor or a selection
touches show the whole link. A link whose target resolves nowhere stays
visible, so that a broken citation is seen. The editor offers no interface
for hidden text, so the decoration uses the `display` style through its text
decoration, as other extensions do.

### Opening a target

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
equals the fragment. Headings inside fenced code blocks do not count. The
Markdown Editor ignores the requested selection, because VS Code passes no
selection to a custom editor, as
[microsoft/vscode#289785](https://github.com/microsoft/vscode/issues/289785)
records. A fragment without a heading requests the start of the document. A
target without a fragment opens as the editor opens files.

The editor moves the cursor to a mouse click before it follows a link. The
command puts the cursor of the source editor back to where it was before the
click, so that following a link with the mouse moves no cursor and reveals no
hidden target.

### Completion

While a Markdown link to a local file is written in a comment, the extension
completes its target. Before a number sign it offers the folders and files of
the directory that the target names, resolved like a link: the entries beside
the file first, then the entries of the workspace folder. A folder inserts
its name with a slash and opens the next completion. After the number sign of
a Markdown target it offers the anchors of the headings of that document,
with the heading text as the detail. The completion opens on `(`, `/` and
`#`, and on the completion key of the editor. A link to a web address, an
absolute path or a bare fragment gets no completion.

### Scope and limits

The extension reads files through the workspace file system, changes no
file, runs no process and needs no opt-in. It supports untrusted and virtual
workspaces, because it only reads. It runs in the workspace host
(`extensionKind: workspace`), so it resolves links on a remote host, for
example in a Codespace.

The extension recognizes links in comments only. It resolves no link in a
string literal, in a generated documentation view, in a Markdown file or in a
language outside the table of the README. A script or style block inside an
HTML document follows the markup syntax, so the comment markers of the script
or style language are not recognized there.

## Release

A released version is a tag `v<version>` whose `<version>` equals the version
in `package.json`. To release a version, follow these steps:

1. Run `npm version <version> --no-git-tag-version`. The command updates `package.json` and `package-lock.json`.
2. Add a section `## <version>` to `CHANGELOG.md`.
3. Merge the change to `main`.
4. Tag the merged commit and push the tag: `git tag v<version>`, then `git push origin v<version>`.

The tag starts the workflow "Release". It runs three jobs:

1. "Release build" tests the tagged source and builds the VSIX with vsce. It stops when the tag differs from the manifest version or when `CHANGELOG.md` has no section for the version.
2. "GitHub release" creates the release of the tag with the GitHub CLI `gh`. The section of the version in `CHANGELOG.md` becomes the notes, and the VSIX becomes the file of the release. A release that exists, for example one created on the GitHub website, keeps its notes and receives the VSIX only when it holds none.
3. "Publish to the Visual Studio Marketplace" downloads the VSIX of the GitHub release, signs in to Microsoft Entra ID with the official [`azure/login`](https://github.com/Azure/login) action and publishes the VSIX with `vsce publish --azure-credential`.

When a job fails, remove the cause and choose "Re-run failed jobs" on the
run. A re-run keeps the VSIX that the GitHub release already holds, and the
Marketplace skips a version that it already holds, so a re-run never
publishes a version twice.

## One-time Marketplace setup

The workflow publishes with a Microsoft Entra ID token, as the
[Microsoft publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
recommends. It uses no personal access token, because Azure DevOps retires
the global personal access tokens that the Marketplace needs on
1 December 2026. The publishing identity is an app registration with a
federated credential: GitHub Actions proves the identity of the job with an
OpenID Connect token, so no secret is stored. An app registration needs no
Azure subscription. One app registration publishes every extension of the
publisher `nimblescape`, because the Marketplace grants the role of a member
for the whole publisher.

### Setup for the first extension

1. Create the publisher. Sign in to the [publisher management page](https://marketplace.visualstudio.com/manage) of the Visual Studio Marketplace with the Microsoft account of nimblescape e.U. Choose "Create publisher" and enter the ID `nimblescape`, which must equal the publisher in `package.json`.
2. Register the app. In the [Microsoft Entra admin center](https://entra.microsoft.com), open "App registrations" and choose "New registration". Enter a name such as `nimblescape-marketplace-publisher` and keep "Single tenant". Note the "Application (client) ID" and the "Directory (tenant) ID". The app needs no API permission and no secret.
3. Set the variables. In the settings of the organization `nimblescape`, open "Secrets and variables", then "Actions", then the tab "Variables". Add the organization variable `AZURE_CLIENT_ID` with the application (client) ID and the organization variable `AZURE_TENANT_ID` with the directory (tenant) ID. Both values are identifiers, not secrets. The workflows take the variable of the environment first, then the one of the repository, then the one of the organization. Organization variables reach private repositories only on a paid GitHub plan.
4. Add the federated credential. In the app registration, open "Certificates & secrets", then the tab "Federated credentials", and choose "Add credential" with the scenario "GitHub Actions deploying Azure resources". Enter the values of the table below. The subject is then `repo:nimblescape@156021698/vscode-comment-markdown-links@1385966074:environment:marketplace`.
5. Create the environment. In the settings of this repository, open "Environments" and create the environment `marketplace`. Add a deployment rule that allows the tags `v*` and the branch `main`, so that only a released version and the workflow "Marketplace identity" reach the environment.
6. Find the member ID. In the tab "Actions", run the workflow "Marketplace identity". Its summary shows the ID of the app registration.
7. Authorize the identity. In the publisher management page, open the publisher `nimblescape`, then "Members". Add the ID of step 6 with the role "Contributor".

| Field of the federated credential | Value for this repository |
| --- | --- |
| Organization | `nimblescape` |
| Organization ID | `156021698` |
| Repository | `vscode-comment-markdown-links` |
| Repository ID | `1385966074` |
| Entity type | Environment |
| GitHub environment name | `marketplace` |
| Audience | `api://AzureADTokenExchange`, the default |

GitHub puts the owner ID and the repository ID into the subject of every
repository created after 15 July 2026, so a new owner of a reused name gets no
token. The command `gh api repos/nimblescape/<repository> --jq .id` prints
the ID of a repository.

### Setup for each further extension

A further extension repository needs only steps 4 and 5, with its own
repository name and ID. The publisher, the app, the variables and the member
stay unchanged. One app accepts at most 20 federated credentials.

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](LICENSE).
