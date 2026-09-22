const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { redact } = require("../src/lib/redact");

describe("credential redaction", () => {
  test("removes platform tokens from messages", () => {
    const cases = [
      ["Facebook: Error validating access token EAABwzLixnjYBO1ZAZCgHtq9ZBkZD for user", "EAABwzLixnjYBO1ZAZCgHtq9ZBkZD"],
      ["Google rejected ya29.a0AfB_byC3xYz-1234567890abcdefg", "ya29.a0AfB_byC3xYz-1234567890abcdefg"],
      ["OpenAI key sk-proj-abcdef1234567890abcdef is invalid", "sk-proj-abcdef1234567890abcdef"],
      ["Gemini key AIzaSyD-1234567890abcdefghijklmn rejected", "AIzaSyD-1234567890abcdefghijklmn"],
      ['{"access_token":"IGQVJYbGxhbXBsZXRva2Vu"} expired', "IGQVJYbGxhbXBsZXRva2Vu"],
      ["Authorization: Bearer abcdef1234567890xyz failed", "abcdef1234567890xyz"],
      ["client_secret=9f8e7d6c5b4a39281706x rejected", "9f8e7d6c5b4a39281706x"],
    ];
    for (const [input, secret] of cases) {
      const out = redact(input);
      assert.ok(!out.includes(secret), `leaked in: ${out}`);
      assert.match(out, /\[redacted\]/);
    }
  });

  test("keeps ordinary error text and platform IDs readable", () => {
    assert.equal(redact("Instagram: The aspect ratio is not supported."), "Instagram: The aspect ratio is not supported.");
    assert.equal(redact("Facebook: (#200) Permissions error"), "Facebook: (#200) Permissions error");
    assert.equal(redact("YouTube: quota exceeded for video 1019610687906644"), "YouTube: quota exceeded for video 1019610687906644");
    assert.equal(redact("Published to https://www.facebook.com/1019610687906644_123456"), "Published to https://www.facebook.com/1019610687906644_123456");
    assert.equal(redact(null), null);
  });
});
