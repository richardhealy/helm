import { config } from "dotenv";
// Load the same env files the app and Prisma CLI use, so integration tests
// hit the local database.
config({ path: [".env.local", ".env"] });
