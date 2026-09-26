/** Scope launch-only environment without changing the embedding process. */
export function withAcpEnvironment(
  command: string | string[],
  environment: Record<string, string>,
): string | string[] {
  const script = `const {spawn}=require("node:child_process");
const [encoded,command,...args]=process.argv.slice(1);
const child=spawn(command,args,{stdio:"inherit",env:{...process.env,...JSON.parse(encoded)},shell:process.platform==="win32"});
for(const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>child.kill(signal));
child.on("error",()=>process.exit(1));
child.on("exit",(code,signal)=>process.exit(code??(signal?1:0)));`;
  const prefix = ["node", "-e", script, "--", JSON.stringify(environment)];
  if (Array.isArray(command)) return [...prefix, ...command];
  // acpx tokenizes this string; environment values never become shell source.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return `${prefix.map(quote).join(" ")} ${command}`;
}

/** VCS identity is public but remains scoped to the launched agent. */
export const withAcpVcsEnvironment = withAcpEnvironment;
