// Proves Go and TypeScript read each other's age files: the passphrase-protected
// identity and an item. Uses `go run` on tools/interop with fake values only.
import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptEntries } from "./client";
import { decryptItem, encryptBytes, encryptItem, fromBase64, toBase64, unwrapIdentity, wrapIdentity } from "./crypto";
import {
  CLASSIFIED_ITEM_VERSION,
  ENVIRONMENT_ITEM_VERSION,
  ITEM_VERSION,
  type Item,
  isItem,
  isProject,
  PROJECT_VERSION,
  type Project,
  upgrade,
} from "./item";

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

test.each([
  ["encrypt", undefined],
  ["encrypt-environment", "preprod"],
] as const)(
  "TypeScript decrypts what Go encrypted (%s)",
  async (mode, environment) => {
    const b = JSON.parse(goInterop(mode)) as { identity: string; recipient: string; item: string };
    const id = await unwrapIdentity(fromBase64(b.identity), password);
    expect(await identityToRecipient(id)).toBe(b.recipient);
    const item = await decryptItem(fromBase64(b.item), id);
    expect(isItem(item)).toBe(true);
    expect(item).toEqual({
      v: environment ? ENVIRONMENT_ITEM_VERSION : CLASSIFIED_ITEM_VERSION,
      name: "fake-go-name",
      kind: "login",
      value: "fake-go-value-123",
      note: "fake note é",
      username: "fake-go-user",
      urls: ["https://fake.example"],
      fields: [{ name: "fake-field", value: "fake-field-value", hidden: true }],
      project: "fake-project",
      ...(environment && { environment }),
      specialty: "Backend",
      languages: ["Go"],
      tags: ["fake-tag"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  },
  60_000,
);

test.each([
  ["v3", undefined],
  ["v5", "preprod"],
] as const)(
  "Go decrypts what TypeScript encrypted (%s)",
  async (_version, environment) => {
    const id = await generateX25519Identity();
    const recipient = await identityToRecipient(id);
    const item: Item = {
      v: ITEM_VERSION,
      name: "fake-ts-name",
      kind: "login",
      value: "fake-passphrase-123",
      note: "fake note à",
      username: "fake-ts-user",
      urls: ["https://fake.example"],
      fields: [{ name: "fake-field", value: "fake-field-value", hidden: true }],
      project: "fake-web",
      ...(environment && { environment }),
      specialty: "Frontend",
      languages: ["TypeScript", "CSS"],
      tags: ["fake-tag", "fake-other"],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    const bundle = {
      identity: toBase64(await wrapIdentity(id, password, 10)),
      recipient,
      item: toBase64(await encryptItem(item, recipient)),
    };
    expect(JSON.parse(goInterop("decrypt", JSON.stringify(bundle)))).toEqual({
      ...item,
      v: environment ? ENVIRONMENT_ITEM_VERSION : CLASSIFIED_ITEM_VERSION,
    });
  },
  60_000,
);

const v5 = {
  v: ENVIRONMENT_ITEM_VERSION,
  name: "fake-token",
  kind: "token",
  value: "",
  note: "",
  updated_at: "",
} satisfies Item;

test.each([
  ["encrypt-null-v2", ITEM_VERSION],
  ["encrypt-null-v3", CLASSIFIED_ITEM_VERSION],
] as const)(
  "Go and TypeScript treat a null environment as absent (%s)",
  async (mode, v) => {
    const encoded = goInterop(mode);
    const b = JSON.parse(encoded) as { identity: string; recipient: string; item: string };
    const id = await unwrapIdentity(fromBase64(b.identity), password);
    const expected = { ...v5, v, created_at: "" };
    expect(JSON.parse(goInterop("decrypt", encoded))).toStrictEqual(expected);
    const listing = await decryptEntries([{ id: "fake-token", etag: "", ciphertext: b.item }], id);
    expect(listing.unreadable).toEqual([]);
    expect(listing.entries[0]?.item).toStrictEqual(expected);
  },
  60_000,
);

test.each([
  ["absent environment", {}, true],
  ["null environment", { environment: null }, true],
  ["invalid environment", { environment: "staging" }, false],
  ...["name", "kind", "value", "note", "updated_at"].flatMap((field) => [
    [`missing ${field}`, { [field]: undefined }, false] as const,
    [`null ${field}`, { [field]: null }, false] as const,
  ]),
] as const)(
  "Go and TypeScript agree on v5 with %s",
  async (_name, overrides, valid) => {
    const encoded = goInterop("encrypt-raw", JSON.stringify({ ...v5, ...overrides }));
    const b = JSON.parse(encoded) as { identity: string; item: string };
    const id = await unwrapIdentity(fromBase64(b.identity), password);
    const listing = await decryptEntries([{ id: "fake-v5", etag: "", ciphertext: b.item }], id);
    if (valid) {
      expect(JSON.parse(goInterop("decrypt", encoded))).toMatchObject(v5);
      expect(listing.unreadable).toEqual([]);
      expect(listing.entries[0]?.item).toStrictEqual(v5);
    } else {
      expect(() => goInterop("decrypt", encoded)).toThrow("interop:");
      expect(listing.unreadable).toEqual(["fake-v5"]);
    }
  },
  60_000,
);

test("Go reads the same encrypted project format as TypeScript", async () => {
  const id = await generateX25519Identity();
  const recipient = await identityToRecipient(id);
  const stamp = "2026-01-01T00:00:00Z";
  const project: Project = {
    v: PROJECT_VERSION,
    kind: "project",
    name: "fake-Cafe\u0301",
    name_key: "fake-café",
    specialty: "Backend",
    languages: ["Go", "TypeScript"],
    tags: ["fake-tag"],
    created_at: stamp,
    updated_at: stamp,
  };
  const bundle = {
    identity: toBase64(await wrapIdentity(id, password, 10)),
    recipient,
    item: toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(project)), recipient)),
  };
  const decoded = JSON.parse(goInterop("decrypt", JSON.stringify(bundle)));
  expect(isProject(decoded)).toBe(true);
  expect(decoded).toMatchObject(project);
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
