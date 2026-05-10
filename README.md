# Violentmonkey Zip Adapter

This is a standalone converter. It does not modify ScriptCat source code,
configuration, dependencies, or build output.

## Usage

```bash
node violentmonkey-to-scriptcat.mjs violentmonkey-backup.zip -o scriptcat-backup.zip
```

Then import `scriptcat-backup.zip` with ScriptCat's existing "Import File" UI.

No npm dependencies are required. The converter uses Node.js plus macOS/system
archive tools (`tar`/bsdtar and `zip`).

## What Is Converted

- `*.user.js` script source files.
- `violentmonkey.scripts[name].config.enabled` into ScriptCat import settings.
- `violentmonkey.scripts[name].position` into ScriptCat import settings.
- `violentmonkey.scripts[name].custom` metadata overrides for match/include/exclude,
  run-at, noframes, tags, downloadURL, updateURL, and homepageURL.
- `violentmonkey.values[uri]` into ScriptCat `.storage.json` using ScriptCat's
  `s/n/b/o` value encoding.

Violentmonkey global settings are intentionally not converted because they are not
script-level data and do not have a stable one-to-one mapping to ScriptCat settings.

## Test

```bash
node test-converter.mjs
```
