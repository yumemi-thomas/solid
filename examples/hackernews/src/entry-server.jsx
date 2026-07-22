// The server side of the transport: one handler, one hook each way. A
// server function that returns data behaves as before; one that returns a
// function streams as a server component over HTTP (frameTransformResult)
// and renders INLINE during document SSR (transformDirectResult) — where
// the page itself is the payload: view-source and every piece of server
// content appears exactly once, with a one-line reference as its hydration
// data.
import { generateHydrationScript, renderToStream } from "@solidjs/web";
import {
  handleServerFunctionRequest,
  configureServerFunctionsServer
} from "@solidjs/web/server-functions/server";
import {
  frameTransformResult,
  frameTransformDirectResult,
  ServerComponentPlugin,
  SERVER_COMPONENT_BOOTSTRAP
} from "@solidjs/web/frames/server";
import { provideRequestEvent } from "@solidjs/web/storage";
// Importing the data module registers its server functions with the
// runtime (the directive pass compiled them to registerServerReference
// calls in this build).
import "./data.jsx";
import { App } from "./app.jsx";

configureServerFunctionsServer({
  transformDirectResult: frameTransformDirectResult
});

// Everything the shell must inline before any streamed content: the
// hydration runtime header (the $HY/$df machinery reveal scripts and
// hydration data target) plus the server-component placeholder bootstrap.
export const DOCUMENT_BOOTSTRAP = generateHydrationScript() + `<script>${SERVER_COMPONENT_BOOTSTRAP}</script>`;

export function handler(request) {
  return handleServerFunctionRequest(request, {
    transformResult: frameTransformResult,
    provideEvent: (event, run) => run()
  });
}

/** Streams the SSR'd app into `writable` ({ write, end }). */
export function renderDocument(request, writable) {
  return provideRequestEvent({ request, locals: {} }, () =>
    renderToStream(() => <App />, { plugins: [ServerComponentPlugin] }).pipe(writable)
  );
}
