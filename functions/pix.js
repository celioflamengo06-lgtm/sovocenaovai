const { getSupabase } = require("./lib/supabase");

const ANTPAY_BASE = "https://antpay.site/api/v1";
const ANTPAY_SECRET = "gw_aa9c9d08cf4d46188dd5476e82deefe902ec33af96aa25c073cce397dee0c6bf";
const ANTPAY_COMPANY_ID = "cmp_faeef7856e7c";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function normalizeAmount(rawAmount) {
  if (rawAmount == null) return { amountCents: 4990, amountNum: 49.9 };
  if (typeof rawAmount === "string") {
    const cleaned = rawAmount.replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return { amountCents: 4990, amountNum: 49.9 };
    if (Number.isInteger(n) && n >= 100) return { amountCents: n, amountNum: n / 100 };
    return { amountCents: Math.max(100, Math.round(n * 100)), amountNum: n };
  }
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return { amountCents: 4990, amountNum: 49.9 };
  if (Number.isInteger(n) && n >= 100) return { amountCents: n, amountNum: n / 100 };
  return { amountCents: Math.max(100, Math.round(n * 100)), amountNum: n };
}

async function postWithRetry(url, payload, headers) {
  const delays = [1000, 2000, 4000];
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.status >= 400 && resp.status < 500) return resp;
      if (resp.ok) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  throw lastErr;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const randDigits = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
  const randId = randDigits(6);
  const rawAmount = body.amount ?? body.valor ?? body.total ?? 4990;
  const { amountCents, amountNum } = normalizeAmount(rawAmount);
  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString().trim();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@example.com`).toString().trim();
  const customerPhone = (body.phone || body.customer_phone || `11${randDigits(9)}`).toString().replace(/\D/g, "");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || randDigits(11)).toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.padEnd(11, "0").slice(0, 11);

  const externalRef = `pedido-${randId}-${Date.now()}`;

  const payload = {
    amountCents,
    description: "Livro Falante",
    externalReference: externalRef,
    client: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      document: customerCpf,
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${ANTPAY_SECRET}`,
  };

  let resp;
  try {
    resp = await postWithRetry(`${ANTPAY_BASE}/pix/payments`, payload, headers);
  } catch (err) {
    return jsonResponse(502, { success: false, error: "Falha ao conectar com gateway: " + String(err) });
  }

  const text = await resp.text();
  if (!resp.ok) {
    return jsonResponse(resp.status, { success: false, error: text || "Erro ao criar cobrança PIX", raw: text });
  }

  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse(500, { success: false, error: "Resposta invalida da gateway", raw: text });
  }

  // AntPay envolve os dados em { ok: true, data: { ... } }
  const data = parsed.data || parsed;

  // qrCode e transactionId estão no nível de data
  const pixCode = data.qrCode || data.qr_code || (data.providerPayload?.data?.pix?.qr_code) || null;
  const qrCodeImage = data.qrCodeBase64 || data.qr_code_base64 || null;
  const transactionId = data.transactionId || data.id || data.transaction_id || null;

  try {
    const supabase = getSupabase();
    await supabase.from("transactions").insert({
      transaction_id: transactionId,
      amount: amountNum,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_cpf: customerCpf,
      customer_phone: customerPhone,
      status: "PENDING",
      brcode: pixCode,
    });
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    pixCode,
    pix_code: pixCode,
    brcode: pixCode,
    payload: pixCode,
    qr_code_image: qrCodeImage,
    transaction_id: transactionId,
    transactionId,
    deposit_id: transactionId,
    status: data.status || "pending",
  });
};
