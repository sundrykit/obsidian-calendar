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
import { verifyToken, activate, PRODUCT_SLUG } from "../dist-test/licence.js";

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


/**
 * Activation, which until now could not be tested at all.
 *
 * It called `fetch` directly, so exercising it meant standing up a server or
 * monkey-patching a global. Obsidian's review rejected the bare `fetch` and
 * asked for its own requestUrl; injecting the call instead of importing it
 * satisfies that AND makes these cases reachable.
 *
 * Every one of them is about what a PAYING customer is told. Telling someone
 * their key is invalid when our server fell over is the single most expensive
 * message this plugin can produce.
 */

const okPost = (body) => async () => ({ status: 200, body });

test("activation returns the token the server signed", async () => {
  const res = await activate("ABCD-1234", okPost({ token: "sig.body" }));
  assert.equal(res.ok, true);
  assert.equal(res.token, "sig.body");
});

test("sends the key and the product, to the activate endpoint", async () => {
  let seen = null;
  await activate("  ABCD-1234  ", async (url, body) => {
    seen = { url, body };
    return { status: 200, body: { token: "t" } };
  });
  assert.match(seen.url, /\/activate$/);
  assert.equal(seen.body.key, "ABCD-1234", "the key is trimmed before it is sent");
  assert.equal(seen.body.product, PRODUCT_SLUG);
});

test("an empty key never reaches the network", async () => {
  let called = false;
  const res = await activate("   ", async () => { called = true; return { status: 200, body: {} }; });
  assert.equal(called, false);
  assert.equal(res.ok, false);
});

test("a network failure does not tell a paying customer their licence is bad", async () => {
  const res = await activate("ABCD-1234", async () => { throw new Error("offline"); });
  assert.equal(res.ok, false);
  assert.match(res.message, /your licence is fine/);
});

test("a rejected key says so, and says where to find the right one", async () => {
  const res = await activate("WRONG", async () => ({ status: 400, body: { error: "invalid_licence" } }));
  assert.equal(res.ok, false);
  assert.match(res.message, /not recognised/);
});

test("a server error is not reported as a bad key", async () => {
  const res = await activate("ABCD-1234", async () => ({ status: 500, body: {} }));
  assert.equal(res.ok, false);
  assert.doesNotMatch(res.message, /not recognised/);
});

test("a 200 with no token is a server fault, not a bad key", async () => {
  // The shape that would otherwise save an empty token and silently leave a
  // paying customer on the free tier.
  const res = await activate("ABCD-1234", async () => ({ status: 200, body: {} }));
  assert.equal(res.ok, false);
  assert.doesNotMatch(res.message, /not recognised/);
});
