const { getSupabase } = require("./lib/supabase");

const ANTPAY_BASE = "https://antpay.site/api/v1";
const ANTPAY_SECRET = "gw_aa9c9d08cf4d46188dd5476e82deefe902ec33af96aa25c073cce397dee0c6bf";

const UTMIFY_PIXEL_ID = "6a2200f2ae65ba8b4e8c85c7";
const UTMIFY_TOKEN   = "EAAakRBooZBQABRp8xaEz9T5H3YBvyq1JumM6Ie1LgCUQHERsBOBuo4ZA7WiVfnQ1hdmmpnM14JnsZC7tuAyHxCcEjwKnuGGiOlpL5PtZAovEWD72zPEtFhP49wewKXuhoXeQx5RKczdHZAyKr8Va7jrpk3MNMgT9XDT3hGv5KlnYq3ML2I57tyMrbOvtWugZDZD";

async function sendUtmifyPurchase(txData, transactionId) {
  try {
    const payload = {
      pixelId: UTMIFY_PIXEL_ID,
      orderId: transactionId,
      event: "Purchase",
      value: txData.amount || 37.20,
      currency: "BRL",
      customer: {
        email: txData.customer_email || null,
        phone: txData.customer_phone || null,
        name: txData.customer_name || null,
        document: txData.customer_cpf || null,
      },
    };

    const resp = await fetch("https://tracking.utmify.com.br/tracking/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${UTMIFY_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log(`[UTMify] Purchase enviado - status ${resp.status}: ${text}`);
  } catch (err) {
    console.error("[UTMify] Erro ao enviar Purchase:", err);
  }
}

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

  let transactionId = event.queryStringParameters?.id || event.queryStringParameters?.transactionId;
  if (event.httpMethod === "POST") {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      transactionId = body?.transactionId || body?.id || transactionId;
    } catch {}
  }

  if (!transactionId) {
    return jsonResponse(400, { success: false, error: "Informe o transactionId" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let statusResp;
  let text = "";
  try {
    statusResp = await fetch(`${ANTPAY_BASE}/pix/payments/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ANTPAY_SECRET}`,
      },
      signal: controller.signal,
    });
    text = await statusResp.text();
  } catch (err) {
    clearTimeout(timeout);
    return jsonResponse(502, { success: false, error: "Falha ao consultar status: " + String(err) });
  } finally {
    clearTimeout(timeout);
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!statusResp.ok) {
    return jsonResponse(statusResp.status, { success: false, error: text || "Erro ao consultar pagamento" });
  }

  // AntPay retorna status: "paid" | "pending" | etc.
  const rawStatus = (data.status || "pending").toLowerCase();
  const paid = rawStatus === "paid" || rawStatus === "completed" || rawStatus === "aprovado" || rawStatus === "concluido";
  const status = paid ? "paid" : rawStatus;
  const paidAt = data.paidAt || data.paid_at || data.confirmed_at || null;

  try {
    const supabase = getSupabase();

    if (paid) {
      const { data: txData } = await supabase
        .from("transactions")
        .select("status, customer_name, customer_email, customer_phone, customer_cpf, amount")
        .eq("transaction_id", transactionId)
        .single();

      const alreadyPaid = txData?.status === "paid";

      await supabase
        .from("transactions")
        .update({ status, paid_at: paidAt || new Date().toISOString() })
        .eq("transaction_id", transactionId);

      if (!alreadyPaid && txData) {
        // Disparo server-side do Purchase na UTMify (mais confiável que browser)
        await sendUtmifyPurchase(txData, transactionId);
      }
    } else {
      await supabase
        .from("transactions")
        .update({ status, paid_at: null })
        .eq("transaction_id", transactionId);
    }
  } catch (_) {}

  return jsonResponse(200, {
    success: true,
    transactionId,
    status,
    paid,
    paidAt,
  });
};
