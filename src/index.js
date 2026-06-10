import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import yaml from "js-yaml";
import { integration, client } from "@stackfactor/client-api";

async function run() {
  try {
    // Read inputs
    const apiToken = core.getInput("api-token", { required: true });
    const apiUrl = core.getInput("api-url", { required: true });
    const configPath = core.getInput("config-path") || "config.yaml";
    const shouldPublish = core.getInput("publish") !== "false";
    const variablesJson = core.getInput("variables") || "{}";
    const secretsJson = core.getInput("secrets") || "{}";

    let variables;
    let secrets;
    try {
      variables = JSON.parse(variablesJson);
    } catch (e) {
      throw new Error(`Invalid JSON in 'variables' input: ${e.message}`);
    }
    try {
      secrets = JSON.parse(secretsJson);
    } catch (e) {
      throw new Error(
        `Invalid JSON in 'secrets' input. Make sure secret values are quoted: '{"KEY": "$\{{ secrets.KEY }}"}'.\nParse error: ${e.message}`,
      );
    }

    // The @stackfactor/client-api creates its axios client at import time,
    // so we must update client.defaults.baseURL directly at runtime.
    client.defaults.baseURL = apiUrl;
    core.info(`API target: ${apiUrl}`);

    // Read the configuration file from the repository
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const fullConfigPath = resolve(workspace, configPath);
    core.info(`Reading configuration from ${fullConfigPath}`);

    const rawContent = await readFile(fullConfigPath, "utf-8");
    const configContent = substituteVariables(rawContent, variables, secrets);
    const config = yaml.load(configContent);

    core.info(`Configuration loaded: ${config.name || "unnamed integration"}`);

    // _id is required — without it, every run would create a duplicate integration
    const integrationId = config._id;
    if (!integrationId) {
      throw new Error(
        "_id is required in config.yaml. Each integration must have a stable _id to prevent duplicates.",
      );
    }

    // capabilities is mandatory for type 5 integrations
    if (Number(config.type) === 5 && !config.capabilities) {
      throw new Error(
        "capabilities is required in config.yaml when type is 5.",
      );
    }

    // The config dir is used to resolve relative file paths (code, batchCode)
    const configDir = dirname(fullConfigPath);

    // Build the payload from the configuration file
    const payload = await buildPayload(config, configDir);

    if (payload.code) {
      core.info(`code: ${payload.code}`);
    }
    if (payload.batchCode) {
      core.info(`batchCode: ${payload.batchCode}`);
    }

    let status;
    let integrationExists = false;
    try {
      // Try to get the integration (draft version)
      const existing = await integration.getIntegrationInformationById(
        integrationId,
        "draft",
        apiToken,
      );
      integrationExists = true;
      core.info(`Interoperability ${integrationId} exists. Updating...`);
      await integration.setIntegrationInformation(
        integrationId,
        payload,
        apiToken,
      );
      core.info(`Interoperability ${integrationId} updated successfully.`);
      status = "updated";
    } catch (err) {
      // If not found, create it (robust 404 detection)
      const status404 =
        (err && err.response && err.response.status === 404) ||
        (err && err.status === 404) ||
        (err && err.message && /404|not found/i.test(err.message)) ||
        (err &&
          err.response &&
          err.response.data &&
          typeof err.response.data.error === "string" &&
          /not found|404/i.test(err.response.data.error));
      if (status404) {
        core.info(
          `Interoperability ${integrationId} does not exist. Creating...`,
        );
        await integration.createIntegration(payload, apiToken);
        core.info(`Interoperability ${integrationId} created successfully.`);
        status = "created";
      } else {
        throw err;
      }
    }

    // Publish if requested
    if (shouldPublish) {
      core.info(`Publishing interoperability ${integrationId}...`);
      await integration.publishIntegration(integrationId, apiToken);
      status = "published";
      core.info(`Interoperability ${integrationId} published successfully.`);
    }

    // Set outputs
    core.setOutput("integration-id", integrationId);
    core.setOutput("status", status);

    core.info(`Done. Status: ${status}`);
  } catch (error) {
    const message = error.message || String(error);
    if (error.response) {
      core.error(`API response status: ${error.response.status}`);
      core.error(
        `API response data: ${JSON.stringify(error.response.data, null, 2)}`,
      );
    } else if (error.request) {
      core.error(
        `No response received from API. This usually means the request could not reach the server.`,
      );
      core.error(
        `Request URL: ${error.config?.baseURL || "unknown"}${error.config?.url || ""}`,
      );
      core.error(`Error code: ${error.code || "unknown"}`);
    }
    if (error.cause) {
      core.error(`Cause: ${error.cause.message || String(error.cause)}`);
    }
    core.setFailed(`Action failed: ${message}`);
  }
}

