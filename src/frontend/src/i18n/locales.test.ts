import { describe, expect, it } from "vitest";
import enRaw from "./locales/en.json?raw";
import esRaw from "./locales/es.json?raw";

function load(lang: "es" | "en") {
  const dups: string[] = [];
  const text = lang === "es" ? esRaw : enRaw;
  // JSON.parse silently keeps the last of two equal keys — which is how a stray key once replaced a
  // whole translated object. A reviver can't see duplicates, so detect them with a small scanner.
  const stack: Array<Set<string>> = [];
  let i = 0;
  const expectKey: boolean[] = [];
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const str = text.slice(i + 1, j);
      const top = stack[stack.length - 1];
      if (top && expectKey[expectKey.length - 1]) {
        if (top.has(str)) dups.push(str);
        top.add(str);
        expectKey[expectKey.length - 1] = false;
      }
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      stack.push(new Set());
      expectKey.push(true);
    } else if (ch === "}") {
      stack.pop();
      expectKey.pop();
    } else if (ch === "[") {
      stack.push(new Set());
      expectKey.push(false);
    } else if (ch === "]") {
      stack.pop();
      expectKey.pop();
    } else if (ch === ",") {
      if (expectKey.length && stack.length && text.slice(0, i).lastIndexOf("[") < text.slice(0, i).lastIndexOf("{")) {
        expectKey[expectKey.length - 1] = true;
      }
    }
    i += 1;
  }
  return { dups, data: JSON.parse(text) as Record<string, unknown> };
}

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("locale files", () => {
  it("have no duplicated keys inside the same object (a duplicate silently overrides the first)", () => {
    expect(load("es").dups).toEqual([]);
    expect(load("en").dups).toEqual([]);
  });

  it("the client screens have the same keys in Spanish and English", () => {
    const es = new Set(flatKeys((load("es").data.femme as Record<string, unknown>).clients, "clients"));
    const en = new Set(flatKeys((load("en").data.femme as Record<string, unknown>).clients, "clients"));
    // Plural suffixes legitimately differ per language, so compare the base key.
    const base = (k: string) => k.replace(/_(one|other|zero|few|many|two)$/, "");
    const esBase = new Set([...es].map(base));
    const enBase = new Set([...en].map(base));
    expect([...enBase].filter((k) => !esBase.has(k))).toEqual([]);
    expect([...esBase].filter((k) => !enBase.has(k))).toEqual([]);
  });
});
