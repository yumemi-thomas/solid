// The server side of the transport: one handler, one hook. A server
// function that returns data behaves as before; one that returns a
// function streams as a server component (frameTransformResult).
import { handleServerFunctionRequest } from "@solidjs/web/server-functions/server";
import { frameTransformResult } from "@solidjs/web/frames/server";
// Importing the data module registers its server functions with the
// runtime (the directive pass compiled them to registerServerReference
// calls in this build).
import "./data.jsx";

export function handler(request) {
  return handleServerFunctionRequest(request, {
    transformResult: frameTransformResult,
    provideEvent: (event, run) => run()
  });
}
