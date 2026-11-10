# dsh-kb

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供的**知识源插件**：在对话里选择本地文件夹或外部知识库，回答时给出可追溯的引用。

## 功能

- **本地文件夹知识源**：递归扫描 Markdown / 文本 / PDF / docx，标题感知分块，SQLite FTS5（trigram）检索，PDF 引用带页码。
- **外部工具知识源（配置式）**：不做厂商适配器。填名称 + 已注册的工具名（MCP server / skill / 其他插件工具）+ 参数模板 + 结果映射，即可接入任意外部知识库。
- **会话级选源**：输入框左侧芯片，下拉选择；支持「不使用知识库」；选择按会话保存。
- **引用折叠面板**：回答下方「引用 N 条 · 来源」，展开看片段，可打开原文。
- **知识库管理页**：侧栏「知识库」入口，左侧本地/外部两个 tab，右侧文件表格（名称/类型/状态/更新时间）。
- **设置**：分块参数、向量模型、重排模型（后两者已保存配置，检索接入见路线图）。

## 安装

```bash
# 1) 克隆到任意目录
git clone <this-repo> dsh-kb
cd dsh-kb

# 2) 安装运行时依赖（pdfjs-dist / mammoth）
npm install --omit=dev

# 3) 装进 DSH profile（路径用绝对路径）
dsh plugin --profile <profile> add <absolute-path-to-dsh-kb>
```

安装后重启/热重载 DSH，侧边栏出现「知识库」入口，输入框左侧出现知识源芯片。

> 说明：profile 的 pnpm 不会为 `link:` 本地包安装依赖，所以需要第 2 步。

## 使用

1. 侧边栏「知识库」→ 新建本地知识库，填文件夹绝对路径 → 自动建索引；
2. 回到对话，点输入框左侧芯片选择该知识源；
3. 提问，回答下方出现引用面板；PDF 引用会标页码。

## 数据位置

- `$DSH_HOME/kb/state.json`：知识源、会话绑定、引用、文档清单、配置
- `$DSH_HOME/kb/local.sqlite`：分块索引（FTS5）

## 路线图

- [ ] 向量检索（OpenAI 兼容 / Ollama / 本地 ONNX）
- [ ] 重排（cross-encoder / Cohere）
- [ ] 混合检索（BM25 + 向量 + RRF）
- [ ] 增量索引（mtime + hash 指纹）
- [ ] Excel / PPT 解析
- [ ] 召回测试面板

## 开发

```
index.js         host：工具、HTTP 路由、存储、会话绑定
local-index.js   本地索引：扫描 / 解析 / 分块 / FTS5 检索
client.js        client：芯片、引用面板、管理页、设置弹窗
cordis.patch.yml 插件行
```

热重载 host：`plugin_manager set_bundle(false)` → `set_bundle(true)`；client 改动需刷新页面。

## License

MIT
