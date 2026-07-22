// A plain node server: static shell + assets, and the server-function
// endpoint mounted at /_server (the client transport's default).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handler, renderDocument, DOCUMENT_BOOTSTRAP } from "./dist/server.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3004;
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".map": "application/json",
  ".css": "text/css"
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/_server")) {
    console.log("[fn]", req.headers["x-server-function-id"]);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
      duplex: "half"
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      // Stream: frame chunks flush as the server renders (watch the
      // comments section arrive after the shell under network throttling).
      for await (const chunk of response.body) res.write(chunk);
    }
    return res.end();
  }

  if (url.pathname === "/") {
    // Document SSR: the app streams into the shell — server components
    // render inline (view-source: every piece of content exactly once),
    // and the client adopts on hydrate with no t=0 fetch.
    const shell = await readFile(path.join(root, "index.html"), "utf8");
    const [head, tail] = shell
      .replace("<script>/*__SC_BOOTSTRAP__*/</script>", DOCUMENT_BOOTSTRAP)
      .split("<!--app-->");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write(head);
    const request = new Request(url, { headers: req.headers });
    renderDocument(request, {
      write: chunk => res.write(chunk),
      end: () => {
        res.write(tail);
        res.end();
      }
    });
    return;
  }

  const file = url.pathname.slice(1);
  try {
    const content = await readFile(path.join(root, file));
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "text/plain" });
    return res.end(content);
  } catch {
    res.writeHead(404);
    return res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`Frame News on http://localhost:${PORT}`);
});
