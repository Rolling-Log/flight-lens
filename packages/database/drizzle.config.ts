import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_DIRECT_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL is required for migrations.");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
