import { hydrate } from "@solidjs/web";
// The only frames wiring a client needs: install the server-component
// transport policy once. (Explicit call — @solidjs/web is sideEffects:false
// and bundlers would drop a bare import.)
import { installServerComponents } from "@solidjs/web/frames";
import { App } from "./app.jsx";

installServerComponents();
hydrate(() => <App />, document.getElementById("app"));
