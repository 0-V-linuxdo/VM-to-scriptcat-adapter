#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ZIP_BIN = "/usr/bin/zip";
const TAR_BIN = "/usr/bin/tar";
const TMP_ROOT = "/private/tmp";
const TMP_PREFIX = "scriptcat-vm-adapter-";
const USER_JS_SUFFIX = ".user.js";
const VM_MANIFEST_NAME = "violentmonkey";

const HEADER_BLOCK = /\/\/[ \t]*==UserScript==([\s\S]+?)\/\/[ \t]*==\/UserScript==/m;
const META_LINE = /^\s*\/\/[ \t]*@(\S+)[ \t]*(.*)$/;

const META_APPEND_ORDER = [
  "match",
  "include",
  "exclude",
  "run-at",
  "noframes",
  "tag",
  "downloadurl",
  "updateurl",
  "homepageurl",
];

const META_CANONICAL = {
  match: "match",
  include: "include",
  exclude: "exclude",
  "run-at": "run-at",
  noframes: "noframes",
  tag: "tag",
  downloadurl: "downloadURL",
  updateurl: "updateURL",
  homepageurl: "homepageURL",
};

export function encodeVmFilename(name) {
  return name.replace(/[-\\/:*?"<>|%\s]/g, (ch) => {
    const code = ch.charCodeAt(0).toString(16);
    return `-${code.length < 2 ? `0${code}` : code}`;
  });
}

export function toScriptCatStorageValue(value) {
  switch (typeof value) {
    case "string":
      return `s${value}`;
    case "number":
      return `n${value}`;
    case "boolean":
      return `b${value}`;
    default:
      try {
        return `o${JSON.stringify(value)}`;
      } catch {
        return "";
      }
  }
}

export function parseUserscriptMetadata(code) {
  const block = HEADER_BLOCK.exec(code);
  if (!block) return {};

  const metadata = {};
  for (const line of block[0].split(/\r?\n/)) {
    const match = META_LINE.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2]?.trim() ?? "";
    (metadata[key] ||= []).push(value);
  }
  return metadata;
}

export function getVmNameUri(metadata, fallbackId = "") {
  const namespace = firstMeta(metadata, "namespace") || "";
  const name = firstMeta(metadata, "name") || "";
  let uri = encodeVmFilename(`${namespace}\n${name}\n`);
  if (!namespace && !name && fallbackId) uri += fallbackId;
  return uri;
}

