# CloudChat (Web 网页端 & Tauri 桌面端)

[English](#english) | [中文](#中文)

---

## 中文

**CloudChat Web & Desktop** 是 CloudChat 云存储协同生态的网页与桌面客户端项目。项目采用 **React + Vite + TailwindCSS** 打造现代化前端架构，并通过 **Tauri 2.0 (Rust)** 构建跨平台桌面应用（Windows / macOS / Linux）。

通过独特的“聊天式”文件管理体验，CloudChat 帮您把 WebDAV 与 S3 云存储变成无限容量的个人随记、网盘及多媒体协作空间。

---

### 🌟 功能亮点介绍

#### 1. 🖥️ 双端合一 (Web 网页端 + Tauri 桌面端)
- **Web 网页端**：基于 Vite + React，零依赖纯前端架构，支持在 Chrome, Safari, Edge 及手机浏览器中即开即用。
- **Tauri 桌面端**：基于 Rust + Webview2 开发，相比传统 Electron 应用，**内存占用极低（<50MB），启动速度达到毫秒级**。
- **绿色独立运行**：支持 Windows 绿色免安装单文件（`CloudChat-Desktop.exe`）与标准安装包（`CloudChat-Desktop-Setup.exe`）。

#### 2. 💬 聊天流式云端文件管理
- **卡片式消息呈现**：不同类型的文件（图片、视频、文档、代码、位置、文本）以聊天气泡形式清晰平铺。
- **混合文本转存引擎 (Text Offloading)**：短文本极速加载，超过 500 字的长文本自动转存为 `.txt` 云端文件并静默无缝拼接。
- **长文本智能折叠**：自动识别超过 10 行的长消息并提供优雅渐变的展开/收起切换。

#### 3. ☁️ 直连 WebDAV & S3 存储
- **全兼容 WebDAV**：支持坚果云、Nextcloud、Alist、ownCloud 等 WebDAV 服务。
- **S3 协议全覆盖**：兼容 AWS S3、MinIO、阿里云 OSS、腾讯云 COS 等 S3 对象存储。
- **分片与断点续传**：大文件传输自动采用 Range PUT / Part 分块，保障弱网环境下的传输稳定性。

#### 4. 🛠️ 高级实用工具箱
- **时间轴与日记导出**：支持按年月归档消息，一键生成并导出格式优美的个人日记或知识库。
- **可视化控制台**：内置 Web 调试日志面板，同步状态与网络请求一目了然。
- **多 Profile 账号管理**：支持保存配置多个云端存储节点并随时无缝切换。

---

### 📦 全平台端生态对比

| 功能特性 | Android (APK) | Web 网页端 | 桌面端 (Tauri) |
| :--- | :---: | :---: | :---: |
| **技术栈** | Kotlin + Compose | React + Vite | Rust + Tauri 2.0 |
| **部署/运行形式** | APK 安装包 | 网页托管/离线HTML | EXE 可执行文件 / 安装包 |
| **系统分享接管** | ✅ 支持 (Share Sheet) | ❌ | ❌ |
| **拖拽文件上传** | ❌ | ✅ 支持 | ✅ 支持 |
| **资源占用** | 原生低消耗 | 视浏览器而定 | **极低内存 (<50MB)** |
| **数据互通** | ✅ 100% 互通 | ✅ 100% 互通 | ✅ 100% 互通 |

---

### 🛠️ 编译与开发指南

#### 1. Web 端开发与编译
```bash
# 安装依赖
npm install

# 启动本地开发服务
npm run dev

# 编译 Web 生产版本 (输出至 dist/)
npm run build
```

#### 2. Tauri 桌面端编译 (Windows / macOS / Linux)
```bash
# 确保本地已安装 Rust 环境 (rustc & cargo)
# 构建 Tauri 桌面应用及安装包 (输出至 src-tauri/target/release/)
npm run tauri:build
```

---

## English

**CloudChat Web & Desktop** is the web and desktop client for the CloudChat ecosystem. Built with **React, Vite, and TailwindCSS**, and packaged with **Tauri 2.0 (Rust)**, it delivers a high-performance, chat-inspired cloud storage management experience across Web, Windows, macOS, and Linux.

### 🌟 Key Features

- **Dual Target**: Single codebase powering both browser Web App and ultra-lightweight Desktop App via Tauri 2.0 (<50MB RAM usage).
- **Chat-Style File Storage**: Turn your WebDAV and S3 cloud buckets into an intuitive personal timeline and asset stream.
- **Hybrid Text Engine**: Long text notes (≥500 chars) automatically offloaded as cloud `.txt` files; short notes embedded for instant render.
- **WebDAV & S3 Direct Connectivity**: Native support for Nextcloud, Alist, MinIO, AWS S3, and more with chunked range upload resilience.
- **Timeline Journal Exporter**: Group messages by timeline and export structured markdown/HTML journal reports.
