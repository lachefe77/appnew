/**
 * Backup automático off-box: snapshot local + cópia remota (scp/rsync/cp).
 * Destino remoto via BACKUP_REMOTE_DIR ou BACKUP_REMOTE_CMD.
 * Sem destino: gera backup local e documenta gap (exit 0 com remoteSkipped).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { copySnapshot } from "../server/database-snapshot.js";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) =>
      code === 0
        ? resolve({ out, err })
        : reject(new Error(err || out || `exit ${code}`)),
    );
  });
}

export async function runOffboxBackup({
  source = process.env.DB_PATH || path.join(root, "data/arena-test.db"),
  localDir = path.join(root, "data/backups"),
  remoteDir = process.env.BACKUP_REMOTE_DIR || "",
  remoteCmd = process.env.BACKUP_REMOTE_CMD || "",
} = {}) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const destination = path.join(localDir, `arena-offbox-${stamp}.db`);
  const local = await copySnapshot(source, destination);
  let remote = { skipped: true, reason: "BACKUP_REMOTE_DIR/CMD unset" };
  if (remoteCmd) {
    const rendered = remoteCmd
      .replaceAll("{src}", destination)
      .replaceAll("{dest}", remoteDir || "");
    const [bin, ...args] = rendered.split(/\s+/).filter(Boolean);
    await run(bin, args);
    remote = { skipped: false, cmd: rendered };
  } else if (remoteDir) {
    const destFile = path.join(remoteDir, path.basename(destination));
    await run("cp", ["-f", destination, destFile]);
    remote = { skipped: false, destFile };
  }
  return { local, remote, at: new Date().toISOString() };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("offbox-backup.js")) {
  try {
    console.log(JSON.stringify(await runOffboxBackup(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
