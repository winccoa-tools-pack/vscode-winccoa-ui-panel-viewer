/**
 * @fileoverview Tree view provider for panel structure visualization.
 *
 * Displays panel shapes, properties, scripts, and references in VS Code's
 * tree view sidebar.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { PanelModel, PanelShape, PanelProperty, PanelScript, PanelReference } from './panelModel';

/**
 * Tree item types for icons and context menus.
 */
type TreeItemType = 'panel' | 'shape' | 'property' | 'script' | 'reference' | 'folder';

type ChildType =
    | 'dir'
    | 'shapes'
    | 'properties'
    | 'scripts'
    | 'references'
    | 'shape-props'
    | 'shape-scripts'
    | 'shape-children'
    | 'prop-children';

/**
 * Tree item data representing a node in the panel structure tree.
 */
export class PanelTreeItem extends vscode.TreeItem {
    public modelPath?: string;
    public childType?: ChildType;
    public directoryChildren?: PanelTreeItem[];
    public shapeData?: PanelShape;
    public propData?: PanelProperty;

    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly data?: PanelShape | PanelProperty | PanelScript | PanelReference,
        public readonly parent?: PanelTreeItem,
    ) {
        super(label, collapsibleState);

        this.contextValue = itemType;
        this.iconPath = this.getIcon();
        this.tooltip = this.getTooltip();

        // Scripts are clickable to show code
        if (itemType === 'script' && data) {
            this.command = {
                command: 'winccoaPanelViewer.showScript',
                title: 'Show Script',
                arguments: [data],
            };
        }
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.itemType) {
            case 'panel':
                return new vscode.ThemeIcon('window');
            case 'shape':
                return new vscode.ThemeIcon('symbol-class');
            case 'property':
                return new vscode.ThemeIcon('symbol-property');
            case 'script':
                return new vscode.ThemeIcon('code');
            case 'reference':
                return new vscode.ThemeIcon('references');
            case 'folder':
                return new vscode.ThemeIcon('folder');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getTooltip(): string {
        if (this.itemType === 'property' && this.data) {
            const prop = this.data as PanelProperty;
            return `${prop.name}: ${prop.value}`;
        }
        if (this.itemType === 'script' && this.data) {
            const script = this.data as PanelScript;
            return `Event: ${script.event}\nClick to view code`;
        }
        if (this.itemType === 'shape' && this.data) {
            const shape = this.data as PanelShape;
            return `${shape.name} (${shape.shapeType})`;
        }
        return this.label;
    }
}

/**
 * Tree data provider for panel structure.
 */
