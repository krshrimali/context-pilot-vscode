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
  var { exec } = require("child_process");

  var activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    var currentFile = activeEditor.document.uri.fsPath;

    var currentWorkspacePath = getCurrentWorkspacePath();
    if (currentWorkspacePath === undefined) {
      vscode.window.showErrorMessage("No workspace open");
    }
    var options: childProcess.ExecOptions = {
      cwd: currentWorkspacePath, // Replace with the desired directory path
    };

    var currentStartLine = 1;
    var currentEndLine = 0;
    var internalCommandType = "authors";
    if (type === "line") {
      currentStartLine = activeEditor.selection.active.line;
      currentEndLine = activeEditor.selection.active.line;
    }
    if (commandType === "files") {
      internalCommandType = "files";
    }

    // `${binaryPath} ${arguments.join(" ")}`,
    var binaryPath: String =
      "context-pilot " +
      currentFile +
      " -s " +
      currentStartLine +
      " -e " +
      currentEndLine +
      " -t " +
      internalCommandType;

    // vscode.window.showInformationMessage("Command running: " + binaryPath);

    childProcess.exec(`${binaryPath}}`, options, (error, stdout, stderr) => {
      if (error) {
        // console.error(`Error executing binary: ${error}`);
        vscode.window.showInformationMessage("Error: ", error.message);
        return;
      }

      // vscode.window.showInformationMessage("Output: ", stdout);
      var outputFilesArray: string[] = stdout.replace(/"/g, "").split(",");
      vscode.window
        .showQuickPick(outputFilesArray, {
          canPickMany: false,
          placeHolder: "Output from ContextPilot",
        })
        .then((selectedFile) => {
          if (internalCommandType === "files") {
            if (selectedFile) {
              // Do something with the selected file
              // vscode.window.showInformationMessage("Selected files: ", selectedFile);
              var uri = vscode.Uri.file(selectedFile);
              var fullPathUri = vscode.Uri.file(selectedFile);
              var fullPath = currentWorkspacePath + fullPathUri.fsPath;
              fullPath = fullPath.replace("%0A", "");
              vscode.window.showInformationMessage("File path: " + fullPath);
              vscode.workspace.openTextDocument(fullPath).then((document) => {
                vscode.window.showTextDocument(document);
              });
              // You can perform any further actions with the selected file
            }
          }
        });
      if (stderr.length > 0 && !stdout) {
        vscode.window.showErrorMessage("stderr: ", stderr);
      }
    });
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  let filesCurrentLineNumber = vscode.commands.registerCommand(
    "contextpilot.getContextFilesCurrentLineNumber",
    () => {
      runCommand("files", "line");
    }
  );
  let filesCurrentFile = vscode.commands.registerCommand(
    "contextpilot.getContextFilesCurrentFile",
    () => {
      runCommand("files", "file");
    }
  );
  let authorsCurrentLineNumber = vscode.commands.registerCommand(
    "contextpilot.getContextAuthorsCurrentLineNumber",
    () => {
      runCommand("authors", "line");
    }
  );
  let authorsCurrentFile = vscode.commands.registerCommand(
    "contextpilot.getContextAuthorsCurrentFile",
    () => {
      runCommand("authors", "file");
    }
  );

  // context.subscriptions.push(filesCurrentLineNumber);
  // context.subscriptions.push(authorsCurrentLineNumber);
  // context.subscriptions.push(filesCurrentFile);
  context.subscriptions.push(authorsCurrentFile);
}

// This method is called when your extension is deactivated
export function deactivate() {}
