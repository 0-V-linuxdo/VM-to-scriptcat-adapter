# Violentmonkey 备份转 ScriptCat 备份

把 Violentmonkey 导出的备份 zip，转成 ScriptCat 可直接导入的备份 zip。
转换器独立运行，不改动 ScriptCat 的源码、配置、依赖或构建产物。

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

| 内容 | 实现 | 直接导入 | 转换后导入 |
| --- | --- | --- | --- |
| 启用状态 | `config.enabled` -> `settings.enabled` | ✅ 保持！ | ✅ 保持，并写入标准备份字段！ |
| 脚本排序 | `position` -> `settings.position` | ❌ 丢失！ | ✅ 保留！ |
| 更新时间 | `lastUpdated/lastModified` -> `meta.modified` | ❌ 丢失！ | ✅ 保留！ |
| 更新检查配置 | `shouldUpdate` -> `options.check_for_updates` | ❌ 丢失！ | ✅ 写入备份文件！当前 ScriptCat 导入页暂不应用。 |
| 自定义元数据 | `custom` -> 脚本 metadata | ❌ 丢失！ | ✅ 写回 metadata 后导入！ |
| GM 数据与 UserConfig 已保存值 | `values[uri]` -> `.storage.json` | ❌ 丢失！ | ✅ 导入！ |
| 通配主机排除规则 | `*://*.example.com/*` -> 额外生成 `*://example.com/*` | ❌ 漏掉裸域名！ | ✅ 同时保留子域名和裸域名！ |

Violentmonkey 的全局 `settings` 不会转换，因为它不是脚本级数据，和 ScriptCat 系统配置没有稳定的一一对应关系。

## 测试

```bash
node --check violentmonkey-to-scriptcat.mjs
node test-converter.mjs
```
