import * as vscode from 'vscode';
import { getSelectedProject } from './otherExtensions';
import { ProjEnvProject, getProjectByProjectPath } from '@winccoa-tools-pack/npm-winccoa-core';

export async function getWinccoaProject(oaPanelPath: string): Promise<ProjEnvProject | undefined> {
    let currentProject: ProjEnvProject | undefined = await getProjectByProjectPath(oaPanelPath);

    if (currentProject) {
        return currentProject;
    }

    currentProject = (await getSelectedProject()) ?? undefined;

    if (!currentProject) {
        vscode.window.showWarningMessage(
            `No WinCC OA project selected; cannot determine WinCC OA version for conversion for given panel ${oaPanelPath}.\nPlease select a runnable project and try again.`,
        );
        return undefined;
    }

    if (!currentProject.getVersion()) {
        vscode.window.showWarningMessage(
            `Selected project "${currentProject.getName()}" does not have a version; cannot determine WinCC OA version for conversion for given panel ${oaPanelPath}.\nPlease select a runnable project with a version and try again.`,
        );
        return undefined;
    }

    if (!currentProject.getConfigPath()) {
        vscode.window.showWarningMessage(
            `Selected project "${currentProject.getName()}" does not have a config file; cannot determine WinCC OA version for conversion for given panel ${oaPanelPath}.\nPlease select a runnable project with a config file and try again.`,
        );
        return undefined;
    }

    return currentProject;
}
