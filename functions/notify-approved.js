const { getSupabase } = require("./lib/supabase");

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
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (_) {}

  const transactionId = body.id || body.transaction_id || body.idTransaction || event.queryStringParameters?.id;

  try {
    const supabase = getSupabase();
    if (transactionId) {
      await supabase
        .from("transactions")
        .update({ status: "APPROVED", paid_at: new Date().toISOString() })
        .eq("transaction_id", transactionId);
    }
  } catch (_) {}

  return jsonResponse(200, { success: true });
};
