const TMDB_BASE_URL = "https://api.themoviedb.org/3";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });
  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "TMDB is not configured." });
  const id = String(event.queryStringParameters?.id || "").trim();
  const type = String(event.queryStringParameters?.type || "movie").trim();
  if (!id || !["movie", "tv"].includes(type)) return jsonResponse(400, { error: "Missing or invalid id/type." });
  try {
    const fetches = [
      fetch(`${TMDB_BASE_URL}/${type}/${encodeURIComponent(id)}/watch/providers?api_key=${encodeURIComponent(apiKey)}`),
      fetch(`${TMDB_BASE_URL}/${type}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`)
    ];
    if (type === "movie") {
      fetches.push(fetch(`${TMDB_BASE_URL}/movie/${encodeURIComponent(id)}/release_dates?api_key=${encodeURIComponent(apiKey)}`));
    }
    const [providerRes, detailRes, releaseDatesRes] = await Promise.all(fetches);
    if (!providerRes.ok) return jsonResponse(providerRes.status, { error: `TMDB returned ${providerRes.status}.` });
    const providerData = await providerRes.json();
    const detailData = detailRes.ok ? await detailRes.json() : {};
    const releaseDatesData = releaseDatesRes?.ok ? await releaseDatesRes.json() : null;
    let extra;
    if (type === "movie") {
      extra = { runtime: detailData.runtime || null, ...detectInTheaters(releaseDatesData) };
    } else {
      extra = {
        totalSeasons: detailData.number_of_seasons || null,
        totalEpisodes: detailData.number_of_episodes || null,
        avgEpisodeRuntime: detailData.episode_run_time?.[0] || null
      };
    }
    return jsonResponse(200, { providers: providerData.results?.US || null, ...extra });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "TMDB watch providers request failed." });
  }
};

function detectInTheaters(releaseDatesData) {
  const none = { inTheaters: false, theatricalReleaseDate: null };
  if (!releaseDatesData?.results) return none;
  const us = releaseDatesData.results.find((r) => r.iso_3166_1 === "US");
  if (!us) return none;
  const theatrical = us.release_dates.find((r) => r.type === 3);
  if (!theatrical) return none;
  const theatricalDate = new Date(theatrical.release_date);
  const releaseDate = theatrical.release_date.slice(0, 10);
  const now = new Date();
  if (theatricalDate > now) return { inTheaters: false, theatricalReleaseDate: releaseDate };
  if ((now - theatricalDate) / 86400000 > 90) return none;
  const digital = us.release_dates.find((r) => r.type === 4);
  if (digital && new Date(digital.release_date) <= now) return none;
  return { inTheaters: true, theatricalReleaseDate: releaseDate };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}
