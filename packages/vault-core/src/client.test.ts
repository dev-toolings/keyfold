// One item that cannot be decrypted must not hide the others. Fake values only.
import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { ConflictError, decryptEntries, selectSaveTarget } from "./client";
import { encryptBytes, encryptItem, toBase64 } from "./crypto";
import type { Entry, Item } from "./item";

test("an unreadable item is reported by id and the others are listed", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const stored = async (id: string, item: Item) => ({
    id,
    etag: `etag-${id}`,
    ciphertext: toBase64(await encryptItem(item, recipient)),
  });
  const stamp = "2026-01-01T00:00:00Z";
  const zeta: Item = { v: 2, name: "fake-zeta", kind: "login", value: "fake-value-1", note: "", updated_at: stamp };
  const alpha: Item = { v: 2, name: "fake-alpha", kind: "token", value: "fake-value-2", note: "", updated_at: stamp };
  const other = await identityToRecipient(await generateX25519Identity());

  const listing = await decryptEntries(
    [
      await stored("0c", zeta),
      { id: "0b", etag: "etag-0b", ciphertext: toBase64(new TextEncoder().encode("not an age file")) },
      await stored("0a", alpha),
      // Encrypted to another vault: whole, and still not readable here.
      { id: "0d", etag: "etag-0d", ciphertext: toBase64(await encryptItem(alpha, other)) },
    ],
    identity,
  );

  expect(listing.entries.map((e) => [e.id, e.etag, e.item.name, e.item.value])).toEqual([
    ["0a", "etag-0a", "fake-alpha", "fake-value-2"],
    ["0c", "etag-0c", "fake-zeta", "fake-value-1"],
  ]);
  expect(listing.unreadable).toEqual(["0b", "0d"]);
});

test("a vault whose items are all readable reports none", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const item: Item = {
    v: 2,
    name: "fake-name",
    kind: "note",
    value: "fake-value",
    note: "",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const stored = { id: "0a", etag: "etag-0a", ciphertext: toBase64(await encryptItem(item, recipient)) };

  expect(await decryptEntries([stored], identity)).toEqual({
    entries: [{ id: "0a", etag: "etag-0a", item, oldFormat: false }],
    unreadable: [],
  });
  expect(await decryptEntries([], identity)).toEqual({ entries: [], unreadable: [] });
});

test("malformed URLs and notes are unreadable while valid items are listed", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const stored = async (id: string, content: object) => ({
    id,
    etag: `etag-${id}`,
    ciphertext: toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(content)), recipient)),
  });
  const item: Item = { v: 2, name: "fake-alpha", kind: "login", value: "fake-value", note: "", updated_at: "" };
  const other = { ...item, name: "fake-zeta" };

  const listing = await decryptEntries(
    [
      await stored("0d", other),
      await stored("0b", { ...item, urls: [null] }),
      await stored("0c", { ...item, note: 123 }),
      await stored("0a", item),
    ],
    identity,
  );

  expect(listing.unreadable).toEqual(["0b", "0c"]);
  expect(listing.entries.map(({ id, item }) => [id, item.name])).toEqual([
    ["0a", "fake-alpha"],
    ["0d", "fake-zeta"],
  ]);
});

test("a newer format and a file that is not an item are unreadable, not shown", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const stored = async (id: string, content: object) => ({
    id,
    etag: `etag-${id}`,
    // encryptItem only writes the current format: these are age files of any JSON.
    ciphertext: toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(content)), recipient)),
  });

  const listing = await decryptEntries(
    [
      await stored("0a", { v: 99, name: "fake-newer", kind: "login", value: "fake-value", note: "", updated_at: "" }),
      await stored("0b", { v: 2 }),
      await stored("0c", { v: 2, name: "fake-no-value", kind: "login" }),
      await stored("0d", { v: 2, name: "fake-kind", kind: "unknown", value: "fake-value" }),
      await stored("0e", { v: 2, name: "fake-list", kind: "login", value: "fake-value", attachments: "none" }),
    ],
    identity,
  );

  expect(listing).toEqual({ entries: [], unreadable: ["0a", "0b", "0c", "0d", "0e"] });
});

test("save finds the fresh name holder and uses the page entry for an overwrite", () => {
  const item: Item = { v: 2, name: "fake-edit", kind: "login", value: "fake-value", note: "", updated_at: "" };
  const edited: Entry = { id: "0a", etag: "page-edit", item, oldFormat: false };
  const known: Entry = { id: "0b", etag: "page-known", item: { ...item, name: "fake-old" }, oldFormat: false };
  const renamed: Entry = { ...known, etag: "fresh-known", item: { ...known.item, name: "fake-current" } };
  const page = [edited, known];
  const fresh = [{ ...edited, etag: "fresh-edit" }, renamed];

  expect(selectSaveTarget(page, fresh, edited.id, "fake-old")).toBe(edited);
  expect(selectSaveTarget(page, fresh, null, "fake-old")).toBeNull();
  expect(selectSaveTarget(page, fresh, edited.id, "fake-current")).toBe(known);
  expect(() => selectSaveTarget([edited], fresh, edited.id, "fake-current")).toThrow(ConflictError);

  const duplicate: Entry = { ...edited, etag: "fresh-edit", item: { ...item, name: "fake-current" } };
  expect(() => selectSaveTarget([edited], [duplicate, renamed], edited.id, "fake-current")).toThrow(ConflictError);
  expect(() => selectSaveTarget([edited], [renamed, duplicate], edited.id, "fake-current")).toThrow(ConflictError);
  expect(selectSaveTarget(page, [renamed, duplicate], edited.id, "fake-current")).toBe(edited);
});
