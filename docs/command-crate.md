# Numera Command Crate — Design Spec

**日期：** 2026-09-07
**状态：** 待实施
**所属：** Phase 1（编辑器 + 即时计算 + MD3）
**位置：** `crates/command/`

---

## 1. 目标与边界

### 1.1 目标

`numera-command` 是 Numera 全平台的**命令注册 + 快捷键 + 派发层**。它把"用户能做什么"从 UI 层剥离为纯数据 + 纯逻辑，使：

1. 同一套命令可在 Web PWA、TUI、Android 三端复用。
2. Web 端打磨出的快捷键方案能映射到 TUI，Android 自动只装载它需要的部分。
3. 编辑器层（vim 模式、查找替换）能桥接到全局命令（如 `:w` → `file.save`）。
4. 命令面板（Command Palette）的数据可直接由本 crate 提供。

### 1.2 非目标

- **不是 UI 渲染层**：本 crate 不画任何东西。`web/` 与 `android/` 自行渲染命令面板。
- **不是输入捕获层**：各平台自行捕获键盘事件，转成 `KeyEvent` 后喂给 `KeyMatcher`。
- **不是状态管理**：当前选中文件、当前 mode 由各平台的 App 状态管理，命令 handler 通过 `Ctx` 访问。

### 1.3 依赖边界

```
numera-command
  ├── thiserror
  └── serde_json
```

```
numera-engine
  └── numera-command    (实现 command 定义的 EngineAccess trait)

numera-format
  └── numera-command    (实现 command 定义的 WorkspaceAccess trait)
```

> **依赖方向：command 是叶子 crate。** trait（`EngineAccess`/`WorkspaceAccess`）由 command 定义，engine 和 format 反向依赖 command 并提供实现。这样 command 与 engine/format 的具体类型完全解耦，测试可注入 mock，wasm/FFI 边界无需重复定义。

---

## 2. 架构

```
crates/command/
├── Cargo.toml
└── src/
    ├── lib.rs           # 根模块 + pub use 重导出
    ├── scope.rs         # Scope, Platform, Mode
    ├── command.rs       # Command, CommandFn, CommandOutcome
    ├── key.rs           # Key, Modifiers, KeyEvent, parse
    ├── keybinding.rs    # Keybinding, KeyChord, KeySeq
    ├── registry.rs      # CommandRegistry
    ├── matcher.rs       # KeyMatcher（和弦匹配状态机）
    ├── context.rs       # Ctx, Focus, Services, Notification
    ├── dispatch.rs      # execute()
    ├── error.rs         # CommandError
    └── macros.rs        # command! 声明宏
```

**`lib.rs` 重导出列表（host crate 用得到的最小集）：**

```rust
pub use command::{Command, CommandFn, CommandOutcome};
pub use context::{Ctx, Focus, Services, Notification};
pub use error::CommandError;
pub use key::{Key, KeyEvent, Modifiers};
pub use keybinding::{KeyChord, Keybinding};
pub use matcher::{KeyMatcher, KeyMatcherResult};
pub use registry::CommandRegistry;
pub use scope::{Mode, Platform, Scope};
```

遵循 `engine` / `format` 的约定：

- 每个文件 `pub mod` 在 `lib.rs` 中声明 + 顶层 `pub use` 重导出核心类型。
- 每个文件内含 `#[cfg(test)] mod tests { use super::*; ... }`，inline 测试。
- 错误类型集中在 `error.rs`，`thiserror::Error` 派生，`String` 负载变体，`#[from]` 仅给 io/serde。

---

## 3. 核心类型

### 3.1 范围三件套（`scope.rs`）

```rust
/// 命令的作用域。
/// - Global: 跨平台、跨编辑器的全局行为（file.save、palette.toggle）
/// - Editor: 仅编辑器内有效（editor.find、vim.*、editor.gotoLine）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
    Global,
    Editor,
}

/// 命令支持的平台。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Web,
    Tui,
    Android,
    Desktop,
}

/// 编辑器模式。
/// - Any: 不依赖模式（默认；所有 keymap 都生效）
/// - Normal / Insert / Visual / Command: Vim 四种模式
/// - Standard: 非模态标准编辑模式（与 Vim 互斥的另一种 keymap）
///
/// 切换方式：注册一个 `modes: [Any]`、键位 `"shift+tab"` 的命令，handler 修改
/// host 内部的 `current_mode` 状态；下次 `matcher.feed(ev, ..., new_mode)`
/// 自动按新模式过滤可见命令。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Mode {
    Any,
    Normal,
    Insert,
    Visual,
    Command,
    Standard,
}
```

**关键决策：**

- `Scope::Editor` 命令在 Web/TUI 由 CodeMirror/ratatui 装载；Android 自动跳过——但**不是**由本 crate 的过滤逻辑完成的。Android 通过 `register_android_builtins()` 只注册 `Scope::Global` 命令，从源头排除 `Editor` 命令进入注册表。host 选择"装载什么"是注册期决策，不是查询期过滤。
- `Mode::Any` 是默认，handler 内部根据实际 mode 决定行为时再读 `ctx.mode`。
- `CommandRegistry::list(platform, mode)` 只按 platform × mode 过滤；scope 不参与查询过滤（注册期已决定）。

### 3.2 键位原语（`key.rs`）

```rust
/// 修饰键位图。
///
/// **跨平台修饰键映射是 host 输入层的职责，不是本 crate 的职责。**
///
/// 命令层只识别 `Ctrl` / `Alt` / `Shift` / `Meta` 四种语义修饰键位。
/// 各平台的物理键（macOS Option/Cmd、Windows Win、Linux Super）由 host 在
/// 喂 `KeyEvent` 前映射为 `Modifiers`：
///
/// ```text
/// macOS:    Option → ALT,    Cmd   → META
/// Linux:    Alt    → ALT,    Super → META
/// Windows:  Alt    → ALT,    Win   → META
/// ```
///
/// 例：TUI 收到 `Option+Backspace`（crossterm），映射为 `ALT+Backspace` 后
/// 喂 matcher；命令以 `Modifiers::ALT` 注册——同一命令在三端行为一致。
///
/// 字符串解析器同样不接受 `cmd` / `win` / `option` / `super` 等物理键名，
/// 只接受语义化的 `ctrl` / `alt` / `shift` / `meta`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Modifiers(pub u8);

