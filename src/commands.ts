/**
 * @fileoverview Command registration for panel viewer extension.
 *
 * Registers all commands: conversion, preview launcher, and viewer actions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionOutputChannel } from './extensionOutput';
import {
    convertPnlToXml,
    convertXmlToPnl,
    convertDirectoryPnlToXml,
    convertDirectoryXmlToPnl,
    isEncryptedPanel,
} from './converter';
import { PanelTreeProvider } from './panelTreeProvider';
import { parsePanelXml } from './panelParser';
import { createEncryptedPanelModel } from './panelModel';
import { PanelScript, PanelModel } from './panelModel';
import { PanelDetailsView } from './panelDetailsView';
import { VirtualCtlProvider } from './virtualCtlProvider';
import { UIComponent } from '@winccoa-tools-pack/npm-winccoa-core/types/components/implementations/index';
import { getSelectedProject } from './otherExtensions';
import { CORE_EXTENSION_ID, EXTENSION_NAME } from './const';
import { ProjEnvProjectFileSysStruct } from '@winccoa-tools-pack/npm-winccoa-core';

/** Singleton tree provider instance */
let treeProvider: PanelTreeProvider | undefined;

/** Details view provider instance */
let detailsViewProvider: PanelDetailsView | undefined;

/** Virtual CTL provider for showing scripts as <event>.ctl */
let virtualCtlProvider: VirtualCtlProvider | undefined;

/** File watcher for .pnl changes */
let fileWatcher: vscode.FileSystemWatcher | undefined;

/** Debounce timers for panel reloads (keyed by absolute fsPath) */
const pendingPanelReloads = new Map<string, NodeJS.Timeout>();

/** Currently viewed panel path */
let currentPanelPath: string | undefined;

/**
 * Registers all extension commands.
 */
export function registerCommands(context: vscode.ExtensionContext): void {
    // Initialize tree provider
    treeProvider = new PanelTreeProvider();
    const treeView = vscode.window.createTreeView('winccoaPanelStructure', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Register details pane (webview view)
    detailsViewProvider = new PanelDetailsView();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PanelDetailsView.viewType, detailsViewProvider),
    );

    // Register virtual CTL provider (so scripts open as read-only virtual .ctl docs)
    virtualCtlProvider = new VirtualCtlProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            VirtualCtlProvider.scheme,
            virtualCtlProvider,
        ),
    );

    // Update details pane when selection changes
    context.subscriptions.push(
        treeView.onDidChangeSelection((e) => {
            detailsViewProvider?.setSelection(e.selection[0]);
        }),
    );

    // Register commands
    context.subscriptions.push(
        // Open panel in viewer
        vscode.commands.registerCommand('winccoaPanelViewer.openPanel', openPanelCommand),

        // Load all panels from project
        vscode.commands.registerCommand('winccoaPanelViewer.loadAllPanels', loadAllPanelsCommand),

        // Clear panel viewer
        vscode.commands.registerCommand('winccoaPanelViewer.clearPanels', clearPanelsCommand),

        // Convert single file
        vscode.commands.registerCommand('winccoaPanelViewer.pnlToXml', pnlToXmlCommand),
        vscode.commands.registerCommand('winccoaPanelViewer.xmlToPnl', xmlToPnlCommand),

        // Convert directory
        vscode.commands.registerCommand(
            'winccoaPanelViewer.convertDirPnlToXml',
            convertDirPnlToXmlCommand,
        ),
        vscode.commands.registerCommand(
            'winccoaPanelViewer.convertDirXmlToPnl',
            convertDirXmlToPnlCommand,
        ),

        // Preview launcher
        vscode.commands.registerCommand('winccoaPanelViewer.previewPanel', previewPanelCommand),
        vscode.commands.registerCommand(
            'winccoaPanelViewer.previewPanelWithOptions',
            previewPanelWithOptionsCommand,
        ),

        // Syntax check (WCCOAui -syntax)
        vscode.commands.registerCommand(
            'winccoaPanelViewer.checkPanelSyntax',
            checkPanelSyntaxCommand,
        ),

        // Show script in editor
        vscode.commands.registerCommand('winccoaPanelViewer.showScript', showScriptCommand),

        // Smoke test: dump language model tools visible to extensions
        vscode.commands.registerCommand(
            'winccoaPanelViewer.dumpLanguageModelTools',
            dumpLanguageModelToolsCommand,
        ),

        vscode.commands.registerCommand(
            'winccoaPanelViewer.invokeListLoadedPanelsTool',
            invokeListLoadedPanelsToolCommand,
        ),

        vscode.commands.registerCommand(
            'winccoaPanelViewer.invokeGetPanelModelTool',
            invokeGetPanelModelToolCommand,
        ),
    );

    // Setup file watcher for .pnl changes
    setupFileWatcher(context);

    // Register Language Model tools for Copilot/AI assistants
    registerLanguageModelTools(context);

    ExtensionOutputChannel.info('Commands', 'Panel viewer commands registered');
}

async function dumpLanguageModelToolsCommand(): Promise<void> {
    try {
        ExtensionOutputChannel.initialize();

        const tools = vscode.lm?.tools ?? [];
        const winccoaTools = tools.filter((t) => t.name.startsWith('winccoaPanelViewer_'));

        const payload = {
            totalCount: tools.length,
            winccoaCount: winccoaTools.length,
            winccoaTools: winccoaTools.map((t) => ({
                name: t.name,
                description: t.description,
                tags: t.tags,
                inputSchema: t.inputSchema,
            })),
        };

        ExtensionOutputChannel.info(
            'LM Tools',
            `Visible tools: ${tools.length}. WinCC OA tools: ${winccoaTools.length}.`,
        );
        ExtensionOutputChannel.info('LM Tools', JSON.stringify(payload, null, 2));
        ExtensionOutputChannel.instance.show(true);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error('LM Tools', 'Failed to dump language model tools', error);
        void vscode.window.showErrorMessage('Failed to dump language model tools. See Output.');
    }
}

