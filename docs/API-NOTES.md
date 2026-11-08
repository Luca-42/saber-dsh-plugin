# Saber API 勘察笔记

记录时间：2026-11-08。目标：本机正在运行的 Saber 实例。

## 当前运行实例（P1 起）

| 项 | 值 |
|---|---|
| 版本 | **3.5.10（GPU 版，QQ 群分发包）** |
| 安装目录 | `D:\play\saber\Saber-Translator-3.5.10-gpu` |
| 进程 | 3 个 `Saber-Translator.exe`（desktop/launcher + api + worker） |
| 地址 | `http://127.0.0.1:5000`（**只绑 loopback**） |
| 健康 | `GET /api/v2/health` → `{status: ok, storageVersion: 3.5.2, role: api, epochId}` |
| 任务 | `GET /api/v2/jobs?scope=queue` → `workerOnline: true, queuePaused: false` |
| 旧接口 | `/api/server-info` 已 404（确认是 v2-only 后端） |

实测（2026-11-08 13:3x）：书架 1 本书《夜缚》/ 1 章 / 54 页；第 1 页已渲染可直接取译图；
任务队列为空。**结论：3.5.10 与 3.5.15 是同一套 `/api/v2` 结构，插件无需区分。**

## 旧运行实例（P0 阶段，已停用）

| 项 | 值 |
|---|---|
| 版本 | **3.3.6.2（CPU 版）** |
| 安装目录 | `D:\play\Saber-Translator-3.3.6.2-cpu` |
| 进程 | `Saber-Translator.exe`（单进程，Flask + 前端静态资源） |
| 地址 | `http://127.0.0.1:5000`（同时监听局域网 `192.168.31.109:5000`） |
| 健康探针 | `GET /api/server-info` → `{lan_ip, lan_url, local_url, port, success}` |

注意：仓库 main 分支是重构后的 v2 后端（`/api/v2/*`），**与本机 3.3.6.2 不是同一代**。
插件按运行实例的 API 面适配，并在探测到新接口时自动切换。

## 3.3.6.2 已验证可用的只读接口

| 接口 | 返回要点 |
|---|---|
| `GET /api/server-info` | 端口、本地/局域网 URL |
| `GET /api/bookshelf/books` | `books[]`：id、title、chapter_count、cover、tags、created_at、updated_at（epoch ms） |
| `GET /api/bookshelf/books?search=xxx` | 按书名过滤 |
| `GET /api/bookshelf/books/{bookId}` | `book`：章节数组（id/title/page_count/image_count/session_path）、total_pages、tags |
| `GET /api/bookshelf/books/{bookId}/chapters/{chapterId}/images` | `images[]` + `prev/next_chapter_id` |
| `GET /api/bookshelf/tags` | 标签列表（name/color） |
| `GET /api/plugins` | Saber 侧插件（v3 hook）：name/version/enabled/description |
| `GET /api/bookshelf/books/{bookId}/cover` | 封面图（二进制） |

## 3.3.6.2 存在、但属于写操作/翻译流程的接口（P1 再碰）

- `POST /api/parallel/detect|ocr|translate|inpaint|render` —— 按页并行处理
- `POST /api/sessions/page/`、`/api/sessions/save_translated/`、`/api/sessions/meta/`
- `POST /api/translate_single_text`、`/api/hq_translate_batch`
- `POST /api/ocr_single_bubble`、`/api/inpaint_single_bubble`、`/api/re_render_image`
- `POST /api/bookshelf/books`、`/chapters`、`/tags` 等增删改
- `POST /api/plugins/...`、`POST /api/web-import/...`

## 版本能力差异（关键）

| 能力 | 3.3.x（本机） | 3.5+（当前 Release） | v2 后端（main） |
|---|---|---|---|
| 书架 API | `/api/bookshelf/*` | `/api/bookshelf/*` | `/api/v2/content/*` |
| 任务队列 | ❌ 无（同步 + 会话） | ✅ 任务中心 | ✅ `jobs` + SSE |
| 任务暂停/恢复/取消 | ❌ | ✅ | ✅ |
| 健康接口 | `/api/server-info` | 待核 | `/api/v2/health` |

