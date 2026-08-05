import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CivId } from "../shared/types";

export interface Identity {
  secret: string;
  serverUrl: string;
  islandName?: string;
  playerUrl?: string;
  /** the civilization this machine rules — what a re-founding rebuilds from */
  civ?: CivId;
  /** true once this machine's key completed the owner handshake */
  paired?: boolean;
}

const DIR = join(homedir(), ".claudilization");
const FILE = join(DIR, "identity.json");

export function loadIdentity(): Identity | null {
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Identity;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  writeFileSync(FILE, JSON.stringify(identity, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

export function identityPath(): string {
  return FILE;
}
