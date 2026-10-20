import path from "node:path";
import { fileURLToPath } from "node:url";
import { copySnapshot, inspectSnapshot } from "../server/database-snapshot.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const [action = "backup", sourceArg, destinationArg] = process.argv.slice(2);
try {
  const source = path.resolve(
    sourceArg || process.env.DB_PATH || path.join(root, "data/arena-test.db"),
  );
  if (action === "verify")
    console.log(JSON.stringify(inspectSnapshot(source), null, 2));
  else if (action === "backup") {
    const destination =
      destinationArg ||
      path.join(
        root,
        "data/backups",
        `arena-${new Date().toISOString().replaceAll(":", "-")}.db`,
      );
    console.log(
      JSON.stringify(await copySnapshot(source, destination), null, 2),
    );
  } else if (action === "restore") {
    if (!sourceArg || !destinationArg)
      throw Error(
        "Use restore arquivo-backup.db novo-arquivo.db. O destino deve ser novo.",
      );
    inspectSnapshot(source);
    console.log(
      JSON.stringify(
        await copySnapshot(source, path.resolve(destinationArg)),
        null,
        2,
      ),
    );
    console.log(
      "Cópia restaurada em um arquivo novo. Pare o servidor antes de configurar DB_PATH para essa cópia.",
    );
  } else
    throw Error(
      "Ações: backup [origem] [destino], verify arquivo, restore backup novo-arquivo.",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
