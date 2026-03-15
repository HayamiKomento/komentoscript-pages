import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "scripts", "validation", "schema", "komentoscript-pack.schema.json");

const ALLOWED_DISPLAY_MODES = new Set(["below", "insert", "replace", "popup", "icon"]);
const ALLOWED_PIPELINE_OPS = new Set(["querySelector", "text", "trim", "regex", "number"]);
const ALLOWED_TRANSFORMS = new Set(["trim", "lowercase", "uppercase", "number"]);

let validateFnPromise = null;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toIsoOrNull(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function formatPath(pathValue) {
  if (!pathValue || pathValue === "/") return "root";
  return pathValue.replaceAll("/", ".").replace(/^\./, "");
}

function convertAjvErrors(errors, sourcePath) {
  return (errors || []).map((error) => {
    const location = formatPath(error.instancePath);
    let message = error.message || "invalid value";

    if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
      message = `unsupported field '${error.params.additionalProperty}'.`;
    }

    return `${sourcePath}: ${location} ${message}`;
  });
}

async function getValidateFn() {
  if (!validateFnPromise) {
    validateFnPromise = (async () => {
      const schemaRaw = await fs.readFile(SCHEMA_PATH, "utf8");
      const schema = JSON.parse(schemaRaw);
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      return ajv.compile(schema);
    })();
  }
  return validateFnPromise;
}

function collectPackWarningsAndCrossFieldErrors(pack, sourcePath) {
  const errors = [];
  const warnings = [];

  if ("updatedAt" in pack && toIsoOrNull(pack.updatedAt) === null) {
    warnings.push(`${sourcePath}: updatedAt is not ISO-like.`);
  }

  if (Array.isArray(pack.targets) && pack.targets.length === 0) {
    warnings.push(`${sourcePath}: targets is empty.`);
  }

  if (!Array.isArray(pack.targets)) {
    return { errors, warnings };
  }

  const targetIds = new Set();

  for (let i = 0; i < pack.targets.length; i += 1) {
    const target = pack.targets[i];
    if (!isObject(target)) continue;

    const targetPath = `${sourcePath}: targets[${i}]`;

    if (isNonEmptyString(target.targetId)) {
      if (targetIds.has(target.targetId)) {
        errors.push(`${targetPath} duplicate targetId '${target.targetId}' inside pack.`);
      }
      targetIds.add(target.targetId);
    }

    if (isObject(target.placement) && !("display" in target.placement)) {
      let defaultCount = 0;
      for (const [mode, modeConfig] of Object.entries(target.placement)) {
        if (!ALLOWED_DISPLAY_MODES.has(mode)) {
          continue;
        }
        if (isObject(modeConfig) && modeConfig.default === true) {
          defaultCount += 1;
        }
      }

      if (defaultCount > 1) {
        errors.push(`${targetPath}.placement map can only mark one mode as default.`);
      }
    }

    if (isObject(target.extract)) {
      for (const [extractKey, extractField] of Object.entries(target.extract)) {
        if (!isObject(extractField)) continue;

        const hasPipeline = "pipeline" in extractField;
        const hasSelector = "selector" in extractField && isNonEmptyString(extractField.selector);
        const hasXPath = "xPath" in extractField && isNonEmptyString(extractField.xPath);

        if (!hasPipeline && !hasSelector && !hasXPath) {
          warnings.push(`${targetPath}.extract.${extractKey} is missing selector/xPath/pipeline.`);
        }

        if ("pipeline" in extractField) {
          if (!Array.isArray(extractField.pipeline)) {
            continue;
          }

          if (extractField.pipeline.length === 0) {
            warnings.push(`${targetPath}.extract.${extractKey}.pipeline is empty.`);
          }

          for (let j = 0; j < extractField.pipeline.length; j += 1) {
            const step = extractField.pipeline[j];
            if (!Array.isArray(step) || step.length === 0 || typeof step[0] !== "string") {
              warnings.push(`${targetPath}.extract.${extractKey}.pipeline[${j}] is not a valid operation tuple.`);
              continue;
            }

            if (!ALLOWED_PIPELINE_OPS.has(step[0])) {
              warnings.push(`${targetPath}.extract.${extractKey}.pipeline[${j}] uses unknown op '${step[0]}'.`);
            }
          }
        }

        if (Array.isArray(extractField.transforms)) {
          for (let j = 0; j < extractField.transforms.length; j += 1) {
            const transform = extractField.transforms[j];
            if (typeof transform !== "string" || !ALLOWED_TRANSFORMS.has(transform)) {
              warnings.push(`${targetPath}.extract.${extractKey}.transforms[${j}] uses an unknown transform '${String(transform)}'.`);
            }
          }
        }
      }
    }
  }

  for (let i = 0; i < pack.targets.length; i += 1) {
    const target = pack.targets[i];
    const targetPath = `${sourcePath}: targets[${i}]`;

    if (isObject(target) && isNonEmptyString(target.extends) && !targetIds.has(target.extends)) {
      warnings.push(`${targetPath}.extends references unknown target '${target.extends}'.`);
    }
  }

  return { errors, warnings };
}

export function normalizeSourcePayload(parsed, sourcePath) {
  if (Array.isArray(parsed)) {
    return parsed.map((pack, index) => ({ pack, sourcePath: `${sourcePath}[${index}]` }));
  }

  if (isObject(parsed) && "packs" in parsed) {
    if (!Array.isArray(parsed.packs)) {
      throw new Error(`${sourcePath}: packs must be an array when provided.`);
    }
    return parsed.packs.map((pack, index) => ({ pack, sourcePath: `${sourcePath}.packs[${index}]` }));
  }

  return [{ pack: parsed, sourcePath }];
}

export async function validatePack(pack, sourcePath) {
  const validateFn = await getValidateFn();
  const schemaValid = validateFn(pack);
  const schemaErrors = schemaValid ? [] : convertAjvErrors(validateFn.errors, sourcePath);

  if (schemaErrors.length > 0) {
    return { errors: schemaErrors, warnings: [] };
  }

  const extraChecks = collectPackWarningsAndCrossFieldErrors(pack, sourcePath);
  return {
    errors: extraChecks.errors,
    warnings: extraChecks.warnings
  };
}
