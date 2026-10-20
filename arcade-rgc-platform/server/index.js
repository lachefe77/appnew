import "dotenv/config";
import { startPlatform } from "./platform.js";
const app = startPlatform();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => app.close());
process.on("message", (message) => {
  if (message === "shutdown") app.close();
});
