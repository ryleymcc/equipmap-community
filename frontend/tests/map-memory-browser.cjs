const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const URL='http://127.0.0.1:4189/tests/map-memory.html';
(async()=>{
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const errors=[];const report={cases:[],memory:[],timings:[]};
async function setup(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.mapTest?.loaded());await p.waitForSelector('.floorplan-tiles[data-detail="ready"]');}
async function stats(p){return p.evaluate(()=>({layers:document.querySelectorAll('[id^=floorplan-layer-]').length,pdfLayers:document.querySelectorAll('.floorplan-tiles').length,tiles:document.querySelectorAll('.floorplan-tiles canvas').length,pdfPixels:[...document.querySelectorAll('.floorplan-tiles')].map(h=>[...h.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height,0)),imagePixels:[...document.querySelectorAll('.floorplan-image')].map(c=>c.width*c.height),logicalHeights:[...document.querySelectorAll('.floorplan-tiles,.floorplan-image')].map(c=>parseFloat(c.style.height)),overflow:document.documentElement.scrollWidth>innerWidth}));}
async function verify(p,label){const s=await stats(p);assert(s.layers<=1,label);assert(s.tiles<=32,label);for(const v of [...s.pdfPixels,...s.imagePixels])assert(v<=4194304,`${label}: ${v}`);assert(!s.overflow,label);report.cases.push({label,...s});return s;}
async function select(p,index){const start=Date.now();await p.evaluate(i=>window.mapTest.select(i),index);await p.waitForFunction(i=>document.querySelector(`#floorplan-layer-${i+1}`),index);await p.waitForFunction(()=>window.mapTest.loaded());await p.waitForFunction(()=>![...document.querySelectorAll('.floorplan-tiles')].some(h=>h.dataset.detail!=='ready'));await p.waitForTimeout(250);report.timings.push({index,ms:Date.now()-start});}
async function memory(p,label){const cdp=await ctx.newCDPSession(p);await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');const session=await browser.newBrowserCDPSession();const {processInfo}=await session.send('SystemInfo.getProcessInfo');const ids=processInfo.map(p=>p.id).join(',');let workingSet=null;try{workingSet=Number(execFileSync('powershell',['-NoProfile','-Command',`(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`],{encoding:'utf8',windowsHide:true}).trim());}catch{}report.memory.push({label,heapUsedBytes:heap.usedSize,backingStorageBytes:heap.backingStorageSize,chromiumWorkingSetBytes:workingSet});await cdp.detach();await session.detach();}
try{
const page=await ctx.newPage();
if(process.argv.includes('--errors-only')) {
 await setup(page);
 for(const i of [11,12]){await page.evaluate(index=>window.mapTest.select(index),i);await page.getByText('Failed to load map image.',{exact:true}).waitFor();await select(page,0);await verify(page,`recover malformed ${i}`);}
 const pending=[];for(let i=0;i<3;i++){const p=await ctx.newPage();await setup(p);pending.push(p);}
 await page.evaluate(()=>{navigator.locks.request('equipmap-floorplan-image-decode',()=>new Promise(resolve=>{window.releaseImageLock=resolve;}));});
 await page.waitForFunction(()=>window.releaseImageLock);
 for(const p of pending)await p.evaluate(()=>window.mapTest.select(10));
 await page.waitForFunction(async()=>{const q=await navigator.locks.query();return q.pending.filter(l=>l.name==='equipmap-floorplan-image-decode').length===3;});
 await pending[0].close();await page.evaluate(()=>window.releaseImageLock());
 for(const p of pending.slice(1)){await p.waitForFunction(()=>window.mapTest.loaded());await verify(p,'serialized cross-tab JPEG decode');await p.close();}
 await page.waitForFunction(async()=>{const q=await navigator.locks.query();return ![...q.held,...q.pending].some(l=>l.name==='equipmap-floorplan-image-decode');});
 assert.deepEqual(errors,[]);fs.writeFileSync('frontend/test-results/map-memory-errors-report.json',JSON.stringify(report,null,2));console.log('Malformed PDF/JPEG recovery and cross-tab decode serialization/cancellation passed');return;
}
const sourceRequests=[];page.on('request',r=>{if(r.url().includes('/uploads/'))sourceRequests.push(r.url());});await setup(page);await page.waitForTimeout(1300);assert(sourceRequests.every(url=>url.endsWith('vector.pdf')),'no background floor rendering');await memory(page,'initial');
for(const i of [0,1,2,3,4,5,6,8,9,10]){if(i)await select(page,i);await page.evaluate(()=>window.mapTest.zoom(1));await page.waitForTimeout(800);const s=await verify(page,`format ${i}`);if(i===1)assert(Math.abs(s.logicalHeights[0]-9600)<.1);if(i===2)assert(Math.abs(s.logicalHeights[0]-3428.5714)<.1);if([0,2,3,8].includes(i)){const difference=await page.evaluate(()=>window.mapTest.compareRaster());assert(difference<.01,`raster difference ${i}: ${difference}`);report.cases.push({label:`raster alignment ${i}`,differentPixelFraction:difference});}await page.screenshot({path:`frontend/test-results/map-format-${i}.png`});}
for(const [width,height] of [[1440,900],[1024,768],[390,844]]){await page.setViewportSize({width,height});await select(page,8);for(const scale of [.5,1,5,100]){await page.evaluate(s=>window.mapTest.zoom(s,-300,-200),scale);await page.waitForTimeout(800);await verify(page,`${width} zoom ${scale}`);}await page.evaluate(()=>window.mapTest.zoom(.5,0,0));await page.waitForTimeout(500);await page.screenshot({path:`frontend/test-results/map-${width}.png`});}
await page.setViewportSize({width:1440,height:900});await select(page,0);await page.evaluate(()=>window.mapTest.zoom(1,0,0));await page.mouse.click(300,250);assert(await page.evaluate(()=>window.pinClicked===true));
await select(page,2);await page.evaluate(()=>{window.mapTest.calibration(true);window.mapTest.overlay({tx:400,ty:100,scale:.7,rotation:35});});await page.waitForTimeout(900);const cal=await verify(page,'calibration rotated');assert.equal(cal.pdfLayers,2);await page.screenshot({path:'frontend/test-results/map-calibration.png'});await page.evaluate(()=>window.mapTest.calibration(false));
for(let cycle=0;cycle<20;cycle++){await select(page,[8,3,10,5,2,6][cycle%6]);await verify(page,`switch ${cycle}`);if(cycle%5===4)await memory(page,`switches ${cycle+1}`);}
// Rapid source changes cancel outstanding loads, renders and worker decodes.
await page.evaluate(async()=>{for(let i=0;i<30;i++){window.mapTest.select([3,10,8,4][i%4]);await new Promise(r=>setTimeout(r,15));}window.mapTest.select(0);});await page.waitForFunction(()=>window.mapTest.loaded());await page.waitForTimeout(600);await verify(page,'rapid switches');const targetSession=await browser.newBrowserCDPSession();const {targetInfos}=await targetSession.send('Target.getTargets');const workers=targetInfos.filter(t=>t.type==='worker');assert(workers.length<=1,`retained workers: ${workers.length}`);report.cases.push({label:'worker cleanup after rapid switches',workers:workers.length});await targetSession.detach();
const tabs=[];for(let i=0;i<3;i++){const p=await ctx.newPage();await setup(p);await select(p,[8,3,10][i]);await verify(p,`additional tab ${i}`);tabs.push(p);}await memory(page,'four tabs');for(const p of tabs)await p.close();await memory(page,'back to one tab');
// Cache actual sources through the production service worker, then switch offline.
await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.mapTest.loaded());await page.waitForFunction(()=>navigator.serviceWorker.controller);
for(const i of [0,3,4,5,6,8,9,10]){await select(page,i);}
await ctx.setOffline(true);for(const i of [0,3,4,5,6,8,9,10]){await select(page,i);await verify(page,`offline ${i}`);}await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.mapTest.loaded());await verify(page,'offline reload');await ctx.setOffline(false);
await select(page,0);await page.evaluate(()=>window.mapTest.select(7));await page.getByText('Failed to load map image.',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry'}).focus();assert(await page.getByRole('button',{name:'Retry'}).evaluate(el=>el===document.activeElement));await select(page,0);await verify(page,'recover from error');
for(const i of [11,12]){await page.evaluate(index=>window.mapTest.select(index),i);await page.getByText('Failed to load map image.',{exact:true}).waitFor();await select(page,0);await verify(page,`recover malformed ${i}`);}
assert.deepEqual(errors,[]);report.consoleErrors=errors;fs.writeFileSync('frontend/test-results/map-memory-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.cases.length,memory:report.memory,timings:report.timings.slice(0,10)},null,2));
}finally{await browser.close();fs.writeFileSync(process.argv.includes('--errors-only')?'frontend/test-results/map-memory-errors-partial.json':'frontend/test-results/map-memory-partial.json',JSON.stringify({...report,errors},null,2));}
})().catch(e=>{console.error(e);process.exit(1)});