async function invokeListLoadedPanelsToolCommand(): Promise<void> {
    try {
        ExtensionOutputChannel.initialize();

        const result = await vscode.lm.invokeTool('winccoaPanelViewer_listLoadedPanels', {
            toolInvocationToken: undefined,
            input: {},
        });

        ExtensionOutputChannel.info('LM Tools', 'Invoked tool winccoaPanelViewer_listLoadedPanels');
        ExtensionOutputChannel.info('LM Tools', formatLanguageModelToolResultForLog(result));
        ExtensionOutputChannel.instance.show(true);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to invoke tool winccoaPanelViewer_listLoadedPanels',
            error,
        );
        void vscode.window.showErrorMessage('Failed to invoke LM tool. See Output.');
    }
}

async function invokeGetPanelModelToolCommand(): Promise<void> {
    try {
        ExtensionOutputChannel.initialize();

        const result = await vscode.lm.invokeTool('winccoaPanelViewer_getPanelModel', {
            toolInvocationToken: undefined,
            input: {
                includeScripts: true,
                maxScriptChars: 2000,
            },
        });

        ExtensionOutputChannel.info('LM Tools', 'Invoked tool winccoaPanelViewer_getPanelModel');
        ExtensionOutputChannel.info('LM Tools', formatLanguageModelToolResultForLog(result));
        ExtensionOutputChannel.instance.show(true);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to invoke tool winccoaPanelViewer_getPanelModel',
            error,
        );
        void vscode.window.showErrorMessage('Failed to invoke LM tool. See Output.');
    }
}

async function checkPanelSyntaxCommand(uri?: vscode.Uri): Promise<void> {
    try {
        ExtensionOutputChannel.initialize();

        let filePath: string | undefined;

        if (uri) {
            filePath = uri.fsPath;
        } else if (currentPanelPath) {
            filePath = currentPanelPath;
        } else if (vscode.window.activeTextEditor?.document?.uri?.fsPath) {
            filePath = vscode.window.activeTextEditor.document.uri.fsPath;
        }

        if (!filePath) {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'WinCC OA Panels': ['pnl'] },
                title: 'Select Panel File to Check Syntax',
            });
            if (!picked || picked.length === 0) {
                return;
            }
            filePath = picked[0].fsPath;
        }

        const normalizedPath = filePath.replace(/\\/g, path.sep);

        const currentProject = getSelectedProject();
        if (!currentProject) {
            void vscode.window.showErrorMessage(
                'No WinCC OA project selected. Select a project in WinCC OA Project Admin first.',
            );
            return;
        }

        const version = currentProject.getVersion();
        if (!version) {
            void vscode.window.showErrorMessage(
                'Cannot determine WinCC OA version from selected project; syntax check is not possible.',
            );
            return;
        }

        const projPanelsPath = currentProject
            .getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH)
            .replace(/\\/g, '/');

        const normalizedForCompare = normalizedPath.replace(/\\/g, '/');
        if (
            !normalizedForCompare.toLocaleLowerCase().startsWith(projPanelsPath.toLocaleLowerCase())
        ) {
            void vscode.window.showErrorMessage(
                `Selected panel is not within the current project's panels directory.\nProject panels path: ${projPanelsPath}\nPanel path: ${normalizedPath}`,
            );
            return;
        }

        const relativePanelPath = normalizedForCompare.substring(projPanelsPath.length);

        const uiComponent = new UIComponent();
        uiComponent.setVersion(version);

        if (!uiComponent.exists()) {
            void vscode.window.showErrorMessage(
                `WinCC OA UI executable not found for version ${version}.`,
            );
            return;
        }

        const timeoutMs = 60000;
        const severities = ['WARNING', 'SEVERE', 'FATAL'];

        ExtensionOutputChannel.info(
            'Syntax',
            `Running WCCOAui -syntax for panel ${relativePanelPath} (version=${version})`,
        );

        const args = [
            '-config',
            currentProject.getConfigPath(),
            '-syntax',
            'panels+',
            '-p',
            relativePanelPath,
            '-n',
            '-log',
            '+stderr',
        ];

        const exitCode = await uiComponent.start(args, {
            timeout: timeoutMs,
            checkStdout: false,
        });

        const stderr = uiComponent.stdErr ?? '';
        const stdout = uiComponent.stdOut ?? '';

        const issueLines: { severity: string; message: string }[] = [];
        const upperSeverities = severities.map((s) => s.toUpperCase());

        for (const rawLine of stderr.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const upperLine = line.toUpperCase();
            const matchedSeverity = upperSeverities.find((s) => upperLine.includes(s));
            if (matchedSeverity) {
                issueLines.push({ severity: matchedSeverity, message: line });
            }
        }

        const ok = exitCode === 0 && issueLines.length === 0;

        if (ok) {
            ExtensionOutputChannel.info(
                'Syntax',
                `Panel syntax OK for ${relativePanelPath} (no WARNING/SEVERE/FATAL). Exit code=${exitCode}.`,
            );
            ExtensionOutputChannel.instance.show(true);
            void vscode.window.showInformationMessage(
                `Panel syntax OK for ${path.basename(normalizedPath)}.`,
            );
            return;
        }

        ExtensionOutputChannel.warn(
            'Syntax',
            `Panel syntax check found ${issueLines.length} issue(s) for ${relativePanelPath}. Exit code=${exitCode}.`,
        );
        for (const issue of issueLines) {
            ExtensionOutputChannel.warn('Syntax', `${issue.severity}: ${issue.message}`);
        }

        if (stderr.trim()) {
            ExtensionOutputChannel.warn('Syntax', '--- stderr ---');
            ExtensionOutputChannel.warn('Syntax', stderr);
        }
        if (stdout.trim()) {
            ExtensionOutputChannel.info('Syntax', '--- stdout ---');
            ExtensionOutputChannel.info('Syntax', stdout);
        }

        ExtensionOutputChannel.instance.show(true);
        void vscode.window.showWarningMessage(
            `Panel syntax check found ${issueLines.length} issue(s) for ${path.basename(
                normalizedPath,
            )}. See "${EXTENSION_NAME}" output for details.`,
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error('Syntax', 'Failed to run panel syntax check', error);
        ExtensionOutputChannel.instance.show(true);
        void vscode.window.showErrorMessage(
            'Failed to run panel syntax check. See Output for details.',
        );
    }
}

