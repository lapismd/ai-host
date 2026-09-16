export type Session = {
  sessionId: string;
  state?: string;
  status?: string;
  [key: string]: unknown;
};
export type HostEvent = { event: string; data: Record<string, unknown> };
export type HostConfig = {
  schema: string;
  workspace: string;
  bind: string;
  port: number;
  origins: string[];
  tokenFile: string;
  profile?: "trusted" | "controller";
  agentConfig?: string;
};
export type Host = {
  url: string;
  workspace: string;
  token: string;
  inspect(): Session[];
  close(): Promise<void>;
};
export type Invocation = { command: string; argsPrefix: string[] };
export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode: 1 | 2 | 3 = 2,
  ) {
    super(message);
  }
}
