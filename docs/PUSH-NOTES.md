# 推送备忘（PUSH-NOTES）

记录一次真实的踩坑与结论，供后续会话/维护者直接照做。

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
```

验证：

```bash
ssh -T -p 443 git@ssh.github.com          # 期望：Hi Luca-42! You've successfully authenticated...
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
