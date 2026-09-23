/**
 * The gate nobody had watched open.
 *
 * verifyToken() used to compare the public key against a literal copy of
 * itself, believing the constant was a placeholder. It was the real key, so the
 * guard matched every time and the function always returned false. A customer
 * could pay, activate successfully, and still be shown the free tier.
 *
 * Nothing caught it, because nothing had ever signed a token and asked the
 * client to accept it. This does exactly that: sign with a throwaway key pair,
 * then make the shipped code say yes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyToken, PRODUCT_SLUG } from "../dist-test/licence.js";

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Build a token exactly the way OPS/licence-server/src/index.js builds one. */
function issue(privateKey, claims) {
  const body = b64u(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = sign(null, new TextEncoder().encode(body), privateKey);
  return body + "." + b64u(sig);
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  // An Ed25519 SPKI is a fixed 12-byte header then the 32-byte raw key.
  return { privateKey, pub: b64u(spki.subarray(spki.length - 32)) };
}

test("a real signed token unlocks Pro", async () => {
  const { privateKey, pub } = keypair();
  const token = issue(privateKey, { p: PRODUCT_SLUG, id: "abc123", t: Date.now() });
  assert.equal(await verifyToken(token, pub), true);
});

test("a token signed by someone else is refused", async () => {
  const mine = keypair();
  const theirs = keypair();
  const token = issue(theirs.privateKey, { p: PRODUCT_SLUG, id: "abc123" });
  assert.equal(await verifyToken(token, mine.pub), false);
});

test("a tampered body is refused", async () => {
  const { privateKey, pub } = keypair();
  const token = issue(privateKey, { p: PRODUCT_SLUG, id: "abc123" });
  const [, sig] = token.split(".");
  const forged = b64u(new TextEncoder().encode(JSON.stringify({ p: PRODUCT_SLUG, id: "zzz" })));
  assert.equal(await verifyToken(forged + "." + sig, pub), false);
});

test("a token for a different product is refused", async () => {
  const { privateKey, pub } = keypair();
  const token = issue(privateKey, { p: "some-other-product", id: "abc123" });
  assert.equal(await verifyToken(token, pub), false);
});

test("rubbish input is refused without throwing", async () => {
  const { pub } = keypair();
  for (const bad of [undefined, "", "nodot", ".", "a.", ".b", "!!!.???"]) {
    assert.equal(await verifyToken(bad, pub), false, JSON.stringify(bad));
  }
});

test("an empty public key fails closed", async () => {
  const { privateKey } = keypair();
  const token = issue(privateKey, { p: PRODUCT_SLUG, id: "abc123" });
  assert.equal(await verifyToken(token, ""), false);
});

test("the shipped public key is present and the right shape", async () => {
  const { PUBLIC_KEY_B64U } = await import("../dist-test/licence.js");
  // 32 raw bytes, base64url, no padding. A wrong shape means no customer can
  // ever unlock Pro, and we would not find out until someone asked for a refund.
  assert.match(PUBLIC_KEY_B64U, /^[A-Za-z0-9_-]{43}$/);
});
