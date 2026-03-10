// Validates required environment variables and exports them typed

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\nPlease add it to your .env.local file.`
    );
  }
  return value;
}

function optionalEnv(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  HELIUS_API_KEY: requireEnv("HELIUS_API_KEY"),
  COVALENT_API_KEY: requireEnv("COVALENT_API_KEY"),
  ANTHROPIC_API_KEY: optionalEnv("ANTHROPIC_API_KEY"),
  SNAPSHOT_SECRET: requireEnv("SNAPSHOT_SECRET"),
  DB_PATH: optionalEnv("DB_PATH", "./data/portfolio.db"),
} as const;
