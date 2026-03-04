/**
 * @fileoverview Tolerant XML parser for WinCC OA panel files.
 *
 * Parses converted panel XML into a PanelModel without strict schema validation.
 * Focuses on extracting structure, properties, scripts, and references.
 *
 * WinCC OA XML panel structure:
 * - <panel version="14">
 *   - <properties>
 *     - <prop name="PropertyName">value</prop>
 *   - <shapes>
 *     - <shape Name="..." shapeType="...">
 *       - <properties>
 *       - <events>
 *         - <script name="EventName"><![CDATA[...code...]]></script>
 */

import * as fs from 'fs';
import {
    PanelModel,
    PanelShape,
    PanelProperty,
    PanelScript,
    PanelReference,
    createEmptyPanelModel,
} from './panelModel';
import { ExtensionOutputChannel } from './extensionOutput';

/**
 * Parses a WinCC OA panel XML file into a PanelModel.
 * Uses tolerant parsing - missing elements are ignored, not errors.
 */
export function parsePanelXml(xmlPath: string, pnlPath: string): PanelModel {
    const model = createEmptyPanelModel(pnlPath);

    try {
        const content = fs.readFileSync(xmlPath, 'utf8');

        // Extract panel-level properties from <panel><properties>...</properties></panel>
        const panelPropsMatch = content.match(/<panel[^>]*>\s*<properties>([\s\S]*?)<\/properties>/i);
        if (panelPropsMatch) {
            model.properties = extractTopLevelProperties(panelPropsMatch[1]);
        }

        // Extract shapes from <shapes>...</shapes>
        const shapesMatch = content.match(/<shapes>([\s\S]*)<\/shapes>/i);
        if (shapesMatch) {
            model.shapes = extractShapes(shapesMatch[1]);
        }

        // Extract panel references from entire content
        model.references = extractReferences(content);

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ExtensionOutputChannel.error('Parser', `Failed to parse panel XML: ${message}`);
        model.errors.push(`Parse error: ${message}`);
    }

    return model;
}

/**
 * Extracts only top-level properties from XML content.
 * Skips nested properties (they become children of their parent).
 */
function extractTopLevelProperties(content: string): PanelProperty[] {
    const properties: PanelProperty[] = [];
    
    // Find all <prop> start positions and their depths
    const propStarts: { idx: number; name: string; depth: number }[] = [];
    const propStartRegex = /<prop name="([^"]+)">/g;
    let match;
    
    // First pass: find all prop start tags
    while ((match = propStartRegex.exec(content)) !== null) {
        propStarts.push({
            idx: match.index,
            name: match[1],
            depth: 0, // Will calculate
        });
    }
    
    // Calculate depth for each prop start
    for (let i = 0; i < propStarts.length; i++) {
        let depth = 0;
        for (let j = 0; j < i; j++) {
            const startJ = propStarts[j].idx;
            const contentJ = extractPropContent(content, startJ + content.slice(startJ).indexOf('>') + 1);
            if (contentJ !== null) {
                const endJ = startJ + content.slice(startJ).indexOf('>') + 1 + contentJ.length + 7; // +7 for </prop>
                // Check if propStarts[i] is inside propStarts[j]
                if (propStarts[i].idx > startJ && propStarts[i].idx < endJ) {
                    depth++;
                }
            }
        }
        propStarts[i].depth = depth;
    }
    
    // Only process top-level props (depth 0)
    for (const prop of propStarts) {
        if (prop.depth > 0) continue; // Skip nested props
        
        const startIdx = prop.idx + content.slice(prop.idx).indexOf('>') + 1;
        const propContent = extractPropContent(content, startIdx);
        if (propContent === null) continue;

        // Check if this has nested <prop> children
        if (propContent.includes('<prop name=')) {
            // Parse nested props as children (recursively)
            const children = extractNestedProperties(propContent);
            if (children.length > 0) {
                properties.push({
                    name: prop.name,
                    value: `(${children.length} entries)`,
                    type: 'nested',
                    children,
                });
            }
        } else {
            // Simple value
            const value = propContent.trim();
            if (value) {
                properties.push({
                    name: prop.name,
                    value,
                    type: inferPropertyType(prop.name, value),
                });
            }
        }
    }

    // Limit to reasonable number to avoid overwhelming UI
    return properties.slice(0, 200);
}

/**
 * Extracts content between current position and matching </prop>.
 */
function extractPropContent(content: string, startIdx: number): string | null {
    let depth = 1;
    let idx = startIdx;
    const maxLen = Math.min(startIdx + 10000, content.length);
    
    while (idx < maxLen && depth > 0) {
        const openIdx = content.indexOf('<prop ', idx);
        const closeIdx = content.indexOf('</prop>', idx);
        
        if (closeIdx === -1) return null;
        
        if (openIdx !== -1 && openIdx < closeIdx) {
            depth++;
            idx = openIdx + 6;
        } else {
            depth--;
            if (depth === 0) {
                return content.substring(startIdx, closeIdx);
            }
            idx = closeIdx + 7;
        }
    }
    return null;
}

/**
 * Extracts nested properties from prop content (recursive).
 * This is called only for content that is already inside a parent prop.
 */
