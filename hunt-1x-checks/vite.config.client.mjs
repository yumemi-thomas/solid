import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["browser", "development"]
  },
  test: {
    environment: "jsdom",
    include: ["checks/**/*.test.{ts,tsx}"]
  }
});
