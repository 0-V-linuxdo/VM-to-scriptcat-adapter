# Violentmonkey Zip 转 ScriptCat 备份

这是一个独立转换器，用来把 Violentmonkey 导出的备份 zip 转成 ScriptCat 可导入的备份 zip。它不会改动 ScriptCat 的源码、配置、依赖或构建产物。

## 使用方式

在本仓库根目录运行：

```bash
node violentmonkey-to-scriptcat.mjs violentmonkey-backup.zip -o scriptcat-backup.zip
```

然后在 ScriptCat 现有的“导入文件”功能中导入 `scriptcat-backup.zip`。

本工具不需要安装 npm 依赖，只使用 Node.js 标准库和系统归档工具（`tar`/bsdtar、`zip`）。

## 转换内容

- `*.user.js` 脚本源码。
- `violentmonkey.scripts[name].config.enabled` 到 ScriptCat 脚本启用状态。
- `violentmonkey.scripts[name].position` 到 ScriptCat 脚本排序。
- `violentmonkey.scripts[name].lastUpdated` 到 ScriptCat 更新时间。
- `violentmonkey.scripts[name].config.shouldUpdate` 到 ScriptCat 更新检查配置。
- `violentmonkey.scripts[name].custom` 到脚本元数据覆盖项，包括 `match`、`include`、`exclude`、`excludeMatch`、`run-at`、`noframes`、`tag`、`downloadURL`、`updateURL` 和 `homepageURL`。
- `violentmonkey.values[uri]` 到 ScriptCat `.storage.json`，并使用 ScriptCat 的 `s/n/b/o` 数据编码。

对于 VM 的通配主机排除规则，例如 `*://*.example.com/*`，转换器会额外生成 `*://example.com/*`，避免裸域名页面在 ScriptCat 中没有被排除。

Violentmonkey 的全局 `settings` 不会转换，因为它不是脚本级数据，和 ScriptCat 系统配置没有稳定的一一对应关系。

## 测试

```bash
node --check violentmonkey-to-scriptcat.mjs
node test-converter.mjs
```
