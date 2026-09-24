# Contributing

This guide explains the files, the development, the tests and the release of
the extension. The [README](README.md) describes the behavior for users.

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
| `npm run package` | Builds `markdown-links-<version>.vsix` with vsce. vsce also validates the manifest and the README. |
| `code --install-extension markdown-links-<version>.vsix` | Installs the built package. Reload the window after an update of an active extension. |

The launch configuration "Run the extension" starts a second VS Code window
that loads the extension from this folder, so that a change can be tried
without a package.

## Manifest

`package.json` is the extension manifest. It has these parts:

- The name and the publisher define the extension ID `nimblescape.markdown-links`.
- The version is the only source of the package version, and the tag of a release names it.
- The engine range defines the compatible VS Code versions.
- `main` selects the entry point.
- `files` lists the files of the package beside `package.json` and `README.md`. A test checks that the list holds every module that the entry point requires.
- `extensionKind` selects the workspace host.
- The activation events activate the extension when a document of a listed language opens. A test keeps them equal to the language table of `links.cjs`.
- The configuration contribution declares the setting that turns the hiding of targets off.
- The untrusted-workspace and virtual-workspace capabilities state that the extension only reads.
- The development dependency pins vsce. The manifest declares no runtime dependency.

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
Azure subscription.

1. Create the publisher. Sign in to the [publisher management page](https://marketplace.visualstudio.com/manage) of the Visual Studio Marketplace with the Microsoft account of nimblescape e.U. Choose "Create publisher" and enter the ID `nimblescape`, which must equal the publisher in `package.json`.
2. Register the app. In the [Microsoft Entra admin center](https://entra.microsoft.com), open "App registrations" and choose "New registration". Enter a name such as `markdown-links-publisher` and keep "Single tenant". Note the "Application (client) ID" and the "Directory (tenant) ID". The app needs no API permission and no secret.
3. Add the federated credential. In the app registration, open "Certificates & secrets", then the tab "Federated credentials", and choose "Add credential" with the scenario "GitHub Actions deploying Azure resources". Enter the organization `nimblescape`, the repository `vscode-markdown-links`, the entity type "Environment" and the environment `marketplace`. The subject is then `repo:nimblescape/vscode-markdown-links:environment:marketplace`.
4. Create the GitHub environment. In the settings of this repository, open "Environments" and create the environment `marketplace`. Add the environment variable `AZURE_CLIENT_ID` with the application (client) ID and the environment variable `AZURE_TENANT_ID` with the directory (tenant) ID. Both values are identifiers, not secrets.
5. Find the member ID. In the tab "Actions", run the workflow "Marketplace identity". Its summary shows the ID of the app registration.
6. Authorize the identity. In the publisher management page, open the publisher `nimblescape`, then "Members". Add the ID of step 5 with the role "Contributor".

The environment accepts every branch and tag by default. After step 5, a
deployment rule that allows only tags `v*` limits the environment to released
versions. Allow the branch `main` as well to run the workflow "Marketplace
identity" again.

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](LICENSE).
