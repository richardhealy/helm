// Side-effect import: loads env BEFORE any other module is evaluated.
// Import this first in standalone scripts — ESM evaluates imported modules in
// order, so this runs before modules that read process.env at import time
// (e.g. the Prisma client singleton in src/lib/db.ts).
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });
