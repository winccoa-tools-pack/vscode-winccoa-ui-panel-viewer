/**
 * @fileoverview Panel conversion utilities using @winccoa-tools-pack/npm-winccoa-ui-pnl-xml.
 *
 * Provides functions to convert between .pnl (binary) and .xml formats
 * using the npm package API.
 *
 * Note: The underlying WCCOAui tool converts files **in-place**, creating a .bak
 * backup. For viewer mode, we copy to a temp directory first.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pnlToXml, xmlToPnl } from '@winccoa-tools-pack/npm-winccoa-ui-pnl-xml';
import { ExtensionOutputChannel } from './extensionOutput';
import { getWinccoaProject } from './utils';
import { ProjEnvProjectFileSysStruct } from '@winccoa-tools-pack/npm-winccoa-core';

/** Result of a conversion operation */
export interface ConversionResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

/**
 * Checks if a .pnl file is encrypted by inspecting the first line.
 */
export async function isEncryptedPanel(filePath: string): Promise<boolean> {
    try {
        const fd = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(64);
        await fd.read(buffer, 0, 64, 0);
        await fd.close();
        const firstLine = buffer.toString('utf8').split(/\r?\n/)[0];
        return firstLine.startsWith('PVSS_CRYPTED_PANEL');
    } catch {
        return false;
    }
}

/**
 * Converts a .pnl file to .xml for viewing.
 *
 * Note: The WCCOAui tool converts in-place. For viewer mode, we copy to a temp
 * directory first, then convert there.
 *
 * @param pnlPath Absolute path to the .pnl file
 * @param outputDir Optional output directory; defaults to temp dir
 * @returns Conversion result with output path or error
 */