export class PanelTreeProvider implements vscode.TreeDataProvider<PanelTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<
        PanelTreeItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private models: Map<string, PanelModel> = new Map();
    private rootItems: PanelTreeItem[] = [];

    /**
     * Adds or updates a panel model in the tree.
     */
    public addModel(model: PanelModel): void {
        this.models.set(model.filePath, model);
        this.rootItems = this.buildTree();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Updates the tree with a new panel model (replaces all).
     * @deprecated Use addModel for multi-panel support
     */
    public setModel(model: PanelModel): void {
        this.addModel(model);
    }

    /**
     * Removes a panel from the tree.
     */
    public removeModel(filePath: string): void {
        this.models.delete(filePath);
        this.rootItems = this.buildTree();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Clears all panels from the tree view.
     */
    public clear(): void {
        this.models.clear();
        this.rootItems = [];
        this._onDidChangeTreeData.fire();
    }

    /**
     * Returns number of loaded panels.
     */
    public get panelCount(): number {
        return this.models.size;
    }

    /**
     * Returns true if the given panel path is currently loaded in the viewer.
     */
    public hasModel(filePath: string): boolean {
        return this.models.has(filePath);
    }

    getTreeItem(element: PanelTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: PanelTreeItem): Thenable<PanelTreeItem[]> {
        if (this.models.size === 0) {
            return Promise.resolve([]);
        }

        if (!element) {
            return Promise.resolve(this.rootItems);
        }

        return Promise.resolve(this.getChildItems(element));
    }

    private buildTree(): PanelTreeItem[] {
        type DirNode = {
            folders: Map<string, DirNode>;
            models: PanelModel[];
        };

        const root: DirNode = { folders: new Map(), models: [] };

        const getRelativePath = (absolutePath: string): string => {
            const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolutePath));
            if (!folder) {
                return absolutePath;
            }
            return path.relative(folder.uri.fsPath, absolutePath);
        };

        for (const model of this.models.values()) {
            const rel = getRelativePath(model.filePath);
            const normalized = rel.replace(/\\/g, '/');
            const segments = normalized.split('/').filter(Boolean);

            // Defensive: if we cannot compute segments, just add to root
            if (segments.length <= 1) {
                root.models.push(model);
                continue;
            }

            // All segments except the filename are directories
            let current = root;
            for (const dirName of segments.slice(0, -1)) {
                let next = current.folders.get(dirName);
                if (!next) {
                    next = { folders: new Map(), models: [] };
                    current.folders.set(dirName, next);
                }
                current = next;
            }
            current.models.push(model);
        }

        const buildDirItems = (node: DirNode, parent?: PanelTreeItem): PanelTreeItem[] => {
            const folders: PanelTreeItem[] = [];
            const panels: PanelTreeItem[] = [];

            for (const [dirName, childNode] of node.folders) {
                const folderItem = new PanelTreeItem(
                    dirName,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                folderItem.childType = 'dir';
                folderItem.directoryChildren = buildDirItems(childNode, folderItem);
                folders.push(folderItem);
            }

            for (const model of node.models) {
                const fileName = path.basename(model.filePath);
                const panelItem = new PanelTreeItem(
                    fileName,
                    'panel',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    parent,
                );
                panelItem.modelPath = model.filePath;
                panelItem.description = model.encrypted ? '🔒 Encrypted' : undefined;
                panels.push(panelItem);
            }

            folders.sort((a, b) => a.label.localeCompare(b.label));
            panels.sort((a, b) => a.label.localeCompare(b.label));
            return [...folders, ...panels];
        };

        return buildDirItems(root);
    }

    private getChildItems(parent: PanelTreeItem): PanelTreeItem[] {
        // Directory nodes: children are precomputed in buildTree()
        if (parent.itemType === 'folder' && parent.childType === 'dir') {
            return parent.directoryChildren ?? [];
        }

        // Find model for this panel item
        const modelPath = parent.modelPath || this.findModelPath(parent);
        const model = modelPath ? this.models.get(modelPath) : undefined;
        if (!model) return [];

        // Panel root children
        if (parent.itemType === 'panel') {
            const children: PanelTreeItem[] = [];

            // Shapes folder
            if (model.shapes.length > 0) {
                const shapesFolder = new PanelTreeItem(
                    `Shapes (${model.shapes.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    parent,
                );
                shapesFolder.childType = 'shapes';
                shapesFolder.modelPath = modelPath;
                children.push(shapesFolder);
            }

            // Properties folder
            if (model.properties.length > 0) {
                const propsFolder = new PanelTreeItem(
                    `Properties (${model.properties.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                propsFolder.childType = 'properties';
                propsFolder.modelPath = modelPath;
                children.push(propsFolder);
            }

            // Scripts folder
            if (model.scripts.length > 0) {
                const scriptsFolder = new PanelTreeItem(
                    `Scripts (${model.scripts.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                scriptsFolder.childType = 'scripts';
                scriptsFolder.modelPath = modelPath;
                children.push(scriptsFolder);
            }

            // References folder
            if (model.references.length > 0) {
                const refsFolder = new PanelTreeItem(
                    `References (${model.references.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                refsFolder.childType = 'references';
                refsFolder.modelPath = modelPath;
                children.push(refsFolder);
            }

            // Errors
            if (model.errors.length > 0) {
                for (const error of model.errors) {
                    const errItem = new PanelTreeItem(
                        `⚠️ ${error}`,
                        'property',
                        vscode.TreeItemCollapsibleState.None,
                    );
                    children.push(errItem);
                }
            }

            return children;
        }

        // Folder children
        if (parent.itemType === 'folder') {
            const childType = parent.childType;

            if (childType === 'shapes') {
                return model.shapes.map((shape) => this.createShapeItem(shape, parent, modelPath));
            }
            if (childType === 'properties') {
                return model.properties.map((prop) =>
                    this.createPropertyItem(prop, parent, modelPath),
                );
            }
            if (childType === 'scripts') {
                return model.scripts.map((script) => this.createScriptItem(script, parent));
            }
            if (childType === 'references') {
                return model.references.map((ref) => this.createReferenceItem(ref, parent));
            }

            // Shape's internal folders
            if (childType === 'shape-props' && parent.shapeData) {
                const shape = parent.shapeData;
                return shape.properties.map((prop) =>
                    this.createPropertyItem(prop, parent, modelPath),
                );
            }
            if (childType === 'shape-scripts' && parent.shapeData) {
                const shape = parent.shapeData;
                return shape.scripts.map((script) => this.createScriptItem(script, parent));
            }
            if (childType === 'shape-children' && parent.shapeData) {
                const shape = parent.shapeData;
                return shape.children.map((child) =>
                    this.createShapeItem(child, parent, modelPath),
                );
            }

            // Nested property children
            if (childType === 'prop-children' && parent.propData) {
                const prop = parent.propData;
                return (prop.children || []).map((child) =>
                    this.createPropertyItem(child, parent, modelPath),
                );
            }
        }

        // Shape children
        if (parent.itemType === 'shape' && parent.data) {
            const shape = parent.data as PanelShape;
            const children: PanelTreeItem[] = [];

            if (shape.children.length > 0) {
                const folder = new PanelTreeItem(
                    `Children (${shape.children.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    parent,
                );
                folder.childType = 'shape-children';
                folder.shapeData = shape;
                folder.modelPath = modelPath;
                children.push(folder);
            }

            if (shape.properties.length > 0) {
                const folder = new PanelTreeItem(
                    `Properties (${shape.properties.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                folder.childType = 'shape-props';
                folder.shapeData = shape;
                folder.modelPath = modelPath;
                children.push(folder);
            }

            if (shape.scripts.length > 0) {
                const folder = new PanelTreeItem(
                    `Scripts (${shape.scripts.length})`,
                    'folder',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    undefined,
                    parent,
                );
                folder.childType = 'shape-scripts';
                folder.shapeData = shape;
                folder.modelPath = modelPath;
                children.push(folder);
            }

            return children;
        }

        // Property with children (nested/localized)
        if (parent.itemType === 'property' && parent.data) {
            const prop = parent.data as PanelProperty;
            if (prop.children && prop.children.length > 0) {
                return prop.children.map((child) =>
                    this.createPropertyItem(child, parent, modelPath),
                );
            }
        }

        return [];
    }

    /**
     * Find model path by traversing up parent chain.
     */
    private findModelPath(item: PanelTreeItem): string | undefined {
        let current: PanelTreeItem | undefined = item;
        while (current) {
            if (current.modelPath) return current.modelPath;
            current = current.parent;
        }
        return this.models.keys().next().value; // fallback to first model
    }

    private createShapeItem(
        shape: PanelShape,
        parent: PanelTreeItem,
        modelPath?: string,
    ): PanelTreeItem {
        const hasChildren =
            shape.children.length > 0 || shape.properties.length > 0 || shape.scripts.length > 0;
        const item = new PanelTreeItem(
            shape.name,
            'shape',
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
            shape,
            parent,
        );
        item.description = shape.shapeType;
        if (modelPath) {
            item.modelPath = modelPath;
        }
        return item;
    }

    private createPropertyItem(
        prop: PanelProperty,
        parent: PanelTreeItem,
        modelPath?: string,
    ): PanelTreeItem {
        // Check if property has nested children
        const hasChildren = prop.children && prop.children.length > 0;
        const item = new PanelTreeItem(
            prop.name,
            'property',
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
            prop,
            parent,
        );
        item.description = this.formatPropertyValue(prop);
        if (modelPath) {
            item.modelPath = modelPath;
        }
        return item;
    }

    private createScriptItem(script: PanelScript, parent: PanelTreeItem): PanelTreeItem {
        const item = new PanelTreeItem(
            script.event,
            'script',
            vscode.TreeItemCollapsibleState.None,
            script,
            parent,
        );
        const lines = script.code.split('\n').length;
        item.description = `${lines} line${lines === 1 ? '' : 's'}`;
        return item;
    }

    private createReferenceItem(ref: PanelReference, parent: PanelTreeItem): PanelTreeItem {
        const label = ref.refType === 'dollar' ? `$${ref.alias}` : ref.path;
        const item = new PanelTreeItem(
            label,
            'reference',
            vscode.TreeItemCollapsibleState.None,
            ref,
            parent,
        );
        item.description = ref.refType;
        return item;
    }

    private formatPropertyValue(prop: PanelProperty): string {
        const value = prop.value;
        if (value.length > 50) {
            return value.substring(0, 47) + '...';
        }
        return value;
    }
}
