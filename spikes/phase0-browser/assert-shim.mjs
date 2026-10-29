// THROWAWAY: minimal stand-in for Node's `assert` so monero-ts bundles for the browser.
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
assert.ok = assert;
assert.equal = (a, b, msg) => { if (a != b) throw new Error(msg || `Assertion failed: ${a} != ${b}`); };
assert.deepEqual = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || "Assertion failed: deepEqual"); };
export default assert;
