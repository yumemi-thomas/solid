import { hydrate } from "@solidjs/web";
// The only frames wiring a client needs: install the server-component
// transport policy once. After this, a server function returning a
// component just works through `dynamic` — including adopting the
// document-SSR'd boundary at boot with no t=0 fetch. (An explicit call,
// not a bare side-effect import — @solidjs/web is sideEffects:false and
// bundlers would drop the import.)
import { installServerComponents } from "@solidjs/web/frames";
import { App } from "./app.jsx";

installServerComponents();
hydrate(() => <App />, document.getElementById("app"));
