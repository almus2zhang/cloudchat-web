# CloudChat (Web & Desktop) v1.0.0

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/almus2zhang/cloudchat-web)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows%20Desktop-orange.svg)](https://github.com/almus2zhang/cloudchat-web)

> ⚠️ **重要说明**：本项目依托 **WebDAV 存储协议** 实现多端无缝数据同步与备份；S3 存储协议暂未测试。

---

## 📱 关联项目

- **Android 移动客户端**：[CloudChat Android 客户端仓库](https://github.com/almus2zhang/cloudchat)

---

## 🌟 核心功能特性

### 1. 🔳 消息与图片有序合并 (Message & Image Combination)
- 支持将多条独立的文本记录、图片素材按时间顺序合并为一条完整的**拼接长卡片**。
- 有效减少聊天流中的散落消息，支持随时解散还原。

### 2. 📁 文件夹归档打包 (Folder Archiving & Management)
- **打包收纳**：支持选中多条聊天记录（文本、图片、文件）一键归档打包为文件夹卡片。
- **灵活移入与解散**：支持将新记录移入已有文件夹，或将已打包的文件夹解散还原为独立消息。

### 3. 📖 HTML 静态日记生成 (Static HTML Diary Generation)
- **一键导出行云流水日记**：提取选中的聊天记录、图片及文件素材，自动生成排版精致的独立 HTML 静态日记页面。
- **在线预览与下载**：生成的 HTML 日记支持直接在应用内在线预览，或下载导出为独立网页保存。

### 4. ⚡ 物理修改时间增量同步 (Incremental Sync)
- **快速同步 (Quick Sync)**：利用 WebDAV `PROPFIND` 响应的物理 `Last-Modified` 修改时间戳进行比对，若未产生新变更则自动拦截，实现**零流量、零卡顿**。
- **普通同步与强制刷新 (Force Refresh)**：提供完整拉取模式与“强制用本地记录覆盖服务器”冲突解决能力。
- **实时调试终端**：内置网络调试终端弹窗，支持一键开关控制台日志打印与日志复制。

---

## 🔧 WebDAV 服务端配置与排查指南

在通过反向代理（如 Nginx、Nginx Proxy Manager、宝塔面板、FRP 等）接入 WebDAV 服务器时，如果出现 `GET/HEAD` 返回 404 成功，但 `PROPFIND` 或 `MKCOL` 拦截报错 `Failed to fetch`，说明网关未放行跨域响应头或 WebDAV 特殊谓词方法。

### 反向代理配置（Nginx 示例）

必须在配置中**允许 WebDAV 特殊谓词**并**放行跨域响应头**：

```nginx
# 1. 允许 WebDAV 扩展 HTTP 方法
dav_methods PUT DELETE MKCOL COPY MOVE;

# 2. 设置允许跨域方法 (必须包含 PROPFIND 与 MKCOL)
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE, PROPFIND, MKCOL' always;

# 3. 设置允许跨域请求头 (必须包含 Authorization, Content-Type, Depth)
add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, Depth, X-Requested-With' always;
```

---

## 💻 客户端架构

- **Web 网页端**：基于 React + Vite 构建，支持全响应式布局。
- **Windows 桌面端**：基于 Tauri 2.0 构建，极致体积（约 15MB）与高流畅度体验。

---

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动 Web 开发服务器
npm run dev

# 构建 Web 生产产物 (dist)
npm run build

# 构建 Tauri 桌面可执行程序 (.exe)
npm run tauri:build
```
