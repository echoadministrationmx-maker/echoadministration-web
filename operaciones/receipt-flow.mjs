function normalizeEmail(value) {
  return String(value || "").split("/")[0].trim();
}

export async function markPaidAndSendReceipt({
  paymentIds,
  residentId,
  concepts,
  paymentMethod = "Transferencia",
  markPayments,
  issueReceipt,
  sendReceipt,
}) {
  const marked = await markPayments(paymentIds);
  if (!marked || marked.ok === false) {
    return { ok: false, stage: "payment", marked };
  }

  const receiptConcepts = concepts.map(({ c, m }) => ({
    c: `Mantenimiento ${String(c).trim()}`,
    m: Number(m),
  }));
  const total = receiptConcepts.reduce((sum, item) => sum + item.m, 0);
  let receipt;
  try {
    receipt = await issueReceipt({
      residentId,
      concepts: receiptConcepts,
      total,
      paymentMethod,
    });
  } catch (error) {
    return {
      ok: false,
      stage: "receipt",
      marked,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!receipt || receipt.ok === false) {
    return { ok: false, stage: "receipt", marked, receipt };
  }

  const email = normalizeEmail(receipt.email);
  if (!email) {
    return {
      ok: true,
      marked,
      receipt,
      email: { ok: false, reason: "missing_email" },
    };
  }

  let delivery;
  try {
    delivery = await sendReceipt({ folio: receipt.folio, email });
  } catch (error) {
    return {
      ok: true,
      marked,
      receipt,
      email: {
        ok: false,
        reason: "send_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
  return {
    ok: true,
    marked,
    receipt,
    email: delivery?.ok
      ? { ...delivery, ok: true }
      : { ...delivery, ok: false, reason: "send_failed" },
  };
}
