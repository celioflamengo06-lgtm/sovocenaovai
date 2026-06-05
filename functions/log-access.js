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
    await supabase.from("access_logs").insert({
      ip: event.headers["x-forwarded-for"] || event.headers["client-ip"] || null,
      user_agent: event.headers["user-agent"] || null,
      path: body.path || event.queryStringParameters?.path || null,
      referrer: event.headers["referer"] || null,
      extra: body,
    });
  } catch (_) {}

  return jsonResponse(200, { success: true });
};
