import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "@/lib/store/settings";
import { chatGptStatus, connectChatGpt, disconnectChatGpt, generateChatGptImage } from "./chatgpt";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-codex-fixture-"));
const binary = path.join(fixture, "codex");
const png = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#445599"/></svg>').render().asPng());
const LIVE = process.env.INROAD_CHATGPT_LIVE_TEST === "1";

beforeEach(async () => {
  if (LIVE) return;
  await disconnectChatGpt();
  fs.writeFileSync(binary, `#!/usr/bin/env node
const fs=require('node:fs');
const rl=require('node:readline').createInterface({input:process.stdin});
const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
rl.on('line',line=>{
 const m=JSON.parse(line); if(!m.id)return;
 const result=(result)=>send({id:m.id,result});
 if(m.method==='initialize')return result({});
 if(m.method==='account/read')return result({account:{type:process.env.TEST_CHATGPT_AUTH||'chatgpt',planType:'plus'}});
 if(m.method==='modelProvider/capabilities/read')return result({imageGeneration:true});
 if(m.method==='account/login/start')return result({type:'chatgpt',loginId:'test-login',authUrl:'https://auth.openai.com/authorize?test=1'});
 if(m.method==='account/login/cancel'||m.method==='account/logout')return result({});
 if(m.method==='thread/start')return result({thread:{id:'test-thread'}});
 if(m.method==='turn/start'){
  if(process.env.OPENAI_API_KEY||process.env.CODEX_API_KEY||process.env.CODEX_ACCESS_TOKEN)process.exit(7);
  result({turn:{id:'turn-test'}});
  if(process.env.TEST_CHATGPT_SLOW)return;
  const item=process.env.TEST_CHATGPT_QUOTA?{type:'imageGeneration',status:'failed',failure:{type:'usageLimitExceeded'}}:{type:'imageGeneration',status:'completed',result:'${png.toString("base64")}'};
  send({method:'item/completed',params:{threadId:'test-thread',item}});
  return send({method:'turn/completed',params:{threadId:'test-thread',turn:{status:'completed'}}});
 }
 send({id:m.id,error:{message:'unsupported'}});
});
`, { mode: 0o700 });
  vi.stubEnv("INROAD_CODEX_PATH", binary);
});
afterAll(() => { fs.rmSync(fixture, { recursive: true, force: true }); });

describe.skipIf(LIVE)("ChatGPT plan image connection", () => {
  it("requires an explicit connection and Disconnect leaves the Codex sign-in alone", async () => {
    expect(await chatGptStatus()).toMatchObject({ available: true, connected: false });
    await expect(generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128 })).rejects.toThrow("Connect ChatGPT");
    expect(await connectChatGpt()).toMatchObject({ connected: true, plan: "plus" });
    await disconnectChatGpt();
    expect(await chatGptStatus()).toMatchObject({ connected: false });
    expect(await connectChatGpt()).toMatchObject({ connected: true });
  });

  it("uses subscription image output while stripping inherited API credentials", async () => {
    await connectChatGpt();
    vi.stubEnv("OPENAI_API_KEY", "must-not-be-used");
    vi.stubEnv("CODEX_API_KEY", "must-not-be-used");
    vi.stubEnv("CODEX_ACCESS_TOKEN", "must-not-be-used");
    const image = await generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128 });
    expect(image.png).toEqual(png);
    expect(image).toMatchObject({ model: "ChatGPT plan", width: 128, height: 128 });
  });

  it("reports plan limits without API fallback", async () => {
    await connectChatGpt();
    vi.stubEnv("TEST_CHATGPT_QUOTA", "1");
    await expect(generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128 })).rejects.toThrow("allowance is used up");
  });

  it("does not use an API-key sign-in as a ChatGPT connection", async () => {
    await connectChatGpt();
    vi.stubEnv("TEST_CHATGPT_AUTH", "apikey");
    await expect(generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128 })).rejects.toThrow("Sign in with ChatGPT");
  });

  it("offers official sign-in when no ChatGPT session is available and can cancel it", async () => {
    vi.stubEnv("TEST_CHATGPT_AUTH", "apikey");
    const status = await connectChatGpt();
    expect(status).toMatchObject({ connected: false, pending: true });
    expect(new URL(status.authUrl!).hostname).toBe("auth.openai.com");
    await disconnectChatGpt();
    const cancelled = await chatGptStatus();
    expect(cancelled.connected).toBe(false);
    expect(cancelled.pending).toBeUndefined();
  });

  it("cancels generation and releases its local concurrency slot", async () => {
    await connectChatGpt();
    vi.stubEnv("TEST_CHATGPT_SLOW", "1");
    const controller = new AbortController();
    const pending = generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    vi.stubEnv("TEST_CHATGPT_SLOW", "");
    expect((await generateChatGptImage({ prompt: "A blue sphere", w: 128, h: 128 })).png).toEqual(png);
  });
});

// Opt-in, single-image local smoke. Uses only an already signed-in ChatGPT plan; never runs in CI.
it.skipIf(!LIVE)("live ChatGPT subscription returns a real PNG without an API key", async () => {
  const status = await connectChatGpt();
  expect(status.connected).toBe(true);
  try {
    const image = await generateChatGptImage({ prompt: "A simple matte blue ceramic sphere on a warm pale gray background, soft studio lighting, centered with generous empty space. No text.", w: 1024, h: 1024 });
    expect(image.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    fs.writeFileSync("/tmp/inroad-chatgpt-live.png", image.png, { mode: 0o600 });
    console.log(JSON.stringify({ provider: image.model, width: image.width, height: image.height, bytes: image.png.length, dataDir: DATA_DIR }));
  } finally { await disconnectChatGpt(); }
}, 660_000);
