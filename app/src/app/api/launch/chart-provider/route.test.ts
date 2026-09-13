import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";
const identity={chain:"base",token:"0x"+"a".repeat(40),quote:"0x"+"0".repeat(40),pool:"0x"+"b".repeat(64)};
function request(overrides: Partial<typeof identity> = {}, ip="chart-test") {
  return new Request("http://localhost/api/launch/chart-provider?"+new URLSearchParams({...identity,...overrides}),{headers:{"fly-client-ip":ip}});
}
test("route validates without network, serves classified data, and rate limits clients",async(t)=>{
  let now=Date.now();t.mock.method(Date,"now",()=>now);
  const response={data:{type:"pool",id:"base_"+identity.pool,attributes:{address:identity.pool,base_token_price_usd:"1"},
    relationships:{base_token:{data:{type:"token",id:"base_"+identity.token}},quote_token:{data:{type:"token",id:"base_"+identity.quote}}}}};
  const upstream=t.mock.method(globalThis,"fetch",async()=>Response.json(response));
  for(const bad of [{chain:"ethereum"},{pool:"https://evil.test"},{token:identity.quote}]) assert.equal((await GET(request(bad))).status,400);
  assert.equal(upstream.mock.callCount(),0);
  const result=await GET(request());assert.equal(result.status,200);assert.deepEqual(await result.json(),{status:"ready"});
  assert.equal(result.headers.get("cache-control"),"no-store");
  await GET(request());assert.equal(upstream.mock.callCount(),1);
  const mismatch=await GET(request({quote:"0x"+"c".repeat(40)}));assert.equal(mismatch.status,503);
  assert.equal(mismatch.headers.get("retry-after"),"60");
  now+=60_001;
  for(let i=0;i<60;i++) assert.equal((await GET(request({},"limited"))).status,200);
  assert.equal((await GET(request({},"limited"))).status,429);
  now+=60_001;assert.equal((await GET(request({},"limited"))).status,200);
});
