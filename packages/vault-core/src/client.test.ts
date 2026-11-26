// One item that cannot be decrypted must not hide the others. Fake values only.
import { expect, spyOn, test } from "bun:test";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import {
  ConflictError,
  decryptEntries,
  InstallTokenError,
  isLoopbackHost,
  LockedError,
  selectSaveTarget,
  VaultClient,
  type VaultSession,
} from "./client";
import { encryptBytes, encryptItem, toBase64, wrapIdentity } from "./crypto";
import type { Entry, Item, Project } from "./item";

test("the page hostname is loopback only for local names and addresses", () => {
  for (const hostname of ["localhost", "127.0.0.1", "127.0.0.2", "127.255.255.255", "::1", "[::1]"]) {
    expect(isLoopbackHost(hostname)).toBe(true);
  }
  for (const hostname of ["192.168.1.10", "vault.example", "127.example", "127.0.0.256"]) {
    expect(isLoopbackHost(hostname)).toBe(false);
  }
});

test.each([
  {
    name: "install token refusal",
    response: Response.json(
      { error: "X-Install-Token is required and must match the install token in the server log" },
      { status: 403 },
    ),
    message: "Jeton d'installation manquant ou incorrect. Il figure dans le journal du serveur au premier démarrage.",
    isTokenError: true,
  },
  {
    name: "forbidden host",
    response: Response.json({ error: "forbidden host" }, { status: 403 }),
    message: "forbidden host",
    isTokenError: false,
  },
  {
    name: "cross-origin refusal",
    response: new Response("cross-origin request detected from Sec-Fetch-Site header\n", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
    message: "erreur serveur 403",
    isTokenError: false,
  },
])("vault creation handles $name", async ({ response, message, isTokenError }) => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(response);
  try {
    const creation = new VaultClient().create("fake-install-master-password");
    await expect(creation).rejects.toThrow(message);
    if (isTokenError) {
      await expect(creation).rejects.toBeInstanceOf(InstallTokenError);
    } else {
      await expect(creation).rejects.not.toBeInstanceOf(InstallTokenError);
    }
  } finally {
    fetchMock.mockRestore();
  }
});

test("unlock retries a wrong password with the identity already downloaded using TOTP", async () => {
  const password = "fake-unlock-password";
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const wrapped = toBase64(await wrapIdentity(identity, password, 10));
  const answer = Uint8Array.of(1, 2, 3);
  const ciphertext = toBase64(await encryptBytes(answer, recipient));
  const fetchMock = spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected vault request"))
    .mockResolvedValueOnce(Response.json({ identity: wrapped, recipient }))
    .mockResolvedValueOnce(Response.json({ id: "fake-challenge", ciphertext }))
    .mockResolvedValueOnce(Response.json({ token: "fake-session" }))
    .mockResolvedValueOnce(Response.json([]));
  try {
    const client = new VaultClient();
    await expect(client.unlock("wrong-password", "123456")).rejects.toThrow("Mot de passe incorrect.");
    expect(client.isUnlocked()).toBe(false);
    expect(client.hasDownloadedIdentity()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-TOTP-Code")).toBe("123456");

    await client.unlock(password);
    expect(client.isUnlocked()).toBe(true);
    expect(client.hasDownloadedIdentity()).toBe(false);
    await client.listItems();
    expect(fetchMock.mock.calls.map(([url, options]) => [options?.method, url])).toEqual([
      ["GET", "/api/v1/identity"],
      ["POST", "/api/v1/challenge"],
      ["POST", "/api/v1/session"],
      ["GET", "/api/v1/items"],
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ id: "fake-challenge", answer: toBase64(answer) }));
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("Authorization")).toBe("Bearer fake-session");
  } finally {
    fetchMock.mockRestore();
  }
});

test.each(["lock", "expiry"] as const)("a resumed session clears its credentials on %s", async (action) => {
  let stored: VaultSession | null = {
    identity: "fake-identity",
    recipient: "fake-recipient",
    token: "fake-session",
  };
  class ResumedClient extends VaultClient {
    constructor() {
      super();
      this.setSession(stored);
    }

    protected override setSession(session: VaultSession | null): void {
      super.setSession(session);
      stored = session;
    }
  }
  const client = new ResumedClient();
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, {
      status: action === "lock" ? 204 : 401,
    }),
  );
  try {
    expect(client.isUnlocked()).toBe(true);
    if (action === "lock") await client.lock();
    else await expect(client.listItems()).rejects.toBeInstanceOf(LockedError);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer fake-session");
    expect(stored).toBeNull();
    expect(client.isUnlocked()).toBe(false);
  } finally {
    fetchMock.mockRestore();
  }
});

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
    projects: [],
    unreadable: [],
  });
  expect(await decryptEntries([], identity)).toEqual({ entries: [], projects: [], unreadable: [] });
});

test("an empty encrypted project can be listed and deleted with its ETag", async () => {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const project: Project = {
    v: 4,
    kind: "project",
    name: "fake-project",
    name_key: "fake-project",
    specialty: "Backend",
    languages: ["Go"],
    tags: ["fake-tag"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const ciphertext = toBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(project)), recipient));
  const listing = await decryptEntries([{ id: "0a", etag: "0a-etag", ciphertext }], identity);
  expect(listing).toEqual({
    entries: [],
    projects: [{ id: "0a", etag: "0a-etag", project }],
    unreadable: [],
  });

  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  try {
    await new VaultClient().deleteProject(listing.projects[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/items/0a", {
      method: "DELETE",
      body: undefined,
      headers: { "If-Match": "0a-etag" },
    });
  } finally {
    fetchMock.mockRestore();
  }
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

  expect(listing).toEqual({ entries: [], projects: [], unreadable: ["0a", "0b", "0c", "0d", "0e"] });
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