impl Modifiers {
    pub const NONE: Modifiers = Modifiers(0);
    pub const CTRL:  Modifiers = Modifiers(1 << 0);
    pub const ALT:   Modifiers = Modifiers(1 << 1);
    pub const SHIFT: Modifiers = Modifiers(1 << 2);
    pub const META:  Modifiers = Modifiers(1 << 3); // macOS Cmd / Windows Win

    pub fn contains(self, other: Modifiers) -> bool { (self.0 & other.0) == other.0 }
    pub fn is_empty(self) -> bool { self.0 == 0 }
}

/// 单个按键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    Char(char),
    Enter,
    Backspace,
    Tab,
    Escape,
    Up, Down, Left, Right,
    Home, End,
    PageUp, PageDown,
    F(u8),                // F1..F12
    Insert,
    Delete,
}

/// 来自宿主平台的键盘事件。
/// 各平台的输入层负责把自家事件统一成这个形态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyEvent {
    pub key: Key,
    pub mods: Modifiers,
}

impl KeyEvent {
    /// 大写字母 + Shift 折叠：'S' (Shift+S) 与 's' 等价表示。
    /// 这样 `ctrl+s` 在大小写键盘下都能匹配。
    pub fn normalize(&self) -> KeyEvent { /* 见 §3.3 */ }
}
```

**键位字符串语法（解析时识别）：**

```
字母：     a-z, A-Z（大小写等价，Shift 通过修饰键表达）
数字：     0-9
功能键：   enter, backspace, tab, escape, up, down, left, right,
          home, end, pageup, pagedown, insert, delete, f1-f12, space
标点键：   plus, minus, equal, comma, period, slash, semicolon,
          quote, bracketleft, bracketright, backslash, grave
          ⚠️ `+` 在键位位置必须写 `plus`，否则与修饰键分隔符冲突
修饰键：   ctrl, alt, shift, meta
          ⚠️ 不接受 cmd / win / option / super —— 由 host 输入层映射（见 §3.2）
字面量：   ? / （若需要，可加 \ 转义）
和弦：     空格分隔多段序列。常见例子：
          - "ctrl+s"          → 单段：Ctrl+S
          - "ctrl+k ctrl+s"   → 和弦：先 Ctrl+K 再 Ctrl+S
          - "g g"             → Vim 风格：连按两次 g（gg 等价）
          - "d d"             → Vim 删除行（dd 等价）
          - "esc"             → Vim 返回 Normal 模式
          - "ctrl+plus"       → Ctrl+=（放大），必须用 plus 不是 +
          ⚠️ 不支持无空格的多字符简写（"gg" 必须写作 "g g"），保持解析无歧义
```

### 3.3 归一化规则

**核心原则：vim 语义下 `d` 和 `D` 是两个不同键。** Modifier 与字符大小写是**正交**维度，不是同一个东西。

```rust
// 解析期（KeySeq::parse 后 normalize 一次）：
//   - 大写字面字母 → 在已有的 Modifiers 上"加" SHIFT，并 fold 成小写
//     "d"     → { mods: NONE,    key: Char('d') }
//     "D"     → { mods: SHIFT,   key: Char('d') }    // 自动加 SHIFT
//     "shift+D" → { mods: SHIFT,  key: Char('d') }    // 幂等
//     "ctrl+S"  → { mods: CTRL+SHIFT, key: Char('s') }
//   - 标点键、数字、功能键：不触发上述规则，原样保留
//
// 事件期（KeyEvent::normalize）：
//   - Char('A'..'Z') → Char('a'..'z')
//   - Modifiers 一律保留（SHIFT **不**清掉）
//     用户按 Shift+d 产生 { SHIFT, Char('D') } → normalize 为 { SHIFT, Char('d') }
//     与 "D" 命令精确匹配；与 "d" 命令不匹配（mods 不同），也不会启动 dd 和弦。
//
// 匹配期（KeySeq::matches）：
//   - Modifiers：精确比较（SHIFT 区分大小写意图）
//   - Key::Char：case-insensitive 比较（小写已归一化，两侧按 ASCII 等价）
//   - 其他 Key 变体：精确比较
//
// 隐含行为（用户体感）：
//   - "ctrl+s" 命令匹配 Ctrl+s 或 Ctrl+S（OS 通常不发送 SHIFT 修饰符）
//   - "D" 命令只匹配 Shift+d；"d" 命令只匹配裸 d；二者互不干扰
//   - dd 和弦（"d" + "d"）键盘可达；"D" 单条独立可达
```

**v1 决定：维持 vim 大小写区分语义。** 修改前的实现把 `D` 折叠成 `d` 并清掉 SHIFT，导致 dd/D 命令撞车（spec §9.5.5 验证表里 `pending='d', new='D'` 那行无法按预期工作）。修正后与 vim、VSCode 等编辑器一致。

### 3.4 键位绑定（`keybinding.rs`）

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeySeq {
    pub mods: Modifiers,
    pub key: Key,
}

impl KeySeq {
    /// True when this `KeySeq` matches the (normalized) event (spec §3.3, §3.4).
    ///
    /// Both sides are normalized first:
    /// - **Modifiers: exact comparison.** `SHIFT` distinguishes `d` from `D`.
    /// - **`Key::Char`: case-insensitive comparison** (after both sides fold
    ///   to lowercase via `Key::normalize`).
    /// - **Other `Key` variants** (`Enter`, `F(1)`, `Tab`, etc.): exact.
    pub fn matches(&self, ev: &KeyEvent) -> bool;

    /// 解析 "ctrl+s"、"shift+tab"、"d"、"D" 之类。
    ///
    /// 大写字面字母会**自动加** `Modifiers::SHIFT`（再 fold 成小写）——这是
    /// vim 区分 `d`/`D`、`g`/`G` 的机制（详见 §3.3）。示例：
    /// - `"d"`    → `{ mods: NONE,  key: Char('d') }`
    /// - `"D"`    → `{ mods: SHIFT, key: Char('d') }`
    /// - `"ctrl+s"` → `{ mods: CTRL,  key: Char('s') }`
    /// - `"ctrl+S"` → `{ mods: CTRL+SHIFT, key: Char('s') }`
    pub fn parse(s: &str) -> Result<KeySeq, CommandError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyChord(pub &'static [KeySeq]);  // 1 个 = 单键，2+ = 和弦

impl KeyChord {
    pub fn parse(s: &'static str) -> Result<KeyChord, CommandError>;
    pub fn matches(&self, events: &[KeyEvent]) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Keybinding {
    pub chord: KeyChord,
    /// 上下文查询（可选），如 `"editorFocus && !readOnly"`。
    /// **`KeyMatcher` 不评估 `when` 字符串**——它只是数据载体。
    /// 评估由 host 实现：在 `Matched(id)` 后或命令面板列表渲染时调用
    /// host 的 `eval_when(when_str, ctx)` 决定是否真正派发/展示。
    /// v1 只识别三种字面量：`editorFocus` / `!editorFocus` / `readOnly`。
    pub when: Option<&'static str>,
}
```

