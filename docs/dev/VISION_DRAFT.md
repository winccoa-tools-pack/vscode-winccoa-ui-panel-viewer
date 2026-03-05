# Vision — VS Code WinCC OA UI Panel Viewer (Draft)

## Vision

Enable engineers to quickly inspect WinCC OA UI panels inside VS Code with a fast, read-only viewer
that transforms opaque `.pnl` files into a clear, navigable representation and an optional runtime
preview. The viewer should make panel structure, properties, and scripts discoverable without
requiring the WinCC OA IDE.

## Mission

Ship an MVP that provides reliable panel inspection, reduces developer friction when exploring UIs, and lays a maintainable foundation for future validation and editing features.

## Target audience

- WinCC OA integrators and developers who need to inspect or audit panels.
- Technical writers and maintainers preparing documentation or migrating panels.
- Automation engineers validating panel structure and scripts.

## Goals (MVP v1)

- Open `.pnl` files in a custom, read-only viewer.
- Render a structured tree (panel → shapes → properties → scripts → references).
- Show property details, render color values, and present scripts with CTL syntax highlighting.
- Provide a preview launcher to start WinCC OA UI for the selected panel path.
- Detect encrypted panels and show clear, actionable messaging.
- Watch `.pnl` changes and reload the viewer automatically; ignore `.bak` files.
- Provide conversion commands: `pnl → xml`, `xml → pnl`, and recursive directory conversions.
- **Integrate LanguageModelToolsService** to expose panel structure and properties to Copilot/AI assistants.

## Out of scope (MVP v1)

- Editing panels inside VS Code.
- Full XML schema validation and automatic fixes.

## Success metrics

- Time-to-inspect: open and render a typical panel within 2–3 seconds on supported platforms.
- Accuracy: structural conversion correctly maps >95% of shapes/properties in representative test fixtures.
- Stability: viewer reloads reliably on file changes without corrupting workspace files.

## Key decisions

- Keep the `.pnl` file as the single source of truth.
- Viewer mode uses temporary XML output to avoid adding generated files to repos.
- Conversion commands write outputs alongside source files when explicitly requested.

## MVP feature checklist

### ✅ Completed (v0.1.0 - 2026-03-04)

- **Core Extension Infrastructure**
  - [x] Extension activation on `.pnl` and `.xml` files
  - [x] Command registration and palette integration
  - [x] Tree view provider for panel structure
  - [x] Extension output channel for logging

- **Conversion Commands**
  - [x] Single-file `pnl → xml` conversion (`winccoa-panel.pnlToXml`)
  - [x] Single-file `xml → pnl` conversion (`winccoa-panel.xmlToPnl`)
  - [x] Recursive directory `pnl → xml` conversion
  - [x] Recursive directory `xml → pnl` conversion
  - [x] Integration with `@winccoa-tools-pack/npm-winccoa-ui-pnl-xml` package

- **Panel Parser**
  - [x] Tolerant XML parsing for WinCC OA panel format
  - [x] Property extraction (`<prop name="...">`)
  - [x] Shape extraction (`<shape Name="..." shapeType="...">`)
  - [x] Script/event extraction (`<script name="..."><![CDATA[...]]>`)
  - [x] Reference detection (panel refs, $-parameters)

- **Tree View**
  - [x] Hierarchical panel structure display
  - [x] Shape nodes with type icons
  - [x] Property nodes
  - [x] Script nodes (clickable to view code)

- **Integration**
  - [x] Preview launcher using UIComponent from npm-winccoa-core
  - [x] Preview launcher option to pass extra user-defined UI arguments (ui.viewer)
  - [x] Change detection and automatic re-conversion (file watcher)
  - [x] WinCC OA version picker (uses version from selected project)

### 🔲 In Progress / Next Steps

- **Viewer UI Enhancements**
  - [ ] Details pane for properties and scripts
  - [ ] Syntax-highlighted CTL script view (webview)
  - [ ] Color value preview in properties
  - [ ] Font preview

- **Integration**
  - [ ] Config path auto-detection from workspace

- **AI Integration (MUST HAVE)**
  - [ ] LanguageModelToolsService integration for Copilot/AI assistants

- **Error Handling**
  - [ ] Detect and clearly report encrypted panels
  - [ ] Surface conversion/toolchain errors with actionable guidance
  - [ ] Prompt behavior for files with no extension

### 🔮 Future (v1.0+)

- [ ] Schema validation for 3.20 / 3.21
- [ ] Panel topology diagram (shapes as boxes)
- [ ] Safe edit workflows

## Architecture principles

- Cross-platform by design (Windows primary; Linux/macOS supported where toolchain allows).
- Clear separation of concerns: conversion, tolerant parsing/model building, UI rendering.
- Fail fast and provide actionable errors (missing tools, conversion failures, encryption).
- Small, testable units for parsing and model transformation.

## Roadmap (high level)

1. Ship MVP v1 (viewer + basic conversion commands).
2. Add richer validation and versioned schemas for 3.20 / 3.21.
3. Explore safe edit workflows (explicit writes, undo, scaffolding tests).

## Risks & mitigations

- Encrypted/unsupported panel formats: detect early and show explicit guidance instead of failing silently.
- Toolchain differences across OSes: document and test supported invocation patterns; isolate platform-specific code behind an adapter.

---

Last updated: 2026-03-05
