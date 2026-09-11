# Numera — 多端自然语言文本计算器设计文档

**日期：** 2026-09-07
**状态：** 待实施

## 1. 项目概述

Numera 是一个多端自然语言文本计算器，基于 numr-core (Rust) 引擎扩展，支持 Web PWA、Android、CLI、TUI 多平台运行，通过 WebDAV 实现个人多设备离线优先同步，可选 E2E 端到端加密。

### 背景

- **numr** (Rust, MIT) — 开源的 CLI/TUI/Web 文本计算器，核心引擎 numr-core 支持 WASM 编译
- **NerdCalci** (Kotlin, GPLv3) — 开源 Android 离线计算器，功能丰富（日期/跨文件引用），SAF 文件同步

两者都是他人的开源项目。Numera 作为独立新项目，依赖 numr-core 作为 crate，对其通用改进 PR 回上游。借鉴 NerdCalci 的技术选型经验（Kotlin Compose + MD3 + Room + Fira Code），但代码完全独立。

### 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 计算引擎 | 基于 numr-core (Rust) 扩展 | WASM + FFI 天然多端，已有测试和迭代 |
| 上游关系 | Cargo 依赖（方案 A） | 通用改进 PR 回上游，项目特有逻辑留在自己 crate |
| 同步协议 | WebDAV | 标准协议，兼容自建/第三方服务 |
| 加密 | 可选 E2E（per-file 或 per-space） | 灵活，不强制 |
| 优先平台 | Web PWA + Android | 覆盖最常用场景 |
| Android 策略 | Rust FFI + Kotlin Compose 原生 UI | 体验最佳 |
| 文件格式 | 结构化目录 + manifest.json | 清晰、灵活、diff 友好 |
| 服务部署 | Cloudflare Pages | 统一平台，成本低 |

## 2. 项目结构

```
numera/
├── crates/
│   ├── engine/          # 扩展引擎 — 依赖 numr-core，新增日期/跨文件引用
│   ├── format/          # 统一文件格式 — manifest.json + globals.numr
│   ├── sync/            # WebDAV 客户端 — 冲突检测、增量同步
│   ├── crypto/          # E2E 加密 — XChaCha20-Poly1305 + HKDF
│   ├── wasm/            # WASM binding — 包装 engine + sync + crypto
│   ├── ffi/             # UniFFI binding — 生成 Kotlin/Swift 接口
│   ├── cli/             # CLI 入口
│   └── tui/             # TUI 入口
├── android/             # Kotlin Compose app
├── web/                 # PWA (Cloudflare Pages)
└── docs/
```

### 引擎职责边界

```
numr-core (上游 crate, MIT)
  ├── 基础数学表达式解析与求值
  ├── 变量、单位转换、货币/汇率
  └── .numr 语法解析 (Pest)

engine (本项目 crate)
  ├── 依赖 numr-core，调用其 API 做基础计算
  ├── 新增：日期/时间/时区表达式
  ├── 新增：跨文件引用 file("name") 解析
  ├── 新增：聚合变量 (sum, avg, total 等)
  └── 新增：多文档上下文管理
```

**原则：** 凡是对 numr-core 通用的改进（解析器扩展、新运算符等），先在 fork 实现，PR 回上游。只有"多文档"、"日期引擎"这类不属于 numr-core 范畴的功能留在 engine crate。

**本地开发 numr-core 改动时**，使用 Cargo `[patch]` override 指向本地 fork 路径，PR 合并后切回 git/crate 依赖。

## 3. 统一文件格式

### Workspace 目录结构（WebDAV 上的存储形态）

```
/{user-prefix}/
├── manifest.json              # workspace 级元数据
├── globals.numr               # 全局变量/函数/常量定义（所有文件自动可用）
├── files/
│   ├── budget-2026.numr       # 纯文本计算文件
│   ├── unit-cheatsheet.numr
│   └── daily/                 # 支持子目录分组
│       ├── 2026-09-01.numr
│       └── 2026-09-02.numr
└── .sync/                     # 本地专属，不上传到 WebDAV
    ├── state.json             # 本地同步状态快照
    └── conflicts/             # 冲突副本暂存
```

### manifest.json

