import * as vscode from "vscode";
import * as childProcess from "child_process";
import * as path from "path";
import * as fs from "fs";
import ignore from "ignore";

const MIN_CONTEXTPILOT_VERSION = "0.9.0";
let cachedVersionCheck: boolean | null = null;

function parseVersion(versionStr: string): [number, number, number] {
    const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function isVersionCompatible(installed: string, required: string): boolean {
    const [imaj, imin, ipat] = parseVersion(installed);
    const [rmaj, rmin, rpat] = parseVersion(required);
    if (imaj !== rmaj) return imaj > rmaj;
    if (imin !== rmin) return imin > rmin;
    return ipat >= rpat;
}

async function checkContextPilotVersion(): Promise<boolean> {
    return new Promise((resolve) => {
        childProcess.exec("contextpilot --version", (error, stdout) => {
            if (error || !stdout) {
                vscode.window.showErrorMessage("Failed to run `contextpilot --version`. Is it installed?");
                return resolve(false);
            }

            const match = stdout.trim().match(/contextpilot\s+(\d+\.\d+\.\d+)/);
            if (!match) {
                vscode.window.showErrorMessage("Unexpected version format from contextpilot.");
                return resolve(false);
            }

            const version = match[1];
            if (!isVersionCompatible(version, MIN_CONTEXTPILOT_VERSION)) {
                vscode.window.showWarningMessage(
                    `Your contextpilot version is ${version}. Please update to at least ${MIN_CONTEXTPILOT_VERSION}.`
                );
                return resolve(false);
            }

            return resolve(true);
        });
    });
}

function getAllSubdirectoriesRespectingGitignore(rootDir: string): string[] {
    let results: string[] = [];
    const ig = ignore();
    const gitignorePath = path.join(rootDir, ".gitignore");

    if (fs.existsSync(gitignorePath)) {
        const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
        ig.add(gitignoreContent.split(/\r?\n/));
    }

    function walk(dir: string) {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = path.join(dir, file.name);
            const relativePath = path.relative(rootDir, fullPath);
            if (file.isDirectory()) {
                if (!ig.ignores(relativePath)) {
                    results.push(fullPath);
                    walk(fullPath);
                }
            }
        }
    }

    walk(rootDir);
    return results;
}

function getCurrentWorkspacePath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;
}

class CommitDescriptionProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this._onDidChange.event;
    private contentMap = new Map<string, string>();

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) || "";
    }

    setContent(uri: vscode.Uri, content: string) {
        this.contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }
}

const commitDescriptionProvider = new CommitDescriptionProvider();
vscode.workspace.registerTextDocumentContentProvider("commitdesc", commitDescriptionProvider);

async function runCommand(commandType: string, type: string) {
    if (!(await checkContextPilotVersion())) return;

    const { exec } = require("child_process");
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const currentFile = activeEditor.document.uri.fsPath;
    const currentWorkspacePath = getCurrentWorkspacePath();
    if (!currentWorkspacePath) {
        vscode.window.showErrorMessage("No workspace open");
        return;
    }

    const options: childProcess.ExecOptions = { cwd: currentWorkspacePath };
    let currentStartLine = 1, currentEndLine = 0;

    if (type === "line") {
        const line = activeEditor.selection.active.line + 1;
        currentStartLine = line;
        currentEndLine = line;
    } else if (type === "range") {
        const selection = activeEditor.selection;
        currentStartLine = selection.start.line + 1;
        currentEndLine = selection.end.line + 1;
    }

    let internalCommandType = commandType === "files" ? "query" : commandType;

    const binaryPath = "contextpilot";
    const command = `${binaryPath} ${currentWorkspacePath} -t ${internalCommandType} ${currentFile} -s ${currentStartLine} -e ${currentEndLine}`;

    vscode.window.showInformationMessage("Running command: " + command);

    exec(command, options, (error: any, stdout: string, stderr: string) => {
        if (error) {
            vscode.window.showErrorMessage("Error: " + error.message);
            return;
        }

        if (stderr.length > 0 && !stdout) {
            vscode.window.showErrorMessage("stderr: " + stderr);
            return;
        }

        if (commandType === "desc") {
            let parsed: [string, string, string, string, string][];
            try {
                parsed = JSON.parse(stdout.trim());
            } catch (e) {
                vscode.window.showErrorMessage("Failed to parse commit descriptions");
                return;
            }

            parsed.sort((a, b) => new Date(b[3]).getTime() - new Date(a[3]).getTime());

            const items = parsed.map(([title, description, author, date, commitUrl]) => ({
                label: title,
                detail: `${author} • ${date}`,
                description: description.slice(0, 80).replace(/\s+/g, " "),
                fullDescription: description,
                author,
                date,
                commitUrl
            }));

            vscode.window.showQuickPick(items, {
                matchOnDetail: true,
                matchOnDescription: true,
                placeHolder: "Select a commit to view details",
            }).then((selected) => {
                if (selected) {
                    const content = `# ${selected.label}\n\n${selected.fullDescription}\n\n---\n**Author:** ${selected.author}\n**Date:** ${selected.date}\n**Commit URL:** ${selected.commitUrl}`;
                    const safeFileName = selected.label.slice(0, 20).replace(/[^\w\d\-_.]/g, "_");
                    const uri = vscode.Uri.parse(`commitdesc:${safeFileName}`);
                    commitDescriptionProvider.setContent(uri, content);
                    vscode.workspace.openTextDocument(uri).then((doc) => {
                        vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
                    });
                }
            });

            return;
        }

        const outputFilesArray = stdout
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const items = outputFilesArray.map(line => {
            const filePath = line.split(" - ")[0].trim();
            const occurrencesMatch = line.match(/- (\d+) occurrences/);
            const occurrences = occurrencesMatch ? occurrencesMatch[1] : "0";
            return {
                label: filePath,
                description: `${occurrences} occurrences`,
            };
        });

        vscode.window.showQuickPick(items, {
            canPickMany: false,
            placeHolder: "Select a related file from ContextPilot",
        }).then((selectedItem) => {
            if (selectedItem) {
                const selectedFilePath = selectedItem.label;
                const fullPath = path.join(currentWorkspacePath, selectedFilePath);
                const fileUri = vscode.Uri.file(fullPath);
                vscode.workspace.openTextDocument(fileUri).then((document) => {
                    vscode.window.showTextDocument(document);
                }, (error) => {
                    vscode.window.showErrorMessage("Failed to open file: " + error.message);
                });
            }
        });
    });
}

