---
name: github-push-ssh443
description: "在这台机器（中国网络、GitHub 22 端口被封、DSH git-push 插件默认通道会改写地址）上可靠地推送代码到 GitHub。当 git push / git_commit_push 报 Repository not found、Git Repository is empty、Permission denied (publickey)，或需要给空仓库做首次推送、需要判断该用 SSH 还是 token 时使用。包含可复制的 origin 与 core.sshCommand 配置、验证命令、以及三条不能走的通道及原因。"
license: MIT
metadata:
  version: "1.0"
  author: Luca-42
---

# GitHub 推送（SSH 443 通道）

本机的 GitHub 直连不可用：**22 端口被拒**，`gh-proxy` 镜像只支持下载。
可靠方案是走 GitHub 的 443 专用 SSH 入口 `ssh.github.com`。

## 先看报错，对症处理

| 报错 | 真实原因 | 处理 |
|---|---|---|
| `remote: Repository not found` | 多半不是仓库不存在：地址被改写成 `gh-proxy.com/...`，而它不支持 push | 换 SSH 443 地址 |
| `Git Repository is empty` | 插件 API 通道无法给空仓库开第一个提交 | 用 git CLI / SSH 推 |
| `Permission denied (publickey)` | 22 端口被拒，或公钥没登记到该账号 | 走 443；确认公钥已加到账号 |
| `Authentication failed` | token 缺 `Contents: Read and write`，或仓库不在 token 的仓库列表里 | 补权限 / 改用 SSH |

## 标准步骤

### 1. 确认账号与钥匙

先跑 `git_account_check`（DSH git-push 插件工具），确认：

- 登录账号正确；
- `sshStatus.valid === true`（返回 `Hi <user>! You've successfully authenticated`）。

若 SSH 未通过：生成密钥（`git_gen_ssh_key`），把公钥贴到
<https://github.com/settings/ssh/new>，再用 443 验证：

```bash
ssh -T -p 443 -i "<密钥路径>" -o IdentitiesOnly=yes git@ssh.github.com
```

密钥默认在 `D:\AI\DeepSeek\DSH_HOME\git-push\id_rsa`（随插件安装位置变化）。

### 2. 仓库本地配置（一次配好，长期有效）

```bash
git remote set-url origin ssh://git@ssh.github.com:443/<owner>/<repo>.git
git config core.sshCommand "ssh -p 443 -i 'D:/AI/DeepSeek/DSH_HOME/git-push/id_rsa' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
```

这两条写进**仓库本地配置**，不依赖会话、不依赖插件当前状态。

### 3. 推送与验证

```bash
git push -u origin main        # 或 git push
git ls-remote origin           # 应列出 refs/heads/main
git status -sb                 # 应为 ## main...origin/main
```

DSH 里也可直接用 `git_commit_push`（SSH 配好后它会优先走 SSH）。

## 不要用的三条通道

1. **插件默认 push（HTTPS + gh-proxy 镜像）**：镜像只读，push 必失败，且报错有误导性。
2. **插件 API 推送通道推空仓库**：不会创建首个提交。
3. **token 直推（备份方案）**：能用，但 origin 必须写成 `https://<user>@github.com/...`
   以绕开镜像改写，且 token 需 `Contents: Read and write`。

## 备份方案：token 直推

```bash
git remote set-url origin https://<user>@github.com/<owner>/<repo>.git
git push -u origin main
```

前提：fine-grained token 的 **Contents** 设为 Read and write，Repository access 选
**All repositories**（只选部分仓库时，新建仓库不在白名单里，同样会被拒）。

## 收尾检查

- `git ls-remote origin` 能看到新的 commit；
- `git status -sb` 显示 `## main...origin/main`（无 ahead/behind）；
- 若同时存在多个 remote，确认 `git remote -v` 里 origin 指向的是 SSH 443 地址，避免下次推错。
