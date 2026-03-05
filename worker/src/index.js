export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    const cacheKey = `reviews:${env.PLACE_ID}`;
    const cacheTtl = parseInt(env.CACHE_TTL || "86400");

    // Try KV cache first (if bound)
    if (env.REVIEWS_CACHE) {
      const cached = await env.REVIEWS_CACHE.get(cacheKey, "json");
      if (cached) {
        return new Response(JSON.stringify(cached), {
          headers: { ...corsHeaders, "X-Cache": "HIT" },
        });
      }
    }

    // Fetch from Google Places API (New)
    const url = `https://places.googleapis.com/v1/places/${env.PLACE_ID}`;
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": env.GOOGLE_API_KEY,
        "X-Goog-FieldMask": "reviews,rating,userRatingCount",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: "Failed to fetch reviews", detail: errorText }),
        { status: 502, headers: corsHeaders }
      );
    }

    const data = await response.json();

    const result = {
      rating: data.rating || null,
      totalReviews: data.userRatingCount || 0,
      reviews: (data.reviews || []).map((r) => ({
        author: r.authorAttribution?.displayName || "Anonyme",
        rating: r.rating,
        text: r.text?.text || "",
        time: r.publishTime,
        profilePhoto: r.authorAttribution?.photoUri || null,
      })),
      fetchedAt: new Date().toISOString(),
    };

    // Cache in KV for 24h
    if (env.REVIEWS_CACHE) {
      await env.REVIEWS_CACHE.put(cacheKey, JSON.stringify(result), {
        expirationTtl: cacheTtl,
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "X-Cache": "MISS" },
    });
  },
};