function formatLanguageModelToolResultForLog(result: vscode.LanguageModelToolResult): string {
    // LanguageModelToolResult is conceptually "parts", but the concrete shape in
    // JS can include wrapper objects (e.g. `{ content: [...] }`).
    // When tools return `LanguageModelDataPart.json(...)`, VS Code transports
    // JSON as bytes. `JSON.stringify(result)` therefore shows a Buffer/Uint8Array wrapper.
    const flattenedParts = flattenLanguageModelResultParts(result);

    const decodedParts = flattenedParts.map((part) => {
        const anyPart = part as unknown as {
            mimeType?: string;
            data?: unknown;
            value?: unknown;
            content?: unknown;
        };

        // Text parts usually have a `value` field.
        if (typeof anyPart.value === 'string') {
            return { kind: 'text', value: anyPart.value };
        }

        if (typeof anyPart.mimeType === 'string') {
            const decoded = decodeLanguageModelDataPart(anyPart.data);
            if (decoded !== undefined) {
                if (anyPart.mimeType === 'text/x-json' || anyPart.mimeType === 'application/json') {
                    try {
                        return {
                            kind: 'json',
                            mimeType: anyPart.mimeType,
                            value: JSON.parse(decoded),
                        };
                    } catch {
                        return { kind: 'data', mimeType: anyPart.mimeType, value: decoded };
                    }
                }
                return { kind: 'data', mimeType: anyPart.mimeType, value: decoded };
            }
            return { kind: 'data', mimeType: anyPart.mimeType, value: anyPart.data };
        }

        return { kind: 'unknown', value: part };
    });

    return JSON.stringify(decodedParts, null, 2);
}

function flattenLanguageModelResultParts(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        return value.flatMap((v) => flattenLanguageModelResultParts(v));
    }

    if (value && typeof value === 'object') {
        // Some VS Code internals wrap results as `{ content: [...] }`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maybeContent = (value as any).content;
        if (Array.isArray(maybeContent)) {
            return flattenLanguageModelResultParts(maybeContent);
        }
    }

    return [value];
}

function decodeLanguageModelDataPart(data: unknown): string | undefined {
    if (data === undefined || data === null) {
        return undefined;
    }

    if (typeof data === 'string') {
        return data;
    }

    // Node.js Buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data as any)) {
        return (data as Buffer).toString('utf8');
    }

    // Uint8Array
    if (data instanceof Uint8Array) {
        return new TextDecoder('utf-8').decode(data);
    }

    // JSON-serialized buffer: { type: 'Buffer', data: number[] }
    if (
        typeof data === 'object' &&
        data !== null &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data as any).type === 'Buffer' &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.isArray((data as any).data)
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bytes = (data as any).data as number[];
        return Buffer.from(bytes).toString('utf8');
    }

    return undefined;
}

