import * as vscode from "vscode";
import * as childProcess from "child_process";
import * as path from "path";
import * as fs from "fs";
import ignore from "ignore";

const MIN_CONTEXTPILOT_VERSION = "0.9.0";
let cachedVersionCheck: boolean | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let gitWatchers: vscode.FileSystemWatcher[] = [];
let lastIndexTime: number | null = null;

// Helper functions
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
    if (cachedVersionCheck !== null) {
        return cachedVersionCheck;
    }

    // Common installation paths to check
    const possiblePaths = [
        "contextpilot", // Check PATH
        "~/.local/bin/contextpilot",
        "~/.cargo/bin/contextpilot",
        "/usr/local/bin/contextpilot",
        "/usr/bin/contextpilot"
    ];

    // Expand home directory in paths
    const expandedPaths = possiblePaths.map(p => p.replace("~", process.env.HOME || ""));

    return new Promise((resolve) => {
        // Try each path until we find the binary
        const tryNextPath = (index: number) => {
            if (index >= expandedPaths.length) {
                const errorMessage = `ContextPilot binary not found. Please install it using one of these methods:
1. Download from GitHub releases and add to PATH
2. Install via cargo: cargo install contextpilot
3. Copy binary to one of these locations:
   - ~/.local/bin/
   - ~/.cargo/bin/
   - /usr/local/bin/
   - /usr/bin/`;
                
                outputChannel.appendLine(`[ERROR] ${errorMessage}`);
                vscode.window.showErrorMessage("ContextPilot binary not found. Check output panel for installation instructions.");
                cachedVersionCheck = false;
                return resolve(false);
            }

            const path = expandedPaths[index];
            childProcess.exec(`${path} --version`, (error, stdout) => {
                if (error || !stdout) {
                    // Try next path
                    tryNextPath(index + 1);
                    return;
                }

                const match = stdout.trim().match(/contextpilot\s+(\d+\.\d+\.\d+)/);
                if (!match) {
                    outputChannel.appendLine(`[ERROR] Unexpected version format from contextpilot at ${path}`);
                    vscode.window.showErrorMessage("Unexpected version format from contextpilot.");
                    cachedVersionCheck = false;
                    return resolve(false);
                }

                const version = match[1];
                if (!isVersionCompatible(version, MIN_CONTEXTPILOT_VERSION)) {
                    const message = `Your contextpilot version is ${version}. Please update to at least ${MIN_CONTEXTPILOT_VERSION}.`;
                    outputChannel.appendLine(`[WARN] ${message}`);
                    vscode.window.showWarningMessage(message);
                    cachedVersionCheck = false;
                    return resolve(false);
                }

                outputChannel.appendLine(`[INFO] Found contextpilot v${version} at ${path}`);
                cachedVersionCheck = true;
                return resolve(true);
            });
        };

        // Start checking paths
        tryNextPath(0);
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

    outputChannel.appendLine(`[INFO] Running command: ${command}`);

    exec(command, options, (error: any, stdout: string, stderr: string) => {
        if (error) {
            outputChannel.appendLine(`[ERROR] Command failed: ${error.message}`);
            vscode.window.showErrorMessage("Error: " + error.message);
            return;
        }

        if (stderr.length > 0 && !stdout) {
            outputChannel.appendLine(`[ERROR] Command stderr: ${stderr}`);
            vscode.window.showErrorMessage("stderr: " + stderr);
            return;
        }

        if (commandType === "desc") {
            let parsed: [string, string, string, string, string][];
            try {
                parsed = JSON.parse(stdout.trim());
                outputChannel.appendLine(`[INFO] Successfully parsed ${parsed.length} commit descriptions`);
            } catch (e) {
                outputChannel.appendLine(`[ERROR] Failed to parse commit descriptions: ${e}`);
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
                    outputChannel.appendLine(`[INFO] Selected commit: ${selected.label}`);
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

        outputChannel.appendLine(`[INFO] Found ${outputFilesArray.length} related files`);

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
                outputChannel.appendLine(`[INFO] Selected file: ${selectedItem.label}`);
                const selectedFilePath = selectedItem.label;
                const fullPath = path.join(currentWorkspacePath, selectedFilePath);
                const fileUri = vscode.Uri.file(fullPath);
                vscode.workspace.openTextDocument(fileUri).then((document) => {
                    vscode.window.showTextDocument(document);
                }, (error) => {
                    outputChannel.appendLine(`[ERROR] Failed to open file: ${error.message}`);
                    vscode.window.showErrorMessage("Failed to open file: " + error.message);
                });
            }
        });
    });
}

