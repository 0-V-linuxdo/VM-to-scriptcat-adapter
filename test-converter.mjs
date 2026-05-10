#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeVmFilename } from "./violentmonkey-to-scriptcat.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONVERTER = path.join(ROOT, "violentmonkey-to-scriptcat.mjs");
const ZIP_BIN = "/usr/bin/zip";
const UNZIP_BIN = "/usr/bin/unzip";

async function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 1024 * 1024 * 16, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr || stdout || ""}`;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "scriptcat-vm-adapter-test-"));
  try {
    const fixtureDir = path.join(tmp, "vm");
    const extractDir = path.join(tmp, "out");
    const inputZip = path.join(tmp, "violentmonkey.zip");
    const outputZip = path.join(tmp, "scriptcat.zip");
    await mkdir(fixtureDir);

    const scriptName = "Adapter Demo";
    const namespace = "https://example.com/ns";
    const uri = encodeVmFilename(`${namespace}\n${scriptName}\n`);
    const code = `// ==UserScript==
// @name        ${scriptName}
// @namespace   ${namespace}
// @version     1.0.0
// @match       https://old.example/*
// @include     https://include-old.example/*
// @exclude     https://exclude-old.example/*
// @grant       GM_getValue
// @grant       GM_setValue
// ==/UserScript==

/*
==UserConfig==
main:
  token:
    title: Token
    type: text
    default: ""
==/UserConfig==
*/

console.log(GM_getValue("token"));
`;
    const sameNameDifferentNamespace = `// ==UserScript==
// @name        ${scriptName}
// @namespace   https://example.com/other-ns
// @version     1.0.0
// @match       https://other.example/*
// ==/UserScript==

console.log("same name, different namespace");
`;

    const vmManifest = {
      scripts: {
        [scriptName]: {
          custom: {
            match: ["https://new.example/*"],
            origMatch: false,
            include: ["https://include-extra.example/*"],
            origInclude: true,
            exclude: ["https://blocked.example/*"],
            origExclude: false,
            runAt: "document-start",
            noframes: 1,
            tag: ["ported", "vm"],
            origTag: false,
            downloadURL: "https://example.com/adapter-demo.user.js",
            updateURL: "https://example.com/adapter-demo.meta.js",
          },
          config: {
            enabled: 0,
            shouldUpdate: 0,
          },
          position: 7,
          lastModified: 1710000000000,
          lastUpdated: 1710000001234,
        },
        [`${scriptName} Copy`]: {
          config: {
            enabled: 1,
            shouldUpdate: 1,
          },
          position: 8,
          lastUpdated: 1710000005678,
        },
      },
      settings: {
        sync: {},
      },
      values: {
        [uri]: {
          token: "secret",
          count: 42,
          enabled: false,
          nested: { ok: true },
          "main.token": "configured",
        },
      },
    };

    await writeFile(path.join(fixtureDir, `${scriptName}.user.js`), code);
    await writeFile(path.join(fixtureDir, `${scriptName} Copy.user.js`), sameNameDifferentNamespace);
    await writeFile(path.join(fixtureDir, "violentmonkey"), JSON.stringify(vmManifest, null, 2));
    await run(ZIP_BIN, ["-qr", inputZip, "."], { cwd: fixtureDir });

    await run(process.execPath, [CONVERTER, inputZip, "-o", outputZip]);
    await mkdir(extractDir);
    await run(UNZIP_BIN, ["-q", outputZip, "-d", extractDir]);

    const outputBases = [scriptName, `${scriptName}_2`];
    const convertedScripts = await Promise.all(
      outputBases.map(async (base) => [base, await readFile(path.join(extractDir, `${base}.user.js`), "utf8")])
    );
    const mainBase = convertedScripts.find(([_, text]) => text.includes(`// @namespace   ${namespace}`))?.[0];
    const sameNameBase = outputBases.find((base) => base !== mainBase);
    assert.ok(mainBase);
    assert.ok(sameNameBase);

    const convertedCode = await readFile(path.join(extractDir, `${mainBase}.user.js`), "utf8");
    const options = JSON.parse(await readFile(path.join(extractDir, `${mainBase}.options.json`), "utf8"));
    const storage = JSON.parse(await readFile(path.join(extractDir, `${mainBase}.storage.json`), "utf8"));
    const sameNameStorage = JSON.parse(await readFile(path.join(extractDir, `${sameNameBase}.storage.json`), "utf8"));

    assert.match(convertedCode, /@match\s+https:\/\/new\.example\/\*/);
    assert.doesNotMatch(convertedCode, /@match\s+https:\/\/old\.example\/\*/);
    assert.match(convertedCode, /@include\s+https:\/\/include-old\.example\/\*/);
    assert.match(convertedCode, /@include\s+https:\/\/include-extra\.example\/\*/);
    assert.match(convertedCode, /@exclude\s+https:\/\/blocked\.example\/\*/);
    assert.doesNotMatch(convertedCode, /@exclude\s+https:\/\/exclude-old\.example\/\*/);
    assert.match(convertedCode, /@run-at\s+document-start/);
    assert.match(convertedCode, /@noframes/);
    assert.match(convertedCode, /@tag\s+ported/);
    assert.match(convertedCode, /@downloadURL\s+https:\/\/example\.com\/adapter-demo\.user\.js/);
    assert.match(convertedCode, /@updateURL\s+https:\/\/example\.com\/adapter-demo\.meta\.js/);

    assert.equal(options.settings.enabled, false);
    assert.equal(options.settings.position, 7);
    assert.equal(options.options.check_for_updates, false);
    assert.equal(options.options.run_at, "document-start");
    assert.equal(options.meta.file_url, "https://example.com/adapter-demo.user.js");

    assert.equal(storage.ts, 1710000001234);
    assert.equal(storage.data.token, "ssecret");
    assert.equal(storage.data.count, "n42");
    assert.equal(storage.data.enabled, "bfalse");
    assert.equal(storage.data.nested, 'o{"ok":true}');
    assert.equal(storage.data["main.token"], "sconfigured");
    assert.deepEqual(sameNameStorage.data, {});

    console.log("converter test passed");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