### 3.5 命令（`command.rs`）

```rust
/// 命令处理器签名：同步、短小、可重入。
/// 长操作通过 `ctx.services.spawn(...)` 派发到后台，立即返回。
pub type CommandFn = fn(&mut Ctx) -> Result<CommandOutcome, CommandError>;

#[derive(Debug, Clone)]
pub enum CommandOutcome {
    /// 什么都不做，仅成功标记。
    None,
    /// 状态消息（命令面板 toast 等）。
    Message(String),
    /// 打开文件（按 ID 或路径）。
    Open(String),
    /// 关闭当前 UI 表面（面板/对话框）。
    Close,
    /// 切换焦点区域。
    Focus(Focus),
    /// 扩展点：宿主可识别的自定义结果。
    Custom(&'static str, serde_json::Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Focus {
    Editor,
    Palette,
    Sidebar,
    StatusBar,
}

#[derive(Debug, Clone, Copy)]
pub struct Command {
    pub id: &'static str,                  // "file.save"
    pub label: &'static str,               // "Save File"
    pub description: Option<&'static str>, // tooltip
    pub category: Option<&'static str>,    // "File", "Edit", "View"
    pub scope: Scope,
    pub platforms: &'static [Platform],
    pub modes: &'static [Mode],            // 通常 [Any]
    pub keybindings: &'static [Keybinding],// 0..N，支持多键位（如 Ctrl+S 和 Cmd+S）
    pub handler: CommandFn,
}
```

**Command 注册期是静态的**，handler 是 `fn` 指针而非闭包——保证 `Command: 'static`，方便装进 `HashMap<&'static str, Command>`，且序列化导出到 wasm/ffi 时无需额外工作。`Copy` 派生是必要的：`register(cmd: Command)` 按值接收参数，注册后还能复用 `static` 命令源；没有 `Copy` 则 `static FOO: Command` 会被 move 走，注册函数拿不到。

### 3.6 命令宏（`macros.rs`）

```rust
/// 声明宏：定义并可立即 push 进静态注册表。
#[macro_export]
macro_rules! command {
    (
        id: $id:literal,
        label: $label:literal
        $(, description: $desc:literal)?
        $(, category: $cat:literal)?
        $(, scope: $scope:ident)?
        $(, platforms: [ $($plat:ident),* ])?
        $(, modes: [ $($mode:ident),* ])?
        $(, key: $key:literal)?
        $(, keys: [ $($k:literal),* ])?
        $(, handler: $handler:path)?
    ) => { ... };
}
```

**简化注册示例：**

```rust
// 全局命令 + 单键位
// ⚠️ v1 在 MSRV 1.75 下无法直接 `pub static FOO: Command = command!(...)`：
// KeyChord::parse 内部需要运行时分配（Vec/Box::leak），非 const。
// 实际用 OnceLock（或 MSRV ≥ 1.80 时的 LazyLock）做首次访问时构造。
pub static FILE_SAVE: OnceLock<Command> = OnceLock::new();
fn file_save() -> Command {
    command!(
        id: "file.save",
        label: "Save File",
        description: "Write current document to storage",
        category: "File",
        scope: Global,
        platforms: [Web, Tui, Android],
        modes: [Any],
        key: "ctrl+s",
        handler: cmd_file_save
    )
}

// 编辑器命令 + 多键位
pub static EDITOR_FIND: OnceLock<Command> = OnceLock::new();
fn editor_find() -> Command {
    command!(
        id: "editor.find",
        label: "Find",
        category: "Edit",
        scope: Editor,
        platforms: [Web, Tui],
        modes: [Normal, Visual],
        keys: ["ctrl+f", "f3"],
        handler: cmd_editor_find
    )
}

// 注册时：
//   reg.register(*FILE_SAVE.get_or_init(file_save)).unwrap();
//   reg.register(*EDITOR_FIND.get_or_init(editor_find)).unwrap();
//
// 升级到 MSRV 1.80+ 时可换为 LazyLock 一次性写法：
//   pub static FILE_SAVE: LazyLock<Command> =
//       LazyLock::new(|| command!( ... ));
```

**v1 决定：** 维持 MSRV 1.75，所有内置命令用 `OnceLock<Command>` 模式存储；升级 MSRV 后切 `LazyLock`。两种形式的外部 API 一致（都是按需构造、`Copy`），仅初始化语法不同。

### 3.7 上下文（`context.rs`）

```rust
/// 当前命令执行上下文。
/// Handler 拿 `&mut Ctx` 一次性可变借用即可——`&mut Ctx` 已提供独占访问，
/// Rust 借用检查器自然支持拆字段借用（`ctx.engine.foo()` 与 `ctx.workspace.bar()`
/// 顺序调用都合法），无须 `RefCell`。
pub struct Ctx<'a> {
    /// 关联的注册表，用于 handler 间委托（如 `vim.save` → `file.save`）。
    pub registry: &'a CommandRegistry,

    pub platform: Platform,
    pub mode: Mode,
    pub focus: Focus,

    pub engine: &'a mut dyn EngineAccess,
    pub workspace: &'a mut dyn WorkspaceAccess,
    pub services: &'a mut Services,
}

/// 服务访问点：长操作、IO、加密、UI 操作。
/// 全部用 `FnMut`——Services 跨多次 handler 调用，不能 `FnOnce`（否则首次调用后字段被 move 掉）。
pub struct Services {
    pub spawn: Box<dyn FnMut(Box<dyn FnOnce() + Send>) + Send + 'static>,
    pub notify: Box<dyn FnMut(Notification)>,
    pub open_url: Box<dyn FnMut(String)>,
    pub request_quit: Box<dyn FnMut()>,
}

pub enum Notification {
    Info(String),
    Warn(String),
    Error(String),
    Progress { id: String, label: String, ratio: f32 },
    Done { id: String },
}

/// Engine 的抽象访问。trait 定义在本 crate，由 crates/engine 实现并注入。
pub trait EngineAccess {
    fn eval_line(&mut self, line: u32) -> Result<String, String>;
    fn invalidate(&mut self);
    // ... 后续按需扩展
}

pub trait WorkspaceAccess {
    fn current_path(&self) -> Option<String>;
    fn list(&self) -> Vec<FileEntry>;
    fn open(&mut self, path: &str) -> Result<(), String>;
    fn save(&mut self) -> Result<(), String>;
    // ...
}
```

