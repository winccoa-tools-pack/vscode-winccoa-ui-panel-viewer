# Development Vision: VS Code WinCC OA UI Panel Viewer

This document defines the development vision for the repository:

- [winccoa-tools-pack/vscode-winccoa-ui-panel-viewer](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer)

It is intentionally MVP-focused so implementation work can proceed without ambiguity.

## Vision statement

Make WinCC OA UI panels inspectable in VS Code by providing a fast, read-only viewer that turns unreadable `.pnl` into a structured UI representation, with optional runtime preview.

Background and research context:

- [winccoa-tools-pack/.github#21](https://github.com/winccoa-tools-pack/.github/issues/21)

## First delivery (MVP v1)

Milestone:

- [MVP v1 milestone](https://github.com/winccoa-tools-pack/vscode-winccoa-ui-panel-viewer/milestone/1)

Project board:

- [Org project board](https://github.com/orgs/winccoa-tools-pack/projects/4)

### What MVP v1 delivers

- Open panel in a custom viewer (read-only).
- Structure tree view:

  - panel root
  - shapes
  - properties
  - scripts/events
  - panel references

- Details view:

  - show raw properties and values (including colors as values)
  - show scripts as CTL text with syntax highlighting

- Preview launcher:

  - start WinCC OA UI for a panel with `-p panels/relative/path/to/panel.pnl`

- Change handling:

  - `.pnl` change triggers re-conversion and viewer reload
  - `.bak` files are ignored

- Commands:

  - `pnl → xml` and `xml → pnl` for single files
  - directory conversion (recursive)
  - special case: panels without extension must prompt the user (treat as pnl / skip / apply-to-all)

### Key decisions (MVP)

- Source of truth is `.pnl`.
- Viewer mode generates XML in a temporary location and removes it after load:

  - avoids two competing sources (`.pnl` and `.xml`) inside the project tree

- Command mode writes conversion output next to the file (same folder).

### Encrypted panels

- Encrypted panels are detected by the first line starting with `PVSS_CRYPTED_PANEL`.
- MVP behavior: show an explicit “Encrypted panel; content not viewable” message and do not parse.

## Out of scope for MVP v1

- Editing panels.
- XML schema validation and quality gates.

The validator/schema idea is tracked separately and should not block MVP delivery.

## Validator and schemas (future)

Separate feature request:

- Maintain schemas ourselves for WinCC OA 3.20 and 3.21.
- Likely schema-per-version.
- Support loading schemas from local filesystem paths.

Implementation details and packaging for this future work belong in a dedicated issue and design doc.

## Architecture principles

- Cross-platform first (Windows primary, Linux/macOS supported where WinCC OA toolchain allows).
- Separate concerns:

  - conversion (WinCC OA integration)
  - tolerant parsing/model building (no strict schema dependency in v1)
  - UI rendering (tree + details + script view)

- Failure should be explicit and actionable (conversion errors, missing tools, encrypted panels).

## Quality bar

- Small, testable units for parsing and model building.
- Clear boundary between “viewer mode” (tmp XML) and “command mode” (in-place outputs).
- No hidden writes to user files except explicit conversion commands.

## Last updated

2026-03-02