async function ensurePanelModelLoaded(filePath: string): Promise<boolean> {
    if (!treeProvider) {
        return false;
    }

    if (treeProvider.hasModel(filePath)) {
        return true;
    }

    try {
        await loadPanelIntoViewerSilent(filePath);
    } catch (err) {
        ExtensionOutputChannel.warn(
            'LM Tools',
            `Failed to load panel model for ${filePath}: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
        return false;
    }

    return treeProvider.hasModel(filePath);
}

function registerLanguageModelTools(context: vscode.ExtensionContext): void {
    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_listLoadedPanels', {
                prepareInvocation: () => ({
                    invocationMessage: 'Listing loaded WinCC OA panels…',
                }),
                invoke: async (_options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_listLoadedPanels',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true, count: 0, panels: [] }),
                                ),
                            ]);
                        }

                        const models: PanelModel[] = treeProvider?.listModels() ?? [];
                        const activeEditorPath =
                            vscode.window.activeTextEditor?.document?.uri?.fsPath;

                        const payload = {
                            count: models.length,
                            panels: models.map((m: PanelModel) => ({
                                filePath: m.filePath,
                                name: m.name,
                                encrypted: m.encrypted,
                            })),
                            context: models.length
                                ? undefined
                                : {
                                      hint: 'No panels are currently loaded in the Panel Viewer tree in this VS Code window. Use "WinCC OA: Open Panel in Viewer" or "WinCC OA: Load All Panels from Project" first.',
                                      currentPanelPath,
                                      activeEditorPath,
                                  },
                        };

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_listLoadedPanels (count=${models.length}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_listLoadedPanels',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message, count: 0, panels: [] }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_listLoadedPanels',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_getPanelModel', {
                prepareInvocation: () => ({
                    invocationMessage: 'Reading WinCC OA panel model…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_getPanelModel',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                            includeScripts?: boolean;
                            maxScriptChars?: number;
                        };

                        const models: PanelModel[] = treeProvider?.listModels() ?? [];
                        const includeScripts = input.includeScripts ?? true;
                        const maxScriptChars =
                            typeof input.maxScriptChars === 'number' ? input.maxScriptChars : 8000;

                        let filePath = input.filePath;
                        if (!filePath) {
                            filePath = currentPanelPath;
                        }
                        if (!filePath && models.length === 1) {
                            filePath = models[0].filePath;
                        }

                        if (!filePath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'No panel selected/loaded. Provide input.filePath or open a panel first.',
                                        loadedPanels: models.map((m: PanelModel) => m.filePath),
                                    }),
                                ),
                            ]);
                        }

                        const normalizedPath = filePath.replace(/\\/g, path.sep);

                        const loaded = await ensurePanelModelLoaded(normalizedPath);
                        if (!loaded) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Failed to load panel model. Ensure filePath points to a valid .pnl panel file within the current project.',
                                        filePath: normalizedPath,
                                    }),
                                ),
                            ]);
                        }

                        const model = treeProvider?.getModel(normalizedPath);
                        if (!model) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: `Panel is not loaded: ${normalizedPath}`,
                                    }),
                                ),
                            ]);
                        }

                        const sanitized = {
                            filePath: model.filePath,
                            name: model.name,
                            encrypted: model.encrypted,
                            shapes: model.shapes,
                            properties: model.properties,
                            references: model.references,
                            errors: model.errors,
                            scripts: includeScripts
                                ? model.scripts.map((s) => ({
                                      ...s,
                                      code:
                                          typeof s.code === 'string' &&
                                          s.code.length > maxScriptChars
                                              ? s.code.slice(0, Math.max(0, maxScriptChars)) +
                                                '\n/* ...truncated... */'
                                              : s.code,
                                  }))
                                : [],
                        };

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_getPanelModel (${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(JSON.stringify(sanitized, null, 2)),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_getPanelModel',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_getPanelModel',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_openPanelInViewer', {
                prepareInvocation: () => ({
                    invocationMessage: 'Opening WinCC OA panel in UI viewer…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_openPanelInViewer',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                            uiArgs?: string[];
                        };

                        const rawPath = input.filePath;
                        if (!rawPath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Missing input.filePath. Provide an absolute path to a .pnl or .xml panel file.',
                                    }),
                                ),
                            ]);
                        }

                        const filePath = rawPath.replace(/\\/g, path.sep);
                        const ext = path.extname(filePath).toLowerCase();

                        let previewPath = filePath;
                        let converted = false;

                        if (ext === '.xml') {
                            const conv = await convertXmlToPnl(filePath);
                            if (!conv.success || !conv.outputPath) {
                                return new vscode.LanguageModelToolResult([
                                    new vscode.LanguageModelTextPart(
                                        JSON.stringify({
                                            error:
                                                conv.error ||
                                                'Failed to convert XML to panel before preview.',
                                            filePath,
                                        }),
                                    ),
                                ]);
                            }
                            previewPath = conv.outputPath;
                            converted = true;
                        } else if (ext !== '.pnl') {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Unsupported file extension. Only .pnl and .xml are supported.',
                                        filePath,
                                    }),
                                ),
                            ]);
                        }

                        await previewPanelCommand(vscode.Uri.file(previewPath));

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_openPanelInViewer (${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        ok: true,
                                        filePath,
                                        previewPath,
                                        convertedFromXml: converted,
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_openPanelInViewer',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_openPanelInViewer',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_convertPnlToXml', {
                prepareInvocation: () => ({
                    invocationMessage: 'Converting WinCC OA panel (.pnl) to XML…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_convertPnlToXml',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                            outputDir?: string;
                        };

                        const rawPath = input.filePath;
                        if (!rawPath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Missing input.filePath. Provide an absolute path to a .pnl file.',
                                    }),
                                ),
                            ]);
                        }

                        const filePath = rawPath.replace(/\\/g, path.sep);
                        const ext = path.extname(filePath).toLowerCase();
                        if (ext && ext !== '.pnl') {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Unsupported file extension. Only .pnl files are supported.',
                                        filePath,
                                    }),
                                ),
                            ]);
                        }

                        const outputDir = input.outputDir
                            ? input.outputDir.replace(/\\/g, path.sep)
                            : path.dirname(filePath);

                        const result = await convertPnlToXml(filePath, outputDir);

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_convertPnlToXml (success=${result.success}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        ok: result.success,
                                        filePath,
                                        xmlPath: result.outputPath,
                                        error: result.success ? undefined : result.error,
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_convertPnlToXml',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_convertPnlToXml',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_convertXmlToPnl', {
                prepareInvocation: () => ({
                    invocationMessage: 'Converting WinCC OA XML panel (.xml) to .pnl…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_convertXmlToPnl',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                            outputDir?: string;
                        };

                        const rawPath = input.filePath;
                        if (!rawPath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Missing input.filePath. Provide an absolute path to a .xml file.',
                                    }),
                                ),
                            ]);
                        }

                        const filePath = rawPath.replace(/\\/g, path.sep);
                        const ext = path.extname(filePath).toLowerCase();
                        if (ext && ext !== '.xml') {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Unsupported file extension. Only .xml files are supported.',
                                        filePath,
                                    }),
                                ),
                            ]);
                        }

                        const outputDir = input.outputDir
                            ? input.outputDir.replace(/\\/g, path.sep)
                            : path.dirname(filePath);

                        const result = await convertXmlToPnl(filePath, outputDir);

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_convertXmlToPnl (success=${result.success}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        ok: result.success,
                                        filePath,
                                        pnlPath: result.outputPath,
                                        error: result.success ? undefined : result.error,
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_convertXmlToPnl',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_convertXmlToPnl',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_convertDirPnlToXml', {
                prepareInvocation: () => ({
                    invocationMessage:
                        'Recursively converting all WinCC OA panels (.pnl) in a directory to XML…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_convertDirPnlToXml',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            dirPath?: string;
                        };

                        const rawDir = input.dirPath;
                        if (!rawDir) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Missing input.dirPath. Provide an absolute path to a directory containing .pnl files.',
                                    }),
                                ),
                            ]);
                        }

                        const dirPath = rawDir.replace(/\\/g, path.sep);
                        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Directory does not exist or is not a directory.',
                                        dirPath,
                                    }),
                                ),
                            ]);
                        }

                        const progress: vscode.Progress<{
                            message?: string;
                            increment?: number;
                        }> = {
                            report: (value) => {
                                if (value.message) {
                                    ExtensionOutputChannel.debug(
                                        'LM Tools',
                                        `convertDirPnlToXml: ${value.message}`,
                                    );
                                }
                            },
                        };

                        const result = await convertDirectoryPnlToXml(dirPath, progress);

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_convertDirPnlToXml (converted=${result.converted}, failed=${result.failed}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        dirPath,
                                        converted: result.converted,
                                        failed: result.failed,
                                        errors: result.errors,
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_convertDirPnlToXml',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_convertDirPnlToXml',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_convertDirXmlToPnl', {
                prepareInvocation: () => ({
                    invocationMessage:
                        'Recursively converting all WinCC OA XML panels (.xml) in a directory to .pnl…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_convertDirXmlToPnl',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            dirPath?: string;
                        };

                        const rawDir = input.dirPath;
                        if (!rawDir) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Missing input.dirPath. Provide an absolute path to a directory containing .xml files.',
                                    }),
                                ),
                            ]);
                        }

                        const dirPath = rawDir.replace(/\\/g, path.sep);
                        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Directory does not exist or is not a directory.',
                                        dirPath,
                                    }),
                                ),
                            ]);
                        }

                        const progress: vscode.Progress<{
                            message?: string;
                            increment?: number;
                        }> = {
                            report: (value) => {
                                if (value.message) {
                                    ExtensionOutputChannel.debug(
                                        'LM Tools',
                                        `convertDirXmlToPnl: ${value.message}`,
                                    );
                                }
                            },
                        };

                        const result = await convertDirectoryXmlToPnl(dirPath, progress);

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_convertDirXmlToPnl (converted=${result.converted}, failed=${result.failed}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        dirPath,
                                        converted: result.converted,
                                        failed: result.failed,
                                        errors: result.errors,
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_convertDirXmlToPnl',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_convertDirXmlToPnl',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_summarizePanel', {
                prepareInvocation: () => ({
                    invocationMessage: 'Summarizing WinCC OA panel structure…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_summarizePanel',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                        };

                        const models: PanelModel[] = treeProvider?.listModels() ?? [];

                        let filePath = input.filePath;
                        if (!filePath) {
                            filePath = currentPanelPath;
                        }
                        if (!filePath && models.length === 1) {
                            filePath = models[0].filePath;
                        }

                        if (!filePath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'No panel selected/loaded. Provide input.filePath or open a panel first.',
                                        loadedPanels: models.map((m: PanelModel) => m.filePath),
                                    }),
                                ),
                            ]);
                        }

                        const normalizedPath = filePath.replace(/\\/g, path.sep);

                        const loaded = await ensurePanelModelLoaded(normalizedPath);
                        if (!loaded) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Failed to load panel model. Ensure filePath points to a valid .pnl panel file within the current project.',
                                        filePath: normalizedPath,
                                    }),
                                ),
                            ]);
                        }

                        const model = treeProvider?.getModel(normalizedPath);
                        if (!model) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: `Panel is not loaded: ${normalizedPath}`,
                                    }),
                                ),
                            ]);
                        }

                        const shapeCount = model.shapes.length;
                        const scriptCount = model.scripts.length;
                        const errorCount = model.errors?.length ?? 0;

                        const shapesByType: Record<string, number> = {};
                        for (const shape of model.shapes) {
                            const typeKey = (shape.shapeType ?? 'unknown').toString();
                            shapesByType[typeKey] = (shapesByType[typeKey] ?? 0) + 1;
                        }

                        const scriptsByEvent: Record<string, number> = {};
                        for (const script of model.scripts) {
                            const eventKey = (script.event ?? 'unknown').toString();
                            scriptsByEvent[eventKey] = (scriptsByEvent[eventKey] ?? 0) + 1;
                        }

                        const mainShapeTypes = Object.entries(shapesByType)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([type, count]) => `${count} ${type}`)
                            .join(', ');

                        const mainEvents = Object.entries(scriptsByEvent)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([event, count]) => `${count} ${event}`)
                            .join(', ');

                        let summary = `Panel "${model.name}" has ${shapeCount} shapes and ${scriptCount} scripts.`;
                        if (mainShapeTypes) {
                            summary += ` Main shape types: ${mainShapeTypes}.`;
                        }
                        if (mainEvents) {
                            summary += ` Main script events: ${mainEvents}.`;
                        }
                        if (model.encrypted) {
                            summary +=
                                ' Panel appears to be encrypted; detailed structure may not be available.';
                        }
                        if (errorCount > 0) {
                            summary += ` There are ${errorCount} parser/validation errors.`;
                        }

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_summarizePanel (${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        filePath: model.filePath,
                                        name: model.name,
                                        encrypted: model.encrypted,
                                        summary,
                                        stats: {
                                            shapeCount,
                                            scriptCount,
                                            errorCount,
                                            shapesByType,
                                            scriptsByEvent,
                                        },
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_summarizePanel',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_summarizePanel',
            error,
        );
    }

    try {
        context.subscriptions.push(
            vscode.lm.registerTool('winccoaPanelViewer_checkPanelSyntax', {
                prepareInvocation: () => ({
                    invocationMessage:
                        'Checking WinCC OA panel syntax via WCCOAui -syntax (logs: WARNING/SEVERE/FATAL)…',
                }),
                invoke: async (options, token) => {
                    const startedAt = Date.now();
                    try {
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            'Tool invoked: winccoaPanelViewer_checkPanelSyntax',
                        );
                        ExtensionOutputChannel.instance?.show(true);

                        if (token?.isCancellationRequested) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({ cancelled: true }),
                                ),
                            ]);
                        }

                        const input = (options?.input ?? {}) as {
                            filePath?: string;
                            severities?: string[];
                            timeoutMs?: number;
                            maxLogChars?: number;
                        };

                        const models: PanelModel[] = treeProvider?.listModels() ?? [];

                        let filePath = input.filePath;
                        if (!filePath) {
                            filePath = currentPanelPath;
                        }
                        if (!filePath && models.length === 1) {
                            filePath = models[0].filePath;
                        }

                        if (!filePath) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'No panel selected/loaded. Provide input.filePath or open a panel first.',
                                        loadedPanels: models.map((m: PanelModel) => m.filePath),
                                    }),
                                ),
                            ]);
                        }

                        const normalizedPath = filePath.replace(/\\/g, path.sep);

                        const currentProject = getSelectedProject();
                        if (!currentProject) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'No WinCC OA project selected. Select a project in WinCC OA Project Admin first.',
                                    }),
                                ),
                            ]);
                        }

                        const version = currentProject.getVersion();
                        if (!version) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Cannot determine WinCC OA version from selected project; syntax check is not possible.',
                                    }),
                                ),
                            ]);
                        }

                        const projPanelsPath = currentProject
                            .getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH)
                            .replace(/\\/g, '/');

                        const normalizedForCompare = normalizedPath.replace(/\\/g, '/');
                        if (
                            !normalizedForCompare
                                .toLocaleLowerCase()
                                .startsWith(projPanelsPath.toLocaleLowerCase())
                        ) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: 'Selected panel is not within the current project panels directory; cannot run -syntax.',
                                        projectPanelsPath: projPanelsPath,
                                        filePath: normalizedPath,
                                    }),
                                ),
                            ]);
                        }

                        const relativePanelPath = normalizedForCompare.substring(
                            projPanelsPath.length,
                        );

                        const uiComponent = new UIComponent();
                        uiComponent.setVersion(version);

                        if (!uiComponent.exists()) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(
                                    JSON.stringify({
                                        error: `WinCC OA UI executable not found for version ${version}.`,
                                    }),
                                ),
                            ]);
                        }

                        const timeoutMs =
                            typeof input.timeoutMs === 'number' && input.timeoutMs > 0
                                ? input.timeoutMs
                                : 60000;

                        const severities =
                            Array.isArray(input.severities) && input.severities.length > 0
                                ? input.severities
                                : ['WARNING', 'SEVERE', 'FATAL'];

                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Running WCCOAui -syntax for panel ${relativePanelPath} (version=${version})`,
                        );

                        /* from OA help:
                          -syntax all[+][-s path][-p path]... check panels and scripts (+ adds integrity check)
                                | scripts[+] [-s path]    ... check only scripts, optionally start with path
                                | panels[+] [-p path]     ... check only panels, optionally start with path
                        */
                        const args = [
                            '-config',
                            currentProject.getConfigPath(),
                            '-syntax',
                            'panels+',
                            '-p',
                            relativePanelPath,
                            '-n',
                            '-log',
                            '+stderr',
                        ];
                        const exitCode = await uiComponent.start(args, {
                            timeout: timeoutMs,
                            checkStdout: false,
                        });

                        const stderr = uiComponent.stdErr ?? '';
                        const stdout = uiComponent.stdOut ?? '';

                        const issueLines: { severity: string; message: string }[] = [];
                        const upperSeverities = severities.map((s) => s.toUpperCase());

                        for (const rawLine of stderr.split(/\r?\n/)) {
                            const line = rawLine.trim();
                            if (!line) continue;
                            const upperLine = line.toUpperCase();
                            const matchedSeverity = upperSeverities.find((s) =>
                                upperLine.includes(s),
                            );
                            if (matchedSeverity) {
                                issueLines.push({ severity: matchedSeverity, message: line });
                            }
                        }

                        const ok = exitCode === 0 && issueLines.length === 0;

                        const maxLogChars =
                            typeof input.maxLogChars === 'number' && input.maxLogChars > 0
                                ? input.maxLogChars
                                : 8000;

                        const truncate = (text: string): string => {
                            if (text.length <= maxLogChars) {
                                return text;
                            }
                            return (
                                text.slice(0, Math.max(0, maxLogChars)) +
                                '\n...<truncated; increase maxLogChars for more>...'
                            );
                        };

                        const elapsedMs = Date.now() - startedAt;
                        ExtensionOutputChannel.info(
                            'LM Tools',
                            `Tool finished: winccoaPanelViewer_checkPanelSyntax (ok=${ok}, issues=${issueLines.length}, exitCode=${exitCode}, ${elapsedMs}ms)`,
                        );

                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify(
                                    {
                                        ok,
                                        exitCode,
                                        filePath: normalizedPath,
                                        panelRelativePath: relativePanelPath,
                                        severities,
                                        issueCount: issueLines.length,
                                        issues: issueLines.slice(0, 100),
                                        stderrSnippet: truncate(stderr),
                                        stdoutSnippet: truncate(stdout),
                                    },
                                    null,
                                    2,
                                ),
                            ),
                        ]);
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        ExtensionOutputChannel.error(
                            'LM Tools',
                            'Tool failed: winccoaPanelViewer_checkPanelSyntax',
                            error,
                        );
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(
                                JSON.stringify({ error: error.message }),
                            ),
                        ]);
                    }
                },
            }),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ExtensionOutputChannel.error(
            'LM Tools',
            'Failed to register tool winccoaPanelViewer_checkPanelSyntax',
            error,
        );
    }
}

