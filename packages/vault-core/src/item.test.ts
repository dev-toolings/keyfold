import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptEntries } from "./client";
import { encryptBytes, toBase64 } from "./crypto";
import { ITEM_VERSION, type Item, isItem } from "./item";

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

  expect(isItem({ ...full, extra: true })).toBe(true);
  expect(isItem(current)).toBe(true);

  const v1 = { name: "fake-old", kind: "password", value: "fake-value-123", note: "fake-note" };
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const ciphertext = toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(v1)), recipient));
  expect(await decryptEntries([{ id: "0a", etag: "etag-0a", ciphertext }], identity)).toEqual({
    entries: [
      { id: "0a", etag: "etag-0a", oldFormat: true, item: { ...v1, v: ITEM_VERSION, kind: "login", updated_at: "" } },
    ],
    unreadable: [],
  });

  for (const invalid of [
    { v: 1 },
    { updated_at: undefined },
    { username: null },
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
