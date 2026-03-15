import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSourcePayload, validatePack } from "./validation/pack-validator.mjs";

const ROOT = process.cwd();
const SITES_DIR = path.join(ROOT, "sites");
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const ROOT_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "root.html");
const ASSETS_TEMPLATE_DIR = path.join(TEMPLATE_DIR, "assets");

function toIsoOrNull(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function renderTemplate(template, values) {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

async function walkJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(absolute)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      files.push(absolute);
    }
  }

  return files;
}

function collectPackOrigins(pack) {
  const set = new Set();

  for (const target of pack.targets) {
    if (!target?.match?.origins) continue;
    for (const origin of target.match.origins) {
      if (typeof origin === "string" && origin.trim()) {
        set.add(origin.trim());
      }
    }
  }

  return [...set].sort((a, b) => a.localeCompare(b));
}

function mergeAllPacks(packs) {
  const mergedTargets = [];
  const seenTargetIds = new Set();
  const tagSet = new Set();
  const appliesToSet = new Set();

  let latestTs = 0;

  for (const pack of packs) {
    const parsedDate = toIsoOrNull(pack.updatedAt);
    if (parsedDate) {
      latestTs = Math.max(latestTs, Date.parse(parsedDate));
    }

    if (Array.isArray(pack.tags)) {
      for (const tag of pack.tags) {
        if (typeof tag === "string" && tag.trim()) {
          tagSet.add(tag.trim());
        }
      }
    }

    if (Array.isArray(pack.appliesTo)) {
      for (const item of pack.appliesTo) {
        if (typeof item === "string" && item.trim()) {
          appliesToSet.add(item.trim());
        }
      }
    }

    for (const target of pack.targets) {
      const clone = structuredClone(target);
      if (seenTargetIds.has(clone.targetId)) {
        clone.targetId = `${pack.id}::${clone.targetId}`;
      }
      seenTargetIds.add(clone.targetId);
      mergedTargets.push(clone);
    }
  }

  return {
    komentoVersion: packs[0]?.komentoVersion ?? "0.1",
    id: "all",
    name: "All KomentoScripts",
    updatedAt: latestTs > 0 ? new Date(latestTs).toISOString() : new Date().toISOString(),
    appliesTo: [...appliesToSet],
    tags: [...tagSet],
    targets: mergedTargets
  };
}

function rootPage(model, rootTemplate, routeBase) {
  return renderTemplate(rootTemplate, {
    PAGE_TITLE: "KomentoScript Pages",
    CSS_PATH: `${routeBase}/assets/root.css`,
    JS_PATH: `${routeBase}/assets/root.js`,
    ALL_LINK: `${routeBase}/all`,
    MODEL_JSON: safeJsonForScript(model)
  });
}

async function copyDirectory(sourceDir, destinationDir) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function loadTemplates() {
  return fs.readFile(ROOT_TEMPLATE_PATH, "utf8");
}

async function ensureCleanDist() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, "data"), { recursive: true });
  await fs.mkdir(path.join(DIST_DIR, "assets"), { recursive: true });
}

async function main() {
  if (process.argv.includes("--clean")) {
    await ensureCleanDist();
    console.log("Cleaned dist/");
    return;
  }

  await ensureCleanDist();

  const rootTemplate = await loadTemplates();
  await copyDirectory(ASSETS_TEMPLATE_DIR, path.join(DIST_DIR, "assets"));

  let jsonFiles = [];
  try {
    jsonFiles = await walkJsonFiles(SITES_DIR);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("sites/ folder not found. Create it and add KomentoScript JSON files.");
    }
    throw error;
  }

  if (jsonFiles.length === 0) {
    throw new Error("No JSON files found in sites/. Add at least one KomentoScript pack.");
  }

  const packs = [];
  const allErrors = [];

  for (const filePath of jsonFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      allErrors.push(`${path.relative(ROOT, filePath)}: Invalid JSON (${error.message})`);
      continue;
    }

    const sourcePath = path.relative(ROOT, filePath);
    let normalized;

    try {
      normalized = normalizeSourcePayload(parsed, sourcePath);
    } catch (error) {
      allErrors.push(error.message || String(error));
      continue;
    }

    for (const entry of normalized) {
      const result = await validatePack(entry.pack, entry.sourcePath);

      if (result.errors.length > 0) {
        allErrors.push(...result.errors);
        continue;
      }

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.warn(`Warning: ${warning}`);
        }
      }

      packs.push({ ...entry.pack, __file: sourcePath });
    }
  }

  if (allErrors.length > 0) {
    throw new Error(`Validation failed:\n- ${allErrors.join("\n- ")}`);
  }

  const idSet = new Set();
  for (const pack of packs) {
    if (idSet.has(pack.id)) {
      throw new Error(`Duplicate pack id detected: ${pack.id}`);
    }
    idSet.add(pack.id);
  }

  const sortedPacks = [...packs].sort((a, b) => a.id.localeCompare(b.id));

  const homeModel = {
    generatedAt: new Date().toISOString(),
    packCount: sortedPacks.length,
    packs: sortedPacks.map((pack) => {
      const origins = collectPackOrigins(pack);
      const encodedId = encodeURIComponent(pack.id);
      return {
        id: pack.id,
        encodedId,
        name: pack.name || pack.id,
        route: `./${encodedId}`,
        source: pack.__file,
        targetCount: Array.isArray(pack.targets) ? pack.targets.length : 0,
        origins,
        updatedAt: pack.updatedAt || null
      };
    })
  };

  const originSet = new Set();
  for (const pack of homeModel.packs) {
    for (const origin of pack.origins) {
      originSet.add(origin);
    }
  }
  homeModel.origins = [...originSet].sort((a, b) => a.localeCompare(b));

  const allPack = mergeAllPacks(sortedPacks);

  await fs.writeFile(path.join(DIST_DIR, "index.html"), rootPage(homeModel, rootTemplate, "."), "utf8");
  await fs.writeFile(path.join(DIST_DIR, "data", "all.json"), JSON.stringify(allPack, null, 2), "utf8");
  await fs.writeFile(path.join(DIST_DIR, "all"), JSON.stringify(allPack, null, 2), "utf8");

  for (const pack of sortedPacks) {
    const encodedId = encodeURIComponent(pack.id);
    const packJson = JSON.stringify(pack, null, 2);
    await fs.writeFile(path.join(DIST_DIR, "data", `${encodedId}.json`), packJson, "utf8");
    await fs.writeFile(path.join(DIST_DIR, encodedId), packJson, "utf8");
  }

  await fs.writeFile(path.join(DIST_DIR, "404.html"), rootPage(homeModel, rootTemplate, "."), "utf8");

  console.log(`Built root page and ${sortedPacks.length + 1} JSON files in /data.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
