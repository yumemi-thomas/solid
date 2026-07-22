// @solidjs/web/frames — server half. Frame streams: render server components
// (functions returned from server functions) to transport-agnostic chunk
// streams, and serve them as framed HTTP responses through the
// server-function handler's transformResult hook.

export {
  renderToFrameStream,
  renderServerComponent,
  serverComponentResponse,
  frameTransformResult,
  createFrameSink,
  // Document SSR (t=0): inline rendering + the hydration reference
  frameTransformDirectResult,
  ServerComponentPlugin,
  SERVER_COMPONENT_BOOTSTRAP
} from "@dom-expressions/runtime/src/frame-sink.js";
export {
  FRAME_STREAM_HEADER,
  isFrameStreamResponse
} from "@dom-expressions/runtime/src/frame-transport.js";
