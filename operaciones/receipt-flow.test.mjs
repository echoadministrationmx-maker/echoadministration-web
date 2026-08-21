import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { markPaidAndSendReceipt } from "./receipt-flow.mjs";

test("the clean /operaciones URL loads its module from the operations directory", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

  assert.match(
    html,
    /from ['"]\/operaciones\/receipt-flow\.mjs['"];/,
    "a relative module path resolves to /receipt-flow.mjs at the clean production URL",
  );
});

test("marking a payment automatically creates and emails its receipt", async () => {
  const calls = [];

  const result = await markPaidAndSendReceipt({
    paymentIds: [41, 42],
    residentId: 101,
    concepts: [
      { c: "julio", m: 500 },
      { c: "agosto", m: 515 },
    ],
    markPayments: async (ids) => {
      calls.push(["mark", ids]);
      return { ok: true, marcados: 2, adeudo: 0 };
    },
    issueReceipt: async (receipt) => {
      calls.push(["issue", receipt]);
      return {
        ok: true,
        folio: 7001,
        nombre: "Residente Ejemplo",
        ident: "A-101",
        fecha: "21/08/2026",
        email: "resident@example.com",
      };
    },
    sendReceipt: async (delivery) => {
      calls.push(["send", delivery]);
      return { ok: true, enviado_a: delivery.email };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.email.ok, true);
  assert.deepEqual(calls, [
    ["mark", [41, 42]],
    [
      "issue",
      {
        residentId: 101,
        concepts: [
          { c: "Mantenimiento julio", m: 500 },
          { c: "Mantenimiento agosto", m: 515 },
        ],
        total: 1015,
        paymentMethod: "Transferencia",
      },
    ],
    ["send", { folio: 7001, email: "resident@example.com" }],
  ]);
});

test("a missing resident email does not undo the recorded payment", async () => {
  let sent = false;
  const result = await markPaidAndSendReceipt({
    paymentIds: [41],
    residentId: 101,
    concepts: [{ c: "julio", m: 500 }],
    markPayments: async () => ({ ok: true, marcados: 1, adeudo: 0 }),
    issueReceipt: async () => ({ ok: true, folio: 7002, email: "" }),
    sendReceipt: async () => {
      sent = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.email, { ok: false, reason: "missing_email" });
  assert.equal(sent, false);
});

test("a payment failure stops before creating or sending a receipt", async () => {
  let issued = false;
  const result = await markPaidAndSendReceipt({
    paymentIds: [41],
    residentId: 101,
    concepts: [{ c: "julio", m: 500 }],
    markPayments: async () => ({ ok: false }),
    issueReceipt: async () => {
      issued = true;
    },
    sendReceipt: async () => ({ ok: true }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "payment");
  assert.equal(issued, false);
});

test("an email transport error still reports the recorded payment and receipt", async () => {
  const result = await markPaidAndSendReceipt({
    paymentIds: [41],
    residentId: 101,
    concepts: [{ c: "julio", m: 500 }],
    markPayments: async () => ({ ok: true, marcados: 1, adeudo: 0 }),
    issueReceipt: async () => ({
      ok: true,
      folio: 7003,
      email: "resident@example.com",
    }),
    sendReceipt: async () => {
      throw new Error("temporary network failure");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.receipt.folio, 7003);
  assert.deepEqual(result.email, {
    ok: false,
    reason: "send_failed",
    error: "temporary network failure",
  });
});

test("a receipt service error still reports the recorded payment", async () => {
  const result = await markPaidAndSendReceipt({
    paymentIds: [41],
    residentId: 101,
    concepts: [{ c: "julio", m: 500 }],
    markPayments: async () => ({ ok: true, marcados: 1, adeudo: 0 }),
    issueReceipt: async () => {
      throw new Error("receipt service unavailable");
    },
    sendReceipt: async () => ({ ok: true }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage, "receipt");
  assert.equal(result.marked.marcados, 1);
  assert.equal(result.error, "receipt service unavailable");
});
