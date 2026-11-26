import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptEntries } from "./client";
import { decryptItem, encryptBytes, encryptItem, toBase64 } from "./crypto";
import { CLASSIFIED_ITEM_VERSION, ENVIRONMENT_ITEM_VERSION, ITEM_VERSION, type Item, isItem, upgrade } from "./item";

test("validates the full item shape, including minimal Go items and upgraded v1 items", async () => {
  const minimal = { name: "fake-item", value: "", note: "", created_at: "", updated_at: "" };
  const current = { ...minimal, v: ITEM_VERSION, kind: "login" } satisfies Item;
  const full = {
    ...current,
    username: "fake-user",
    urls: ["https://example.invalid"],
    totp: "fake-totp",
    fields: [{ name: "fake-field", value: "fake-value", hidden: true }],
    attachments: [{ id: "0a", name: "fake.txt", size: 0, sha256: "fake-hash" }],
    history: [{ value: "fake-old", changed_at: "2026-01-01T00:00:00Z" }],
    passkeys: [
      {
        credential_id: "fake-credential",
        rp_id: "example.invalid",
        user_handle: "fake-handle",
        user_name: "fake-user",
        private_key: "fake-key",
        counter: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    ssh_key: { private: "fake-private", public: "fake-public", fingerprint: "fake-fingerprint", agent: true },
    favorite: true,
    folder: "fake-folder",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  } satisfies Item;

  expect(
    isItem({
      ...full,
      v: 3,
      project: "fake-project",
      specialty: "Backend",
      languages: ["Go"],
      tags: ["fake-tag"],
      extra: true,
    }),
  ).toBe(true);
  expect(isItem(current)).toBe(true);

  const v1 = { name: "fake-old", kind: "password", value: "fake-value-123", note: "fake-note" };
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const ciphertext = toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(v1)), recipient));
  expect(await decryptEntries([{ id: "0a", etag: "etag-0a", ciphertext }], identity)).toEqual({
    entries: [
      { id: "0a", etag: "etag-0a", oldFormat: true, item: { ...v1, v: ITEM_VERSION, kind: "login", updated_at: "" } },
    ],
    projects: [],
    unreadable: [],
  });

  for (const invalid of [
    { v: 1 },
    { updated_at: undefined },
    { username: null },
    { project: ["fake-project"] },
    { specialty: null },
    { languages: [true] },
    { tags: "fake-tag" },
    { favorite: "true" },
    { urls: null },
    { urls: [...full.urls, null] },
    { fields: [{ ...full.fields[0], hidden: null }] },
    { attachments: [{ ...full.attachments[0], size: "0" }] },
    { history: [{ ...full.history[0], changed_at: false }] },
    { passkeys: [{ ...full.passkeys[0], counter: "0" }] },
    { ssh_key: { ...full.ssh_key, agent: null } },
  ]) {
    expect(isItem({ ...full, ...invalid })).toBe(false);
  }
});

test("reads v5 items and rejects unknown environments", () => {
  const item = { v: 5, name: "fake-item", kind: "token", value: "", note: "", updated_at: "" } satisfies Item;
  const withEnvironment = { ...item, environment: "preprod" };
  expect(ENVIRONMENT_ITEM_VERSION).toBe(5);
  expect(isItem(withEnvironment)).toBe(true);
  expect(upgrade(withEnvironment)).toEqual({ item: withEnvironment, old: false });
  expect(upgrade({ ...item, environment: "" })).toStrictEqual({ item, old: false });
  expect(isItem({ ...item, v: 4 })).toBe(false);
  expect(() => upgrade({ ...item, v: 4 })).toThrow("v4");
  expect(() => upgrade({ ...item, v: 6 })).toThrow("v6");

  const invalid = { ...item, environment: "staging" };
  expect(isItem(invalid)).toBe(false);
  expect(() => upgrade(invalid)).toThrow("prod, preprod, local");
});

test("rewrites a v5 item using the version required by its environment and project", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const item: Item = {
    v: ENVIRONMENT_ITEM_VERSION,
    name: "fake-item",
    kind: "token",
    value: "",
    note: "",
    updated_at: "",
  };
  const withEnvironment: Item = { ...item, environment: "local" };
  const withProject = { ...item, project: "fake-project" };

  expect(await decryptItem(await encryptItem(withEnvironment, recipient), identity)).toEqual(withEnvironment);
  expect(await decryptItem(await encryptItem(item, recipient), identity)).toStrictEqual({ ...item, v: ITEM_VERSION });
  expect(await decryptItem(await encryptItem(withProject, recipient), identity)).toStrictEqual({
    ...withProject,
    v: CLASSIFIED_ITEM_VERSION,
  });
});