因此 `saber_jobs` 在 3.3.x 上返回能力说明，而不是报 404；P1 的写操作会先做版本探测再选适配器。

## 启动/生命周期约束（P1 用）

- 官方发布包是绿色版：解压目录 + `data-v2`（新版）或程序目录内数据（旧版）。
- 新版 API/Worker 需要 Launcher 下发 epoch 令牌才能启动；直接 `--role api` 需 `--test-mode`。
- 因此插件接管启动时应调用 `Saber-Translator.exe --role launcher ...`（或桌面程序），而不是裸起 API。
- 本机当前是 3.3.6.2，单进程运行；启动方式与新版不同，P1 需分别处理。

## 已发现的下载/安装事实（P2 用）

- Release 资产为分卷压缩：CPU 版 2 卷（约 3.66GB）、GPU 版 3 卷（约 5.31GB）、models 2 卷（约 3.44GB）。
- 每个资产在 GitHub Release API 里都带 `digest: sha256:...`，可直接做下载校验。
- 显卡判据：NVIDIA 且显存 ≥ 6GB（上游明确不建议 A 卡与 <6G 的 N 卡跑 GPU 版）。

## v2 后端（Saber 3.5+）契约摘要

来源：`openapi/v2.yaml`（tag v3.5.15，前缀 `/api/v2`）。

| 用途 | 接口 |
|---|---|
| 健康/身份 | `GET /health` → `{status: ok\|fenced, storageVersion, role}` |
| 服务信息 | `GET /system/server-info` → `{hostname, host, port, lanUrl}` |
| 能力 | `GET /system/capabilities` |
| 书架 | `GET /books?search=` → `{items: Book[]}` |
| 书详情 | `GET /books/{book_id}` → `BookDetail`（含 chapters/tags） |
| 章节 | `GET /books/{book_id}/chapters` → `{book, chapters}` |
| 页面 | `GET /chapters/{chapter_id}/pages?limit=&cursor=&all=1` → `{items: PageSummary[]}` |
| 单页 | `GET /pages/{page_id}` |
| 排翻译（单章） | `POST /chapters/{chapter_id}/translation-jobs` body `{config:{mode,executionMode,skipCompleted?}, pageIds?}` → 202 `{batchId, jobIds}` |
| 排翻译（批量） | `POST /translation-batches` body `{chapterIds?|bookIds?, config}` → 202 `{batchId, jobIds, skipped[]}` |
| 任务列表 | `GET /jobs?scope=queue\|history\|all&status=&type=&book_id=&limit=` → `{items, queuePaused, workerOnline, executorBusy, eventCursor}` |
| 任务详情 | `GET /jobs/{job_id}` → `JobDetail`（counts / items / failedItems / artifacts / recentEvents） |
| 任务控制 | `POST /jobs/{job_id}/pause\|resume\|cancel\|retry\|retry-failed\|continue` |
| 队列控制 | `POST /jobs/queue/pause\|resume`、`POST /jobs/cancel-queued` |
| 事件流 | `GET /jobs/events`（SSE，可续传：`Last-Event-ID` / `after`） |
| 术语/禁翻 | `GET/PUT /books/{book_id}/translation-constraints`（乐观 revision） |
| 页面图片 | `PageSummary.sourceUrl / cleanUrl / translatedUrl`（相对 URL，可直接 GET 二进制） |

关键枚举：

- `mode`: standard / hq / proofread / remove_text
- `executionMode`: sequential / parallel
- `JobStatus`: queued / running / paused / cancelled / completed / completed_with_errors / failed / interrupted

启动约束：v2 的 API/Worker 需要 Launcher 下发的 epoch 身份，插件通过
`Saber-Translator.exe --role launcher --host 127.0.0.1 --port <p> [--data-dir <d>] --no-browser`
启动，再轮询 `/api/v2/health` 等待就绪。