**为什么用 trait 而不是直接 `&mut numera_engine::Engine`？**

- trait 定义在 command crate，engine/format 反向依赖 command 实现 trait——command 是叶子 crate，无任何向上依赖。
- `crates/command` 与 `numera-engine` 的具体类型完全解耦，测试时可注入 mock。
- FFI/wasm 边界能用同一 trait 把 Rust 接口直接暴露，无需重复定义。
- 后续 `numera-engine` 重构不影响本 crate。

---

## 4. 注册表（`registry.rs`）

```rust
pub struct CommandRegistry {
    by_id: HashMap<&'static str, Command>,
    by_category: BTreeMap<Option<&'static str>, Vec<&'static str>>,
}

impl CommandRegistry {
    pub fn new() -> Self;

    /// 注册单条命令。同 id 重复注册返回 DuplicateId。
    pub fn register(&mut self, cmd: Command) -> Result<(), CommandError>;

    /// 批量注册，任意一条失败则整体回滚。
    pub fn register_all<'a, I: IntoIterator<Item = &'a Command>>(
        &mut self,
        cmds: I,
    ) -> Result<(), CommandError>;

    pub fn get(&self, id: &str) -> Option<&Command>;

    /// 按 (platform, mode) 过滤，返回命令面板所需数据。
    pub fn list(
        &self,
        platform: Platform,
        mode: Mode,
    ) -> Vec<&Command>;

    pub fn len(&self) -> usize;
}
```

**关键不变量：**

- 注册时**不**做平台/模式过滤——所有命令都进表。过滤是查询时的事。
- 重复 id → 拒绝。重复 (platform, mode, chord) → 不报错但记日志（由宿主处理）。

### 4.1 推荐注册模式：`inventory` 或手动 collect

为避免各 crate 各自维护 `CommandRegistry::new()` 再注册一堆命令，统一通过 linkme / inventory 风格的静态收集：

> **v1 决定**：先不引入 `inventory` 第三方 crate（多一层依赖）。改用**显式注册函数**：

```rust
// crates/command/src/builtins.rs
pub fn register_builtins(reg: &mut CommandRegistry) {
    reg.register(FILE_SAVE).unwrap();
    reg.register(EDITOR_FIND).unwrap();
    // ...
}

// 业务 crate（wasm、tui、android）在启动时调一次
fn main() {
    let mut reg = CommandRegistry::new();
    register_builtins(&mut reg);
    if let Some(ext) = load_extension_commands() {
        register_all(&mut reg, &ext).unwrap();
    }
    // ...
}
```

如果将来扩展多、需要 cross-crate 自动收集，再升级到 `inventory`。

---

## 5. 键位匹配器（`matcher.rs`）

### 5.1 状态机

```rust
pub struct KeyMatcher {
    pending: Option<PendingChord>,
    timeout: Duration,  // 默认 1500ms
}

impl Default for KeyMatcher {
    fn default() -> Self {
        Self { pending: None, timeout: Duration::from_millis(1500) }
    }
}

struct PendingChord {
    next_index: usize,         // 期望下一段的下标（chord 起步时为 0）
    started_at: Instant,
    candidates: Vec<&'static str>, // 同时匹配中的多个命令 id
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyMatcherResult {
    /// 无匹配，也不构成和弦前缀。宿主应按常规处理（透传给编辑器等）。
    NoMatch,
    /// 已匹配某命令 id，宿主应执行之。
    Matched(&'static str),
    /// 当前键是和弦前缀，等待下一键。宿主可显示提示。
    PartialMatch,
}
```

> **wasm 平台注意：** `Instant::now()` 在 `wasm32-unknown-unknown` 上由 `performance.now()` 支撑，在大多数浏览器/Worker 中可用；但在某些受限环境可能 panic。wasm host 应在初始化时验证 `Instant::now()` 可用，或在 `KeyMatcher` 之上注入一个外部单调时钟 trait（v2 演进，v1 直接使用 `Instant`）。

### 5.2 匹配算法

```
pub fn feed(
    &mut self,
    ev: KeyEvent,
    platform: Platform,
    mode: Mode,
    reg: &CommandRegistry,
) -> KeyMatcherResult {
    let visible = reg.list(platform, mode);
    let ev_n = ev.normalize();

    // 1) 若当前有 pending chord：
    if let Some(pend) = self.pending:
        if now - pend.started_at > self.timeout:
            self.pending = None;          // 超时，清除
            // 重新当作新事件处理（fallthrough 到 step 2）
        else:
            // 非超时：跳转到续接路径 feed_continuation。
            //   - 新键续接和弦下一段 → Matched / PartialMatch
            //   - 新键不续接但开启新和弦前缀 → 清旧 pending，开新 → PartialMatch
            //     例：pending='g'，新键='j'，且 'j' 是另一个 chord 的首段
            //   - 完全失配 → 清 pending，返回 NoMatch（Vim 即时取消语义）
            return self.feed_continuation(ev_n, &visible, reg);

    // 2) 收集所有匹配当前事件的"单段"键位（和弦第一段 / 单键）。
    //    同时记录"已是和弦前缀"的多段键位。
    let mut prefix_hits: Vec<&Command> = vec![];
    let mut exact_hits:  Vec<&Command> = vec![];

    for cmd in &visible:
        for kb in cmd.keybindings:
            let seqs = kb.chord.0;
            if seqs.is_empty(): continue;
            if !seqs[0].matches(&ev_n): continue;

            if seqs.len() == 1:
                exact_hits.push(cmd);
            else:
                prefix_hits.push(cmd);

    // 3) 决策：
    if exact_hits.len() == 1 && prefix_hits.is_empty():
        return Matched(exact_hits[0].id);

    if exact_hits.is_empty() && prefix_hits.len() >= 1:
        // 启动/继续和弦等待；next_index 从 0 开始（下一键续接 seqs[1]）
        self.pending = Some(PendingChord {
            candidates: prefix_hits.iter().map(|c| c.id).collect(),
            next_index: 0,
            started_at: Instant::now(),
        });
        return PartialMatch;

    if !exact_hits.is_empty() && !prefix_hits.is_empty():
        // 歧义：当前键既作为完整匹配也存在和弦前缀
        // 优先匹配完整（VSCode 行为：键按下立即生效，不等和弦）
        if exact_hits.len() == 1:
            self.pending = None;
            return Matched(exact_hits[0].id);
        else:
            // 多个完整匹配 → 取 id 字典序最小，warn 日志
            self.pending = None;
            return Matched(sorted[0].id);

    return NoMatch;
```

