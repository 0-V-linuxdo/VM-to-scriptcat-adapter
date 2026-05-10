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

这里的“直接导入”指不经过本工具，直接把 Violentmonkey 原始备份 zip 交给 ScriptCat 的“导入文件”功能。

| 内容 | 介绍 | 与直接导入的区别 |
| --- | --- | --- |
| `*.user.js` 脚本源码 | 复制 VM 备份中的用户脚本源码，并按 ScriptCat 支持的导入文件名输出。 | VM 原始备份不是 ScriptCat 备份结构；转换后每个脚本都有 ScriptCat 可识别的 `${name}.user.js`。 |
| 启用状态 | 将 `violentmonkey.scripts[name].config.enabled` 写入 ScriptCat `.options.json`。 | 直接导入不解析 `violentmonkey.scripts[name].config.enabled`，因此不会把 VM 的启用/禁用状态写入 ScriptCat。 |
| 脚本排序 | 将 `violentmonkey.scripts[name].position` 写入 ScriptCat `.options.json`。 | 直接导入不解析 `violentmonkey.scripts[name].position`，因此不会恢复 VM 的脚本排序。 |
| 更新时间 | 将 `violentmonkey.scripts[name].lastUpdated` 写入 ScriptCat `.options.json`。 | 直接导入不解析 `violentmonkey.scripts[name].lastUpdated`，因此不会保留 VM 记录的脚本更新时间。 |
| 更新检查配置 | 将 `violentmonkey.scripts[name].config.shouldUpdate` 写入 ScriptCat `.options.json`。 | 直接导入不解析 `violentmonkey.scripts[name].config.shouldUpdate`，因此不会恢复 VM 的单脚本更新检查开关。 |
| 自定义元数据 | 将 `violentmonkey.scripts[name].custom` 合并到 metadata，包括 `match`、`include`、`exclude`、`excludeMatch`、`run-at`、`noframes`、`tag`、`downloadURL`、`updateURL` 和 `homepageURL`。 | 直接导入不解析 `violentmonkey.scripts[name].custom`，因此不会应用 VM 设置页里改过的匹配、排除、运行时机和更新地址。 |
| GM 数据与 UserConfig 已保存值 | 将 `violentmonkey.values[uri]` 写入 ScriptCat `.storage.json`，并使用 ScriptCat 的 `s/n/b/o` 数据编码。 | 直接导入不解析 `violentmonkey.values[uri]`，因此不会生成 ScriptCat `.storage.json`，脚本 GM value 与 UserConfig 已保存值不会进入 ScriptCat storage。 |
| 通配主机排除规则 | 对 `*://*.example.com/*` 这类 VM 排除规则，额外生成 `*://example.com/*`。 | 直接导入不执行这层兼容展开；转换后同时存在子域名规则和裸域名规则。 |

Violentmonkey 的全局 `settings` 不会转换，因为它不是脚本级数据，和 ScriptCat 系统配置没有稳定的一一对应关系。

## 测试

```bash
node --check violentmonkey-to-scriptcat.mjs
node test-converter.mjs
```