/**
 * Opens a .pnl file in the panel viewer.
 */
async function openPanelCommand(uri?: vscode.Uri): Promise<void> {
    let filePath: string;

    if (uri) {
        filePath = uri.fsPath;
    } else {
        // Prompt user to select file
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'WinCC OA Panels': ['pnl'] },
            title: 'Select Panel File',
        });
        if (!uris || uris.length === 0) return;
        filePath = uris[0].fsPath;
    }

    await loadPanelIntoViewer(filePath);
}

/**
 * Loads all panels from project's panels directory recursively.
 */
async function loadAllPanelsCommand(): Promise<void> {
    if (!treeProvider) return;

    const currentProject = getSelectedProject();
    if (!currentProject) {
        vscode.window.showWarningMessage(
            'No WinCC OA project selected. Select a project in WinCC OA Project Admin first.',
        );
        return;
    }

    const panelsDir = currentProject
        .getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH)
        .replace(/\\/g, path.sep);

    if (!fs.existsSync(panelsDir) || !fs.statSync(panelsDir).isDirectory()) {
        vscode.window.showErrorMessage(
            `Panels directory not found for project ${currentProject.getId()}: ${panelsDir}`,
        );
        return;
    }

    // Clear existing panels
    treeProvider.clear();

    // Find all .pnl files recursively
    const pnlFiles = await findPnlFilesRecursive(panelsDir);

    if (pnlFiles.length === 0) {
        vscode.window.showInformationMessage('No .pnl files found in directory.');
        return;
    }

    // Load panels with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading panels',
            cancellable: true,
        },
        async (progress, token) => {
            let loaded = 0;
            const total = pnlFiles.length;

            for (const pnlPath of pnlFiles) {
                if (token.isCancellationRequested) break;

                progress.report({
                    message: `${loaded}/${total} - ${path.basename(pnlPath)}`,
                    increment: (1 / total) * 100,
                });

                try {
                    await loadPanelIntoViewerSilent(pnlPath);
                    loaded++;
                } catch (err) {
                    ExtensionOutputChannel.warn('LoadAll', `Failed to load ${pnlPath}: ${err}`);
                }
            }

            vscode.window.showInformationMessage(`Loaded ${loaded} panels.`);
        },
    );

    await vscode.commands.executeCommand('setContext', 'winccoaPanelViewer.panelOpen', true);
}

