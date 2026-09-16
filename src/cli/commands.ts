import { access, link, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { BINARY, VERSION } from "./brand";
import { parseArguments, helpText, markdownHelp } from "./args";
import {
  atomicWrite,
  context,
  effectiveConfig,
  loadConfig,
  tokenValue,
  initializeToken,
} from "./config";
import { Output, type Io } from "./output";
import { CliError, type Host } from "./types";
import { listenControl, query } from "./control";
import { delay, shutdownSignal } from "./lifecycle";
import { logger, readLogs } from "./logs";
import * as service from "./service";
import { startHost, runtimes, prerequisite } from "./host";

export async function runCli(
  argv: string[],
  io: Io = { stdout: console.log, stderr: console.error },
): Promise<number> {
  const colorValue =
    argv.find((v) => v.startsWith("--color="))?.slice(8) ??
    argv[argv.indexOf("--color") + 1];
  const color =
    colorValue === "always" ||
    (colorValue !== "never" && !process.env.NO_COLOR && !!process.stdout.isTTY);
  const output = new Output(io, argv.includes("--json"), color);
  let command = "help";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--token" && argv[i + 1]) output.secrets.add(argv[i + 1]);
    if (argv[i].startsWith("--token=")) output.secrets.add(argv[i].slice(8));
  }
  try {
    const args = parseArguments(argv);
    command = args.command || "help";
    const o = args.options;
    if (command === "version") {
      output.success(command, { version: VERSION }, `${BINARY} ${VERSION}`);
      return 0;
    }
    if (o.help) {
      output.success(
        command,
        { help: helpText(args.command) },
        helpText(args.command),
      );
      return 0;
    }
    if (command === "docs markdown-help") {
      output.success(command, { markdown: markdownHelp() }, markdownHelp());
      return 0;
    }
    const ctx = context(o);
    const existing = await loadConfig(ctx, !!o.config && command !== "init");
    const config = effectiveConfig(ctx, o, existing);
    if (o.token && o["token-file"])
      throw new CliError(
        "invalid_arguments",
        "Use only one of --token and --token-file",
      );
    if (command === "init") {
      if (!o.workspace)
        throw new CliError("missing_option", "init requires --workspace");
      if (existing && JSON.stringify(existing) !== JSON.stringify(config))
        throw new CliError(
          "config_conflict",
          "Configuration already exists with different values",
        );
      const token = await initializeToken(
        config,
        o.token as string | undefined,
      );
      output.secrets.add(token);
      if (!existing) {
        const temporary = ctx.configPath + ".init-" + crypto.randomUUID();
        await atomicWrite(temporary, JSON.stringify(config, null, 2) + "\n");
        try {
          await link(temporary, ctx.configPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          const concurrent = await loadConfig(ctx, true);
          if (JSON.stringify(concurrent) !== JSON.stringify(config))
            throw new CliError(
              "config_conflict",
              "Configuration was concurrently initialized",
            );
        } finally {
          await unlink(temporary);
        }
      }
      output.success(command, {
        config: ctx.configPath,
        workspace: config.workspace,
        tokenFile: config.tokenFile,
      });
      return 0;
    }
    if (command === "config validate") {
      await loadConfig(ctx, true);
      await tokenValue(config);
      await runtimes(config);
      output.success(command, { valid: true, config: ctx.configPath });
      return 0;
    }
    if (command === "token show") {
      let token: string;
      try {
        token = String(await query(ctx.socket, "token"));
      } catch (e) {
        if (!(e instanceof CliError) || e.exitCode !== 3) throw e;
        token = await tokenValue(config);
      }
      output.success(command, { token }, token, true);
      return 0;
    }
    if (command === "serve") {
      let host: Host | undefined;
      let ready = false;
      const started = new Date().toISOString();
      let token = "";
      const control = await listenControl(ctx.socket, (method) => {
        if (method === "ping") return { ready };
        if (method === "status")
          return {
            state: ready ? "running" : "starting",
            pid: process.pid,
            version: VERSION,
            started,
            instance: ctx.instance,
            url: host?.url ?? null,
            workspace: config.workspace,
            sessions: host?.inspect() ?? [],
          };
        if (method === "sessions") return host?.inspect() ?? [];
        if (method === "token" && ready) return token;
        throw new Error("Unknown method");
      });
      const signals = shutdownSignal();
      try {
        token = await tokenValue(config, o.token as string | undefined, true);
        output.secrets.add(token);
        const log = await logger(ctx);
        const events: Promise<void>[] = [];
        const record = (event: string, data: Record<string, unknown>) => {
          output.event(command, event, data);
          const write = log.write(event, data);
          write.catch(() => {});
          events.push(write);
        };
        host = await startHost(config, token, ({ event, data }) =>
          record(event, data),
        );
        ready = true;
        let previous = new Map<string, string>();
        while (!signals.signal.aborted) {
          const sessions = host.inspect();
          const next = new Map(
            sessions.map((s) => [s.sessionId, JSON.stringify(s)]),
          );
          for (const session of sessions)
            if (previous.get(session.sessionId) !== next.get(session.sessionId))
              record("session", session);
          for (const id of previous.keys())
            if (!next.has(id)) record("session_closed", { sessionId: id });
          previous = next;
          await delay(500, signals.signal);
          await log.flush();
          events.length = 0;
        }
        await host.close();
        host = undefined;
        ready = false;
        await log.flush();
        await Promise.all(events);
        return 0;
      } finally {
        signals.dispose();
        ready = false;
        await host?.close();
        await control.close();
      }
    }
    if (command === "status") {
      const signals = shutdownSignal();
      try {
        do {
          let data: unknown;
          try {
            data = await query(ctx.socket, "status");
          } catch (e) {
            if (!(e instanceof CliError) || e.exitCode !== 3) throw e;
            data = { state: "stopped", instance: ctx.instance };
          }
          if (o.watch) output.event(command, "status", data);
          else output.success(command, data);
          if (o.watch) await delay(1000, signals.signal);
        } while (o.watch && !signals.signal.aborted);
      } finally {
        signals.dispose();
      }
      return 0;
    }
    if (command.startsWith("sessions ")) {
      if (command === "sessions show" && !o.session)
        throw new CliError(
          "missing_option",
          "sessions show requires --session",
        );
      let data = (await query(ctx.socket, "sessions")) as Array<{
        sessionId: string;
        state?: string;
        status?: string;
      }>;
      if (o.active)
        data = data.filter((s) =>
          ["running", "initializing"].includes(s.state ?? s.status ?? ""),
        );
      if (command === "sessions show") {
        if (!o.session)
          throw new CliError(
            "missing_option",
            "sessions show requires --session",
          );
        const session = data.find((s) => s.sessionId === o.session);
        if (!session)
          throw new CliError("not_found", "Session does not exist", 1);
        output.success(command, session);
      } else output.success(command, { sessions: data });
      return 0;
    }
    if (command === "runtimes list") {
      output.success(command, { runtimes: await runtimes(config) });
      return 0;
    }
    if (command === "doctor") {
      const checks: Array<{ id: string; ok: boolean; detail?: string }> = [];
      const check = async (id: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
          checks.push({ id, ok: true });
        } catch (e) {
          checks.push({
            id,
            ok: false,
            detail: output.redact(
              e instanceof CliError ? e.message : `${id} unavailable`,
            ),
          });
        }
      };
      await check("configuration", () => loadConfig(ctx, true));
      await check("workspace", () =>
        access(config.workspace, constants.R_OK | constants.W_OK),
      );
      await check("token", () => tokenValue(config));
      for (const p of await prerequisite(config))
        checks.push({ id: p.id, ok: p.available });
      await check("connectivity", () => query(ctx.socket, "ping"));
      output.success(command, { healthy: checks.every((c) => c.ok), checks });
      return checks.every((c) => c.ok) ? 0 : 1;
    }
    if (command === "logs") {
      const lines = Number(o.lines ?? 100);
      if (!Number.isSafeInteger(lines) || lines < 1 || lines > 10000)
        throw new CliError(
          "invalid_option",
          "--lines must be an integer from 1 to 10000",
        );
      let records = await readLogs(ctx, lines);
      if (!o.follow) {
        output.success(command, { records });
        return 0;
      }
      const signals = shutdownSignal();
      let last = "";
      try {
        for (const r of records) {
          output.event(command, "log", r);
          last = JSON.stringify(r);
        }
        while (!signals.signal.aborted) {
          await delay(500, signals.signal);
          records = await readLogs(ctx, 10000);
          const index = records.findIndex((r) => JSON.stringify(r) === last);
          for (const r of records.slice(index + 1)) {
            output.event(command, "log", r);
            last = JSON.stringify(r);
          }
        }
      } finally {
        signals.dispose();
      }
      return 0;
    }
    if (command.startsWith("service ")) {
      const action = command.slice(8);
      if (["install", "start", "restart"].includes(action)) {
        await loadConfig(ctx, true);
        await tokenValue(config);
      }
      const definition = service.serviceDefinition(
        ctx.configPath,
        ctx.instance,
      );
      const actions = {
        install: service.installService,
        start: service.startService,
        stop: service.stopService,
        restart: service.restartService,
        status: service.serviceStatus,
        uninstall: service.uninstallService,
      };
      const result = await actions[action as keyof typeof actions](definition);
      if (result.loaded) {
        try {
          const live = (await query(ctx.socket, "status")) as { state: string };
          if (live.state === "running") result.state = "running";
        } catch {}
      }
      output.success(command, result);
      return 0;
    }
    throw new CliError("unknown_command", "Unknown command");
  } catch (error) {
    return output.error(command, error);
  }
}