```json
{
  "version": 1,
  "created_at": "2026-09-07T10:00:00Z",
  "encryption": {
    "enabled": true,
    "key_verify_hash": "sha256:xxx..."
  },
  "files": {
    "budget-2026.numr": {
      "display_name": "2026 年预算",
      "tags": ["finance"],
      "pinned": true,
      "locked": false,
      "encrypted": false,
      "sort_order": 0
    },
    "daily/2026-09-01.numr": {
      "display_name": "9月1日",
      "tags": ["daily"],
      "pinned": false,
      "locked": false,
      "encrypted": true,
      "sort_order": 10
    }
  }
}
```

### globals.numr

```
# 全局变量 — 所有文件自动可用
tax_rate = 13%
hourly_rate = $85
work_hours_per_day = 8

# 全局函数
margin(cost, rate) = cost * rate / (1 - rate)
```

### 求值优先级

1. `globals.numr` — 最先加载，所有文件可见
2. `file("xxx")` 引用 — 按需加载被引用文件的导出变量
3. 当前文件局部变量 — 优先级最高，可覆盖同名全局变量

### 设计要点

- `.numr` 文件是纯文本，与 numr 上游语法兼容
- 元数据和内容分离 — 删掉 manifest，文件照样能算
- `globals.numr` 是约定路径，引擎固定识别
- 跨文件引用用相对路径解析：`file("budget-2026")` 从 `files/` 根目录查找
- **manifest.json 冲突处理**：manifest 采用 merge 策略而非整体覆盖——同步时逐字段合并（新增文件条目取并集，同一文件的元数据以最新修改时间为准），仅在同一字段被两端同时修改为不同值时才标记冲突

## 4. 同步层 (numr-sync)

### 同步模型 — 离线优先，按需同步

```
┌─────────────┐         HTTPS/WebDAV         ┌──────────────────┐
│  本地设备     │  ◄────────────────────────►  │  WebDAV 服务端     │
│             │    PUT/GET/PROPFIND/DELETE    │                  │
│ ┌─────────┐ │                              │  ┌────────────┐  │
│ │ Room DB │ │  (Android)                   │  │ 第三方      │  │
│ │ 或文件系统│ │  (Web/CLI/TUI)              │  │ WebDAV     │  │
│ └─────────┘ │                              │  │ 服务        │  │
│ ┌─────────┐ │                              │  └────────────┘  │
│ │.sync/   │ │                              │                  │
│ │state.json│ │                              │                  │
│ └─────────┘ │                              └──────────────────┘
└─────────────┘
```

### 同步策略

| 场景 | 行为 |
|------|------|
| 本地新增文件 | PUT 到远端，更新 manifest.json |
| 远端新增文件 | GET 到本地，更新本地 DB/文件 |
| 双方都修改同一文件 | 基于内容 hash 检测冲突 → 保留两个版本（`.conflict.numr`），用户手动解决 |
| 本地删除 | tombstone in state.json，下次同步时远端删除 |
| 离线编辑多个文件 | 上线后批量同步，per-file 独立判定 |

### state.json（本地专属，不上传）

```json
{
  "last_sync_at": "2026-09-07T12:00:00Z",
  "files": {
    "budget-2026.numr": {
      "local_hash": "sha256:abc...",
      "remote_hash": "sha256:abc...",
      "remote_etag": "\"xyz\"",
      "last_synced_at": "2026-09-07T12:00:00Z"
    }
  },
  "tombstones": {
    "old-file.numr": {
      "deleted_at": "2026-09-06T08:00:00Z"
    }
  }
}
```

### 同步触发时机

- **Web PWA** — 上线时自动同步 + 手动触发
- **Android** — 启动时同步 + 后台 WorkManager 定时 + 手动触发
- **CLI/TUI** — 启动时同步 + `numera sync` 命令手动触发

### WebDAV 端点兼容

- 用户配置任意 WebDAV URL（Nextcloud、Synology、ownCloud、自建等），Numera 不提供自建服务
- sync crate 只依赖标准 WebDAV 操作（PROPFIND/GET/PUT/DELETE/MKCOL），不绑定任何服务商特有 API

## 5. E2E 加密

### 分层密钥模型

```
Master Key（用户主密钥）
  │  本地生成，永不上传
  │  用户需备份（助记词 12 词 BIP39 或导出密钥文件）
  │
  ├──► Space Key（空间密钥）
  │      由 Master Key 派生 (HKDF-SHA256)
  │      加密 manifest.json 中的敏感元数据
  │
  └──► Per-File Key（文件密钥）
         由 Space Key + file_path 派生 (HKDF-SHA256)
         加密 .numr 文件内容
```

### 算法选择

| 用途 | 算法 |
|------|------|
| 文件内容加密 | XChaCha20-Poly1305 |
| 密钥派生（从密码） | Argon2id |
| 密钥派生链 | HKDF-SHA256 |

