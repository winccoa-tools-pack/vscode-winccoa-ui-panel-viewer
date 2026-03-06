# WinCC OA UI Panel Viewer

<div align="center">

![Version](https://img.shields.io/github/v/release/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer?label=version)
![License](https://img.shields.io/github/license/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer)
![VS Code](https://img.shields.io/badge/VS%20Code-1.109.2-007ACC.svg)
[![Coverage](https://codecov.io/gh/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/graph/badge.svg)](https://codecov.io/gh/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer)
[![Quality gate](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/actions/workflows/ci-cd.yml)
[![Released](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/actions/workflows/release.yml/badge.svg)](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/actions/workflows/release.yml)

</div>

A fast, read-only VS Code extension that transforms opaque WinCC OA `.pnl` panel files into a navigable, structured tree view — letting you inspect shapes, properties, scripts, and references without leaving your editor.

Part of the [WinCC OA Tools Pack](https://marketplace.visualstudio.com/items?itemName=mPokornyETM.wincc-oa-tools-pack).

---

## Features

### Panel Tree View

Open any `.pnl` or `.xml` panel file and see its structure as a collapsible tree: shapes, sub-shapes, properties, scripts, and references — all organized in a clear hierarchy. Directory-aware grouping keeps multi-panel projects tidy.

### Details Pane

Select any shape or property node in the tree to view its full details in a dedicated side panel.

### Virtual CTL Script Documents

Click a script node to open its CTL source as a read-only virtual document with full syntax highlighting — no need to extract scripts manually.

### Live File Watcher

The extension watches for changes to loaded `.pnl` files and automatically refreshes the tree when a panel is saved externally (e.g. from the WinCC OA GEDI editor).

### Panel Preview (WinCC OA native UI)

Launch `WCCOAui` directly from VS Code to preview a panel in the native WinCC OA runtime — one click from the tree view or the Command Palette.

### PNL ↔ XML Conversion

Convert individual files or entire directories between the binary `.pnl` format and human-readable `.xml` — useful for diffing, code review, or version control.

### Panel Syntax Check

Run `WCCOAui -syntax` on any panel from the Command Palette, the Explorer context menu, or the tree view title bar. The extension surfaces lines containing **WARNING**, **SEVERE**, or **FATAL** from the WinCC OA output so you can quickly spot problems.

---

## Requirements

- **VS Code** 1.109.2 or higher
- **WinCC OA** 3.19+ installed on your system
- Companion extension: [WinCC OA Project Admin](https://marketplace.visualstudio.com/items?itemName=RichardJanisch.winccoa-project-admin) (provides project context used by this extension)

---

## Experimental: AI / LLM Integration

This extension includes an **experimental** integration with VS Code language-model tools
so assistants like GitHub Copilot can inspect and validate WinCC OA panels.
APIs, behavior, and tool names may still change.

**Current benefits (experimental):**

- **Panel structure as JSON** – AI can call tools to read the parsed panel model
  (shapes, properties, scripts, references, basic errors) and reason about it.
- **Summarize panels** – AI can get a compact, natural-language style summary with
  key shape types, script events, and error counts to quickly understand a panel.
- **Open panels in UI viewer** – AI can open `.pnl` or `.xml` panels in the WinCC OA
  UI viewer (with XML converted to PNL on the fly) without you leaving the chat.
- **On-demand pnl ↔ xml conversion** – AI can trigger single-file or directory
  conversions between `.pnl` and `.xml`, so you can ask it to "convert this
  directory to XML and inspect panel X".
- **Panel syntax check via `-syntax`** – AI (and now a VS Code command) can run
  `WCCOAui -syntax` for a panel and surface lines containing `WARNING`, `SEVERE`,
  or `FATAL` from stderr/logs, helping you quickly see whether a panel is
  obviously broken.
- **Auto-loading by file path** – Most tools accept an absolute panel path and
  will load the panel into the internal tree on demand; you do **not** need to
  manually open the panel first.

Safety-wise, these AI tools are currently **read-only** for panel content; they
either inspect panels or run conversions/syntax checks you explicitly ask for.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build scripts, branching model, and CI details.

---

## License

MIT License. See <https://github.com/winccoa-tools-pack/.github/blob/main/LICENSE>.

---

## Disclaimer

**WinCC OA** and **Siemens** are trademarks of Siemens AG. This project is not
affiliated with, endorsed by, or sponsored by Siemens AG. This is a
community-driven open source project created to enhance the development
experience for WinCC OA developers.

---

## Quick Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mPokornyETM.wincc-oa-tools-pack)

---

<center>Made with ❤️ for and by the WinCC OA community</center>
