# 独立更新分发

更新发布由工作区私有 `../nacho-update-server/` 和根目录 `../publish-update.ps1` 承担。此仓库只提供面板源码；服务端和 Agent 源码仍由 `nachomao/nacho-server` 提供。索引位于配置的 `NACHO_UPDATE_ORIGIN` 下的 `updates/{stable|beta|alpha}/index.json` 与 `.sig`，制品位于对应的 `artifacts/` 路径。

每次行为更新先推送源码并确认固定提交 SHA，然后在开发 Windows 设备使用菜单选择组件、频道、严格 X.Y.Z 版本及发布说明，通过 SSH/SFTP 上传 Windows 制品；Linux 服务端由更新服务器从固定 GitHub 提交构建。索引原子签名发布。首次发布须备齐三个组件；面板签名可选，有签名则指纹必须匹配，无签名只依赖经 Ed25519 验证的索引及制品哈希；私钥不匹配时停止。

旧公钥已经更换，已安装旧实例需人工安装含新公钥和更新服务器地址的过渡版本。当前目录的 `release-public.pem` 只包含新公钥；私钥只存于私有更新服务器的受限目录。无 Authenticode 证书也可按上述校验发布；没有已推送的对应源码及可验证制品前，线上发布仍待完成。
