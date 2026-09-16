import { markdownHelp } from "../src/cli/args.ts";
const path = new URL("../docs/cli/reference.md", import.meta.url);
const expected = markdownHelp();
if (Deno.args.includes("--check")) {
  const actual = await Deno.readTextFile(path).catch(() => "");
  if (actual !== expected)
    throw new Error("CLI reference is stale; run deno task docs:write");
} else {
  await Deno.mkdir(new URL("../docs/cli/", import.meta.url), {
    recursive: true,
  });
  await Deno.writeTextFile(path, expected);
}
