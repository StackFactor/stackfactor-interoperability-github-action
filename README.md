# stackfactor-interoperability-github-action

Publishes integrations and agents to StackFactor from your repository using the `@stackfactor/client-api` package.

## How It Works

1. Reads a YAML configuration file (default: `src/config.yaml`) from your repository
2. Reads code files referenced by `code` and `batchCode` paths
3. Builds a payload with integration metadata, constants/variables, custom fields, and inlined code
4. Creates or updates the integration in StackFactor via the `@stackfactor/client-api`
5. Optionally publishes the integration

## Usage

```yaml
- uses: StackFactor/stackfactor-interoperability-github-action@main
  with:
    api-token: ${{ secrets.STACKFACTOR_API_TOKEN }}
```

### Inputs

| Input         | Required | Default           | Description                                                            |
| ------------- | -------- | ----------------- | ---------------------------------------------------------------------- |
| `api-token`   | Yes      |                   | StackFactor API authorization token                                    |
| `api-url`     | No       |                   | Override the API base URL                                              |
| `environment` | No       | `production`      | Target environment (`production`, `nonprod`, `testing`, `development`) |
| `config-path` | No       | `src/config.yaml` | Path to the configuration file relative to repo root                   |
| `publish`     | No       | `true`            | Whether to publish after updating                                      |

### Outputs

| Output           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `integration-id` | The ID of the created or updated integration        |
| `status`         | Result status: `created`, `updated`, or `published` |

## Configuration File

Create `src/config.yaml` in your repository:

```yaml
_id: "your-integration-id"
name: "My Agent"
summary: "A short description of what this agent does."
type: PLANNING
url: "https://example.com/my-agent"
canBeDisabled: true
code: ./main.js
batchCode: ./batch.js

constantsAndVars:
  - name: apiBaseUrl
    description: Base URL for the external service
    type: tenantConfig
    value: "https://example.com"
    dataType: string

  - name: apiToken
    description: API token for authentication
    type: tenantConfigSecret
    value: ""
    dataType: string

  - name: featureEnabled
    description: Enable or disable a feature
    type: tenantConfig
    value: "true"
    dataType: boolean

  - name: itemStatus
    description: Allowed statuses for an item
    type: userConfig
    value: "Open"
    allowedValues:
      - "Open"
      - "In Progress"
      - "Done"
    dataType: select

customFields:
  - key: externalId
    description: External system identifier
    elementType: LEARNING_CONTENT
    fieldType: TEXT
    indexable: true
```

### Config Reference

| Field              | Required | Description                                                           |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `_id`              | **Yes**  | Integration ID — required to prevent duplicate creation               |
| `name`             | Yes      | Display name of the integration                                       |
| `summary`          | Yes      | Description of what the integration does                              |
| `type`             | Yes      | Integration type (e.g., `PLANNING`)                                   |
| `url`              | No       | URL associated with the integration                                   |
| `canBeDisabled`    | No       | Whether tenants can disable this integration                          |
| `code`             | No       | Relative path to the main code file (read and inlined in the payload) |
| `batchCode`        | No       | Relative path to the batch code file                                  |
| `constantsAndVars` | No       | Array of configuration variables (see below)                          |
| `customFields`     | No       | Array of custom field definitions (see below)                         |

### `constantsAndVars` Entry

| Field           | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `name`          | Variable name                                                              |
| `description`   | Human-readable description                                                 |
| `type`          | `tenantConfig`, `tenantConfigSecret`, `userConfig`, or `userConfigSecret`  |
| `value`         | Default value                                                              |
| `dataType`      | `string`, `boolean`, `date`, `dollarCurrency`, `select`, or `multiSelect`  |
| `allowedValues` | (Optional) Array of allowed values for `select` / `multiSelect` data types |

### `customFields` Entry

| Field         | Description                               |
| ------------- | ----------------------------------------- |
| `key`         | Unique field key                          |
| `description` | Human-readable description                |
| `elementType` | Target element (e.g., `LEARNING_CONTENT`) |
| `fieldType`   | Field data type (e.g., `TEXT`)            |
| `indexable`   | Whether the field is searchable           |

## Full Workflow Example

```yaml
name: Publish to StackFactor

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: StackFactor/stackfactor-interoperability-github-action@main
        with:
          api-token: ${{ secrets.STACKFACTOR_API_TOKEN }}
          environment: production
          publish: "true"
```

## Development

```bash
npm install
npm run build   # compiles src/index.js into dist/ via @vercel/ncc
```

The `dist/` directory must be committed since GitHub Actions runs the compiled output directly.
