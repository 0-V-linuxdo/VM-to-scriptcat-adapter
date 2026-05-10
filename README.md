# Violentmonkey Zip 转 ScriptCat 备份

这是一个独立转换器，用来把 Violentmonkey 导出的备份 zip 转成 ScriptCat 可导入的备份 zip。它不会改动 ScriptCat 的源码、配置、依赖或构建产物。

## 使用方式

在本仓库根目录运行：

```bash
node violentmonkey-to-scriptcat.mjs violentmonkey-backup.zip -o scriptcat-backup.zip
```

然后在 ScriptCat 现有的“导入文件”功能中导入 `scriptcat-backup.zip`。

本工具不需要安装 npm 依赖，只使用 Node.js 标准库和系统归档工具（`tar`/bsdtar、`zip`）。

## 输出结构

转换器会把 VM 备份整理成 ScriptCat 备份导入使用的同名文件组：

- `${name}.user.js`：脚本源码。
- `${name}.options.json`：脚本选项与导入设置。
- `${name}.storage.json`：脚本 GM 数据。

## 转换内容

这里的“直接导入”指不经过本工具，直接把 Violentmonkey 原始备份 zip 交给 ScriptCat 的“导入文件”功能。

| 内容 | 介绍 | 直接导入 VM zip | 转换后导入 |
| --- | --- | --- | --- |
| 启用状态 | 将 `violentmonkey.scripts[name].config.enabled` 写入 ScriptCat `.options.json` 的 `settings.enabled`。 | ScriptCat 会读取 VM 的禁用状态，并通过 `item.enabled = false` 临时标记让普通用户脚本保持禁用。 | 启用/禁用值写入 ScriptCat 备份字段 `settings.enabled`，不依赖 VM 兼容分支的临时标记。 |
| 脚本排序 | 将 `violentmonkey.scripts[name].position` 写入 ScriptCat `.options.json` 的 `settings.position`。 | ScriptCat 不读取 VM 的 `position`。 | 导入页会把 `settings.position` 写入脚本 `sort`。 |
| 更新时间 | 用 `violentmonkey.scripts[name].lastUpdated` 或 `lastModified` 设置输出文件修改时间，并写入 `.options.json` 的 `meta.modified`。 | ScriptCat 不读取 VM 的 `lastUpdated` 字段，只使用 zip 中 `.user.js` 文件的修改时间作为脚本创建/更新时间。 | 转换器先把 VM 更新时间写成输出 `.user.js` 的文件修改时间，导入时进入脚本创建/更新时间；`meta.modified` 同时保留在备份文件中。 |
| 更新检查配置 | 将 `violentmonkey.scripts[name].config.shouldUpdate` 写入 ScriptCat `.options.json` 的 `options.check_for_updates`。 | ScriptCat 不读取 VM 的 `shouldUpdate`。 | 字段保留在 ScriptCat 备份结构中；当前 ScriptCat 导入页不应用 `options.check_for_updates`。 |
| 自定义元数据 | 将 `violentmonkey.scripts[name].custom` 合并进源码 metadata，包括 `match`、`include`、`exclude`、`excludeMatch`、`run-at`、`noframes`、`tag`、`downloadURL`、`updateURL` 和 `homepageURL`。 | ScriptCat 只解析 `.user.js` 源码里的 metadata，不读取 VM `custom`。 | VM 设置页里的自定义规则会先写回源码 metadata，再由 ScriptCat 按普通 metadata 解析。 |
| GM 数据与 UserConfig 已保存值 | 将 `violentmonkey.values[uri]` 写入 ScriptCat `.storage.json`，并使用 ScriptCat 的 `s/n/b/o` 数据编码。 | ScriptCat 不读取 VM `values`。 | 导入页会读取 `.storage.json`，解码后写入 ScriptCat storage。 |
| 通配主机排除规则 | 对 `*://*.example.com/*` 这类 VM 排除规则，额外生成 `*://example.com/*`。 | ScriptCat URL 匹配会把含 `*.` 的 `@exclude` 保留为 glob，裸域名 `https://example.com/` 不被这条 glob 覆盖。 | 同时生成子域名规则和裸域名规则，覆盖 `https://example.com/`。 |

Violentmonkey 的全局 `settings` 不会转换，因为它不是脚本级数据，和 ScriptCat 系统配置没有稳定的一一对应关系。

## 测试

```bash
node --check violentmonkey-to-scriptcat.mjs
node test-converter.mjs
```