### 加密文件格式

```
┌─────────────────────────────┐
│ Magic: "NUMR_ENC\x01"  (9B) │  标识加密文件，版本 1
│ Nonce               (24B)   │  XChaCha20 随机 nonce
│ Ciphertext          (变长)   │  加密后的原文内容
│ Auth Tag            (16B)   │  Poly1305 认证标签
└─────────────────────────────┘
```

### 用户体验

- **启用加密**：本地生成 Master Key → 展示助记词 → 用户确认备份 → 激活
- **加密文件**：manifest.json 标记 `"encrypted": true` → 同步时本地加密后上传密文
- **新设备**：输入助记词/导入密钥文件 → 恢复 Master Key
- **不启用**：一切照常，无 Master Key，全部明文

### 要点

- 第三方 WebDAV 服务完全看不到明文
- 丢失 Master Key = 丢失加密文件（UI 需强调备份）
- manifest.json 本身不加密（文件名可见，仅内容加密）
- globals.numr 若加密，依赖它的文件需在解密环境下才能正确求值

## 6. 平台实现策略

### 各平台职责分层

```
┌────────────────────────────────────────────────┐
│                    UI 层                        │
│  Web: CodeMirror + JS    Android: Compose + KT  │
│  TUI: Ratatui            CLI: Clap              │
├────────────────────────────────────────────────┤
│              Binding 层                         │
│  Web: wasm-bindgen       Android: UniFFI        │
│  CLI/TUI: 直接调用 crate                         │
├────────────────────────────────────────────────┤
│              Rust 核心层（所有平台共享）            │
│  engine ─ format ─ sync ─ crypto                │
├────────────────────────────────────────────────┤
│              存储层                              │
│  Web: IndexedDB          Android: Room + FS     │
│  CLI/TUI: 文件系统                               │
└────────────────────────────────────────────────┘
```

### Web PWA (Cloudflare Pages)

- 计算/同步/加密全在 WASM 内执行，JS 层只负责 UI 和 IO
- Service Worker 缓存 WASM + 静态资源 → 离线可用
- IndexedDB 存储 workspace 完整副本 → 断网可编辑
- 上线后 Service Worker 触发后台同步
- 部署到 Cloudflare Pages

### Android (Kotlin Compose + Rust FFI)

- Rust 通过 UniFFI 生成 Kotlin binding，编译为 `libengine.so` (arm64/x86_64)
- Room DB 作为本地索引（文件列表、搜索、标签）
- Kotlin 层只做 UI + IO 调度，计算/同步/加密在 Rust 侧
- WorkManager 处理后台定时同步
- 借鉴 NerdCalci 经验：MD3 + Fira Code + 实时求值 + 撤销/重做

### CLI / TUI

- 直接调用 Rust crate，无 FFI 开销
- CLI：`numera eval "expr"` / `numera file x.numr` / `numera sync`
- TUI：保持 vim 模式体验，新增同步状态栏和加密文件标识
- WebDAV 凭据存在 `~/.config/numera/auth.json`

## 7. 分阶段执行

### Phase 1 — 引擎增强 + Web PWA

**交付物：** engine crate（日期/跨文件引用/聚合变量）、format crate、wasm binding、Web PWA
**验收：** 基础表达式 + 日期 + 跨文件引用可算；PWA 离线可用；部署到 Cloudflare Pages

### Phase 2 — 同步

**交付物：** sync crate、Web 同步 UI、CLI sync 命令
**验收：** 多设备同步；冲突产生副本；可配置第三方 WebDAV

### Phase 3 — E2E 加密

**交付物：** crypto crate、Web/CLI 加密 UI
**验收：** 加密文件远端服务侧不可读；新设备助记词恢复；未加密文件不受影响

### Phase 4 — Android 原生 App

**交付物：** UniFFI binding、Kotlin Compose app
**验收：** 离线编辑 + WorkManager 同步；与 Web 端文件双向兼容；MD3 + Fira Code

### Phase 5 — 后续（视需求）

- iOS app（UniFFI → Swift, SwiftUI）
- 桌面 app（Tauri 或 TUI）
- TUI 增强

### Phase 间依赖

```
Phase 1 (引擎 + Web)
   ↓
Phase 2 (同步)  ← Phase 3 (加密) 可并行
   ↓
Phase 4 (Android)      ← 依赖 Phase 1-3 的所有 Rust crate
```