function extractNestedProperties(content: string): PanelProperty[] {
    const props: PanelProperty[] = [];
    
    // Find immediate child props only (depth 0 within this content)
    const propStarts: { idx: number; name: string }[] = [];
    const propStartRegex = /<prop name="([^"]+)">/g;
    let match;
    
    while ((match = propStartRegex.exec(content)) !== null) {
        propStarts.push({
            idx: match.index,
            name: match[1],
        });
    }
    
    // Track which positions are inside other props (to skip nested)
    const processedRanges: { start: number; end: number }[] = [];
    
    for (const prop of propStarts) {
        // Skip if this prop is inside an already processed prop
        const isNested = processedRanges.some(
            range => prop.idx > range.start && prop.idx < range.end
        );
        if (isNested) continue;
        
        const startIdx = prop.idx + content.slice(prop.idx).indexOf('>') + 1;
        const propContent = extractPropContent(content, startIdx);
        if (propContent === null) continue;
        
        // Mark this range as processed
        const endIdx = startIdx + propContent.length + 7; // +7 for </prop>
        processedRanges.push({ start: prop.idx, end: endIdx });

        // Check if this has nested <prop> children
        if (propContent.includes('<prop name=')) {
            // Recursively parse nested props
            const children = extractNestedProperties(propContent);
            if (children.length > 0) {
                props.push({
                    name: prop.name,
                    value: `(${children.length} entries)`,
                    type: 'nested',
                    children,
                });
            }
        } else {
            // Simple value
            const value = propContent.trim();
            if (value) {
                props.push({
                    name: prop.name,
                    value,
                    type: inferPropertyType(prop.name, value),
                });
            }
        }
    }
    
    return props;
}

/**
 * Extracts scripts/events from XML content.
 * WinCC OA format: <events><script name="EventName"><![CDATA[...code...]]></script></events>
 */
function extractScripts(content: string): PanelScript[] {
    const scripts: PanelScript[] = [];

    // Extract events section
    const eventsMatch = content.match(/<events>([\s\S]*?)<\/events>/i);
    if (!eventsMatch) {
        return scripts;
    }

    const eventsContent = eventsMatch[1];

    // Match <script name="EventName"><![CDATA[...]]></script>
    // The isEscaped="1" attribute indicates XML entities are escaped
    const scriptRegex = /<script[^>]*name="([^"]+)"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/script>/gi;
    let match;

    while ((match = scriptRegex.exec(eventsContent)) !== null) {
        const [, event, code] = match;
        if (code.trim()) {
            scripts.push({
                event,
                code: decodeXmlEntities(code),
            });
        }
    }

    // Also try without CDATA (some scripts may be directly escaped)
    const scriptPlainRegex = /<script[^>]*name="([^"]+)"[^>]*>([^<][\s\S]*?)<\/script>/gi;
    while ((match = scriptPlainRegex.exec(eventsContent)) !== null) {
        const [, event, code] = match;
        // Skip if already found via CDATA
        if (!scripts.some((s) => s.event === event) && code.trim()) {
            scripts.push({
                event,
                code: decodeXmlEntities(code),
            });
        }
    }

    return scripts;
}

/**
 * Extracts shapes from XML content.
 * WinCC OA format: <shape Name="shapeName" shapeType="PUSH_BUTTON">...</shape>
 */
function extractShapes(content: string): PanelShape[] {
    const shapes: PanelShape[] = [];

    // Match shape elements: <shape Name="..." layerId="..." shapeType="...">...</shape>
    // Use non-greedy matching and handle nested shapes carefully
    const shapeRegex = /<shape\s+Name="([^"]+)"[^>]*shapeType="([^"]+)"[^>]*>([\s\S]*?)<\/shape>/gi;
    let match;

    while ((match = shapeRegex.exec(content)) !== null) {
        const [fullMatch, name, shapeType, innerContent] = match;

        // Extract properties from shape's <properties> section
        const propsMatch = innerContent.match(/<properties>([\s\S]*?)<\/properties>/i);
        const shapeProps = propsMatch ? extractTopLevelProperties(propsMatch[1]) : [];

        // Extract scripts from shape's <events> section
        const shapeScripts = extractScripts(innerContent);

        // Extract references
        const shapeRefs = extractReferences(innerContent);

        const shape: PanelShape = {
            name: name || 'unnamed',
            shapeType: shapeType || 'UNKNOWN',
            children: [], // TODO: Handle nested shapes (CASCADE elements)
            properties: shapeProps,
            scripts: shapeScripts,
            references: shapeRefs,
        };

        shapes.push(shape);
    }

    return shapes;
}

/**
 * Extracts panel references from content.
 */
function extractReferences(content: string): PanelReference[] {
    const references: PanelReference[] = [];

    // Match ref patterns: fileName="xxx.pnl", RefFileName, etc.
    const refPatterns = [
        /<prop name="RefFileName">([^<]+\.pnl)<\/prop>/gi,
        /fileName="([^"]+\.pnl)"/gi,
        /panelName="([^"]+\.pnl)"/gi,
    ];

    for (const pattern of refPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const refPath = match[1].trim();
            if (refPath && !references.some((r) => r.path === refPath)) {
                references.push({
                    refType: 'ref',
                    path: refPath,
                });
            }
        }
    }

    // Match $-parameter references in script content
    const dollarRegex = /\$(\w+)/g;
    let match;
    while ((match = dollarRegex.exec(content)) !== null) {
        const paramName = match[1];
        if (!references.some((r) => r.refType === 'dollar' && r.alias === paramName)) {
            references.push({
                refType: 'dollar',
                path: '',
                alias: paramName,
            });
        }
    }

    return references;
}

/**
 * Infers property type from name and value.
 */
function inferPropertyType(name: string, value: string): string {
    const lowerName = name.toLowerCase();

    if (lowerName.includes('col') || lowerName.includes('color')) {
        return 'color';
    }
    if (lowerName.includes('font')) {
        return 'font';
    }
    if (/^-?\d+$/.test(value)) {
        return 'int';
    }
    if (/^-?\d+\.\d+$/.test(value)) {
        return 'float';
    }
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        return 'bool';
    }
    // Size format: "400 400"
    if (/^\d+\s+\d+$/.test(value)) {
        return 'size';
    }

    return 'string';
}

/**
 * Decodes common XML entities in script content.
 */
function decodeXmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
