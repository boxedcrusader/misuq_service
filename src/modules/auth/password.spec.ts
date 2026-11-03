import { hashPassword, verifyPassword } from "./password";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("correct horse battery stapl", stored)).resolves.toBe(false);
  });

  it("never stores the plaintext, and salts every hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toContain("same-password");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$3$")).toBe(true);
  });

  it("reads cost params from the stored hash, not the current constants", async () => {
    // A hash written under different (older/cheaper) params must still
    // verify after the constants change -- simulate by re-encoding.
    const stored = await hashPassword("pw-under-old-params");
    const [, , , , salt] = stored.split("$");
    const { scryptSync } = await import("node:crypto");
    const oldKey = scryptSync("pw-under-old-params", Buffer.from(salt, "base64"), 64, { N: 2 ** 14, r: 8, p: 1 });
    const oldStored = ["scrypt", 2 ** 14, 8, 1, salt, oldKey.toString("base64")].join("$");
    await expect(verifyPassword("pw-under-old-params", oldStored)).resolves.toBe(true);
  });

  it.each([
    ["the old seed placeholder", "not-a-real-hash"],
    ["an empty string", ""],
    ["a different scheme", "bcrypt$10$abc$def$ghi$jkl"],
    ["non-numeric params", "scrypt$x$8$1$c2FsdA==$aGFzaA=="],
    ["an empty salt/hash", "scrypt$16384$8$1$$"],
  ])("returns false (never throws) for %s", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });
});
