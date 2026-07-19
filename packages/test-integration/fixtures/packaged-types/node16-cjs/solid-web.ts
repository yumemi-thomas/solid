import {} from "@solidjs/web";
import {} from "@solidjs/web/jsx-runtime";
import {} from "@solidjs/web/jsx-dev-runtime";
import {} from "@solidjs/web/storage";
// Note: @solidjs/web/server-functions (and /serialization) types are not
// importable from Node16 CJS without skipLibCheck — their d.cts chain
// reaches seroval, whose published types are ESM-only (unqualified relative
// imports, no .d.cts). Upstream seroval limitation, tracked separately.