**当 pending chord 在等待下一键时，新键到来：**

```
on feed_continuation(ev, visible, reg):
    let pend = self.pending.take().unwrap();
    let next_idx = pend.next_index + 1;

    // (a) 续接候选：pend.candidates 中下一段匹配 ev 的命令
    let next_cmds: Vec<&Command> = pend.candidates.iter()
        .filter_map(|id| reg.get(id))
        .filter(|cmd| cmd.keybindings.iter().any(|kb| {
            let seqs = kb.chord.0;
            seqs.len() > next_idx && seqs[next_idx].matches(&ev)
        }))
        .collect();

    // (b) 新单段匹配：ev 完整匹配某个单段命令
    //     例：pending='d'，新键='D' → 立即触发 delete-to-end（不等 d 的和弦）
    //     例：pending='d'，新键='j' → 立即触发 vim.motion_down（d 被取消）
    let fresh_singles: Vec<&Command> = visible.iter()
        .filter(|cmd| cmd.keybindings.iter().any(|kb| {
            let seqs = kb.chord.0;
            seqs.len() == 1 && seqs[0].matches(&ev)
        }))
        .collect();

    // (c) 新多段前缀：ev 是其他 chord 的首段
    //     例：pending='d'，新键='g' → 启动 gg 和弦（d 被顶掉）
    let fresh_prefixes: Vec<&Command> = visible.iter()
        .filter(|cmd| cmd.keybindings.iter().any(|kb| {
            let seqs = kb.chord.0;
            seqs.len() >= 2 && seqs[0].matches(&ev)
        }))
        .collect();

    // 优先级 1：续接完成（chord 凑齐，胜出）
    if !next_cmds.is_empty():
        let completed: Vec<&Command> = next_cmds.iter()
            .filter(|cmd| cmd.keybindings.iter().any(|kb| kb.chord.0.len() == next_idx + 1))
            .copied().collect();
        if !completed.is_empty():
            return Matched(completed[0].id);
        // 续接但未完成 → 推进
        self.pending = Some(PendingChord {
            candidates: next_cmds.iter().map(|c| c.id).collect(),
            next_index,
            started_at: Instant::now(),
        });
        return PartialMatch;

    // 优先级 2：新单段匹配（immediate fire；旧 pending 已被 take() 取消）
    if !fresh_singles.is_empty():
        return Matched(fresh_singles[0].id);

    // 优先级 3：新多段前缀（开新 chord）
    if !fresh_prefixes.is_empty():
        self.pending = Some(PendingChord {
            candidates: fresh_prefixes.iter().map(|c| c.id).collect(),
            next_index: 0,
            started_at: Instant::now(),
        });
        return PartialMatch;

    // 完全失配：键透传给编辑器
    return NoMatch;
```

### 5.3 边界处理

| 场景 | 行为 |
|---|---|
| 单键和多键共前缀（如 `Ctrl+K` 同时是 `Ctrl+K Ctrl+S` 的前缀） | 单键立即触发；多键需严格按 chord 全部按下 |
| 等待和弦中按了无关键 | 清 pending，返回 NoMatch（键透传给编辑器） |
| 等待和弦中按了不续接但构成**新**和弦前缀的键（pending='g'，新键='j'，且 'j' 是别的 chord 首段） | 清旧 pending，按新前缀重启等待 → PartialMatch |
| 等和弦超时（>1500ms） | 清 pending；下一键按全新事件处理 |
| Vim 模式下任何未匹配键 | 立即清 pending（不等超时），体感一致 |
| 同 id 多键位 | 注册时不报错，匹配时任意一个命中即触发 |
| 同 id 但 platforms/modes 不一致 | 注册时同 id 视为同命令，键位并集；冲突时记录 warn |
| 多条命令键位完全相同 | 注册期接受，匹配时按注册顺序取首条 |
| **贪心 chord 完成**（`d d` 与 `d d d` 都注册；按下两次 `d`） | chord 凑齐即 fire，更长的 chord 变不可达——与 VSCode 一致。若需更长 chord 超时后再 fire，须提高 KeyMatcher 超时（v1 不支持） |
| **键位 overlap**（`Ctrl+S` 在 `[Any]` 模式绑 `file.save`，同时在 `[Normal]` 模式绑 `file.save_as`） | Normal 模式下两条都可见，按字典序最小 id 触发；`file.save_as` 经键盘不可达，只能经命令面板。这是已知权衡，避免注册期重叠 |
| **模式切换打断 chord**（pending='d'，按 `i` 进入 Insert；`d` 是 `dd` 的前缀） | §5.4 on_mode_change 清 pending。`i` 同时是 `vim.insert` 命令，会触发；`dd` 失效。这是预期行为（vim 中切模式等同"我改主意了"） |

### 5.4 模式切换联动

模式切换（如 vim normal → insert）由编辑器层通知 KeyMatcher：

```rust
impl KeyMatcher {
    /// 当前模式改变（如进入 insert 模式），清掉 pending。
    pub fn on_mode_change(&mut self, new_mode: Mode) {
        self.pending = None;
    }
}
```

---

## 6. 派发（`dispatch.rs`）

```rust
pub fn execute(
    reg: &CommandRegistry,
    id: &str,
    ctx: &mut Ctx,
) -> Result<CommandOutcome, CommandError> {
    let cmd = reg.get(id).ok_or_else(|| CommandError::UnknownCommand(id.to_string()))?;

    // 再做一次可见性检查（防止宿主绕过 matcher 直接调 execute）
    if !cmd.platforms.contains(&ctx.platform) {
        return Err(CommandError::PlatformMismatch);
    }
    if !cmd.modes.contains(&ctx.mode) && !cmd.modes.contains(&Mode::Any) {
        return Err(CommandError::ModeMismatch);
    }

    (cmd.handler)(ctx)
}
```

