type ValueMap = Record<string, string>;
type TokenKind = "secrets" | "vars";

const SUPPORTED_TOKEN_PATTERN = /\$\{\{\s*(secrets|vars)\.([A-Z_][A-Z0-9_]*)\s*\}\}/g;
const LEGACY_TOKEN_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/;
const ACTIONS_TOKEN_PATTERN = /\$\{\{[\s\S]*?\}\}/;

export function expandEnvTokens(value: string): string {
  const expanded = value.replace(SUPPORTED_TOKEN_PATTERN, (token, rawKind: string, name: string) => {
    const kind = rawKind as TokenKind;
    const resolved = getConfigValue(kind, name);
    if (resolved === undefined) {
      throw new Error(`missing ${kind.slice(0, -1)} value for ${token}`);
    }
    return resolved;
  });

  const legacyMatch = expanded.match(LEGACY_TOKEN_PATTERN);
  if (legacyMatch) {
    throw new Error(`unsupported legacy token ${legacyMatch[0]}; use \${{ secrets.${legacyMatch[1]} }} or \${{ vars.${legacyMatch[1]} }}`);
  }

  const unsupportedActionsMatch = expanded.match(ACTIONS_TOKEN_PATTERN);
  if (unsupportedActionsMatch) {
    throw new Error(`unsupported GitHub Actions token ${unsupportedActionsMatch[0]}; only secrets.NAME and vars.NAME are supported`);
  }

  return expanded;
}

function getConfigValue(kind: TokenKind, name: string): string | undefined {
  return kind === "secrets" ? readSecretMap()[name] : readVarMap()[name];
}

let secretMap: ValueMap | undefined;
let varMap: ValueMap | undefined;

function readSecretMap(): ValueMap {
  if (secretMap) {
    return secretMap;
  }
  secretMap = readValueMap("FEED_SECRET_ENV");
  return secretMap;
}

function readVarMap(): ValueMap {
  if (varMap) {
    return varMap;
  }
  varMap = readValueMap("FEED_VAR_ENV");
  return varMap;
}

function readValueMap(name: string): ValueMap {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isValueMap(parsed)) {
    throw new Error(`${name} must be a JSON object with string values`);
  }
  return parsed;
}

function isValueMap(value: unknown): value is ValueMap {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((entry) => typeof entry === "string");
}
