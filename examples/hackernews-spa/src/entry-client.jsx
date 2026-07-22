import { hydrate } from "@solidjs/web";
import { App } from "./app.jsx";

hydrate(() => <App />, document.getElementById("app"));
