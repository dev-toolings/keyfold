import { expect, test } from "bun:test";
import { generatePassphrase, generatePassword, MAX_HISTORY, totpCode, withValue } from "./generate";
import { pwnedCount } from "./hibp";
import type { Item } from "./item";
import { noTotpEntries, strengthBits, weakEntries } from "./stats";
import { EFF_WORDS } from "./wordlist";

test("the wordlist is the one Go embeds", async () => {
  const goList = await Bun.file(new URL("../../../internal/wordlist/eff_large_wordlist.txt", import.meta.url)).text();
  expect(EFF_WORDS).toEqual(goList.trim().split("\n"));
  expect(EFF_WORDS.length).toBe(7776);
});

test("generators", () => {
  expect(generatePassword(64, false)).toMatch(/^[A-Za-z0-9]{64}$/);
  expect(generatePassphrase(6).split("-").length).toBeGreaterThanOrEqual(6);
});

test("TOTP matches RFC 6238 (SHA-1, T = 59 s)", async () => {
  const uri = "otpauth://totp/fake?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8";
  expect((await totpCode(uri, 59_000)).code).toBe("94287082");
  const bare = await totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000);
  expect(bare).toEqual({ code: "287082", remaining: 1, period: 30 });
});

test("withValue keeps the 20 latest values, newest first", () => {
  let item = { value: "fake-0" } as Item;
  for (let i = 1; i <= 25; i++) item = withValue(item, `fake-${i}`, String(i));
  item = withValue(item, "fake-25", "26");
  expect(item.history?.length).toBe(MAX_HISTORY);
  expect(item.history?.[0]).toEqual({ value: "fake-24", changed_at: "25" });
});

test("HIBP sends only the 5 first SHA-1 characters", async () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(url);
    return new Response("0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:42\r\n");
  }) as unknown as typeof fetch;
  expect(await pwnedCount("password", fake)).toBe(42);
  expect(urls).toEqual(["https://api.pwnedpasswords.com/range/5BAA6"]);
  expect(await pwnedCount("fake-unknown-value", fake)).toBe(0);
});

test("strength and missing TOTP", () => {
  expect(strengthBits("abc")).toBeLessThan(20);
  expect(strengthBits(generatePassword(24))).toBeGreaterThan(140);
  expect(strengthBits("fake-word-list-here")).toBeCloseTo(4 * Math.log2(7776));
  const entry = (id: string, item: Partial<Item>) => ({
    id,
    etag: "",
    oldFormat: false,
    item: { v: 2, name: id, kind: "login", value: "", note: "", updated_at: "", ...item } as Item,
  });
  const entries = [
    entry("weak", { value: "fakepass" }),
    entry("bookmark", { value: "" }),
    entry("site", { value: generatePassword(24), urls: ["https://fake.example"] }),
    entry("site2fa", { value: generatePassword(24), urls: ["https://fake.example"], totp: "JBSWY3DPEHPK3PXP" }),
  ];
  expect(weakEntries(entries).map((e) => e.id)).toEqual(["weak"]);
  expect(noTotpEntries(entries).map((e) => e.id)).toEqual(["site"]);
});