export async function convertViolentmonkeyZip(inputZip, outputZip, opts = {}) {
  const logger = opts.logger || console;
  assertTool(TAR_BIN);
  assertTool(ZIP_BIN);

  const input = path.resolve(inputZip);
  const output = path.resolve(outputZip);
  const tmpParent = existsSync(TMP_ROOT) ? TMP_ROOT : os.tmpdir();
  const tmpDir = await mkdtemp(path.join(tmpParent, TMP_PREFIX));
  const outputDir = path.join(tmpDir, "output");

  try {
    const entries = await listZipEntries(input);
    const manifestEntry = entries.find((entry) => path.basename(entry).toLowerCase() === VM_MANIFEST_NAME);
    if (!manifestEntry) {
      throw new Error("No `violentmonkey` manifest found in the zip.");
    }

    const vm = JSON.parse(await readZipEntryText(input, manifestEntry));
    const scripts = isPlainObject(vm.scripts) ? vm.scripts : {};
    const values = isPlainObject(vm.values) ? vm.values : {};
    const userScriptEntries = entries
      .filter((entry) => path.basename(entry).endsWith(USER_JS_SUFFIX))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

    if (!userScriptEntries.length) {
      throw new Error("No `.user.js` files found in the zip.");
    }

    await mkdir(outputDir, { recursive: true });

    const usedOutputNames = new Set();
    let converted = 0;
    let warnings = 0;

    for (const scriptEntry of userScriptEntries) {
      const sourceBase = path.basename(scriptEntry, USER_JS_SUFFIX);
      const rawCode = await readZipEntryText(input, scriptEntry);
      const rawMetadata = parseUserscriptMetadata(rawCode);
      const vmScript = resolveVmScript(scripts, sourceBase, rawMetadata);
      const mergedCode = applyViolentmonkeyCustom(rawCode, vmScript.custom);
      const metadata = parseUserscriptMetadata(mergedCode);
      const outputBase = makeUniqueOutputBase(sourceBase, metadata, usedOutputNames);
      const modifiedTime = getModifiedTime(vmScript, Date.now());
      const storageData = resolveVmValues({
        values,
        metadata,
        vmScript,
        sourceBase,
        logger,
      });

      if (!firstMeta(metadata, "name")) {
        logger.warn(`[warn] ${sourceBase}: missing @name; ScriptCat will likely reject this script.`);
        warnings += 1;
      }

      if (Object.keys(storageData).length === 0 && Object.keys(values).length > 0) {
        logger.warn(`[warn] ${sourceBase}: no matching Violentmonkey GM values were found.`);
        warnings += 1;
      }

      const finalMetadata = parseUserscriptMetadata(mergedCode);
      const options = buildScriptCatOptions({
        metadata: finalMetadata,
        scriptBase: sourceBase,
        vmScript,
        modifiedTime,
      });
      const storage = {
        data: encodeStorageObject(storageData),
        ts: modifiedTime,
      };

      await writeOutputFile(outputDir, `${outputBase}.user.js`, mergedCode, modifiedTime);
      await writeOutputFile(outputDir, `${outputBase}.options.json`, `${JSON.stringify(options, null, 2)}\n`, modifiedTime);
      await writeOutputFile(outputDir, `${outputBase}.storage.json`, `${JSON.stringify(storage, null, 2)}\n`, modifiedTime);
      converted += 1;
    }

    await mkdir(path.dirname(output), { recursive: true });
    await rm(output, { force: true });
    await run(ZIP_BIN, ["-qr", output, "."], { cwd: outputDir });
    logger.log(`Converted ${converted} script(s) to ${output}`);
    if (warnings > 0) logger.warn(`Finished with ${warnings} warning(s).`);
    return { converted, warnings, output };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = [...argv];
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    return { help: true };
  }

  const input = args.shift();
  let output = "";
  while (args.length) {
    const arg = args.shift();
    if (arg === "-o" || arg === "--output") {
      output = args.shift() || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!input) throw new Error("Missing input zip path.");
  if (!output) {
    const parsed = path.parse(input);
    output = path.join(parsed.dir, `${parsed.name}-scriptcat.zip`);
  }
  return { input, output };
}

function usage() {
  return [
    "Usage:",
    "  node vmzip-adapter/violentmonkey-to-scriptcat.mjs input-vm.zip -o output-scriptcat.zip",
    "",
    "Converts a Violentmonkey backup zip into a ScriptCat-compatible backup zip.",
  ].join("\n");
}

function assertTool(file) {
  if (!existsSync(file)) throw new Error(`Required tool not found: ${file}`);
}

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 * 64, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr || stdout || ""}`;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function listZipEntries(zipPath) {
  const listing = await run(TAR_BIN, ["-tf", zipPath]);
  const entries = listing.split(/\r?\n/).filter(Boolean);
  for (const entry of listing.split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replace(/\\/g, "/");
    const parts = normalized.split("/");
    if (normalized.startsWith("/") || parts.includes("..")) {
      throw new Error(`Unsafe zip entry path: ${entry}`);
    }
  }
  return entries;
}

async function readZipEntryText(zipPath, entry) {
  return run(TAR_BIN, ["-xOf", zipPath, escapeTarPattern(entry)]);
}

function escapeTarPattern(entry) {
  return entry.replace(/([\\[\]*?])/g, "\\$1");
}

function parseMetaBlock(code) {
  const match = HEADER_BLOCK.exec(code);
  if (!match) return undefined;
  return {
    index: match.index,
    text: match[0],
    eol: match[0].includes("\r\n") ? "\r\n" : "\n",
  };
}

export function applyViolentmonkeyCustom(code, custom) {
  if (!isPlainObject(custom)) return code;
  const block = parseMetaBlock(code);
  if (!block) return code;

  const metadata = parseUserscriptMetadata(code);
  const changes = new Map();

  setListChange(changes, metadata, custom, "match", "origMatch", "match");
  setListChange(changes, metadata, custom, "include", "origInclude", "include");
  setListChange(changes, metadata, custom, "exclude", "origExclude", "exclude");
  setListChange(changes, metadata, custom, "excludeMatch", "origExcludeMatch", "exclude", {
    append: true,
    expandValues: expandWildcardHostExcludes,
  });
  setListChange(changes, metadata, custom, "tag", "origTag", "tag");

  const runAt = firstString(custom.runAt ?? custom.run_at);
  if (runAt) changes.set("run-at", [runAt]);

  if (Object.hasOwn(custom, "noframes")) {
    changes.set("noframes", asBool(custom.noframes, false) ? [""] : []);
  }

  const downloadUrl = firstString(custom.downloadURL ?? custom.downloadUrl);
  if (downloadUrl) changes.set("downloadurl", [downloadUrl]);

  const updateUrl = firstString(custom.updateURL ?? custom.updateUrl);
  if (updateUrl) changes.set("updateurl", [updateUrl]);

  const homepageUrl = firstString(custom.homepageURL ?? custom.homepageUrl);
  if (homepageUrl) changes.set("homepageurl", [homepageUrl]);

  if (changes.size === 0) return code;
  return rebuildMetaBlock(code, block, changes);
}

function setListChange(changes, metadata, custom, customKey, origKey, metaKey, options = {}) {
  if (!Object.hasOwn(custom, customKey) && !Object.hasOwn(custom, origKey)) return;
  const rawCustomValues = toStringArray(custom[customKey]);
  const customValues =
    typeof options.expandValues === "function" ? options.expandValues(rawCustomValues) : rawCustomValues;
  const originalValues =
    options.append && changes.has(metaKey)
      ? changes.get(metaKey)
      : asBool(custom[origKey], true)
        ? metadata[metaKey] || []
        : [];
  changes.set(metaKey, uniqueStrings([...originalValues, ...customValues]));
}

function expandWildcardHostExcludes(values) {
  const ret = [];
  for (const value of values) {
    ret.push(value);
    const bareHostValue = toBareHostMatchPattern(value);
    if (bareHostValue) ret.push(bareHostValue);
  }
  return uniqueStrings(ret);
}

function toBareHostMatchPattern(value) {
  const match = /^(\*|[-a-z]+|http\*):\/\/\*\.([^*/:?#]+)(\/.*)?$/i.exec(value);
  if (!match) return "";
  const [, scheme, host, pathPart] = match;
  if (!host || /[*?]/.test(host)) return "";
  return `${scheme}://${host}${pathPart || "/*"}`;
}

