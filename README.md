# ContextPilot VSCode Plugin

Check out the server code: https://github.com/krshrimali/context-pilot-rs. Make sure to build the binary and have it in your PATH before you run this extension.

The plugin will be shipped to the marketplace, very soon.

## Usage

In order to install it, please go to the [releases](https://github.com/krshrimali/context-pilot-vscode/releases) page and download the `.vsix` file along with the binary (or can download from [context-pilot-rs repository](https://github.com/krshrimali/context-pilot-rs) releases page).

Just run: `code --install-extension <path_to_vsix_file>` and you are done.

1. Press "Ctrl/Command + Shift + P"
2. Type: "Context " (and you'll see multiple options, select any and enjoy)


# ContextPilot 🧠

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**ContextPilot** is a powerful VSCode extension to understand the context of your codebase quickly!  
It lets you find related files, top authors, and historical context **directly from Git blame** and **file relationships** — without leaving your editor.

---

## ✨ Features

- 🔍 **Query Top Files** related to a line or file.
- 👥 **Query Top Authors** who wrote a line or file.
- 📈 **See Usage Frequency** (Occurrences) inside your project.
- 📂 **Open related files instantly** in VSCode.
- ⚡ **Super fast**, powered by Rust backend for indexing & querying.
- 🛠️ **Supports indexing** with progress shown (Coming soon).
- 🖥️ Designed for **large workspaces** and **monorepos**.

---

## 🚀 Getting Started

### 1. Install

- Download and install from the [VSCode Marketplace](#) (Coming soon)
- Or clone this repo and run:

```bash
npm install
npm run compile
```

Then press `F5` to launch the extension in a new Extension Host window.

---

### 2. Commands

| Command | Description |
| :--- | :--- |
| `ContextPilot: Get Context Files (Line)` | Get related files for the current line. |
| `ContextPilot: Get Context Files (File)` | Get related files for the whole file. |
| `ContextPilot: Get Context Authors (Line)` | Get top authors for the current line. |
| `ContextPilot: Get Context Authors (File)` | Get top authors for the entire file. |
| `ContextPilot: Index Workspace` (coming soon) | Index your project for faster querying. |

> ⚡ These commands can be triggered via the Command Palette (`Ctrl+Shift+P`) by typing `ContextPilot`.

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
npm install -g webpack webpack-cli vsce
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
