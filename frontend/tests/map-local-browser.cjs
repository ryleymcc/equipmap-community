const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});const results=[];
// Isolate local rendering checks from the existing external telemetry transport.
await p.route(/https:\/\/[^/]+\.sentry\.io\//,route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
try{for(const [width,height] of [[1440,900],[1024,768],[390,844]]){
 await p.setViewportSize({width,height});await p.goto('http://127.0.0.1:5173/map/2',{waitUntil:'domcontentloaded'});await p.waitForSelector('.floorplan-tiles[data-detail="ready"] .floorplan-detail canvas');await p.waitForTimeout(700);
 const open=p.getByTitle('Open Menu',{exact:true});await open.focus();assert(await open.evaluate(el=>el===document.activeElement));await open.click();const outside=p.getByText('Outside',{exact:true});await outside.waitFor();await outside.click();await p.waitForSelector('.floorplan-image');await p.waitForFunction(()=>document.querySelector('.floorplan-image')?.width>300);await p.waitForTimeout(300);
 assert.equal(await p.locator('[id^=floorplan-layer-]').count(),1);assert.equal(await p.locator('.floorplan-image').evaluate(c=>c.width*c.height<=4194304),true);
 // Sidebar is navigation; use it again rather than reloading the app.
 const level=p.getByText('Level 2',{exact:true});if(await p.locator('.drawer-left.drawer-open').count()===0)await p.getByTitle('Open Menu',{exact:true}).click();await level.click();await p.waitForSelector('.floorplan-tiles[data-detail="ready"] .floorplan-detail canvas');await p.waitForTimeout(700);
 await p.evaluate(()=>{
  const host=document.querySelector('.floorplan-tiles');
  window.tileContinuity={empty:0,commits:0};
  window.tileObserver=new MutationObserver(()=>{
   window.tileContinuity.commits++;
   if(!host.querySelector('canvas'))window.tileContinuity.empty++;
  });window.tileObserver.observe(host,{childList:true});
 });
 await p.mouse.move(width/2,height/2);await p.mouse.wheel(0,-400);await p.waitForTimeout(600);
 await p.mouse.move(width/2,height/2);await p.mouse.down();await p.mouse.move(width/2-90,height/2-60,{steps:10});await p.mouse.up();await p.waitForSelector('.floorplan-tiles[data-detail="ready"]');await p.waitForTimeout(100);
 const continuity=await p.evaluate(()=>{window.tileObserver.disconnect();return window.tileContinuity;});assert.equal(continuity.empty,0);assert(continuity.commits>0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await p.locator('[id^=floorplan-layer-]').count(),1);await p.screenshot({path:`frontend/test-results/local-map-${width}.png`});results.push({width,continuity,tiles:await p.locator('.floorplan-tiles canvas').count()});
}assert.deepEqual(errors,[]);console.log(JSON.stringify({results,consoleErrors:errors},null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
