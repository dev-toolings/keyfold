// KPI computations on clearly fake entries.
import { describe, expect, test } from "bun:test";
import type { Entry, Item } from "./item";
import {
  countByKind,
  flaggedIds,
  growthByMonth,
  hasEnoughHistory,
  monthlyAverage,
  passwordEntries,
  recentEntries,
  reusedGroups,
  shortEntries,
  staleEntries,
  updatesByMonth,
} from "./stats";

const now = new Date(2026, 5, 15, 12); // 15 June 2026, local time

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function entry(id: string, item: Partial<Item>): Entry {
  return {
    id,
    etag: "",
    oldFormat: false,
    item: {
      v: 2,
      name: id,
      kind: "login",
      value: `fake-value-${id}-0123456789`,
      note: "",
      updated_at: daysAgo(1),
      ...item,
    },
  };
}

describe("stale", () => {
  test("keeps items older than 90 days, oldest first", () => {
    const entries = [
      entry("a", { updated_at: daysAgo(91) }),
      entry("b", { updated_at: daysAgo(90) }),
      entry("c", { updated_at: daysAgo(200) }),
    ];
    expect(staleEntries(entries, now).map((e) => e.id)).toEqual(["c", "a"]);
  });

  test("is empty when nothing is older than 90 days", () => {
    expect(staleEntries([entry("a", { updated_at: daysAgo(10) })], now)).toEqual([]);
  });
});

describe("reused", () => {
  test("groups identical secret values and ignores notes", () => {
    const entries = [
      entry("a", { value: "fake-passphrase-123" }),
      entry("b", { kind: "token", value: "fake-passphrase-123" }),
      entry("c", { kind: "note", value: "fake-passphrase-123" }),
      entry("d", { kind: "ssh-passphrase", value: "fake-shared-456" }),
      entry("e", { value: "fake-shared-456" }),
      entry("f", { value: "fake-unique-789" }),
    ];
    const groups = reusedGroups(entries).map((g) => g.map((e) => e.id));
    expect(groups).toEqual([
      ["a", "b"],
      ["d", "e"],
    ]);
  });
});

describe("short", () => {
  test("flags passwords and passphrases under 16 characters", () => {
    const entries = [
      entry("a", { value: "fake-pass-12345" }), // 15
      entry("b", { value: "fake-pass-123456" }), // 16
      entry("c", { kind: "ssh-passphrase", value: "fake-ssh" }),
      entry("d", { kind: "token", value: "fake" }),
    ];
    expect(shortEntries(entries).map((e) => e.id)).toEqual(["a", "c"]);
    expect(passwordEntries(entries)).toHaveLength(3);
  });
});

test("recent counts items modified within 7 days", () => {
  const entries = [entry("a", { updated_at: daysAgo(2) }), entry("b", { updated_at: daysAgo(8) })];
  expect(recentEntries(entries, now).map((e) => e.id)).toEqual(["a"]);
});

test("countByKind includes kinds with no items", () => {
  expect(countByKind([entry("a", {}), entry("b", { kind: "note" })])).toEqual({
    login: 1,
    token: 0,
    note: 1,
    identity: 0,
    "ssh-key": 0,
    "ssh-passphrase": 0,
  });
});

test("flaggedIds maps each filter to its ids", () => {
  const entries = [
    entry("a", { updated_at: daysAgo(120), value: "fake-short" }),
    entry("b", { value: "fake-dup-0123456789" }),
    entry("c", { value: "fake-dup-0123456789" }),
  ];
  const flags = flaggedIds(entries, now);
  expect([...flags.stale]).toEqual(["a"]);
  expect([...flags.short]).toEqual(["a"]);
  expect([...flags.reused]).toEqual(["b", "c"]);
});

describe("growth", () => {
  test("is cumulative per month from created_at, with gaps filled", () => {
    const entries = [
      entry("a", { created_at: new Date(2026, 1, 10).toISOString() }),
      entry("b", { created_at: new Date(2026, 1, 20).toISOString() }),
      entry("c", { created_at: new Date(2026, 3, 5).toISOString() }),
    ];
    expect(growthByMonth(entries, now)).toEqual([
      { month: "2026-02", count: 2 },
      { month: "2026-03", count: 2 },
      { month: "2026-04", count: 3 },
      { month: "2026-05", count: 3 },
      { month: "2026-06", count: 3 },
    ]);
  });

  test("falls back to updated_at when created_at is missing or empty", () => {
    const entries = [
      entry("a", { updated_at: new Date(2026, 4, 3).toISOString() }),
      entry("b", { created_at: "", updated_at: new Date(2026, 4, 9).toISOString() }),
    ];
    expect(growthByMonth(entries, now)).toEqual([
      { month: "2026-05", count: 2 },
      { month: "2026-06", count: 2 },
    ]);
  });
});

describe("updates per month", () => {
  test("counts last modifications per month and averages them", () => {
    const entries = [
      entry("a", { updated_at: new Date(2026, 2, 2).toISOString() }),
      entry("b", { updated_at: new Date(2026, 2, 9).toISOString() }),
      entry("c", { updated_at: new Date(2026, 5, 1).toISOString() }),
    ];
    const series = updatesByMonth(entries, now);
    expect(series).toEqual([
      { month: "2026-03", count: 2 },
      { month: "2026-04", count: 0 },
      { month: "2026-05", count: 0 },
      { month: "2026-06", count: 1 },
    ]);
    expect(monthlyAverage(series)).toBe(0.75);
    expect(hasEnoughHistory(series)).toBe(true);
  });

  test("fewer than 4 months is not enough history", () => {
    const series = updatesByMonth([entry("a", { updated_at: new Date(2026, 3, 20).toISOString() })], now);
    expect(series).toHaveLength(3);
    expect(hasEnoughHistory(series)).toBe(false);
  });

  test("an empty vault has no series and a zero average", () => {
    expect(updatesByMonth([], now)).toEqual([]);
    expect(monthlyAverage([])).toBe(0);
  });
});

test("same health rules as Go (internal/vault/testdata/health.json)", async () => {
  const c = await Bun.file(new URL("../../../internal/vault/testdata/health.json", import.meta.url)).json();
  const entries: Entry[] = c.items.map((item: Item) => ({ id: item.name, etag: "", oldFormat: false, item }));
  const flags = flaggedIds(entries, new Date(c.now));
  const names = (f: keyof typeof flags) => [...flags[f]].sort();
  expect({
    items: entries.length,
    stale: names("stale"),
    reused: names("reused"),
    short: names("short"),
    weak: names("weak"),
    no_totp: names("no2fa"),
  }).toEqual(c.want);
});
