const { chromium } = require("playwright-core");
const src = require("fs").readFileSync("/home/user/LifeOS/scripts/smoke-090-replanning.cjs","utf8");
const body = src.slice(src.indexOf("const DOMAINS"), src.indexOf("/** §32, §35."));
const WORLD = new Function(`${body}\nreturn WORLD();`)();
(async()=>{
 const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
 const c=await b.newContext({viewport:{width:1280,height:1600}});const p=await c.newPage();
 await p.goto("http://localhost:3111/today",{waitUntil:"domcontentloaded"});
 await p.evaluate(([k,s])=>localStorage.setItem(k,s),["lifeos.mvp.v1",JSON.stringify(WORLD)]);
 await p.goto("http://localhost:3111/today",{waitUntil:"domcontentloaded"});
 await p.waitForTimeout(1200);
 console.log(await p.evaluate(()=>{
   const rows=[...document.querySelectorAll("li,div")].filter(e=>e.querySelector(":scope > [data-resolutions]"));
   return rows.map(e=>({text:(e.textContent||"").replace(/\s+/g," ").slice(0,60),
     kinds:[...e.querySelectorAll("[data-resolution]")].map(b=>b.getAttribute("data-resolution")+(b.disabled?"(off)":""))}));
 }));
 console.log("--- actions page ---");
 await p.goto("http://localhost:3111/actions",{waitUntil:"domcontentloaded"});
 await p.waitForTimeout(1000);
 console.log(await p.evaluate(()=>({
   resolutions: document.querySelectorAll("[data-resolution]").length,
   checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
   batchBar: !!document.querySelector("[data-batch-not-today]"),
 })));
 await b.close();
})();