**Outcome 处理由宿主完成。** 典型映射：

| Outcome | Web (Lit) | TUI (ratatui) | Android (Compose) |
|---|---|---|---|
| `None` | 不做任何事 | 不做任何事 | 不做任何事 |
| `Message(s)` | snackbar | status bar 1 秒 | SnackbarHost |
| `Open(path)` | 切换当前文档 | 切换当前文档 | 切换当前文档 |
| `Close` | 关闭顶层 dialog/popup | 关闭 modal | 关闭 BottomSheet |
| `Focus(F)` | focus DOM 节点 | ratatui focus 切换 | focus Compose 节点 |
| `Custom(tag, data)` | 自定义 tag 派发 | 同上 | 同上 |

---

## 7. 错误（`error.rs`）

```rust
#[derive(Error, Debug)]
pub enum CommandError {
    #[error("Unknown command id: {0}")]
    UnknownCommand(String),

    #[error("Duplicate command id: {0}")]
    DuplicateId(String),

    #[error("Keybinding parse error: {0}")]
    KeybindingParseError(String),

    #[error("Command '{0}' not available on platform {1:?}")]
    PlatformMismatch(String, Platform),

    #[error("Command '{0}' not available in mode {1:?}")]
    ModeMismatch(String, Mode),

    #[error("Handler error: {0}")]
    HandlerError(String),
}
```

约定：`#[from]` 仅给 io/serde/reqwest；本 crate 暂无 IO 错误，全部用 `String` 负载。

---

## 8. 与现有 crates 的关系

| crate | 关系 |
|---|---|
| `numera-engine` | `EngineAccess` trait 由 `engine` crate 实现并注入；不修改 engine 内部 API |
| `numera-format` | `WorkspaceAccess` trait 由 `format` crate 实现；不修改 format 内部 API |
| `numera-wasm` | 增加 4 个 wasm 函数：`new_registry()` 构造注册表、`command_list(platform, mode)` 取可见命令、`command_execute(id)` 派发、`new_key_matcher()` 构造匹配器 |
| `numera-ffi` | UniFFI 把 `CommandRegistry` / `CommandOutcome` / `KeyMatcher` 暴露给 Kotlin/Swift |
| `numera-cli` | 不直接使用（CLI 是单命令运行） |
| `numera-tui`（未来） | 复用本 crate 的 matcher + execute |

`Cargo.toml`：

```toml
# crates/command/Cargo.toml
[dependencies]
thiserror = { workspace = true }
serde_json = { workspace = true }    # CommandOutcome::Custom 序列化
```

反向依赖（engine/format crate 的 Cargo.toml 加这一行）：

```toml
# crates/engine/Cargo.toml + crates/format/Cargo.toml
[dependencies]
numera-command = { workspace = true }   # 实现 EngineAccess / WorkspaceAccess trait
```

---

## 9. 集成示例

### 9.1 Web（Lit + CodeMirror + WASM）

```ts
// web/src/lib/keyboard.ts
import { init } from '@numera/wasm';

const numera = await init();
const reg = numera.newRegistry();
// WASM 侧已 register_builtins

const matcher = numera.newKeyMatcher();

window.addEventListener('keydown', (e) => {
  const event = keyEventFromDom(e);
  const platform = 'Web';
  const mode = currentEditorMode();   // 由 CodeMirror 维护
  const result = matcher.feed(event, platform, mode, reg);

  if (result.matched) {
    e.preventDefault();
    const outcome = numera.execute(result.matched);
    handleOutcome(outcome);
  } else if (result.partial) {
    showChordHint('Ctrl+K…');
  }
  // NoMatch 不 preventDefault，让 CodeMirror 处理
});

function handleOutcome(outcome) {
  switch (outcome.tag) {
    case 'Message': showSnackbar(outcome.value); break;
    case 'Open': openFile(outcome.value); break;
    case 'Close': closeTopDialog(); break;
    case 'Focus': focusDom(outcome.value); break;
    case 'Custom':
      if (outcome.tag === 'palette.show') numera.openPalette();
      break;
  }
}

// 命令面板：列出所有可见命令
const paletteItems = numera.commandList('Web', 'Normal')
  .map(c => ({ id: c.id, label: c.label, category: c.category }));
```

### 9.2 TUI（ratatui）

```rust
use numera_command::{CommandRegistry, KeyMatcher, Platform, Mode, execute};
use crossterm::event::{read, Event, KeyEvent as CtKey};

let mut reg = CommandRegistry::new();
numera_command::builtins::register_builtins(&mut reg);
// builtins 已注册 vim normal/insert、standard、global 三组命令
// （详见 §9.5 完整 keymap 参考）

let mut matcher = KeyMatcher::default();

loop {
    terminal.draw(|f| ui(f, &app))?;
    if let Event::Key(k) = read()? {
        let ev = to_key_event_with_mapping(k);   // §3.2: Option→Alt, Cmd→Meta
        let mode = app.editor_mode();
        match matcher.feed(ev, Platform::Tui, mode, &reg) {
            Matched(id) => {
                let outcome = execute(&reg, id, &mut app.ctx())?;
                app.apply_outcome(outcome);
            }
            PartialMatch => app.set_chord_hint(matcher.pending_hint()),
            NoMatch => app.editor_mut().on_key(ev),   // 透传给编辑器
        }
    }
}
```

### 9.3 Android（Kotlin via UniFFI）

```kotlin
// Android 只装载 platforms=Android 的命令
val reg = CommandRegistry()
registerAndroidBuiltins(reg)

val matcher = KeyMatcher()

// 硬件快捷键（如 Ctrl+S 外接键盘）
hardwareKeyListener { keyEvent ->
    val ev = keyEvent.toKeyEvent()
    when (val result = matcher.feed(ev, Platform.Android, Mode.Any, reg)) {
        is Matched -> {
            val outcome = execute(reg, result.id, ctx)
            applyOutcome(outcome)
        }
        else -> Unit
    }
}

// 软键盘命令入口（FAB 长按弹出的命令面板）
val items = commandList(reg, Platform.Android, Mode.Any)
    .map { CommandItem(it.id, it.label, it.category) }
```

### 9.4 Vim 桥接示例