/**
 * Replaces vars.NAME and secrets.NAME patterns in a string with actual values.
 */
function substituteVariables(content, variables, secrets) {
  return content.replace(
    /\$\{\{\s*(vars|secrets)\.(\w+)\s*\}\}/g,
    (_match, scope, name) => {
      const source = scope === "secrets" ? secrets : variables;
      if (name in source) {
        return source[name];
      }
      throw new Error(
        `${scope}.${name} referenced in config.yaml but not provided in the '${scope}' input.`,
      );
    },
  );
}

/**
 * Builds the integration payload from the parsed YAML config.
 */
async function buildPayload(config, configDir) {
  const payload = {
    _id: config._id,
    name: config.name,
    summary: config.summary,
    type: config.type,
    url: config.url,
    canBeDisabled: config.canBeDisabled,
    publishedInMarketplace: config.publishedInMarketplace,
    tags: config.tags || [],
    githubRepository: `${github.context.repo.owner}/${github.context.repo.repo}`,
  };

  if (config.code) {
    payload.code = config.code;
  }

  if (config.batchCode) {
    payload.batchCode = config.batchCode;
  }

  if (config.capabilities) {
    payload.capabilities = config.capabilities;
  }

  if (config.apps !== undefined) {
    if (!Array.isArray(config.apps)) {
      throw new Error("apps must be an array of strings in config.yaml.");
    }
    const validApps = ["core", "admin", "exceed", "shield"];
    const invalid = config.apps.filter(
      (app) => typeof app !== "string" || !validApps.includes(app),
    );
    if (invalid.length > 0) {
      throw new Error(
        `apps contains invalid value(s): ${invalid
          .map((v) => JSON.stringify(v))
          .join(", ")}. Valid values are: ${validApps.join(", ")}.`,
      );
    }
    payload.apps = config.apps;
  }

  // Map constants and variables
  if (config.constantsAndVars) {
    payload.constAndVars = config.constantsAndVars.map((entry) => {
      const mapped = {
        name: entry.name,
        description: entry.description,
        type: entry.type,
        value: entry.value,
        dataType: entry.dataType,
      };
      if (entry.allowedValues) {
        mapped.allowedValues = entry.allowedValues;
      }
      return mapped;
    });
  }

  // Map custom fields
  if (config.customFields) {
    payload.customFields = config.customFields.map((field) => ({
      key: field.key,
      description: field.description,
      elementType: field.elementType,
      fieldType: field.fieldType,
      indexable: field.indexable,
    }));
  }

  // Add repository context metadata
  const context = github.context;
  payload.metadata = {
    source: "github-action",
    repository: `${context.repo.owner}/${context.repo.repo}`,
    commit: context.sha,
    ref: context.ref,
  };

  // Add repository files (array of { path, code })
  payload.repository = [];
  if (Array.isArray(config.repository)) {
    for (const repoPath of config.repository) {
      const absPath = resolve(configDir, repoPath);
      let code;
      try {
        code = await readFile(absPath, "utf-8");
      } catch (err) {
        throw new Error(
          `Could not read repository file: ${repoPath} - ${err.message}`,
        );
      }
      payload.repository.push({ path: repoPath, code });
      core.info(
        `Included file in payload: ${repoPath} (${code.length} bytes)`,
      );
    }
  }

  // Always include the dependency manifest + lockfile from the repo root, so the
  // Cloud Run build/deploy pipeline has the agent's npm dependencies and a
  // reproducible lockfile — regardless of whether config.yaml lists them. These
  // are read from the workspace root (npm's working dir), not configDir, which
  // may be nested (e.g. src/config.yaml). package.json is required; the lockfile
  // is strongly recommended but only warned about so existing agents don't break.
  const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  for (const manifest of ["package.json", "package-lock.json"]) {
    if (payload.repository.some((file) => basename(file.path) === manifest)) {
      continue; // already provided via config.yaml repository
    }
    let code;
    try {
      code = await readFile(resolve(workspaceRoot, manifest), "utf-8");
    } catch (err) {
      if (manifest === "package.json") {
        throw new Error(
          `package.json is required at the repo root for deployment but could not be read: ${err.message}`,
        );
      }
      core.warning(
        `No ${manifest} at the repo root — agent builds will not be reproducible. Commit a lockfile.`,
      );
      continue;
    }
    payload.repository.push({ path: manifest, code });
    core.info(`Included manifest in payload: ${manifest} (${code.length} bytes)`);
  }

  return payload;
}

run();
