const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true});const errors=[];const results=[];
try{for(const [width,height]of [[1440,900],[1024,768],[390,844]]){
 const p=await b.newPage({viewport:{width,height}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('http://127.0.0.1:4189/tests/map-memory.html',{waitUntil:'domcontentloaded'});await p.waitForSelector('.floorplan-tiles[data-detail="ready"]');
 for(let i=0;i<6;i++){
  const state=await p.evaluate(i=>{window.mapTest.zoom(1.2+i*.2,-i*30,-i*20);const h=document.querySelector('.floorplan-tiles');return{detail:h.dataset.detail,preview:getComputedStyle(h.querySelector('.floorplan-preview')).visibility,tiles:getComputedStyle(h.querySelector('.floorplan-detail')).visibility,delay:Number(h.dataset.refinementDelay)};},i);
  assert.equal(state.detail,'preview');assert.equal(state.preview,'visible');assert.equal(state.tiles,'hidden');await p.waitForTimeout(45);
 }
 const delay=await p.locator('.floorplan-tiles').getAttribute('data-refinement-delay');assert(Number(delay)>=80&&Number(delay)<=300);const stopped=Date.now();await p.waitForTimeout(15);assert.equal(await p.locator('.floorplan-tiles').getAttribute('data-detail'),'preview');await p.waitForSelector('.floorplan-tiles[data-detail="ready"]');const elapsed=Date.now()-stopped;
 const stats=await p.evaluate(()=>{const h=document.querySelector('.floorplan-tiles');return{pixels:[...h.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height,0),previewPixels:h.querySelector('.floorplan-preview').width*h.querySelector('.floorplan-preview').height,previewVisibility:getComputedStyle(h.querySelector('.floorplan-preview')).visibility};});
 assert(stats.pixels<=4194304);assert(stats.previewPixels<=524288);assert.equal(stats.previewVisibility,'hidden');assert(elapsed>=Number(delay)-70);await p.screenshot({path:`frontend/test-results/map-preview-${width}.png`});results.push({width,settledAfterMs:elapsed,adaptiveDelayMs:Number(delay),...stats});await p.close();
}assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors},null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
