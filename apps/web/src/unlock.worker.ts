/// <reference lib="webworker" />

import { fromBase64, unwrapIdentity } from "@keyfold/vault-core";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async ({ data }: MessageEvent<{ wrappedIdentity: string; password: string }>) => {
  let identity: string | null = null;
  try {
    identity = await unwrapIdentity(fromBase64(data.wrappedIdentity), data.password);
  } catch {
    // A failed unwrap is reported to the form as an incorrect password.
  }
  self.postMessage(identity);
};