async function getChangedFilesSinceLastIndex(workspacePath: string): Promise<string[]> {
    if (!lastIndexTime) {
        return [];
    }

    return new Promise((resolve, reject) => {
        const command = `git diff --name-only --diff-filter=ACMRT ${lastIndexTime} HEAD`;
        childProcess.exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            const files = stdout.split('\n')
                .map(file => file.trim())
                .filter(file => file.length > 0)
                .map(file => path.join(workspacePath, file));
            resolve(files);
        });
    });
}

const reindexChangedFilesCommand = vscode.commands.registerCommand(
    "contextpilot.reindexChangedFiles",
    async () => {
        if (!(await checkContextPilotVersion())) return;

        const workspacePath = getCurrentWorkspacePath();
        if (!workspacePath) {
            vscode.window.showErrorMessage("No workspace open!");
            return;
        }

        try {
            const changedFiles = await getChangedFilesSinceLastIndex(workspacePath);
            
            if (changedFiles.length === 0) {
                vscode.window.showInformationMessage("No files have changed since last indexing.");
                return;
            }

            // Update status bar to show indexing in progress
            statusBarItem.text = "$(sync~spin) ContextPilot: Re-indexing...";
            statusBarItem.show();

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `ContextPilot: Re-indexing ${changedFiles.length} changed files`,
                cancellable: false
            }, async (progress) => {
                let completed = 0;
                for (const file of changedFiles) {
                    const relativePath = path.relative(workspacePath, file);
                    progress.report({ 
                        message: `Re-indexing ${relativePath}`,
                        increment: (100 / changedFiles.length)
                    });

                    const command = `contextpilot ${workspacePath} -t indexfile "${file}"`;
                    await new Promise<void>((resolve, reject) => {
                        childProcess.exec(command, { cwd: workspacePath }, (error, stdout, stderr) => {
                            if (error) {
                                outputChannel.appendLine(`[ERROR] Failed to index ${relativePath}: ${error.message}`);
                                reject(error);
                                return;
                            }
                            completed++;
                            outputChannel.appendLine(`[INFO] Successfully indexed ${relativePath}`);
                            resolve();
                        });
                    });
                }
            });

            // Update last index time
            lastIndexTime = Math.floor(Date.now() / 1000);

            // Show completion status temporarily
            statusBarItem.text = "$(check) ContextPilot: Re-indexing Done";
            setTimeout(() => {
                statusBarItem.text = "$(search) ContextPilot";
            }, 3000);

            vscode.window.showInformationMessage(`Successfully re-indexed ${changedFiles.length} changed files.`);
        } catch (error) {
            outputChannel.appendLine(`[ERROR] Re-indexing failed: ${error}`);
            vscode.window.showErrorMessage(`ContextPilot Re-indexing Failed ❌: ${error}`);
            statusBarItem.text = "$(error) ContextPilot: Re-indexing Failed";
            setTimeout(() => {
                statusBarItem.text = "$(search) ContextPilot";
            }, 3000);
        }
    }
);

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
        outputChannel.appendLine(`[INFO] Starting workspace indexing`);
        outputChannel.appendLine(`[INFO] Command: ${command}`);

        let filesIndexed = 0;

        // Update status bar to show indexing in progress
        statusBarItem.text = "$(sync~spin) ContextPilot: Indexing...";
        statusBarItem.show();

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "ContextPilot: Indexing Workspace",
            cancellable: false
        }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            return new Promise<void>((resolve, reject) => {
                const cp = childProcess.exec(command, { cwd: workspacePath }, (error: childProcess.ExecException | null, stdout: string, stderr: string) => {
                    if (error) {
                        outputChannel.appendLine(`[ERROR] Indexing failed: ${error.message}`);
                        vscode.window.showErrorMessage(`ContextPilot Indexing Failed ❌: ${error.message}`);
                        statusBarItem.text = "$(error) ContextPilot: Indexing Failed";
                        setTimeout(() => {
                            statusBarItem.text = "$(search) ContextPilot";
                        }, 3000);
                        reject(error);
                        return;
                    }
                    outputChannel.appendLine(`[INFO] Indexing completed successfully (${filesIndexed} files indexed)`);
                    vscode.window.showInformationMessage(`ContextPilot: Indexing completed successfully ✅ (${filesIndexed} files indexed)`);
                    
                    // Update last index time on successful indexing
                    lastIndexTime = Math.floor(Date.now() / 1000);
                    
                    // Show completion status temporarily
                    statusBarItem.text = "$(check) ContextPilot: Indexing Done";
                    setTimeout(() => {
                        statusBarItem.text = "$(search) ContextPilot";
                    }, 3000);
                    
                    resolve();
                });

                cp.stdout?.on("data", (data: string) => {
                    const output = data.toString();
                    outputChannel.appendLine(`[stdout] ${output}`);
                    
                    // Count files being indexed
                    const fileMatches = output.match(/Indexing file:/g);
                    if (fileMatches) {
                        filesIndexed += fileMatches.length;
                        progress.report({ message: `${filesIndexed} files indexed` });
                    }
                });
                cp.stderr?.on("data", (data: string) => outputChannel.appendLine(`[stderr] ${data.toString()}`));
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

async function isCopilotAvailable(): Promise<boolean> {
    try {
        // Check if Copilot extension is installed and activated
        const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
        if (!copilotExtension) {
            vscode.window.showErrorMessage('GitHub Copilot extension not found. Please install it from the VS Code marketplace.');
            return false;
        }

        // Check if Copilot is activated
        if (!copilotExtension.isActive) {
            await copilotExtension.activate();
        }

        // Check if Copilot is signed in by trying to get a completion
        try {
            // Create a temporary document to test Copilot
            const tempDoc = await vscode.workspace.openTextDocument({
                content: '// Test Copilot',
                language: 'javascript'
            });
            const tempEditor = await vscode.window.showTextDocument(tempDoc, vscode.ViewColumn.Beside);
            
            // Try to trigger Copilot
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            
            // Wait a bit to see if Copilot responds
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Close the temporary document
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            
            return true;
        } catch (error) {
            vscode.window.showErrorMessage('GitHub Copilot is not properly activated. Please make sure you are signed in.');
            return false;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error checking Copilot availability: ${error}`);
        return false;
    }
}

async function getCopilotResponse(prompt: string, maxRetries: number = 3): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Create a temporary document for Copilot
            const tempDoc = await vscode.workspace.openTextDocument({
                content: prompt,
                language: 'markdown'
            });
            const tempEditor = await vscode.window.showTextDocument(tempDoc, vscode.ViewColumn.Beside);
            
            // Trigger Copilot inline completion
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            
            // Wait for Copilot response
            const response = await new Promise<string>((resolve, reject) => {
                let timeoutId: NodeJS.Timeout;
                const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
                    if (e.document === tempDoc) {
                        const content = e.document.getText();
                        if (content.length > prompt.length) {
                            clearTimeout(timeoutId);
                            disposable.dispose();
                            resolve(content.slice(prompt.length).trim());
                        }
                    }
                });
                
                // Increased timeout to 30 seconds
                timeoutId = setTimeout(() => {
                    disposable.dispose();
                    reject(new Error('Copilot is taking longer than expected to respond. Please try again or rephrase your question.'));
                }, 30000);
            });

            // Close the temporary document
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            return response;
        } catch (error) {
            if (attempt === maxRetries) {
                throw new Error(`Failed to get response after ${maxRetries} attempts. ${error instanceof Error ? error.message : String(error)}`);
            }
            // Wait before retrying with exponential backoff
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
    }
    throw new Error('Failed to get response after multiple attempts');
}

async function generateDiffsForCursorChat() {
    if (!(await checkContextPilotVersion())) return;

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    // Make sure we're not in an untitled file
    if (activeEditor.document.isUntitled) {
        vscode.window.showErrorMessage("Please save the file before analyzing commits");
        return;
    }

    const currentFile = activeEditor.document.uri.fsPath;
    const currentWorkspacePath = getCurrentWorkspacePath();
    if (!currentWorkspacePath) {
        vscode.window.showErrorMessage("No workspace open");
        return;
    }

    // Create output channel but don't show it automatically
    outputChannel.clear();
    outputChannel.appendLine("Starting diff generation process...");
    outputChannel.appendLine(`Current file: ${currentFile}`);
    outputChannel.appendLine(`Workspace path: ${currentWorkspacePath}`);

    // Get the current selection or use the whole file
    let currentStartLine = 1;
    let currentEndLine = activeEditor.document.lineCount;
    let isSelection = false;

    if (activeEditor.selection && !activeEditor.selection.isEmpty) {
        currentStartLine = activeEditor.selection.start.line + 1;
        currentEndLine = activeEditor.selection.end.line + 1;
        isSelection = true;
        outputChannel.appendLine(`Using selected range: lines ${currentStartLine} to ${currentEndLine}`);
    } else {
        outputChannel.appendLine(`Using entire file: ${currentEndLine} lines`);
    }

    // Show progress indicator
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Generating diffs for ${isSelection ? 'selected code' : 'current file'}...`,
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0 });

        // First get the commit descriptions
        const command = `contextpilot ${currentWorkspacePath} -t desc ${currentFile} -s ${currentStartLine} -e ${currentEndLine}`;
        outputChannel.appendLine(`\nRunning contextpilot command: ${command}`);
        
        return new Promise<void>((resolve, reject) => {
            childProcess.exec(command, { cwd: currentWorkspacePath }, async (error, stdout, stderr) => {
                if (error) {
                    outputChannel.appendLine(`Error running contextpilot: ${error.message}`);
                    vscode.window.showErrorMessage("Error: " + error.message);
                    reject(error);
                    return;
                }

                if (stderr.length > 0 && !stdout) {
                    outputChannel.appendLine(`stderr output: ${stderr}`);
                    vscode.window.showErrorMessage("stderr: " + stderr);
                    reject(new Error(stderr));
                    return;
                }

                outputChannel.appendLine("\nContextPilot output:");
                outputChannel.appendLine(stdout);

                let parsed: [string, string, string, string, string][];
                try {
                    parsed = JSON.parse(stdout.trim());
                    outputChannel.appendLine(`\nParsed ${parsed.length} commits:`);
                    parsed.forEach(([hash, title, , author, date]) => {
                        outputChannel.appendLine(`- ${hash}: ${title} (${author}, ${date})`);
                    });
                } catch (e) {
                    outputChannel.appendLine(`\nFailed to parse commits: ${e}`);
                    vscode.window.showErrorMessage("Failed to parse commit descriptions");
                    reject(e);
                    return;
                }

                if (!parsed || parsed.length === 0) {
                    outputChannel.appendLine("\nNo commits found for the selected range");
                    vscode.window.showWarningMessage("No commits found for the selected range");
                    resolve();
                    return;
                }

                progress.report({ increment: 30 });

                // Get git diff for each commit
                const commitDiffs: string[] = [];
                for (const [title, description, author, date, hash] of parsed) {
                    try {
                        outputChannel.appendLine(`\nProcessing commit: ${hash}`);
                        // Extract the commit hash from the URL
                        const commitHash = hash.split('/').pop() || hash;
                        const diffCommand = `git show ${commitHash} -- "${currentFile}"`;
                        outputChannel.appendLine(`\nRunning git command for commit ${commitHash}: ${diffCommand}`);
                        
                        const diffOutput = await new Promise<string>((resolve, reject) => {
                            childProcess.exec(diffCommand, { cwd: currentWorkspacePath }, (error, stdout, stderr) => {
                                if (error) {
                                    outputChannel.appendLine(`Git error for commit ${commitHash}: ${error.message}`);
                                    reject(error);
                                } else {
                                    outputChannel.appendLine(`Got diff for commit ${commitHash}, length: ${stdout.length}`);
                                    resolve(stdout);
                                }
                            });
                        });

                        if (diffOutput.trim()) {
                            commitDiffs.push(`Commit: ${commitHash}\nTitle: ${title}\nAuthor: ${author}\nDate: ${date}\n\n${diffOutput}\n\n---\n\n`);
                            outputChannel.appendLine(`Added diff for commit ${commitHash}`);
                        } else {
                            outputChannel.appendLine(`Empty diff for commit ${commitHash}`);
                        }
                    } catch (e) {
                        outputChannel.appendLine(`Failed to get diff for commit ${hash}: ${e}`);
                    }
                }

                progress.report({ increment: 30 });

                if (commitDiffs.length === 0) {
                    outputChannel.appendLine("\nNo diffs were generated for any commits");
                    vscode.window.showWarningMessage("No diffs found for the selected commits");
                    resolve();
                    return;
                }

                // Create a new file with all the diffs
                const fileName = path.basename(currentFile);
                const diffContent = `# Git Diffs for ${fileName}\n\nThis file contains all relevant git diffs for analysis. You can use Cursor Chat to ask questions about these changes.\n\n${commitDiffs.join('\n')}`;
                
                outputChannel.appendLine(`\nGenerated diff content length: ${diffContent.length}`);
                
                const diffFile = await vscode.workspace.openTextDocument({
                    content: diffContent,
                    language: 'markdown'
                });

                await vscode.window.showTextDocument(diffFile, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside
                });

                vscode.window.showInformationMessage(`Generated ${commitDiffs.length} diffs! You can now use Cursor Chat to analyze these changes.`);
                outputChannel.appendLine(`\nSuccessfully generated ${commitDiffs.length} diffs`);

                progress.report({ increment: 40 });
                resolve();
            });
        });
    });
}