```rust
// CodeMirror vim 模式下输入 ':w'
// → CodeMirror 派发 vim.save 命令到 numera-command
// → execute("vim.save") 内部做：
pub fn cmd_vim_save(ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
    execute(ctx.registry, "file.save", ctx)   // 委托到全局命令
}

// CodeMirror 的 vim 扩展本身不重新实现 :w，只需把命令字符串映射到 numera-command 的 execute
```

### 9.5 TUI Keymap 参考——覆盖 `numr` 上游 Vim + Standard 方案

把上文贴出的 TUI 键位表完整映射为本 crate 的 Command 注册，验证：本 spec 的数据模型 + matcher 算法可直接承载这套方案，无须再扩展。

#### 9.5.1 全局命令（modes: [Any]）

| key | command id | 说明 |
|---|---|---|
| `"ctrl+s"` | `file.save` | 三模式都生效 |
| `"ctrl+r"` | `editor.refresh_rates` | 跨模式（TUI/Web） |
| `"?"` / `"f1"` | `help.toggle` | 跨模式（TUI） |
| `"f12"` | `debug.toggle` | 跨模式（TUI） |
| `"shift+tab"` | `keymap.toggle` | 跨模式，handler 翻转 host 当前 mode |

#### 9.5.2 Vim Normal 模式（modes: [Normal]）

| key | command id |
|---|---|
| `"i"` / `"a"` / `"I"` / `"A"` | `vim.insert` / `vim.insert_after` / `vim.insert_line_start` / `vim.insert_line_end` |
| `"o"` / `"O"` | `vim.open_below` / `vim.open_above` |
| `"s"` | `vim.substitute` |
| `"C"` | `vim.change_to_end` |
| `"h"` / `"j"` / `"k"` / `"l"` | `vim.motion_left` / `motion_down` / `motion_up` / `motion_right` |
| `"w"` / `"b"` / `"e"` | `vim.word_forward` / `word_back` / `word_end` |
| `"0"` / `"$"` | `vim.line_start` / `line_end` |
| `"g g"` | `vim.goto_first` |
| `"G"` | `vim.goto_last` |
| `"space"` | `vim.move_right` |
| `"pageup"` / `"pagedown"` | `vim.page_up` / `page_down` |
| `"x"` / `"X"` | `editor.delete_forward` / `editor.delete_back` |
| `"d d"` | `editor.delete_line` |
| `"D"` | `editor.delete_to_end` |
| `"J"` | `editor.join_lines` |
| `"W"` / `"N"` / `"H"` | `view.toggle_wrap` / `toggle_line_numbers` / `toggle_header` |
| `"q"` | `app.quit` |

> ⚠️ `d` **不**注册为单段命令——只作为 `"d d"` 的首段前缀。否则 `d d` 在 §5.2 续接路径优先级 1 中会因歧义失效。

#### 9.5.3 Vim Insert 模式（modes: [Insert]）

| key | command id |
|---|---|
| `"esc"` | `vim.normal`（回到 Normal） |
| `"backspace"` / `"delete"` | `editor.delete_back` / `delete_forward` |
| `"alt+backspace"` / `"ctrl+w"` | `editor.delete_word` |
| `"meta+backspace"` / `"ctrl+u"` | `editor.delete_to_start` |
| `"enter"` | `editor.new_line` |
| `"up"` / `"down"` / `"left"` / `"right"` | `editor.move_*` |
| `"pageup"` / `"pagedown"` | `editor.page_up` / `page_down` |
| `"home"` / `"end"` | `editor.line_start` / `line_end` |

可打印字符：`NoMatch` 透传给编辑器作文字插入。**注意：** Insert 模式下的字符输入不由 matcher 决策，编辑器层接收 NoMatch 直接 insert。

#### 9.5.4 Standard 模式（modes: [Standard]）

| key | command id |
|---|---|
| `"left"` / `"right"` / `"up"` / `"down"` | `editor.move_*` |
| `"home"` / `"end"` | `editor.line_start` / `line_end` |
| `"pageup"` / `"pagedown"` | `editor.page_up` / `page_down` |
| `"ctrl+a"` / `"ctrl+e"` | `editor.line_start` / `line_end` |
| `"ctrl+g"` | `editor.goto_first` |
| `"backspace"` / `"delete"` | `editor.delete_back` / `delete_forward` |
| `"alt+backspace"` / `"ctrl+w"` | `editor.delete_word` |
| `"meta+backspace"` / `"ctrl+u"` | `editor.delete_to_start` |
| `"ctrl+k"` | `editor.delete_to_end` |
| `"enter"` | `editor.new_line` |
| `"alt+z"` | `view.toggle_wrap` |
| `"ctrl+l"` / `"ctrl+h"` | `view.toggle_line_numbers` / `toggle_header` |
| `"ctrl+q"` | `app.quit` |

可打印字符：直接透传给编辑器（不进入 matcher 决策）。

#### 9.5.5 边界场景验证表

| 用户场景 | spec 段 | 验证 |
|---|---|---|
| pending=`"d"`，新键=`"d"` → 触发 `editor.delete_line` | §5.2 续接路径优先级 1（chord 完成） | ✓ |
| pending=`"d"`，新键=`"D"` → 触发 `editor.delete_to_end`（d 取消） | §5.2 续接路径优先级 2（新单段） | ✓ |
| pending=`"g"`，新键=`"g"` → 触发 `vim.goto_first` | §5.2 续接路径优先级 1 | ✓ |
| pending=`"d"`，新键=`"j"` → 触发 `vim.motion_down`（d 取消） | §5.2 续接路径优先级 2 | ✓ |
| pending=`"g"`，新键=`"G"` → 触发 `vim.goto_last`（大小写不同） | §5.2 续接路径优先级 2 | ✓ |
| pending=`"d"`，超时（>1500ms）→ 清 pending | §5.2 step 0 | ✓ |
| Normal → Insert 切换 → 清 pending | §5.4 | ✓ |
| Vim ↔ Standard 切换 → 清 pending | §5.4 | ✓ |
| macOS `Option+Backspace` → 匹配 `alt+backspace` 命令 | §3.2 host 映射 | ✓ |
| `Ctrl+s` 在 Normal/Insert/Standard 三模式都生效 | §3.1 Mode::Any | ✓ |
| `?` 与 `F1` 绑同一命令（多键位） | §3.5 `keybindings: &'static [Keybinding]` | ✓ |
| `Shift+Tab` 三模式都能触发 keymap 切换 | §3.1 Mode::Any + §9.5.1 | ✓ |
| `d` 单按无命令（避免和 `d d` 撞车） | §9.5.2 注释（注册表不放单段 `d`） | ✓ |