/**
 * Recursively finds all .pnl files in a directory.
 */
async function findPnlFilesRecursive(dir: string): Promise<string[]> {
    const results: string[] = [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            // Recurse into subdirectory
            const subResults = await findPnlFilesRecursive(fullPath);
            results.push(...subResults);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pnl')) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * Clears all panels from the viewer.
 */
async function clearPanelsCommand(): Promise<void> {
    if (!treeProvider) return;
    treeProvider.clear();
    detailsViewProvider?.setSelection(undefined);
    await vscode.commands.executeCommand('setContext', 'winccoaPanelViewer.panelOpen', false);
    vscode.window.showInformationMessage('Panel viewer cleared.');
}

/**
 * Loads a panel file into the tree viewer (silent mode for batch loading).
 */
async function loadPanelIntoViewerSilent(filePath: string): Promise<void> {
    if (!treeProvider) return;

    // Check for encryption
    if (await isEncryptedPanel(filePath)) {
        const model = createEncryptedPanelModel(filePath);
        treeProvider.addModel(model);
        return;
    }

    // Convert to XML in temp location
    const result = await convertPnlToXml(filePath);
    if (!result.success || !result.outputPath) {
        throw new Error(result.error || 'Conversion failed');
    }

    // Parse the XML
    const model = parsePanelXml(result.outputPath, filePath);
    treeProvider.addModel(model);

    // Clean up temp XML
    try {
        fs.unlinkSync(result.outputPath);
        const tempDir = path.dirname(result.outputPath);
        if (tempDir.includes('winccoa-panel-')) {
            fs.rmdirSync(tempDir);
        }
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Loads a panel file into the tree viewer.
 */
async function loadPanelIntoViewer(filePath: string): Promise<void> {
    if (!treeProvider) return;

    currentPanelPath = filePath;
    ExtensionOutputChannel.info('Viewer', `Opening panel: ${filePath}`);

    // Check for encryption
    if (await isEncryptedPanel(filePath)) {
        const model = createEncryptedPanelModel(filePath);
        treeProvider.addModel(model);
        // Show tree view even for encrypted panels
        await vscode.commands.executeCommand('setContext', 'winccoaPanelViewer.panelOpen', true);
        vscode.window.showWarningMessage('Encrypted panel; content not viewable.');
        return;
    }

    // Convert to XML in temp location
    const result = await convertPnlToXml(filePath);
    if (!result.success || !result.outputPath) {
        vscode.window.showErrorMessage(`Failed to convert panel: ${result.error}`);
        return;
    }

    // Parse the XML
    const model = parsePanelXml(result.outputPath, filePath);
    treeProvider.addModel(model);

    // Show tree view
    await vscode.commands.executeCommand('setContext', 'winccoaPanelViewer.panelOpen', true);

    // Clean up temp XML
    try {
        fs.unlinkSync(result.outputPath);
        const tempDir = path.dirname(result.outputPath);
        if (tempDir.includes('winccoa-panel-')) {
            fs.rmdirSync(tempDir);
        }
    } catch {
        // Ignore cleanup errors
    }

    ExtensionOutputChannel.info('Viewer', `Loaded panel with ${model.shapes.length} shapes`);
}

/**
 * Converts a .pnl file to .xml (command mode - writes to same folder).
 */
async function pnlToXmlCommand(uri?: vscode.Uri): Promise<void> {
    let filePath: string;

    if (uri) {
        filePath = uri.fsPath;
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'WinCC OA Panels': ['pnl'] },
            title: 'Select Panel File to Convert',
        });
        if (!uris || uris.length === 0) return;
        filePath = uris[0].fsPath;
    }

    // Handle files without extension
    if (!filePath.toLowerCase().endsWith('.pnl')) {
        const choice = await vscode.window.showQuickPick(['Treat as .pnl', 'Skip'], {
            placeHolder: `File has no .pnl extension: ${path.basename(filePath)}`,
        });
        if (choice !== 'Treat as .pnl') return;
    }

    const result = await convertPnlToXml(filePath, path.dirname(filePath));
    if (result.success) {
        vscode.window.showInformationMessage(`Converted: ${result.outputPath}`);
    } else {
        vscode.window.showErrorMessage(`Conversion failed: ${result.error}`);
    }
}

/**
 * Converts a .xml file to .pnl (command mode).
 */
async function xmlToPnlCommand(uri?: vscode.Uri): Promise<void> {
    let filePath: string;

    if (uri) {
        filePath = uri.fsPath;
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'XML Files': ['xml'] },
            title: 'Select XML File to Convert',
        });
        if (!uris || uris.length === 0) return;
        filePath = uris[0].fsPath;
    }

    const result = await convertXmlToPnl(filePath);
    if (result.success) {
        vscode.window.showInformationMessage(`Converted: ${result.outputPath}`);
    } else {
        vscode.window.showErrorMessage(`Conversion failed: ${result.error}`);
    }
}

