import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the current change. Route handlers run their work inside
 * `runAs(...)` with the GitHub login behind the active token, so every
 * activity event written during that request is attributed to that person
 * without threading a parameter through every service function.
 */
export interface Actor {
  name: string;
  kind: "person" | "agent";
}

const store = new AsyncLocalStorage<Actor | null>();

export function runAs<T>(actor: Actor | null, fn: () => T): T {
  return store.run(actor, fn);
}

export function currentActor(): Actor | null {
  return store.getStore() ?? null;
}
