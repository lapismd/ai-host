import { BINARY, VERSION, IS_AI } from "../src/cli/brand.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
if (Deno.version.deno !== "2.9.5")
  throw new Error("Release CLI builds require Deno 2.9.5");
const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
} as const;
type Target = keyof typeof targets;
const index = Deno.args.indexOf("--target");
const chosen =
  index < 0
    ? `${Deno.build.os === "darwin" ? "darwin" : Deno.build.os}-${Deno.build.arch === "aarch64" ? "arm64" : "x64"}`
    : Deno.args[index + 1];
if (!(chosen in targets)) throw new Error(`Unsupported target ${chosen}`);
const selected = Deno.args.includes("--all")
  ? (Object.keys(targets) as Target[])
  : [chosen as Target];
const artifacts = join(root, "artifacts");
await Deno.mkdir(artifacts, { recursive: true });
let sourceRevision = Deno.env.get("GITHUB_SHA");
if (!sourceRevision) {
  const result = await new Deno.Command("jj", {
    cwd: root,
    args: ["log", "--no-graph", "-r", "@", "-T", "commit_id"],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!result.success) throw new Error("Cannot determine source revision");
  sourceRevision = new TextDecoder().decode(result.stdout).trim();
}
const files = [];
const entries = [];
for (const name of selected) {
  const extra: string[] = [];
  if (!IS_AI) {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(root, "native-artifacts.json")),
    );
    const native = manifest.targets[targets[name]];
    const folder = join(root, ".cli-build", "native");
    await Deno.mkdir(folder, { recursive: true });
    const destination = join(folder, native.file);
    let bytes = await Deno.readFile(destination).catch(() => null);
    if (!bytes || (await sha(bytes)) !== native.sha256) {
      const response = await fetch(`${manifest.baseUrl}/${native.file}`);
      if (!response.ok)
        throw new Error(`PTY download failed: ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      if ((await sha(bytes)) !== native.sha256)
        throw new Error("PTY checksum mismatch");
      await Deno.writeFile(destination, bytes);
    }
    extra.push("--include", destination);
  }
  const filename = `${BINARY}-${name}`;
  const output = join(artifacts, filename);
  const status = await new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: [
      "compile",
      "--exclude-unused-npm",
      "--allow-all",
      "--self-extracting",
      "--sloppy-imports",
      "--frozen",
      "--config",
      "deno.json",
      ...extra,
      "--target",
      targets[name],
      "--output",
      output,
      "src/main.ts",
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) Deno.exit(status.code);
  const hash = await sha(await Deno.readFile(output));
  files.push(`${hash}  ${filename}`);
  entries.push({ file: filename, target: targets[name], sha256: hash });
}
await Deno.writeTextFile(
  join(artifacts, "SHA256SUMS"),
  files.join("\n") + "\n",
);
await Deno.writeTextFile(
  join(artifacts, "manifest.json"),
  JSON.stringify(
    {
      schema: "lapis.host-release/1",
      binary: BINARY,
      version: VERSION,
      revision: sourceRevision,
      deno: Deno.version.deno,
      artifacts: entries,
    },
    null,
    2,
  ) + "\n",
);
let notices = await Deno.readTextFile(join(root, "LICENSE.md"));
const includeNotice = async (name: string, url: string) => {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Unable to include ${name} license: ${response.status}`);
  notices += `\n\n===== ${name} =====\n${await response.text()}`;
};
await includeNotice(
  "Deno 2.9.5",
  "https://raw.githubusercontent.com/denoland/deno/v2.9.5/LICENSE.md",
);
if (IS_AI) {
  const info = await new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: ["info", "--json", "src/main.ts"],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!info.success) throw new Error("Cannot inventory bundled npm licenses");
  type Package = {
    name: string;
    version: string;
    localPath: string;
    dependencies: string[];
  };
  const packages = JSON.parse(new TextDecoder().decode(info.stdout))
    .npmPackages as Record<string, Package>;
  const visited = new Set<string>();
  const visit = async (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const pkg = packages[id];
    if (!pkg) throw new Error(`Missing dependency metadata: ${id}`);
    // Deno inventories optional packages for other targets without embedding them.
    const manifestText = await Deno.readTextFile(
      join(pkg.localPath, "package.json"),
    ).catch((error) => {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    });
    if (manifestText === null) return;
    const manifest = JSON.parse(manifestText);
    notices += `\n\n===== ${pkg.name}@${pkg.version} (${manifest.license ?? "see package license"}) =====\n`;
    let found = false;
    for await (const entry of Deno.readDir(pkg.localPath)) {
      if (
        entry.isFile &&
        /^(license|licence|notice|copying)([.-].*)?$/i.test(entry.name)
      ) {
        notices +=
          (await Deno.readTextFile(join(pkg.localPath, entry.name))) + "\n";
        found = true;
      }
    }
    if (!found && pkg.name.startsWith("@esbuild/")) {
      const parent = Object.values(packages).find(
        (p) => p.name === "esbuild" && p.version === pkg.version,
      );
      if (parent) {
        notices += await Deno.readTextFile(
          join(parent.localPath, "LICENSE.md"),
        );
        found = true;
      }
    }
    if (!found)
      throw new Error(`No license text in ${pkg.name}@${pkg.version}`);
    for (const dependency of pkg.dependencies) await visit(dependency);
  };
  for (const [id, pkg] of Object.entries(packages))
    if (["acpx", "ws", "@modelcontextprotocol/sdk"].includes(pkg.name))
      await visit(id);
} else {
  await includeNotice(
    "PTY FFI 0.42.0",
    "https://raw.githubusercontent.com/sigmaSd/deno-pty-ffi/0.42.0/LICENSE",
  );
  await includeNotice(
    "Deno Standard Library",
    "https://raw.githubusercontent.com/denoland/std/main/LICENSE",
  );
}
await Deno.writeTextFile(join(artifacts, "NOTICES.txt"), notices);
async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