const indexWorkspaceCommand = vscode.commands.registerCommand(
    "contextpilot.indexWorkspace",
    async () => {
        if (!(await checkContextPilotVersion())) return;

        const workspacePath = getCurrentWorkspacePath();
        if (!workspacePath) {
            vscode.window.showErrorMessage("No workspace open!");
            return;
        }

        const command = `contextpilot ${workspacePath} -t index`;
        const outputChannel = vscode.window.createOutputChannel("ContextPilot Logs");
        outputChannel.show(true);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "ContextPilot: Indexing Workspace",
            cancellable: false
        }, async () => {
            return new Promise((resolve, reject) => {
                const cp = childProcess.exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showErrorMessage(`ContextPilot Indexing Failed ❌: ${error.message}`);
                        outputChannel.appendLine(`[ERROR] ${error.message}`);
                        reject(error);
                        return;
                    }
                    vscode.window.showInformationMessage("ContextPilot: Indexing completed successfully ✅");
                    outputChannel.appendLine("[INFO] Indexing completed successfully ✅");
                    resolve(undefined);
                });

                cp.stdout?.on("data", data => outputChannel.appendLine(`[stdout] ${data.toString()}`));
                cp.stderr?.on("data", data => outputChannel.appendLine(`[stderr] ${data.toString()}`));
            });
        });
    }
);

const indexSubdirectoriesCommand = vscode.commands.registerCommand(
    "contextpilot.indexSubdirectories",
    async () => {
        if (!(await checkContextPilotVersion())) return;

        const workspacePath = getCurrentWorkspacePath();
        if (!workspacePath) {
            vscode.window.showErrorMessage("No workspace open!");
            return;
        }

        const allSubdirs = getAllSubdirectoriesRespectingGitignore(workspacePath)
            .map(dir => path.relative(workspacePath, dir))
            .filter(p => p.length > 0);

        if (allSubdirs.length === 0) {
            vscode.window.showInformationMessage("No subdirectories found.");
            return;
        }

        const selected = await vscode.window.showQuickPick(allSubdirs, {
            canPickMany: true,
            placeHolder: "Select subdirectories to index with ContextPilot"
        });

        if (!selected || selected.length === 0) {
            vscode.window.showInformationMessage("No subdirectories selected.");
            return;
        }

        const subDirArg = selected.join(",");
        const command = `contextpilot ${workspacePath} -t index -i "${subDirArg}"`;

        const outputChannel = vscode.window.createOutputChannel("ContextPilot Logs");
        outputChannel.show(true);

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `ContextPilot: Indexing ${selected.length} subdirectories`,
            cancellable: false
        }, async () => {
            return new Promise((resolve, reject) => {
                const cp = childProcess.exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showErrorMessage(`Indexing failed ❌: ${error.message}`);
                        outputChannel.appendLine(`[ERROR] ${error.message}`);
                        reject(error);
                        return;
                    }
                    vscode.window.showInformationMessage("ContextPilot: Subdirectory indexing completed ✅");
                    outputChannel.appendLine("[INFO] Subdirectory indexing completed ✅");
                    resolve(undefined);
                });

                cp.stdout?.on("data", data => outputChannel.appendLine(`[stdout] ${data.toString()}`));
                cp.stderr?.on("data", data => outputChannel.appendLine(`[stderr] ${data.toString()}`));
            });
        });
    }
);

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentLineNumber", () => runCommand("files", "line")),
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentFile", () => runCommand("files", "file")),
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentRange", () => runCommand("files", "range")),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentLineNumber", () => runCommand("authors", "line")),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentFile", () => runCommand("authors", "file")),
        vscode.commands.registerCommand("contextpilot.getContextDescriptions", () => runCommand("desc", "range")),
        indexWorkspaceCommand,
        indexSubdirectoriesCommand
    );
}

export function deactivate() {}