#### 9.5.6 关键代码模式

> 以下示例展示 `command!` 宏的语法形状；实际存储因 MSRV 1.75 约束用 `OnceLock<Command>`（见 §3.6 注）。

```rust
// 1) 全局命令，跨模式
pub static FILE_SAVE: Command = command!(
    id: "file.save",
    label: "Save",
    key: "ctrl+s",
    scope: Global,
    platforms: [Web, Tui, Android],
    modes: [Any],
    handler: cmd_file_save
);

// 2) Vim Normal 单段命令
pub static VIM_INSERT: Command = command!(
    id: "vim.insert",
    label: "Enter Insert",
    key: "i",
    scope: Editor,
    platforms: [Tui],
    modes: [Normal],
    handler: cmd_vim_insert
);

// 3) Vim Normal 和弦命令（gg）—— key 必须写 "g g" 带空格
pub static VIM_GOTO_FIRST: Command = command!(
    id: "vim.goto_first",
    label: "Go to First Line",
    key: "g g",
    scope: Editor,
    platforms: [Tui],
    modes: [Normal],
    handler: cmd_vim_goto_first
);

// 4) 同一命令多模式 + 多键位
pub static EDITOR_LINE_START: Command = command!(
    id: "editor.line_start",
    label: "Line Start",
    keys: ["0", "ctrl+a", "home"],   // Normal: "0", Standard: "ctrl+a", 共享: "home"
    scope: Editor,
    platforms: [Tui],
    modes: [Normal, Standard],
    handler: cmd_editor_line_start
);

// 5) 模式切换（Shift+Tab 三模式生效）
pub static KEYMAP_TOGGLE: Command = command!(
    id: "keymap.toggle",
    label: "Toggle Keymap",
    key: "shift+tab",
    scope: Global,
    platforms: [Tui],
    modes: [Any],
    handler: cmd_keymap_toggle
);
```

#### 9.5.7 结论

整套 keymap 直接落地，无须再改 spec。剩下的工程问题（handler 内部的光标移动、删除、模式翻转逻辑）属于 crates/command 之外的实现范畴。

---

## 10. 测试策略

每个模块 inline 测试（`#[cfg(test)] mod tests`）：

| 模块 | 测试内容 |
|---|---|
| `scope` | 默认值 / Eq / Hash 行为 |
| `key` | 修饰键位构造、normalize、KeyEvent 比较 |
| `keybinding` | 解析 `"ctrl+s"`、`"ctrl+k ctrl+p"`、`"f3"`、`"shift+?"` 等；matches 正确性 |
| `command` | 宏展开产物字段正确；多键位并集 |
| `registry` | 注册/去重/list 过滤（platform × mode 矩阵） |
| `matcher` | 单键匹配；和弦匹配；歧义时单键胜出；超时清 pending；mode 切换清 pending |
| `dispatch` | 调未注册命令返回 `UnknownCommand`；平台/模式不匹配返回对应错误 |
| `error` | Display 文本稳定（snapshot） |

**关键测试场景**（`matcher` 必须覆盖）：

```rust
#[test]
fn single_key_matches_unique_command() { ... }

#[test]
fn chord_completes_after_two_keys_within_timeout() { ... }

#[test]
fn chord_resets_after_timeout() { ... }

#[test]
fn ambiguous_key_prefers_single_when_chord_prefix_exists() { ... }

#[test]
fn pending_cleared_on_mode_change() { ... }

#[test]
fn no_match_passes_through() { ... }

#[test]
fn same_id_with_multiple_keybindings_matches_any() { ... }
```

---

## 11. 错误处理约定

- 注册期：开发期 panic + 错误日志；运行期可降级（仅警告）。
- 匹配期：永不 panic；歧义 → 选首条 + warn。
- 派发期：handler 错误透传给宿主，由宿主决定展示（snackbar / log / status bar）。
- v1 不引入错误恢复策略，handler 自决。

---

## 12. 性能与可观测性

- 注册表查询：`HashMap<&'static str, Command>` O(1)。
- 命令面板：`BTreeMap` 按字母排序。
- 匹配器：每个键位平均 O(N) 扫描可见命令（N ≤ 数百，足够快）。
- 调试：`tracing` crate（可选 feature）记录匹配路径。

---

## 13. 开放问题（待定）

| 编号 | 问题 | 备选 |
|---|---|---|
| Q1 | `inventory` 自动收集 vs 显式 `register_builtins` | 先显式；扩展多了再升 |
| Q2 | 是否引入 `tracing` 依赖 | 可选 feature，默认关 |
| Q3 | `when` 表达式语法设计 | v1 只识别 `editorFocus`、`!editorFocus`、`readOnly` 三种字面量 |
| Q4 | 多键位注册 API 是 `keys: [...]` 还是多次 `register` | 用 `keys: [...]`（更紧凑） |
| Q5 | 自定义命令（用户配置 JSON）如何加载 | v1 不支持；只在命令面板里"指向文件"，文件加载走 format crate |
| Q6 | handler 同步约束会不会限制 sync upload？ | 通过 `ctx.services.spawn(...)` 解决，handler 立即返回 |
| Q7 | 注册表是否暴露到 JS/JSON 让 web 端做静态分析？ | v1 不暴露；v2 加 `reg.export_json()` 给 MD3 命令面板做 i18n |

---

## 14. 里程碑

| 里程碑 | 交付物 | 验证 |
|---|---|---|
| M1 | 骨架：`scope`/`key`/`keybinding`/`command`/`error` + 测试 | `cargo test -p numera-command` 全绿 |
| M2 | `registry` + `macros` + 内置命令 5 条 | 注册/过滤/查询测试 |
| M3 | `matcher` 完整状态机 | 7 个关键测试场景通过 |
| M4 | `context` + `dispatch` + trait 接入 engine/format | mock 测试 + 与 engine 集成测试 |
| M5 | wasm binding 暴露 4 个函数 | 浏览器端命令面板可用 |
| M6 | 文档 + 示例（web/tui/android 各 1 段） | 集成示例跑通 |

---

## 15. 一句话原则

> **命令是数据，handler 是函数，UI 是渲染。**
> Web 端打磨的快捷键方案，TUI 直接复用，Android 自动隔离——这三件事由本 crate 同时保证。