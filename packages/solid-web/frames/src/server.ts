// @solidjs/web/frames — server half. Frame streams: render server components
// (functions returned from server functions) to transport-agnostic chunk
// streams, and serve them as framed HTTP responses through the
// server-function handler's transformResult hook.
//
// Source-level entry while frames are pre-release; dist/exports wiring lands
// with the release packaging.
export {
  renderToFrameStream,
  renderServerComponent,
  serverComponentResponse,
  frameTransformResult,
  createFrameSink,
  createProjectionProps
} from "@dom-expressions/runtime/src/frame-sink.js";
export {
  FRAME_STREAM_HEADER,
  isFrameStreamResponse
} from "@dom-expressions/runtime/src/frame-transport.js";
