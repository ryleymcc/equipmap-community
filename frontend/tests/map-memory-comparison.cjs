const {chromium}=require('playwright');const {execFileSync}=require('node:child_process');const fs=require('node:fs');
(async()=>{const results=[];for(const floor of [0,8,10])for(const baseline of [true,false]){
 const browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});const start=Date.now();
 await p.goto(`http://127.0.0.1:4189/tests/map-memory.html?floor=${floor}${baseline?'&baseline':''}`,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.mapTest?.loaded());const readyMs=Date.now()-start;await p.waitForTimeout(800);
 const surface=await p.evaluate(()=>({pixels:[...document.querySelectorAll('canvas')].map(c=>c.width*c.height),imageElements:[...document.querySelectorAll('img')].map(i=>({width:i.naturalWidth,height:i.naturalHeight}))}));
 const session=await browser.newBrowserCDPSession();const {processInfo}=await session.send('SystemInfo.getProcessInfo');const ids=processInfo.map(p=>p.id).join(',');const bytes=Number(execFileSync('powershell',['-NoProfile','-Command',`(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`],{encoding:'utf8',windowsHide:true}).trim());
 results.push({floor,baseline,readyMs,chromiumWorkingSetBytes:bytes,...surface});await browser.close();
}fs.writeFileSync('frontend/test-results/map-memory-comparison.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exit(1)});
