import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/routes/admin.js";
import { loadConfig } from "../src/config.js";
import { decrypt, deriveKeys, encrypt } from "../src/lib/crypto.js";
import { drawCycle } from "../src/lib/draw.js";

describe("drawCycle", () => {
  it("is always one full cycle: nobody draws themselves, everyone gives and receives once", () => {
    for (let n = 3; n <= 12; n++) {
      for (let run = 0; run < 200; run++) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const pairs = drawCycle(ids);
        expect(new Set(pairs.values()).size).toBe(n);
        for (const [g, r] of pairs) expect(g).not.toBe(r);
        // follow the chain from p0: must visit everyone before returning
        let cur = "p0";
        for (let i = 0; i < n; i++) cur = pairs.get(cur)!;
        expect(cur).toBe("p0");
        const seen = new Set<string>();
        cur = "p0";
        do seen.add(cur), (cur = pairs.get(cur)!);
        while (cur !== "p0");
        expect(seen.size).toBe(n);
      }
    }
  });

  it("is roughly uniform over the possible cycles (n=4 has 6)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 12000; i++) {
      const p = drawCycle(["a", "b", "c", "d"]);
      const key = ["a", "b", "c", "d"].map((x) => p.get(x)).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(c).toBeGreaterThan(1700); // expected 2000 each
  });

  it("refuses fewer than 3 people", () => {
    expect(() => drawCycle(["a", "b"])).toThrow();
  });
});

describe("assignment encryption", () => {
  const { assignment } = deriveKeys(randomBytes(32).toString("base64"));
  it("round-trips", () => {
    expect(decrypt(assignment, encrypt(assignment, "giftee-1", "ev:giver"), "ev:giver")).toBe("giftee-1");
  });
  it("can't be moved to another row (AAD mismatch)", () => {
    const c = encrypt(assignment, "giftee-1", "ev:giverA");
    expect(() => decrypt(assignment, c, "ev:giverB")).toThrow();
  });
  it("detects tampering", () => {
    const c = encrypt(assignment, "giftee-1", "x").split(".");
    c[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(assignment, c.join("."), "x")).toThrow();
  });
});

describe("config", () => {
  const base = { APP_ORIGIN: "https://app.example.com", DATABASE_URL: "postgres://x", ASSIGNMENT_KEY: randomBytes(32).toString("base64") };
  it("refuses dev login in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", DEV_LOGIN: "true", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toThrow(/DEV_LOGIN/);
  });
  it("requires Google credentials and https in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/Google/);
    expect(() => loadConfig({ ...base, APP_ORIGIN: "http://x.com", NODE_ENV: "production", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toThrow(/https/);
  });
  it("rejects a short key without printing it", () => {
    expect(() => loadConfig({ ...base, ASSIGNMENT_KEY: "c2hvcnQ=" })).toThrow(/ASSIGNMENT_KEY must be 32 bytes/);
  });
});

describe("parseCsv", () => {
  it("handles quotes, commas and CRLF", () => {
    expect(parseCsv('name,email\r\n"Rao, Aditya",a@x.com\r\n"Say ""hi""",b@x.com\n\n')).toEqual([
      ["name", "email"],
      ["Rao, Aditya", "a@x.com"],
      ['Say "hi"', "b@x.com"],
    ]);
  });
});
