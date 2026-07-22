// Standard SSR-SPA wiring: document SSR streams the app, async data
// serializes into hydration scripts (that's the double: content in the
// HTML and again in the data), and the client hydrates from both.
import { generateHydrationScript, renderToStream } from "@solidjs/web";
import { handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
import { provideRequestEvent } from "@solidjs/web/storage";
import "./data.jsx";
import { App } from "./app.jsx";

export const DOCUMENT_BOOTSTRAP = generateHydrationScript();

export function handler(request) {
  return handleServerFunctionRequest(request, {
    provideEvent: (event, run) => run()
  });
}

/** Streams the SSR'd app into `writable` ({ write, end }). */
export function renderDocument(request, writable) {
  return provideRequestEvent({ request, locals: {} }, () =>
    renderToStream(() => <App />).pipe(writable)
  );
}
