/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: script-breaking strings ("</script>", "<!--") inside serialized
// async data. Task scripts are emitted as `<script>` + seroval output +
// `</script>`; if a user string survives unescaped, the inline script is
// terminated early and the rest of the payload renders as text.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";

function collectChunks(code: () => any, options: any = {}): Promise<string[]> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks);
      }
    });
  });
}

describe("hunt: script-breaking strings in serialized data", () => {
  test("</script> and <!-- in async data do not break the inline task script", async () => {
    const evil = `</script><b>pwn</b><script>/*<!--*/`;
    function App() {
      const data = createMemo(async () => {
        await new Promise(r => setTimeout(r, 10));
        return evil;
      });
      return (
        <Loading fallback={<span>Loading...</span>}>
          <p>{data()}</p>
        </Loading>
      );
    }

    const chunks = await collectChunks(() => <App />);
    const full = chunks.join("");
    // Any inline <script> block must not contain a raw close tag mid-payload.
    const scripts = [...full.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const body of scripts) {
      expect(body).not.toContain("</script");
      expect(body).not.toContain("<!--");
    }
    // and the rendered text itself must be escaped, not live markup
    expect(full).not.toMatch(/<p[^>]*><\/script>/);
  });
});
