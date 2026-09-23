import { timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import type { ToolBridgeDescriptor } from "./tool-bridge-types";

export function parseRecord(
  raw: string,
  maxBytes: number,
): Record<string, unknown> | null {
  if (Buffer.byteLength(raw) > maxBytes) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

export function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function bearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/iu.exec(value?.trim() ?? "");
  return match?.[1] ?? "";
}

export function sanitizeDescriptors(
  descriptors: ToolBridgeDescriptor[],
): ToolBridgeDescriptor[] {
  if (!Array.isArray(descriptors) || descriptors.length > 128) {
    throw new Error("Invalid app tool descriptor snapshot");
  }
  const names = new Set<string>();
  return descriptors
    .map((descriptor) => {
      if (
        !/^[a-z][a-z0-9_]{0,63}$/u.test(descriptor.name) ||
        names.has(descriptor.name) ||
        typeof descriptor.description !== "string" ||
        descriptor.inputSchema?.type !== "object"
      ) {
        throw new Error("Invalid app tool descriptor");
      }
      names.add(descriptor.name);
      return JSON.parse(JSON.stringify(descriptor)) as ToolBridgeDescriptor;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
