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

  try {
    const supabase = getSupabase();
    await supabase.from("comprovantes").insert({
      transaction_id: body.transaction_id || body.id || null,
      cpf: body.cpf || null,
      nome: body.nome || null,
      arquivo: body.arquivo || body.file || body.url || null,
      extra: body,
    });
  } catch (_) {}

  return jsonResponse(200, { success: true });
};
