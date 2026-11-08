# dsh-plugin-saber（P1）

让 DSH 用自然语言驱动本机 **Saber-Translator**（漫画翻译器）的插件。

- **v2 后端（Saber 3.5+）**：完整链路——查书、看页面、排翻译任务、看进度、暂停/取消/重试、取译图、读写术语表。
- **legacy 后端（Saber 3.3.x）**：诚实降级——只读查询可用，任务类工具会明确说明该版本没有任务 API。

## 工具

| 工具 | 作用 | 3.5+ | 3.3.x |
|---|---|---|---|
| `saber_status` | 版本线、存储版本、端口、书架、Worker/队列状态 | ✅ | ✅ |
| `saber_books` | 书架列表（search / limit） | ✅ | ✅ |
| `saber_book` | 书详情 + 章节列表 | ✅ | ✅ |
| `saber_pages` | 章节页面列表（渲染状态、译图有无） | ✅ | ✅（需 bookId） |
| `saber_translate` | 排翻译任务（单章 / 多章 / 整本；standard/hq/proofread/remove_text） | ✅ | ❌ |
| `saber_jobs` | 任务队列/历史列表 | ✅ | ❌ |
| `saber_job` | 单个任务详情（进度、失败项、产物） | ✅ | ❌ |
| `saber_job_control` | 暂停 / 恢复 / 取消 / 重试 / 队列暂停 | ✅ | ❌ |
| `saber_page_image` | 取原图 / 去字图 / 译图，落到临时目录 | ✅ | ❌ |
| `saber_terms` | 读/写术语表与禁翻表 | ✅ | ❌ |
| `saber_backend` | 启动 / 停止 / 状态（只停插件自己启动的进程） | ✅ | ✅ |

写操作按要求**直接执行、不逐次确认**；每个工具都会在结果里说明它实际做了什么。

## 配置

配置文件：`<DSH_HOME>/saber-plugin.config.json`（不存在时使用默认值）：

```json
{
  "baseUrl": "http://127.0.0.1:5000",
  "installPath": "D:/play/Saber-Translator-3.5.15-gpu",
  "dataDir": "",
  "autoStart": false,
  "apiFlavor": "auto",
  "requestTimeoutMs": 15000
}
```

环境变量覆盖：`SABER_BASE_URL`、`SABER_INSTALL_PATH`、`SABER_DATA_DIR`、`SABER_PLUGIN_CONFIG`。

- `autoStart: true` 时，工具发现后端未运行会尝试拉起 `installPath` 下的 `Saber-Translator.exe --role launcher ...` 并等待 `/api/v2/health`。
- 插件只停止**自己启动**的进程（记着 PID），不会动你在用的实例。
- API 版本自动探测：先探 `/api/v2/health`，再探 `/api/server-info`。

## 安装（本地 link 方式）

本包存放在 `D:\AI\DeepSeek\dsh2\plugins\saber-dsh-plugin`，通过 junction 链接进 dsh2 的 web profile：

```bash
# 1) 把本包 link 进 web profile
dsh plugin --profile web add link:"D:/AI/DeepSeek/dsh2/plugins/saber-dsh-plugin"

# 2) 把包名加入 profile 的 bundle 列表（profiles/web/package.json 的 dsh.profile.bundles）
#    "dsh-plugin-saber"

# 3) 重启 dsh web 后 tool 生效
```

> dsh2 的 pnpm 解析会卡在 `eac-design-world@0.5.0`（镜像上只剩 `0.0.0-stage`），
> 因此不要直接跑 `dsh plugin add`：改用手写依赖 + 指向本目录的 junction。

## 自测

```bash
# 打真实后端（只读工具；写工具不会执行）
node test/harness.mjs

# 用进程内 mock 的 /api/v2 验证完整 P1 链路（含写请求体、图片、术语表）
node test/mock-v2.mjs
```

`mock-v2.mjs` 会校验：JSON Schema 合法（`required` 必须是数组）、翻译请求体与 `Idempotency-Key`、
任务渲染、页面图片落盘、术语表读取。

## 随附技能（Skills）

- [`skills/github-push-ssh443/`](skills/github-push-ssh443/SKILL.md)：本机推送 GitHub 的可靠姿势
  （22 端口被封 → 走 `ssh.github.com:443`），含报错对照、仓库本地配置、验证命令，以及三条不能走的通道。
- [`docs/PUSH-NOTES.md`](docs/PUSH-NOTES.md)：同一主题的排查过程与结论，供维护者查阅。

插件安装到 DSH 后，`skills/` 随包分发；重启 dsh2 后可在会话技能列表中验证是否被加载。

## 设计约束

- 宿主半身**零运行时依赖**（不 import `@deepseek-ai/*`），避免污染 profile 的解析链。
- 工具 schema 在注册时自检：`required` 必须是对象层的字符串数组（属性上的布尔 `required`
  会让供应商拒绝**所有**工具调用）。
- 适配层 `adapters/v2.js` / `adapters/legacy.js` 隔离版本差异；工具层不感知具体 API 版本。
- 不支持的能力返回中文说明而不是抛 404 堆栈。
