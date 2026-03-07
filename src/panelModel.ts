/**
 * @fileoverview Type definitions for WinCC OA panel structure.
 *
 * These types represent the in-memory model of a parsed .pnl file,
 * used by the tree view, details pane, and script viewer.
 */

/**
 * Represents a property on a shape or panel element.
 */
export interface PanelProperty {
    /** Property name (e.g., "foreCol", "backCol", "text") */
    name: string;
    /** Raw string value from the XML/pnl */
    value: string;
    /** Resolved type hint for display (e.g., "color", "string", "int") */
    type?: string;
    /** Nested child properties (e.g., localized text values) */
    children?: PanelProperty[];
}

/**
 * Represents a script or event handler attached to a shape.
 */
export interface PanelScript {
    /** Event name (e.g., "Initialize", "Clicked", "Changed") */
    event: string;
    /** CTL script body */
    code: string;
    /** 1-based line number in source for navigation */
    sourceLine?: number;
}

/**
 * Represents a reference to another panel (e.g., embedded ref or $-parameter).
 */
export interface PanelReference {
    /** Reference type: "ref" | "symbol" | "dollar" */
    refType: string;
    /** Target panel path */
    path: string;
    /** Optional alias or param name */
    alias?: string;
}

/**
 * Represents a shape (graphical element) inside a panel.
 */
export interface PanelShape {
    /** Unique shape name within the panel */
    name: string;
    /** Shape type (e.g., "PRIMITIVE_TEXT", "PUSH_BUTTON", "CASCADE") */
    shapeType: string;
    /** Child shapes for group/cascade elements */
    children: PanelShape[];
    /** Properties defined on this shape */
    properties: PanelProperty[];
    /** Scripts/events attached to this shape */
    scripts: PanelScript[];
    /** References to other panels */
    references: PanelReference[];
}

/**
 * Root model representing a parsed WinCC OA panel.
 */
export interface PanelModel {
    /** Absolute file path of the source .pnl */
    filePath: string;
    /** Panel name (usually filename without extension) */
    name: string;
    /** Whether the panel is encrypted */
    encrypted: boolean;
    /** Top-level shapes */
    shapes: PanelShape[];
    /** Panel-level properties */
    properties: PanelProperty[];
    /** Panel-level scripts */
    scripts: PanelScript[];
    /** Panel-level references */
    references: PanelReference[];
    /** Parse/conversion errors, if any */
    errors: string[];
}

/**
 * Creates an empty PanelModel for a given file.
 */
export function createEmptyPanelModel(filePath: string): PanelModel {
    const name = filePath.replace(/^.*[\\/]/, '').replace(/\.pnl$/i, '');
    return {
        filePath,
        name,
        encrypted: false,
        shapes: [],
        properties: [],
        scripts: [],
        references: [],
        errors: [],
    };
}

/**
 * Creates a placeholder model for encrypted panels.
 */
export function createEncryptedPanelModel(filePath: string): PanelModel {
    const model = createEmptyPanelModel(filePath);
    model.encrypted = true;
    model.errors.push('Encrypted panel; content not viewable.');
    return model;
}