function rebuildMetaBlock(code, block, changes) {
  const lines = block.text.split(/\r?\n/);
  const header = lines[0];
  const footer = lines[lines.length - 1];
  const body = lines.slice(1, -1);
  const prefix = findMetaPrefix(body);
  const changedKeys = new Set(changes.keys());
  const keptBody = body.filter((line) => {
    const match = META_LINE.exec(line);
    if (!match) return true;
    return !changedKeys.has(match[1].toLowerCase());
  });
  const appended = [];

  for (const key of META_APPEND_ORDER) {
    if (!changes.has(key)) continue;
    const values = changes.get(key);
    for (const value of values) {
      const tag = META_CANONICAL[key] || key;
      appended.push(`${prefix}@${tag}${value ? ` ${value}` : ""}`);
    }
  }

  const newBlock = [header, ...trimTrailingBlankLines(keptBody), ...appended, footer].join(block.eol);
  return `${code.slice(0, block.index)}${newBlock}${code.slice(block.index + block.text.length)}`;
}

function findMetaPrefix(lines) {
  for (const line of lines) {
    const match = /^(\s*\/\/[ \t]*)@\S+/.exec(line);
    if (match) return match[1];
  }
  return "// ";
}

function trimTrailingBlankLines(lines) {
  const ret = [...lines];
  while (ret.length && ret[ret.length - 1].trim() === "") ret.pop();
  return ret;
}

