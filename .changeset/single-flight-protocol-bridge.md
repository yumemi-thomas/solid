---
"@solidjs/web": patch
---

Bridge the single-flight mutation protocol through `@solidjs/web/server-functions`.

Pulls in dom-expressions' generic single-flight protocol: on the server, `configureServerFunctionsServer({ collectFlightData })` (or the per-handler `collectFlightData` option on `handleServerFunctionRequest`) registers the hook that produces a data payload from a call's outcome — the handler folds it into the response as the standardized `{ value, data }` payload under the `X-Single-Flight` header. On the client, `subscribeFlightData(consumer)` registers the consumer the fetch transport delivers `data` to (with the response as envelope context — redirect location, revalidation keys) before returning `value` to the caller; the registration is universal, exported from both halves of the subpath, since routers are universal code. The flight-data types (`SingleFlightPayload`, `FlightDataConsumer`, `FlightDataContext`, `CollectFlightDataHook`, `ServerFunctionOutcome`) and `SINGLE_FLIGHT_HEADER` ride the copied type surface. Without a hook or consumer, behavior is byte-identical to before.
