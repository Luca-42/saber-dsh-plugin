# 推送与发布备忘（PUSH-NOTES）

记录 Git 推送与 npm 发布的真实踩坑与结论，供后续会话/维护者直接照做。

## 结论：用 SSH（443 端口）推

本机 **22 端口被封**，`git@github.com` 直连会 `Connection refused`。
GitHub 提供 443 专用入口：`ssh.github.com:443`。

插件与 key 已经配好，仓库 origin 建议写成：

```
ssh://git@ssh.github.com:443/Luca-42/saber-dsh-plugin.git
```

设置命令：

```bash
git remote set-url origin ssh://git@ssh.github.com:443/Luca-42/saber-dsh-plugin.git
git config core.sshCommand "ssh -p 443 -i 'D:/AI/DeepSeek/DSH_HOME/git-push/id_rsa' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
```

私钥由插件生成并托管在 `D:\AI\DeepSeek\DSH_HOME\git-push\id_rsa`（不随仓库分发）。
上面两条都写进**仓库本地配置**后，任何会话里直接 `git push` 都能用，无需再折腾插件通道。

验证：

```bash
ssh -T -p 443 -i "D:/AI/DeepSeek/DSH_HOME/git-push/id_rsa" -o IdentitiesOnly=yes git@ssh.github.com
# 期望：Hi Luca-42! You've successfully authenticated...
git ls-remote origin                       # 期望：列出 refs/heads/main
```

## 不要用这三条路（都会失败）

1. **插件默认 push 通道（HTTPS + gh-proxy 镜像）**
   插件会给 git 注入 `url.<gh-proxy>/https://github.com.insteadOf`，而 gh-proxy **只支持下载、不支持 push**，
   报错是 `remote: Repository not found`（具有误导性，仓库其实存在）。
2. **插件 API 推送通道打空仓库**
   全新空仓库报 `Git Repository is empty`：该通道不会创建第一个提交。
3. **token 直推**
   可以成功，但要求 origin 写成 `https://<user>@github.com/...` 形式（绕开镜像改写），
   且 token 需要 `Contents: Read and write`；比 SSH 麻烦，仅作备份方案。

## 备份方案（token 直推）

```bash
git remote set-url origin https://Luca-42@github.com/Luca-42/saber-dsh-plugin.git
git push -u origin main
```

前提：fine-grained token 已授予 **Contents: Read and write**，Repository access 选 **All repositories**。

## 日常流程

1. 改代码 → 跑 `node test/mock-v2.mjs` 与 `node test/harness.mjs`；
2. `code_audit` 无 blocker（本仓库历史分 92.0/A）；
3. 提交并推送：优先 `git push`（origin 已是 SSH 443 地址）；
4. 不要在新会话里改用插件默认推送通道，除非确认上述两个 bug 已修。

## 已知插件侧问题（如需上游反馈）

- gh-proxy 镜像改写被用于 push 通道，导致 push 必然失败；
- API 推送通道无法初始化空仓库（首个提交）；
- `git_account_check` 能正确识别 SSH，但普通 `git push` 走 SSH 时需要 443 入口。

## npm 发布（2026-11-08 实测：dsh-plugin-saber@0.2.0）

### 前置条件

- 账号开启 2FA 时，普通 granular token 发布会报
  `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`。
  解决：token 勾上 **Bypass 2FA**，或使用 classic **Automation** token（天生免 2FA）。
- 本机默认 registry 是 npmmirror（`npm config get registry`），发布必须显式指定官方源；
  包内已加 `publishConfig.registry` 兜底。

### 认证：临时 userconfig（用完即删）

`--userconfig` 必须用 **Windows 路径**：Git Bash 的 `/tmp`、MSYS 风格路径 npm 不认，
会把配置当不存在，表现为 `need auth`。文件权限 0600，token 不要落进仓库或文档。

```bash
RC="C:/Users/<user>/AppData/Local/Temp/dsh-npmrc"
umask 077
printf 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$RC"

npm --userconfig "$RC" --registry=https://registry.npmjs.org/ whoami
npm --userconfig "$RC" --registry=https://registry.npmjs.org/ publish --dry-run
npm --userconfig "$RC" --registry=https://registry.npmjs.org/ publish
rm -f "$RC"
```

