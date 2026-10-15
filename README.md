<h1 align="center">Continue</h1>

<p align="center">Pioneering open-source coding agent</p>

<div align="center">

<a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" /></a>
<a href="https://docs.continue.dev"><img src="https://img.shields.io/badge/Docs-docs.continue.dev-blue" /></a>
<a href="https://github.com/continuedev/continue/releases"><img src="https://img.shields.io/badge/Changelog-GitHub_Releases-blue" /></a>

</div>

<p align="center">
  <img src="media/github-readme.png" alt="Banner" />
</p>

## What is Continue?

> _Note: The `continuedev/continue` repository is no longer actively maintained and is read-only for all users._

Continue is a coding agent available as a [CLI](#cli), [VS Code extension](#vs-code), and [JetBrains plugin](#jetbrains).

## Documentation

To learn how to configure Continue, how it works, and how to customize it, check out the [Continue Docs](https://docs.continue.dev).

## Final 2.0.0 Release

We polished Continue and did a final 2.0.0 release of the VS Code extension, CLI, and JetBrains plugin.

This included removing anonymous telemetry, pulling out authentication, squashing bugs, and more.

### VS Code

[![VS Code Marketplace](https://img.shields.io/badge/VS_Code_Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=Continue.continue) [![OpenVSX Registry](https://img.shields.io/badge/OpenVSX_Registry-C160EF?logo=eclipseide&logoColor=white)](https://open-vsx.org/extension/Continue/continue) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](extensions/vscode)

### CLI

[![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/@continuedev/cli) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](extensions/cli)

### JetBrains

> _Note: We recommend using the Continue CLI instead of the JetBrains plugin._

[![GitHub Releases](https://img.shields.io/badge/GitHub_Releases-181717?logo=github&logoColor=white)](https://github.com/continuedev/continue/releases) [![View source](https://img.shields.io/badge/View_source-181717?logo=github&logoColor=white)](extensions/intellij)

## 2.0.2

This fork lets the IDE extension apply code edits and create files without clicking Accept.

Terminal and MCP auto-run are configured in Tools:

- **Auto-run commands** — base command names (e.g. `ls`, `git`) that run without confirmation. Chains require every segment to match; `find -exec` / `-delete` still asks.
- **Dangerous commands** — base command names (e.g. `sudo`, `rm`, `wget`) that always require confirmation. **Execute and remember** removes the command from this list and adds it to Auto-run commands.
- **Auto-run MCP tools** (off by default) — tools from connected MCP servers run without Accept.

A tool that is disabled in tool policies still never runs.

## Local build and run

The checkout does not include built IDE extensions. Activating Continue before a build fails with:

```text
Cannot find module '.../extensions/vscode/out/extension.js'
```

### Prerequisites

- Node.js 20.20.1 or newer. From the repository root, `nvm use` selects the version in `.nvmrc`.
- npm
- JetBrains only: JDK 17 and IntelliJ IDEA (Community or Ultimate)

### Install and build

From the repository root:

```bash
./scripts/install-dependencies.sh
```

On Windows:

```powershell
.\scripts\install-dependencies.ps1
```

The script installs dependencies and builds the shared packages, the GUI, the VS Code extension, and the core binary. When it finishes, these files exist:

- `extensions/vscode/out/extension.js`
- `binary/out/index.js`

### VS Code and Cursor

Open the repository root, then start the extension from this checkout:

1. Open **Run and Debug**.
2. Select **Launch extension** to open Cursor, or **Launch extension (VS Code)** to open Visual Studio Code.
3. Start debugging.

**Launch extension** opens a second Cursor window. **Launch extension (VS Code)** starts the installed Visual Studio Code and attaches the debugger to its extension host. The next launch replaces the previous debug window. The GUI dev server on port 5173 starts with that window when it is not already running, and stops when the window closes. Reload the window after changes in `core` or `extensions/vscode`. Changes in `gui` hot-reload. Both sessions write Continue config to `extensions/.continue-debug`.

If you packaged a Windows VSIX earlier, native binaries under `extensions/vscode` may still target `win32`. **Launch extension (VS Code)** runs `ensure-host-natives` before start and restores host sqlite / ripgrep / LanceDB / onnxruntime when they do not match this machine.

To install into an editor you already use, package a VSIX for this machine:

```bash
cd extensions/vscode
npm run package
```

The package is `extensions/vscode/build/continue-<version>.vsix`. In VS Code or Cursor, run **Extensions: Install from VSIX...** and select that file.

#### Package for Windows or Linux (cross-compile)

A VSIX includes native binaries (sqlite, ripgrep, LanceDB, onnxruntime). Build with an explicit target; otherwise the package matches the host OS.

Use Node from `.nvmrc` (`nvm use`). From the editor: **Tasks: Run Task**, then pick one of:

| Task                                 | Output                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| `vscode-extension:package-win32-x64` | `extensions/vscode/build/continue-win32-x64-<version>.vsix` |
| `vscode-extension:package-linux-x64` | `extensions/vscode/build/continue-linux-x64-<version>.vsix` |

Each task runs `prepackage` and `package` for that target, then `ensure-host-natives` so local debug still works on this machine. Linux is always `linux-x64`.

From the terminal:

```bash
cd extensions/vscode
node scripts/prepackage.js --target win32-x64
node scripts/package.js --target win32-x64
# or --target linux-x64
node scripts/ensure-host-natives.js
```

Do not commit `.vsix` files. GitHub rejects blobs over 100 MB (`GH001`), and cross-platform packages are often larger than that.

If a large `.vsix` was already committed and `git push` fails:

```bash
# stop tracking the file (keep it on disk)
git rm --cached continue-win32-x64-*.vsix
# or any other path that was added, e.g. continue-*.vsix at the repo root

# remove it from commits that are not on the remote yet
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter \
  'git rm --cached --ignore-unmatch continue-win32-x64-2.3.0.vsix' \
  origin/main..HEAD

git push -u origin HEAD
```

`*.vsix` is in `.gitignore`. Keep built packages under `extensions/vscode/build/` (also ignored) and share them outside git (release, Drive, etc.).

### JetBrains

Open the repository root in IntelliJ IDEA so the run configurations resolve `binary/`, `gui/`, and `extensions/intellij`. Use JDK 17 for the Gradle project.

In the run widget, select **Run Continue** and start it in Debug. On Community Edition, select **Run Continue (CE)**.

A second IDE window opens with the plugin installed. This debug session writes config to `extensions/.continue-debug` and leaves `~/.continue` unchanged.

To install a packaged plugin into an existing IDE:

```bash
cd extensions/intellij
./gradlew buildPlugin
```

On Windows, run `gradlew.bat buildPlugin`. The ZIP is `extensions/intellij/build/distributions/continue-*.zip`. Install it from **Settings | Plugins | gear | Install Plugin from Disk**.

## Contributors

Thank you to the entire Continue community for helping us create a pioneering coding agent.

What we built together pushed the boundaries of what AI developer tooling could be.

We hope this codebase continues to serve as a foundation for others.

## Code friends

<a href="https://github.com/continuedev/continue/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=continuedev/continue&max=500" />
</a>

## License

Apache 2.0 © 2023-2026 Continue Dev, Inc.
