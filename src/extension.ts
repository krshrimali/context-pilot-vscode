import * as vscode from "vscode";
import * as childProcess from "child_process";
import * as path from "path";
import * as fs from "fs";
import ignore from "ignore";

const MIN_CONTEXTPILOT_VERSION = "0.9.0";
let cachedVersionCheck: boolean | null = null;
let outputChannel: vscode.OutputChannel;

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

    return new Promise((resolve) => {
        childProcess.exec("contextpilot --version", (error, stdout) => {
            if (error || !stdout) {
                vscode.window.showErrorMessage("Failed to run `contextpilot --version`. Is it installed?");
                cachedVersionCheck = false;
                return resolve(false);
            }

            const match = stdout.trim().match(/contextpilot\s+(\d+\.\d+\.\d+)/);
            if (!match) {
                vscode.window.showErrorMessage("Unexpected version format from contextpilot.");
                cachedVersionCheck = false;
                return resolve(false);
            }

            const version = match[1];
            if (!isVersionCompatible(version, MIN_CONTEXTPILOT_VERSION)) {
                vscode.window.showWarningMessage(
                    `Your contextpilot version is ${version}. Please update to at least ${MIN_CONTEXTPILOT_VERSION}.`
                );
                cachedVersionCheck = false;
                return resolve(false);
            }

            cachedVersionCheck = true;
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

class LLMAnalysisProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this._onDidChange.event;
    private contentMap = new Map<string, string>();
    private chatHistory: { role: string; content: string }[] = [];

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) || "";
    }

    setContent(uri: vscode.Uri, content: string) {
        this.contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    addToChatHistory(role: string, content: string) {
        this.chatHistory.push({ role, content });
    }

    getChatHistory() {
        return this.chatHistory;
    }

    clearChatHistory() {
        this.chatHistory = [];
    }
}

const llmAnalysisProvider = new LLMAnalysisProvider();
vscode.workspace.registerTextDocumentContentProvider("llmanalysis", llmAnalysisProvider);

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

async function analyzeCommitsWithLLM() {
    if (!(await checkContextPilotVersion())) return;

    // Check if Copilot is available
    if (!(await isCopilotAvailable())) {
        const installCopilot = await vscode.window.showWarningMessage(
            'GitHub Copilot is required for this feature. Would you like to install it?',
            'Install Copilot',
            'Cancel'
        );
        
        if (installCopilot === 'Install Copilot') {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', 'GitHub.copilot');
            vscode.window.showInformationMessage('Please sign in to GitHub Copilot after installation.');
        }
        return;
    }

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

    // Get the current selection or use the whole file
    let currentStartLine = 1;
    let currentEndLine = activeEditor.document.lineCount;
    let isSelection = false;

    if (activeEditor.selection && !activeEditor.selection.isEmpty) {
        currentStartLine = activeEditor.selection.start.line + 1;
        currentEndLine = activeEditor.selection.end.line + 1;
        isSelection = true;
    }

    // Show progress indicator
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing commits for ${isSelection ? 'selected code' : 'current file'}...`,
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0 });

        // First get the commit descriptions
        const command = `contextpilot ${currentWorkspacePath} -t desc ${currentFile} -s ${currentStartLine} -e ${currentEndLine}`;
        
        return new Promise<void>((resolve, reject) => {
            childProcess.exec(command, { cwd: currentWorkspacePath }, async (error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage("Error: " + error.message);
                    reject(error);
                    return;
                }

                if (stderr.length > 0 && !stdout) {
                    vscode.window.showErrorMessage("stderr: " + stderr);
                    reject(new Error(stderr));
                    return;
                }

                let parsed: [string, string, string, string, string][];
                try {
                    parsed = JSON.parse(stdout.trim());
                } catch (e) {
                    vscode.window.showErrorMessage("Failed to parse commit descriptions");
                    reject(e);
                    return;
                }

                progress.report({ increment: 30 });

                // Get git diff for each commit
                const commitDiffs: string[] = [];
                for (const [hash, , , , ] of parsed) {
                    try {
                        const diffCommand = `git show ${hash} -- ${currentFile}`;
                        const diffOutput = await new Promise<string>((resolve, reject) => {
                            childProcess.exec(diffCommand, { cwd: currentWorkspacePath }, (error, stdout, stderr) => {
                                if (error) reject(error);
                                else resolve(stdout);
                            });
                        });
                        commitDiffs.push(diffOutput);
                    } catch (e) {
                        console.error(`Failed to get diff for commit ${hash}:`, e);
                    }
                }

                progress.report({ increment: 30 });

                // Create a chat window with the context
                const chatDoc = await vscode.workspace.openTextDocument({
                    content: `# Commit History Chat\n\nI've analyzed the commit history for this file. You can ask me questions about the changes, and I'll use the commit diffs as context to answer.\n\nContext loaded from ${parsed.length} commits.\n\n---\n\n`,
                    language: 'markdown'
                });

                const chatEditor = await vscode.window.showTextDocument(chatDoc, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside
                });

                // Initialize chat history
                const chatHistory: { role: 'user' | 'assistant', content: string }[] = [];

                // Register keybinding for Enter key
                const enterKeyDisposable = vscode.commands.registerCommand('type', async (args) => {
                    if (vscode.window.activeTextEditor?.document === chatDoc) {
                        if (args.text === '\n') {
                            const position = vscode.window.activeTextEditor.selection.active;
                            const line = vscode.window.activeTextEditor.document.lineAt(position.line);
                            
                            // If the current line starts with '>', process it as a question
                            if (line.text.startsWith('>')) {
                                const question = line.text.substring(1).trim();
                                if (question) {
                                    try {
                                        // Add user message to chat history
                                        chatHistory.push({
                                            role: 'user',
                                            content: question
                                        });
                                        
                                        // Create a temporary document for Copilot
                                        const tempDoc = await vscode.workspace.openTextDocument({
                                            content: `Here are the relevant git diffs for analysis:\n\n${commitDiffs.join('\n\n')}\n\nQuestion: ${question}`,
                                            language: 'markdown'
                                        });
                                        
                                        // Get response from Copilot
                                        const response = await getCopilotResponse(tempDoc.getText());
                                        
                                        // Add the response to our chat window
                                        const edit = new vscode.WorkspaceEdit();
                                        edit.insert(chatDoc.uri, new vscode.Position(position.line + 1, 0), 
                                            `\n\n${response}\n\n---\n\n`);
                                        await vscode.workspace.applyEdit(edit);
                                        
                                        // Close the temporary document
                                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                                    } catch (error) {
                                        vscode.window.showErrorMessage(`Failed to generate response: ${error instanceof Error ? error.message : String(error)}`);
                                    }
                                }
                            }
                        }
                        // Always insert the newline
                        return vscode.commands.executeCommand('default:type', args);
                    }
                });

                // Clean up when the editor is closed
                vscode.window.onDidChangeActiveTextEditor(editor => {
                    if (editor?.document !== chatDoc) {
                        enterKeyDisposable.dispose();
                    }
                });

                progress.report({ increment: 40 });
                resolve();
            });
        });
    });
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

    // Show the output channel
    outputChannel.show(true);
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

export function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel("ContextPilot");
    context.subscriptions.push(outputChannel);

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
            "contextpilot.analyzeCommitsWithLLM",
            analyzeCommitsWithLLM
        ),
        vscode.commands.registerCommand(
            "contextpilot.generateDiffsForCursorChat",
            generateDiffsForCursorChat
        )
    );
}

export function deactivate() {}