function setupGitWatcher() {
    const config = vscode.workspace.getConfiguration('contextpilot');
    const autoIndexOnCommit = config.get<boolean>('autoIndexOnGitCommit');

    if (!autoIndexOnCommit) {
        if (gitWatchers.length > 0) {
            gitWatchers.forEach(watcher => watcher.dispose());
            gitWatchers = [];
        }
        return;
    }

    // Watch for changes in both .git/HEAD and .git/refs/heads
    const workspacePath = getCurrentWorkspacePath();
    if (!workspacePath) return;

    const gitPath = path.join(workspacePath, '.git');
    if (!fs.existsSync(gitPath)) return;

    // Watch HEAD file
    const headWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(gitPath), 'HEAD'),
        false, // ignoreCreateEvents
        false, // ignoreChangeEvents
        false  // ignoreDeleteEvents
    );

    // Watch refs/heads directory
    const refsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(gitPath), 'refs/heads/**/*'),
        false, // ignoreCreateEvents
        false, // ignoreChangeEvents
        false  // ignoreDeleteEvents
    );

    const handleGitChange = async (uri: vscode.Uri) => {
        outputChannel.appendLine(`[INFO] Git change detected in ${uri.fsPath}, triggering re-indexing of changed files`);
        try {
            // If this is the first time (no lastIndexTime), do a full index
            if (!lastIndexTime) {
                await vscode.commands.executeCommand("contextpilot.indexWorkspace");
            } else {
                await vscode.commands.executeCommand("contextpilot.reindexChangedFiles");
            }
        } catch (error) {
            outputChannel.appendLine(`[ERROR] Failed to re-index after Git change: ${error}`);
        }
    };

    headWatcher.onDidChange(handleGitChange);
    refsWatcher.onDidChange(handleGitChange);

    // Store both watchers
    gitWatchers = [headWatcher, refsWatcher];
}