### 首次发布的两个坑

1. **staged 占位版本**：npm 首次发布新包会先创建 `0.0.0-stage`
   （描述 “Temporary package placeholder for staged publishing”），真正的版本稍后才出现。
   **registry 暂时只显示 `0.0.0-stage` 不代表失败**——先等几分钟再查，不要立刻重发
   （重发会报 `You cannot publish over the previously published versions`）。
2. **占位版本删不掉**：用 bypass-2FA 的 granular token 执行
   `npm unpublish <pkg>@0.0.0-stage` 会报
   `Granular access tokens that bypass two-factor authentication may not perform this action`。
   只能去 npm 网站手动删（72 小时内），或留着不管（不影响 `latest`）。

补充：本机 npm 是 10.9.2，**没有 `npm stage` 子命令**。要看/批准 staged 版本（npm 11+ 的能力）用：

```bash
npx -y npm@11 stage list [<pkg>]
npx -y npm@11 stage approve <stage-id>
```

### 发布前检查

- `package.json` 去掉 `private: true`（npm 直接拒绝 private 包）；
- `npm publish --dry-run` 核对 tarball 清单（本包 18 files / 23.4 KB / 零依赖）；
- `repository.url` 写成 `git+https://...`，避免 npm 自动纠正的 warning；
- 元数据确认：

```bash
curl -s https://registry.npmjs.org/<pkg>/<version> \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.dist.tarball,j.dist.shasum,JSON.stringify(j.dsh))})"
```

### 发布后

- 打 tag 并推送：`git tag -a v0.2.0 -m "..." && git push origin v0.2.0`；
- README 补 npm 安装方式与徽章；
- **token 一旦出现在聊天、日志或临时文件里就视为已泄露，立即去 npm 轮换**。

## 插件市场索引与仓库公开（2026-11-08）

### 市场索引文件

DSH 插件市场是一个静态 JSON 索引，指向 npm 包或 Git 仓库版本。

- 索引位置：`docs/index.json`（配合 GitHub Pages 的 `/docs` 发布目录）
- 图标：`docs/icon.svg`，索引里写相对路径 `icon.svg`——**相对索引 URL 解析**
- 插件条目：`name` 必须与 npm 包名一致；`versions[].source` 写 `{ "type": "npm" }`
- `publishTimestamp` 用 npm registry 里该版本的发布时间（秒级 epoch），
  由 `https://registry.npmjs.org/<pkg>` 的 `time[version]` 换算
- `engines.dsh` 可选；写了就要与包自身声明一致，否则安装器会拒。本包未声明，索引里同样省略
- 约束：索引 ≤128 MiB、返回 2xx、不经重定向；DSH 只校验格式，不校验内容真伪

### 转公开（Pages 与 npm 源码链接的前提）

GitHub → 仓库 → **Settings → General → Danger Zone → Change visibility → Make public**

- 私有仓库**无法使用免费 GitHub Pages**（私有 Pages 需要 Pro 及以上）
- npm 包页面的源码链接、市场索引地址也都要求仓库公开可读
- 验证：

```bash
curl -s https://api.github.com/repos/Luca-42/saber-dsh-plugin | grep -E '"(visibility|private)"'
# 期望：visibility "public" / private false
```

### 启用 GitHub Pages

仓库 → **Settings → Pages** → Source: **Deploy from a branch** →
Branch: `main`，Folder: **/docs** → Save

1~2 分钟后索引地址为：

```
https://luca-42.github.io/saber-dsh-plugin/index.json
```

验证：

```bash
curl -s https://luca-42.github.io/saber-dsh-plugin/index.json | head -3
# 期望：{ "format": 1, ...
```

### 在 DSH 里添加索引

插件页 → **发现** → **添加索引源** → 粘贴上面的 URL → 浏览并安装。

### 索引相关的坑

- 转公开前不要指望 Pages 能访问；先公开再开 Pages。
- Pages 有 CDN 缓存，改完索引要 push 并等一两分钟。
- DSH 端也会缓存索引；看不到更新时重新添加索引源或重启 dsh。
- `icon` 用相对路径时不要写成 `/icon.svg`（会从 Pages 根解析，404）。
- 版本条目要一个个加；发新版后同步更新 `versions` 与 `publishTimestamp`。
