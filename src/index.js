import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import yaml from "js-yaml";
import { integration } from "@stackfactor/client-api";

async function run() {
  try {
    // Read inputs
    const apiToken = core.getInput("api-token", { required: true });
    const apiUrl = core.getInput("api-url");
    const environment = core.getInput("environment") || "production";
    const configPath = core.getInput("config-path") || "src/config.yaml";
    const shouldPublish = core.getInput("publish") !== "false";

    // Configure the API base URL via environment variables
    // The @stackfactor/client-api reads REACT_APP_BACKEND_URL or REACT_APP_NODE_ENV
    if (apiUrl) {
      process.env.REACT_APP_BACKEND_URL = apiUrl;
    } else {
      process.env.REACT_APP_NODE_ENV = environment;
    }

    // Read the configuration file from the repository
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const fullConfigPath = resolve(workspace, configPath);
    core.info(`Reading configuration from ${fullConfigPath}`);

    const configContent = await readFile(fullConfigPath, "utf-8");
    const config = yaml.load(configContent);

    core.info(`Configuration loaded: ${config.name || "unnamed integration"}`);

    // _id is required — without it, every run would create a duplicate integration
    const integrationId = config._id;
    if (!integrationId) {
      throw new Error(
        "_id is required in config.yaml. Each integration must have a stable _id to prevent duplicates.",
      );
    }

    // The config dir is used to resolve relative file paths (code, batchCode)
    const configDir = dirname(fullConfigPath);

    // Build the payload from the configuration file
    const payload = await buildPayload(config, workspace, configDir);

    // Update the integration
    core.info(`Updating integration ${integrationId}...`);
    await integration.setIntegrationInformation(
      integrationId,
      payload,
      apiToken,
    );
    core.info(`Integration ${integrationId} updated successfully.`);
    let status = "updated";

    // Publish if requested
    if (shouldPublish) {
      core.info(`Publishing integration ${integrationId}...`);
      await integration.publishIntegration(integrationId, apiToken);
      status = "published";
      core.info(`Integration ${integrationId} published successfully.`);
    }

    // Set outputs
    core.setOutput("integration-id", integrationId);
    core.setOutput("status", status);

    core.info(`Done. Status: ${status}`);
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

/**
 * Reads a file path relative to configDir, with path-traversal protection.
 */
async function readCodeFile(filePath, workspace, configDir) {
  const resolved = resolve(configDir, filePath);
  if (!resolved.startsWith(workspace)) {
    throw new Error(`File path escapes workspace: ${filePath}`);
  }
  core.info(`Reading code file: ${filePath}`);
  return readFile(resolved, "utf-8");
}

/**
 * Builds the integration payload from the parsed YAML config.
 */
async function buildPayload(config, workspace, configDir) {
  const payload = {
    name: config.name,
    summary: config.summary,
    type: config.type,
    url: config.url,
    canBeDisabled: config.canBeDisabled,
  };

  // Read and inline the code file
  if (config.code) {
    payload.code = await readCodeFile(config.code, workspace, configDir);
  }

  // Read and inline the batch code file
  if (config.batchCode) {
    payload.batchCode = await readCodeFile(
      config.batchCode,
      workspace,
      configDir,
    );
  }

  // Map constants and variables
  if (config.constantsAndVars) {
    payload.constantsAndVars = config.constantsAndVars.map((entry) => {
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

  return payload;
}

run();
