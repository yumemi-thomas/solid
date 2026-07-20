import { render } from "@solidjs/web";
// The only frames wiring a client needs: install the server-component
// transport policy once. After this, a server function returning a
// component just works through `dynamic`. (An explicit call, not a bare
// side-effect import — @solidjs/web is sideEffects:false and bundlers
// would drop the import.)
import { installServerComponents } from "@solidjs/web/frames";
import { App } from "./app.jsx";

installServerComponents();
render(() => <App />, document.getElementById("app"));
