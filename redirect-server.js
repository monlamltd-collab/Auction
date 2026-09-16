import http from "node:http";

const destinationOrigin = "https://www.auctionbrain.co.uk";
const port = Number(process.env.PORT) || 8080;

const server = http.createServer((request, response) => {
  const incoming = new URL(request.url ?? "/", "http://localhost");

  if (incoming.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("ok");
    return;
  }

  const preservePath = /^\/(blog|auctioneers|methodology)(\/|$)/.test(incoming.pathname);
  const destination = new URL(preservePath ? `${incoming.pathname}${incoming.search}` : "/", destinationOrigin);

  response.writeHead(308, {
    Location: destination.href,
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(`AuctionBrain has moved to ${destination.href}\n`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Legacy AuctionBrain redirect listening on port ${port}`);
});
