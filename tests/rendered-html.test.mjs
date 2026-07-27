import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the GlowCast forecast shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>霞光预报网 \| GlowCast<\/title>/i);
  assert.match(html, /霞光预报网/);
  assert.match(html, /南京/);
  assert.match(html, /stable_score/);
  assert.match(html, /burst_score/);
  assert.match(html, /horizon_gap_score/);
  assert.match(html, /真实气象输入/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("does not depend on Google Fonts", async () => {
  const response = await render();
  const html = await response.text();

  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/i);
  assert.doesNotMatch(html, /font-family:\s*['"]Geist/i);
});
