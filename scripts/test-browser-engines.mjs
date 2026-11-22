/** Smoke the shipped WASM specialist pipeline in Firefox and phone-sized WebKit. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {firefox,webkit,devices} from "playwright-core";
const root=path.resolve("dist");
const types={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".wasm":"application/wasm",".py":"text/plain",".json":"application/json",".css":"text/css",".woff2":"font/woff2"};
const server=createServer(async(q,r)=>{
  const pathname=decodeURIComponent(new URL(q.url,"http://localhost").pathname);
  const file=path.resolve(root,"."+pathname+(pathname.endsWith("/")?"index.html":""));
  if(!file.startsWith(root+path.sep)){r.writeHead(404).end();return;}
  try {const bytes=await readFile(file);r.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream"}).end(bytes);}
  catch{r.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
const gates=[];
try{
 for(const [name,engine,options] of [["Firefox desktop",firefox,{viewport:{width:1440,height:960}}],["WebKit mobile emulation",webkit,devices["iPhone 13"]]]){
   let browser;
   try{
     browser=await engine.launch();const ctx=await browser.newContext({...options,reducedMotion:"reduce"});const p=await ctx.newPage();
     const errors=[];p.on("pageerror",e=>errors.push(e.message));
     await p.goto(origin+"/#intelligence-studio",{waitUntil:"domcontentloaded"});
     await p.getByRole("button",{name:"Run deterministic investigation",exact:true}).first().click();
     await p.getByRole("button",{name:"Approve design",exact:true}).first().waitFor({timeout:90000});
     await p.reload({waitUntil:"domcontentloaded"});
     await p.getByRole("button",{name:"Approve design",exact:true}).first().waitFor({timeout:30000});
     assert.deepEqual(errors,[]);
     gates.push({gate:name,status:"PASSED",engine_version:browser.version(),evidence:"Completed six-stage browser WASM investigation and restored the saved run after reload."});
   }catch(e){gates.push({gate:name,status:"FAILED",evidence:e.message.slice(0,320)});}
   finally{await browser?.close();}
 }
}finally{server.close();}
if(process.env.MONOLITH_CROSS_BROWSER_EVIDENCE)await writeFile(process.env.MONOLITH_CROSS_BROWSER_EVIDENCE,JSON.stringify(gates,null,2)+"\n");
console.log(JSON.stringify(gates));if(gates.some(g=>g.status!=="PASSED"))process.exitCode=1;
