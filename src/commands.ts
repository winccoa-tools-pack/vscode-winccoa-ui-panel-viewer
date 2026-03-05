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
import { PanelScript } from './panelModel';
import { UIComponent } from '@winccoa-tools-pack/npm-winccoa-core/types/components/implementations/index';
import { ProjectInfo, extraUiViewerOptions, getSelectedProject } from './otherExtensions';
import { CORE_EXTENSION_ID } from './const';
import { ProjEnvProject, ProjEnvProjectFileSysStruct } from '@winccoa-tools-pack/npm-winccoa-core';

/** Singleton tree provider instance */
let treeProvider: PanelTreeProvider | undefined;

/** File watcher for .pnl changes */
let fileWatcher: vscode.FileSystemWatcher | undefined;

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
        vscode.commands.registerCommand('winccoaPanelViewer.convertDirPnlToXml', convertDirPnlToXmlCommand),
        vscode.commands.registerCommand('winccoaPanelViewer.convertDirXmlToPnl', convertDirXmlToPnlCommand),
        
        // Preview launcher
        vscode.commands.registerCommand('winccoaPanelViewer.previewPanel', previewPanelCommand),
        vscode.commands.registerCommand('winccoaPanelViewer.previewPanelWithOptions', previewPanelWithOptionsCommand),
        
        // Show script in editor
        vscode.commands.registerCommand('winccoaPanelViewer.showScript', showScriptCommand),
    );

    // Setup file watcher for .pnl changes
    setupFileWatcher(context);

    ExtensionOutputChannel.info('Commands', 'Panel viewer commands registered');
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

    // Find panels directory in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
    }

    // Look for panels directory
    let panelsDir: string | undefined;
    for (const folder of workspaceFolders) {
        const possiblePath = path.join(folder.uri.fsPath, 'panels');
        if (fs.existsSync(possiblePath) && fs.statSync(possiblePath).isDirectory()) {
            panelsDir = possiblePath;
            break;
        }
    }

    if (!panelsDir) {
        // Ask user to select directory
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select Panels Directory',
        });
        if (!uris || uris.length === 0) return;
        panelsDir = uris[0].fsPath;
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
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Loading panels',
        cancellable: true,
    }, async (progress, token) => {
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
    });

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
        const choice = await vscode.window.showQuickPick(
            ['Treat as .pnl', 'Skip'],
            { placeHolder: `File has no .pnl extension: ${path.basename(filePath)}` },
        );
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
    const projPanelsPath = currentProject.getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH).replace(/\\/g, '/');

    if (!filePath.replace(/\\/g, '/').toLocaleLowerCase().startsWith(projPanelsPath.toLocaleLowerCase())) {
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
            args.push(...extraUiViewerOptions || []);
        }

        
        ExtensionOutputChannel.info('Preview', `Launching WCCOAui v${version} with panel: ${relativePanelPath}`);
        
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

    // Create a temporary document with CTL content
    const doc = await vscode.workspace.openTextDocument({
        content: script.code,
        language: 'ctl', // Assumes CTL language extension is installed
    });

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

    fileWatcher.onDidChange(async (uri: vscode.Uri) => {
        // Skip .bak files
        if (uri.fsPath.toLowerCase().endsWith('.bak')) return;

        // Reload if this is the currently viewed panel
        if (currentPanelPath && uri.fsPath === currentPanelPath) {
            ExtensionOutputChannel.debug('Watcher', `Panel changed: ${uri.fsPath}`);
            await loadPanelIntoViewer(uri.fsPath);
        }
    });

    context.subscriptions.push(fileWatcher);
}