/**
 * Recursively converts all .pnl files in a directory to .xml.
 */
async function convertDirPnlToXmlCommand(uri?: vscode.Uri): Promise<void> {
    let dirPath: string;

    if (uri) {
        dirPath = uri.fsPath;
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select Directory to Convert',
        });
        if (!uris || uris.length === 0) return;
        dirPath = uris[0].fsPath;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Converting panels to XML',
            cancellable: false,
        },
        async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            const result = await convertDirectoryPnlToXml(dirPath, progress);
            if (result.failed === 0) {
                vscode.window.showInformationMessage(`Converted ${result.converted} panels`);
            } else {
                vscode.window.showWarningMessage(
                    `Converted ${result.converted}, failed ${result.failed}. Check output for details.`,
                );
                for (const err of result.errors) {
                    ExtensionOutputChannel.error('Converter', err);
                }
            }
        },
    );
}

/**
 * Recursively converts all .xml files in a directory to .pnl.
 */
async function convertDirXmlToPnlCommand(uri?: vscode.Uri): Promise<void> {
    let dirPath: string;

    if (uri) {
        dirPath = uri.fsPath;
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select Directory to Convert',
        });
        if (!uris || uris.length === 0) return;
        dirPath = uris[0].fsPath;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Converting XML to panels',
            cancellable: false,
        },
        async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            const result = await convertDirectoryXmlToPnl(dirPath, progress);
            if (result.failed === 0) {
                vscode.window.showInformationMessage(`Converted ${result.converted} files`);
            } else {
                vscode.window.showWarningMessage(
                    `Converted ${result.converted}, failed ${result.failed}. Check output for details.`,
                );
                for (const err of result.errors) {
                    ExtensionOutputChannel.error('Converter', err);
                }
            }
        },
    );
}

/**
 * Launches WinCC OA UI to preview a panel.
 * Uses UIComponent from npm-winccoa-core package.
 */
