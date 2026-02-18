Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    console.log(url)

    if (url.pathname === "/hello") {
      return new Response("hello, world", { status: 200 });
    }
    if (url.pathname === "/echo") {
      const body = await req.body?.text()
      return new Response(body, { status: 200 });
    }
    return new Response("idk bro", { status: 404 });
  },
});

console.log("app listening on :3000");
