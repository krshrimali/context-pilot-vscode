# ContextPilot VSCode Plugin

Users need to first install the server locally. The binary is currently
available on homebrew:

```
brew install krshrimali/context-pilot/context-pilot
```

Once done, please make sure that `context_pilot --help` works on your system
(for confidence). If users don't have homebrew, they can also build the binary
from source, for more details - please check:
https://github.com/krshrimali/context-pilot-rs.

## Usage

1. Open your workspace.
2. Open the command palette (Ctrl+Shift+P or Cmd+Shift+P).
3. Type `Context Pilot: Index Workspace` to index your workspace. This is
   important step to make the querying faster.
4. Type `Context Pilot: Line Number` to get related files for the current line.
5. Type `Context Pilot: Current File` to get related files for the whole file.
6. Type `Context Pilot: Get Context Files for Selected Range` to get related files
   for the selected range.

# ContextPilot 🧠

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**ContextPilot** is a powerful VSCode extension to understand the context of your codebase quickly!  
It lets you find related files, top authors, and historical context **directly from Git blame** and **file relationships** — without leaving your editor.

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

| Command | Description |
| :--- | :--- |
| `Context Pilot: Line Number` | Get related files for the current line. |
| `Context Pilot: Current File` | Get related files for the whole file. |
| `Context Pilot: Get Context Files for Selected Range` | Get related files for the selected range. |
| `ContextPilot: Index Workspace` | Index your project for faster querying (necessary). |

> ⚡ These commands can be triggered via the Command Palette (`Ctrl+Shift+P`) by typing `Context Pilot`.

---

### 3. Requirements

- **Rust** and **Cargo** installed (for running the backend binary `context-pilot`).
- **Git** installed and available in PATH.
- `context-pilot` available as a binary in your PATH. Go to https://github.com/krshrimali/context-pilot for information. (This step will be removed soon)

---

## 🛠️ Development Setup

Clone the repo:

```bash
git clone https://github.com/krshrimali/context-pilot-vscode.git
cd context-pilot-vscode
npm install && npm run compile
vsce package
```

Once done, you can install this extension from VSIX file generated (ctrl/cmd + shift + P -> install extension from VSIX file).

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

**Note:**  
You are free to use, modify, and distribute this project, but **you must give proper credit** to the original author:

**Kushashwa Ravi Shrimali**  
📧 [kushashwaravishrimali@gmail.com](mailto:kushashwaravishrimali@gmail.com)

---

## 🤝 Contributing

Pull Requests are welcome!  
Feel free to open an issue or suggest features.

---

## 📬 Contact

- Email: [kushashwaravishrimali@gmail.com](mailto:kushashwaravishrimali@gmail.com)
- GitHub: [@krshrimali](https://github.com/krshrimali)

---

## ❤️ Support

If you like this project, please consider starring 🌟 the repository! It helps a lot!