function buildScriptCatOptions({ metadata, scriptBase, vmScript, modifiedTime }) {
  const config = isPlainObject(vmScript.config) ? vmScript.config : {};
  const checkForUpdates = asBool(config.shouldUpdate ?? vmScript.update, true);
  const runAt = firstMeta(metadata, "run-at") || "document-idle";
  const noframes = metadata.noframes ? true : null;
  const downloadUrl = firstMeta(metadata, "downloadurl") || "";
  const updateUrl = firstMeta(metadata, "updateurl") || "";

  return {
    options: {
      check_for_updates: checkForUpdates,
      comment: null,
      compat_foreach: false,
      compat_metadata: false,
      compat_prototypes: false,
      compat_wrappedjsobject: false,
      compatopts_for_requires: true,
      noframes,
      override: {
        merge_connects: true,
        merge_excludes: true,
        merge_includes: true,
        merge_matches: true,
        orig_connects: metadata.connect || [],
        orig_excludes: metadata.exclude || [],
        orig_includes: metadata.include || [],
        orig_matches: metadata.match || [],
        orig_noframes: noframes,
        orig_run_at: runAt,
        use_blockers: [],
        use_connects: [],
        use_excludes: [],
        use_includes: [],
        use_matches: [],
      },
      run_at: firstMeta(metadata, "run-at") || null,
    },
    settings: {
      enabled: asBool(config.enabled ?? vmScript.enabled, true),
      position: numberOr(vmScript.position ?? vmScript.props?.position, 0),
    },
    meta: {
      name: firstMeta(metadata, "name") || scriptBase,
      uuid: "",
      sc_uuid: "",
      modified: modifiedTime,
      file_url: downloadUrl || updateUrl,
    },
  };
}

function resolveVmValues({ values, metadata, vmScript, sourceBase, logger }) {
  const exactKey = getVmNameUri(metadata, vmScript.props?.id);
  if (exactKey && isPlainObject(values[exactKey])) return values[exactKey];

  const fallbackKeys = uniqueStrings([
    vmScript.props?.uri,
    vmScript.uri,
    sourceBase,
    encodeVmFilename(`${sourceBase}\n`),
  ]);

  for (const key of fallbackKeys) {
    if (key && isPlainObject(values[key])) return values[key];
  }

  return {};
}

function resolveVmScript(scripts, sourceBase, metadata) {
  const name = firstMeta(metadata, "name");
  const candidates = uniqueStrings([sourceBase, name]);
  for (const key of candidates) {
    if (isPlainObject(scripts[key])) return scripts[key];
  }
  return {};
}

function encodeStorageObject(data) {
  const ret = {};
  for (const [key, value] of Object.entries(data)) {
    ret[key] = toScriptCatStorageValue(value);
  }
  return ret;
}

function getModifiedTime(vmScript, fallback) {
  const value = numberOr(
    vmScript.lastUpdated ?? vmScript.lastModified ?? vmScript.props?.lastUpdated ?? vmScript.props?.lastModified,
    fallback
  );
  return Math.trunc(value || Date.now());
}

async function writeOutputFile(dir, filename, content, modifiedTime) {
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, content);
  const seconds = modifiedTime / 1000;
  await utimes(fullPath, seconds, seconds);
}

function makeUniqueOutputBase(sourceBase, metadata, used) {
  const preferred = sanitizeScriptCatFilename(firstMeta(metadata, "name") || sourceBase) || "script";
  let candidate = preferred;
  let index = 2;
  while (used.has(outputNameKey(candidate))) {
    candidate = `${preferred}_${index}`;
    index += 1;
  }
  used.add(outputNameKey(candidate));
  return candidate;
}

function sanitizeScriptCatFilename(name) {
  return String(name).replace(/[\\/\\:*?"<>|]/g, "_");
}

function outputNameKey(name) {
  return String(name).normalize("NFC").toLocaleLowerCase();
}

function firstMeta(metadata, key) {
  return metadata[key]?.[0] || "";
}

function firstString(value) {
  const values = toStringArray(value);
  return values[0] || "";
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== null).map(String);
  }
  if (value === undefined || value === null || value === false) return [];
  return [String(value)];
}

function uniqueStrings(values) {
  const ret = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value === "" || seen.has(value)) continue;
    seen.add(value);
    ret.push(value);
  }
  return ret;
}

function asBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return !/^(0|false|no|off)$/i.test(value.trim());
  return Boolean(value);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      return;
    }
    await convertViolentmonkeyZip(args.input, args.output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1]) {
  const entryUrl = pathToFileURL(path.resolve(process.argv[1])).href;
  if (import.meta.url === entryUrl) await main();
}
