// Proves Go and TypeScript read each other's age files: the passphrase-protected
// identity and an item. Uses `go run` on tools/interop with fake values only.
import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptItem, encryptItem, fromBase64, toBase64, unwrapIdentity, wrapIdentity } from "./crypto";
import { type Item, upgrade } from "./item";

const repoRoot = new URL("../../..", import.meta.url).pathname;
const password = "fake-master-123";

function goInterop(mode: string, stdin?: string): string {
  const p = Bun.spawnSync(["go", "run", "./tools/interop", mode, password], {
    cwd: repoRoot,
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
  });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString();
}

test("TypeScript decrypts what Go encrypted", async () => {
  const b = JSON.parse(goInterop("encrypt")) as { identity: string; recipient: string; item: string };
  const id = await unwrapIdentity(fromBase64(b.identity), password);
  expect(await identityToRecipient(id)).toBe(b.recipient);
  const item = await decryptItem(fromBase64(b.item), id);
  expect(item).toEqual({
    v: 2,
    name: "fake-go-name",
    kind: "login",
    value: "fake-go-value-123",
    note: "fake note é",
    username: "fake-go-user",
    urls: ["https://fake.example"],
    fields: [{ name: "fake-field", value: "fake-field-value", hidden: true }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
}, 60_000);

test("Go decrypts what TypeScript encrypted", async () => {
  const id = await generateX25519Identity();
  const recipient = await identityToRecipient(id);
  const item: Item = {
    v: 2,
    name: "fake-ts-name",
    kind: "login",
    value: "fake-passphrase-123",
    note: "fake note à",
    username: "fake-ts-user",
    urls: ["https://fake.example"],
    fields: [{ name: "fake-field", value: "fake-field-value", hidden: true }],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
  const bundle = {
    identity: toBase64(await wrapIdentity(id, password, 10)),
    recipient,
    item: toBase64(await encryptItem(item, recipient)),
  };
  expect(JSON.parse(goInterop("decrypt", JSON.stringify(bundle)))).toEqual(item);
}, 60_000);

test("a v1 item is read upgraded, and never written", async () => {
  const id = await generateX25519Identity();
  const recipient = await identityToRecipient(id);
  const v1 = {
    name: "fake-old",
    kind: "password",
    value: "fake-value-123",
    note: "",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const { item, old } = upgrade(v1);
  expect(old).toBe(true);
  expect(item.v).toBe(2);
  expect(item.kind).toBe("login");
  await expect(encryptItem({ ...v1, v: 1, kind: "login" }, recipient)).rejects.toThrow();
});
