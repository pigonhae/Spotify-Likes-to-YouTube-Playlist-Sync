import { describe, expect, it } from "vitest";

import { TokenCipher } from "../src/lib/crypto.js";

describe("TokenCipher", () => {
  it("encrypts and decrypts a token", () => {
    const cipher = new TokenCipher("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const plaintext = "refresh-token-value";

    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });
});