export async function convertPnlToXml(
    pnlPath: string,
    outputDir?: string,
): Promise<ConversionResult> {
    if (await isEncryptedPanel(pnlPath)) {
        return { success: false, error: 'Encrypted panel; content not viewable.' };
    }

    const oaProj = await getWinccoaProject(pnlPath);

    if (!oaProj) {
        return {
            success: false,
            error: 'No WinCC OA project selected; cannot determine WinCC OA project for conversion.',
        };
    }

    const version = oaProj.getVersion();

    const baseName = path.basename(pnlPath);

    // WCCOAui requires panel paths relative to project panels directory
    // Create a temp subfolder inside panels dir, copy file there, convert
    const tempSubDir = `_temp_convert_${Date.now()}`;
    const tempPanelsPath = path.join(
        oaProj.getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH),
        tempSubDir,
    );

    // Ensure temp directory exists
    await fs.promises.mkdir(tempPanelsPath, { recursive: true });

    // Copy file to temp panels subdirectory
    const workingFilePath = path.join(tempPanelsPath, baseName);
    await fs.promises.copyFile(pnlPath, workingFilePath);

    // Relative path from panels directory (what WCCOAui expects)
    const relativePath = `${tempSubDir}/${baseName}`;

    try {
        ExtensionOutputChannel.debug(
            'Converter',
            `Converting PNL to XML: ${relativePath} (version: ${version})`,
        );

        const result = await pnlToXml({
            version: version || 'unknown',
            inputPath: relativePath,
            configPath: oaProj.getConfigPath() || '',
            overwrite: true,
        });

        if (result.success) {
            // After in-place conversion, the file now contains XML
            // Copy to user's temp dir before cleanup
            const userTempDir =
                outputDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'winccoa-panel-'));
            const outputFilePath = path.join(userTempDir, baseName);
            await fs.promises.copyFile(workingFilePath, outputFilePath);

            // Cleanup project panels temp dir
            try {
                await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }

            return { success: true, outputPath: outputFilePath };
        } else {
            const errorMsg = result.stderr || `Conversion failed with exit code ${result.exitCode}`;
            ExtensionOutputChannel.error('Converter', `PNL to XML conversion failed: ${errorMsg}`);
            // Cleanup on failure too
            try {
                await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
            return { success: false, error: errorMsg };
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ExtensionOutputChannel.error('Converter', `PNL to XML conversion failed: ${message}`);
        // Cleanup on error
        try {
            await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        return { success: false, error: message };
    }
}

/**
 * Converts a .xml file back to .pnl.
 *
 * Note: The WCCOAui tool converts in-place and requires paths relative to project panels dir.
 *
 * @param xmlPath Absolute path to the .xml file
 * @param outputDir Optional output directory; defaults to same directory as xml
 * @returns Conversion result with output path or error
 */
export async function convertXmlToPnl(
    xmlPath: string,
    outputDir?: string,
): Promise<ConversionResult> {
    const oaProj = await getWinccoaProject(xmlPath);

    if (!oaProj) {
        return {
            success: false,
            error: 'No WinCC OA project selected; cannot determine WinCC OA project for conversion.',
        };
    }

    const baseName = path.basename(xmlPath);

    // WCCOAui requires panel paths relative to project panels directory
    // Create a temp subfolder inside panels dir, copy file there, convert
    const tempSubDir = `_temp_convert_${Date.now()}`;
    const tempPanelsPath = path.join(
        oaProj.getDir(ProjEnvProjectFileSysStruct.PANELS_REL_PATH),
        tempSubDir,
    );

    // Ensure temp directory exists
    await fs.promises.mkdir(tempPanelsPath, { recursive: true });

    // Copy file to temp panels subdirectory
    const workingFilePath = path.join(tempPanelsPath, baseName);
    await fs.promises.copyFile(xmlPath, workingFilePath);

    // Relative path from panels directory (what WCCOAui expects)
    const relativePath = `${tempSubDir}/${baseName}`;

    try {
        ExtensionOutputChannel.debug(
            'Converter',
            `Converting XML to PNL: ${relativePath} (version: ${oaProj.getVersion()})`,
        );

        const result = await xmlToPnl({
            version: oaProj.getVersion() || 'unknown',
            inputPath: relativePath,
            configPath: oaProj.getConfigPath() || '',
            overwrite: true,
        });

        if (result.success) {
            // After in-place conversion, the file now contains PNL
            // Copy to target directory
            const targetDir = outputDir ?? path.dirname(xmlPath);
            const outputFilePath = path.join(targetDir, baseName);
            await fs.promises.copyFile(workingFilePath, outputFilePath);

            // Cleanup project panels temp dir
            try {
                await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }

            return { success: true, outputPath: outputFilePath };
        } else {
            const errorMsg = result.stderr || `Conversion failed with exit code ${result.exitCode}`;
            ExtensionOutputChannel.error('Converter', `XML to PNL conversion failed: ${errorMsg}`);
            // Cleanup on failure
            try {
                await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
            return { success: false, error: errorMsg };
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ExtensionOutputChannel.error('Converter', `XML to PNL conversion failed: ${message}`);
        // Cleanup on error
        try {
            await fs.promises.rm(tempPanelsPath, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        return { success: false, error: message };
    }
}

/**
 * Recursively converts all .pnl files in a directory to .xml.
 */
export async function convertDirectoryPnlToXml(
    dirPath: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ converted: number; failed: number; errors: string[] }> {
    const result = { converted: 0, failed: 0, errors: [] as string[] };

    const files = await findPnlFiles(dirPath);
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progress?.report({ message: path.basename(file), increment: 100 / total });

        const convResult = await convertPnlToXml(file, path.dirname(file));
        if (convResult.success) {
            result.converted++;
        } else {
            result.failed++;
            result.errors.push(`${file}: ${convResult.error}`);
        }
    }

    return result;
}

/**
 * Recursively converts all .xml files in a directory to .pnl.
 */
export async function convertDirectoryXmlToPnl(
    dirPath: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ converted: number; failed: number; errors: string[] }> {
    const result = { converted: 0, failed: 0, errors: [] as string[] };

    const files = await findXmlFiles(dirPath);
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progress?.report({ message: path.basename(file), increment: 100 / total });

        const convResult = await convertXmlToPnl(file);
        if (convResult.success) {
            result.converted++;
        } else {
            result.failed++;
            result.errors.push(`${file}: ${convResult.error}`);
        }
    }

    return result;
}

/** Recursively finds .pnl files in a directory */
async function findPnlFiles(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await findPnlFiles(fullPath)));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pnl')) {
            // Skip .bak files
            if (!entry.name.toLowerCase().endsWith('.bak')) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

/** Recursively finds .xml files in a directory */
async function findXmlFiles(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await findXmlFiles(fullPath)));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
            results.push(fullPath);
        }
    }

    return results;
}