async function previewPanelCommand(uri?: vscode.Uri): Promise<void> {
    _previewPanel(uri, []);
}
async function previewPanelWithOptionsCommand(uri?: vscode.Uri): Promise<void> {
    // Prompt user for extra options
    const extraUiViewerOptions = await vscode.window.showInputBox({
        prompt: 'Extra command-line options for WCCOAui (e.g., -logLevel debug)',
        placeHolder: '-n -dbg all',
        value: '',
    });
    _previewPanel(uri, extraUiViewerOptions ? extraUiViewerOptions.split(' ') : []);
}

async function _previewPanel(uri?: vscode.Uri, extraUiViewerOptions?: string[]): Promise<void> {
    let filePath: string;

    if (uri) {
        filePath = uri.fsPath;
    } else if (currentPanelPath) {
        filePath = currentPanelPath;
    } else {
        vscode.window.showWarningMessage('No panel selected. Open a panel first.');
        return;
    }

    // Get current project from core extension
    const coreExtension = vscode.extensions.getExtension(CORE_EXTENSION_ID);

    if (!coreExtension || !coreExtension.exports) {
        vscode.window.showErrorMessage(
            'WinCC OA Project Admin extension not found. Please install it to use preview.',
        );
        return;
    }

    const currentProject = getSelectedProject();

    if (!currentProject) {
        return;
    }

    const version = currentProject.getVersion();

    if (!version) {
        vscode.window.showErrorMessage(
            `Cannot determine WinCC OA version from project: ${currentProject.getId()}`,
        );
        return;
    }

    // project / panels path
    const projPanelsPath = currentProject
        .getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH)
        .replace(/\\/g, '/');

    if (
        !filePath
            .replace(/\\/g, '/')
            .toLocaleLowerCase()
            .startsWith(projPanelsPath.toLocaleLowerCase())
    ) {
        vscode.window.showWarningMessage(
            `Selected panel is not within the current project's panels directory.\nProject panels path: ${projPanelsPath}\nPanel path: ${filePath}`,
        );
        return;
    }
    // Calculate relative path from project panels directory
    // The panel path for WCCOAui -p should be relative to the project
    let relativePanelPath = filePath.substring(projPanelsPath.length);

    try {
        // Create and configure UIComponent
        const uiComponent = new UIComponent();
        uiComponent.setVersion(version);

        // Check if executable exists
        if (!uiComponent.exists()) {
            vscode.window.showErrorMessage(
                `WinCC OA UI executable not found for version ${version}`,
            );
            return;
        }

        let args = ['-proj', currentProject.getId()];

        if (extraUiViewerOptions) {
            args.push(...(extraUiViewerOptions || []));
        }

        ExtensionOutputChannel.info(
            'Preview',
            `Launching WCCOAui v${version} with panel: ${relativePanelPath}`,
        );

        // Start UI with the panel (detached to not block VS Code)
        await uiComponent.startWithPanel(relativePanelPath, args, (line: string) => {
            ExtensionOutputChannel.debug('Preview', line);
        });

        vscode.window.showInformationMessage(`Previewing panel: ${path.basename(filePath)}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ExtensionOutputChannel.error('Preview', `Failed to launch preview: ${message}`);
        vscode.window.showErrorMessage(`Failed to launch preview: ${message}`);
    }
}

/**
 * Shows a script in a new editor with CTL syntax highlighting.
 */
async function showScriptCommand(script: PanelScript): Promise<void> {
    if (!script || !script.code) return;

    // Open as a virtual <event>.ctl document, so VS Code detects the language by extension.
    const provider = virtualCtlProvider;
    if (!provider) {
        // Fallback to previous behavior (shouldn't happen).
        const doc = await vscode.workspace.openTextDocument({
            content: script.code,
            language: 'ctl',
        });
        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside,
        });
        return;
    }

    const panelPath = currentPanelPath ?? 'panel.pnl';
    const uri = provider.createScriptUri(panelPath, script.event);
    provider.setContent(uri, script.code);

    const doc = await vscode.workspace.openTextDocument(uri);
    // Ensure language mode is ctl even if no CTL extension is installed.
    await vscode.languages.setTextDocumentLanguage(doc, 'ctrl');

    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });
}

/**
 * Sets up file watcher to reload viewer on .pnl changes.
 */
function setupFileWatcher(context: vscode.ExtensionContext): void {
    fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.pnl');

    const shouldIgnore = (uri: vscode.Uri): boolean => {
        const lower = uri.fsPath.toLowerCase();
        // Explicitly ignore backup files (even if patterns change later).
        return lower.endsWith('.bak');
    };

    const scheduleReload = (uri: vscode.Uri, reason: string): void => {
        if (!treeProvider) return;
        if (shouldIgnore(uri)) return;

        const filePath = uri.fsPath;

        // Only auto-reload panels that are already loaded in the viewer.
        if (!treeProvider.hasModel(filePath) && filePath !== currentPanelPath) return;

        const existing = pendingPanelReloads.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        pendingPanelReloads.set(
            filePath,
            setTimeout(async () => {
                pendingPanelReloads.delete(filePath);
                try {
                    ExtensionOutputChannel.debug('Watcher', `${reason}: ${filePath}`);
                    await loadPanelIntoViewerSilent(filePath);
                } catch (err) {
                    ExtensionOutputChannel.warn(
                        'Watcher',
                        `Failed to reload changed panel: ${filePath}: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
            }, 250),
        );
    };

    fileWatcher.onDidChange((uri: vscode.Uri) => scheduleReload(uri, 'Panel changed'));
    fileWatcher.onDidCreate((uri: vscode.Uri) => scheduleReload(uri, 'Panel created'));

    fileWatcher.onDidDelete((uri: vscode.Uri) => {
        if (!treeProvider) return;
        if (shouldIgnore(uri)) return;

        const filePath = uri.fsPath;
        if (pendingPanelReloads.has(filePath)) {
            clearTimeout(pendingPanelReloads.get(filePath)!);
            pendingPanelReloads.delete(filePath);
        }

        if (treeProvider.hasModel(filePath)) {
            ExtensionOutputChannel.debug('Watcher', `Panel deleted: ${filePath}`);
            treeProvider.removeModel(filePath);
        }

        if (currentPanelPath === filePath) {
            currentPanelPath = undefined;
        }

        void vscode.commands.executeCommand(
            'setContext',
            'winccoaPanelViewer.panelOpen',
            treeProvider.panelCount > 0,
        );
    });

    context.subscriptions.push(fileWatcher);
}
