# ContextPilot VSCode Plugin

Users need to first install the server locally. The binary is currently
available on homebrew:

```
brew install krshrimali/context-pilot/context-pilot
```

OR if using AUR, refer: https://aur.archlinux.org/packages/contextpilot.

In case you are not using either of the package managers above, follow the commands below: (`cargo` installation is must)

```bash
git clone https://github.com/krshrimali/context-pilot-rs && cd context-pilot-rs
cargo build --release
cp ./target/release/contextpilot ~/.local/bin/
```

Feel free to replace the binary path to `/usr/local/bin` based on your system.

## Usage

1. Open your workspace.
2. Open the command palette (Ctrl+Shift+P or Cmd+Shift+P).
3. (Optional, for faster querying) - Index your workspace (`Context Pilot: Index Workspace`) - please note that, this might be slower for huge workspaces.
4. (Optional, for faster querying) - Only index selected subdirectories (`Context Pilot: Index Subdirectories`) - select the subfolders you want to index, faster for huge workspaces (like monorepos).
5. Run `Context Pilot: Current File` to get related files for the current file. Can be slower for huge files (>10k-20k LoCs).
6. Run `Context Pilot: Get Relevant Commits` on a selected piece of code to fetch relevant commits.
7. Run `Context Pilot: Get Context Files for Selected Range` on a selected piece of code to fetch relevant files.

# ContextPilot 🧠

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**ContextPilot** is a powerful VSCode extension to understand the context of your codebase quickly!  
It lets you find related files, top authors, and historical context **directly from Git history** and **file relationships** — without leaving your editor.

---

## ✨ Features

- 🔍 **Query Top Files** related to a line or file.
- 📈 **See Usage Frequency** (Occurrences) inside your project.
- 📂 **Open related files instantly** in VSCode.
- ⚡ **Super fast**, powered by Rust backend for indexing & querying.
- 🛠️ **Supports indexing** with progress shown (Coming soon).
- 🖥️ Designed for **large workspaces** and **monorepos**.

---

## 🚀 Getting Started

### 1. Install

- Download and install from the VSCode Marketplace.

### 2. Commands

| Step | Action                                                  | Description                                                                                 | Notes                                                  |
|------|---------------------------------------------------------|---------------------------------------------------------------------------------------------|--------------------------------------------------------|
| 3    | **Index Workspace**                                     | Index the entire workspace for faster querying.                                             | Slower for large workspaces.                          |
| 4    | **Index Subdirectories**                                | Index only selected subdirectories for faster querying.                                     | Recommended for large workspaces or monorepos.        |
| 5    | **Run `Context Pilot: Current File`**                   | Get related files for the currently opened file.                                            | May be slower for large files (>10k–20k LoCs).        |
| 6    | **Run `Context Pilot: Get Relevant Commits`**           | Fetch relevant commits for a selected piece of code.                                        | Useful for tracing history of specific code sections. |
| 7    | **Run `Context Pilot: Get Context Files for Selected Range`** | Fetch relevant files based on the selected code range.                                     | Helps understand code dependencies.                   |

> ⚡ These commands can be triggered via the Command Palette (`Ctrl+Shift+P`) by typing `Context Pilot`.

---

### 3. Requirements

- **Rust** and **Cargo** installed (for running the backend binary `contextpilot`).
- **Git** installed and available in PATH.
- `contextpilot` available as a binary in your PATH. Go to https://github.com/krshrimali/context-pilot-rs for information. (This step will be removed soon)

---

## 🛠️ Development Setup

Clone the repo:

```bash
git clone https://github.com/krshrimali/context-pilot-vscode.git
cd context-pilot-vscode
npm install && npm run compile
vsce package
```

Once done, you can install this extension from .vsix file generated (ctrl/cmd + shift + P -> install extension from VSIX file).

---

## 🤝 Contributing

Pull Requests are welcome!  
Feel free to open an issue or suggest features.

---

## 📬 Contact

- GitHub: [@krshrimali](https://github.com/krshrimali)

---

## ❤️ Support

If you like this project, please consider starring 🌟 the repository! It helps a lot!
