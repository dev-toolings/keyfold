import { expect, test } from "bun:test";
import { ITEM_VERSION, type Item, isItem, upgrade } from "./item";

test("validates the full item shape, including minimal Go items and upgraded v1 items", () => {
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
  expect(isItem(upgrade({ ...minimal, kind: "password" }).item)).toBe(true);

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
