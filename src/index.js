export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/images/")) {
      const key = url.pathname.slice("/images/".length);
      const object = await env.R2.get(key);

      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");

      return new Response(object.body, { headers });
    }

    return env.ASSETS.fetch(request);
  },
};
