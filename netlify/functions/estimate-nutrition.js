const { estimateRecipeNutrition } = require("../../nutrition-provider");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }
  try {
    return jsonResponse(200, { estimate: await estimateRecipeNutrition(payload) });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Nutrition estimate failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
