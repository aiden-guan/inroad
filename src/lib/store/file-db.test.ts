import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileDB } from "./file-db";
import { DATA_DIR } from "./settings";

/**
 * The store every data file goes through: each save is atomic and serialized, a failed update changes nothing,
 * and a reader's snapshot never changes under it. Saves are compact JSON, and each draft is parsed from the
 * text the last save wrote (no deep clone of the whole state per save).
 */

interface Doc {
  rev: number;
  items: { id: string; n: number }[];
  note?: string;
}

let seq = 0;
function db(initial: Doc = { rev: 0, items: [] }) {
  const name = `db-${++seq}.json`;
  return { db: new FileDB<Doc>(name, () => structuredClone(initial)), file: path.join(DATA_DIR, name) };
}
const onDisk = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as Doc;

describe("saving", () => {
  it("writes compact JSON atomically, leaving no temp file, and hands back the text it wrote", async () => {
    const { db: d, file } = db();
    const { state, value, json } = await d.update((draft) => {
      draft.items.push({ id: "a", n: 1 });
      return "added";
    });
    expect(value).toBe("added");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toBe('{"rev":0,"items":[{"id":"a","n":1}]}');
    expect(json).toBe(text);
    expect(d.json()).toBe(text);
    expect(state).toEqual(JSON.parse(text));
    expect(fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(path.basename(file)) && f !== path.basename(file))).toEqual([]);
  });

  it("runs concurrent updates one at a time, each on the previous one's result", async () => {
    const { db: d, file } = db();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        d.update((draft) => {
          draft.rev += 1;
          draft.items.push({ id: `i${i}`, n: draft.rev });
        }),
      ),
    );
    expect(onDisk(file).rev).toBe(20);
    expect(onDisk(file).items.map((x) => x.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(d.read()).toEqual(onDisk(file));
  });

  it("changes nothing, on disk or in memory, when an update throws halfway", async () => {
    const { db: d, file } = db();
    await d.update((draft) => void draft.items.push({ id: "a", n: 1 }));
    const before = fs.readFileSync(file, "utf8");
    await expect(
      d.update((draft) => {
        draft.items[0].n = 99;
        draft.note = "half done";
        throw new Error("invalid action");
      }),
    ).rejects.toThrow("invalid action");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(d.read()).toEqual({ rev: 0, items: [{ id: "a", n: 1 }] });
    // The queue goes on after a failure.
    await d.update((draft) => void (draft.rev = 7));
    expect(onDisk(file)).toEqual({ rev: 7, items: [{ id: "a", n: 1 }] });
  });

  it("never changes a snapshot a reader already holds", async () => {
    const { db: d } = db({ rev: 0, items: [{ id: "a", n: 1 }] });
    const held = d.read();
    await d.update((draft) => {
      draft.items[0].n = 2;
      draft.items.push({ id: "b", n: 3 });
    });
    expect(held).toEqual({ rev: 0, items: [{ id: "a", n: 1 }] });
    expect(d.read().items).toEqual([
      { id: "a", n: 2 },
      { id: "b", n: 3 },
    ]);
  });

  it("reads a file an older version pretty-printed, and saves it compact", async () => {
    const { db: d, file } = db();
    fs.writeFileSync(file, JSON.stringify({ rev: 3, items: [{ id: "a", n: 1 }] }, null, 2));
    expect(d.read().rev).toBe(3);
    expect(JSON.parse(d.json())).toEqual({ rev: 3, items: [{ id: "a", n: 1 }] });
    await d.update((draft) => void (draft.rev += 1));
    expect(fs.readFileSync(file, "utf8")).toBe('{"rev":4,"items":[{"id":"a","n":1}]}');
  });

  it("replaces the whole state, and refuses to when the file on disk can't be read", async () => {
    const { db: d, file } = db();
    await d.update((draft) => void (draft.note = "old"));
    expect(await d.replace({ rev: 9, items: [] })).toEqual({ rev: 9, items: [] });
    expect(onDisk(file)).toEqual({ rev: 9, items: [] });

    const broken = db();
    fs.writeFileSync(broken.file, "{ not json");
    await expect(broken.db.replace({ rev: 1, items: [] })).rejects.toThrow(/could not be read/);
    expect(fs.readFileSync(broken.file, "utf8")).toBe("{ not json");
    expect(fs.readdirSync(DATA_DIR).some((f) => f.startsWith(`${path.basename(broken.file)}.corrupt-`))).toBe(true);
  });
});