export function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel("ContextPilot");
    context.subscriptions.push(outputChannel);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "$(search) ContextPilot";
    statusBarItem.tooltip = "ContextPilot Commands";
    statusBarItem.command = "contextpilot.showCommands";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Set up Git watcher
    setupGitWatcher();

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('contextpilot.autoIndexOnGitCommit')) {
                setupGitWatcher();
            }
        })
    );

    // Register command to show available commands
    context.subscriptions.push(
        vscode.commands.registerCommand("contextpilot.showCommands", () => {
            const commands = [
                { label: "Index Workspace", command: "contextpilot.indexWorkspace" },
                { label: "Index Subdirectories", command: "contextpilot.indexSubdirectories" },
                { label: "Get Context Files (Current Line)", command: "contextpilot.getContextFilesCurrentLineNumber" },
                { label: "Get Context Files (Current File)", command: "contextpilot.getContextFilesCurrentFile" },
                { label: "Get Context Files (Selected Range)", command: "contextpilot.getContextFilesCurrentRange" },
                { label: "Get Relevant Commits", command: "contextpilot.getContextDescriptions" },
                { label: "Generate Diffs Buffer", command: "contextpilot.generateDiffsForCursorChat" },
                { label: "Re-index Changed Files", command: "contextpilot.reindexChangedFiles" }
            ];

            vscode.window.showQuickPick(commands, {
                placeHolder: "Select a ContextPilot command"
            }).then(selected => {
                if (selected) {
                    vscode.commands.executeCommand(selected.command);
                }
            });
        })
    );

    // Function to start indexing
    const startIndexing = async () => {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            try {
                await vscode.commands.executeCommand("contextpilot.indexWorkspace");
            } catch (error) {
                console.error("Failed to start indexing:", error);
            }
        }
    };

    // Register workspace open event listener
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async (event: vscode.WorkspaceFoldersChangeEvent) => {
            if (event.added.length > 0) {
                // Wait a bit for the workspace to be fully loaded
                setTimeout(startIndexing, 2000);
            }
        })
    );

    // Start indexing when extension is activated
    setTimeout(startIndexing, 2000);

    context.subscriptions.push(
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentLineNumber", () => runCommand("files", "line")),
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentFile", () => runCommand("files", "file")),
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentRange", () => runCommand("files", "range")),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentLineNumber", () => runCommand("authors", "line")),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentFile", () => runCommand("authors", "file")),
        vscode.commands.registerCommand("contextpilot.getContextDescriptions", () => runCommand("desc", "range")),
        indexWorkspaceCommand,
        indexSubdirectoriesCommand,
        vscode.commands.registerCommand(
            "contextpilot.generateDiffsForCursorChat",
            generateDiffsForCursorChat
        ),
        reindexChangedFilesCommand
    );
}

export function deactivate() {
    if (gitWatchers.length > 0) {
        gitWatchers.forEach(watcher => watcher.dispose());
        gitWatchers = [];
    }
}
