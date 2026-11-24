// One item that cannot be decrypted must not hide the others. Fake values only.
import { expect, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { decryptEntries } from "./client";
import { encryptItem, toBase64 } from "./crypto";
import type { Item } from "./item";

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

test("a vault without a damaged item reports none", async () => {
  expect(await decryptEntries([], await generateX25519Identity())).toEqual({ entries: [], unreadable: [] });
});
