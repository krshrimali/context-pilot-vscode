// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as childProcess from "child_process";
import internal = require("stream");

function getCurrentWorkspacePath(): string | undefined {
    var workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return workspaceFolders[0].uri.fsPath;
    }
    return undefined;
}

function runCommand(commandType: string, type: string) {
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

    let currentStartLine = 1;
    let currentEndLine = 0;
    if (type === "line") {
        const line = activeEditor.selection.active.line + 1; // +1 because VSCode lines are 0-indexed
        currentStartLine = line;
        currentEndLine = line;
    }

    let internalCommandType = "author";
    if (commandType === "files") {
        internalCommandType = "query";
    }

    const binaryPath = "context-pilot";
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

        const outputFilesArray = stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const items = outputFilesArray.map((line) => {
            // Example: "src/main.rs - 2423 occurrences"
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
                const fileUri = vscode.Uri.file(selectedItem.label);
                vscode.workspace.openTextDocument(fileUri).then((document) => {
                    vscode.window.showTextDocument(document);
                });
            }
        });


        // vscode.window
        //     .showQuickPick(outputFilesArray, {
        //         canPickMany: false,
        //         placeHolder: "ContextPilot Output",
        //     })
        //     .then((selectedFile) => {
        //         if (selectedFile) {
        //             // Strip occurrences if present
        //             const filePathOnly = selectedFile.split(" - ")[0].trim();
        //
        //             const fileUri = vscode.Uri.file(filePathOnly);
        //             vscode.workspace.openTextDocument(fileUri).then((document) => {
        //                 vscode.window.showTextDocument(document);
        //             });
        //         }
        //     });
    });
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentLineNumber", () => {
            runCommand("files", "line");
        }),
        vscode.commands.registerCommand("contextpilot.getContextFilesCurrentFile", () => {
            runCommand("files", "file");
        }),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentLineNumber", () => {
            runCommand("authors", "line");
        }),
        vscode.commands.registerCommand("contextpilot.getContextAuthorsCurrentFile", () => {
            runCommand("authors", "file");
        })
    );
}

// This method is called when your extension is deactivated
export function deactivate() { }
