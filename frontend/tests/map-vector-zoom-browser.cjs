const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[];const results=[];
 try{
  for(const [width,height,dpr] of [[1440,900,1],[1024,768,2],[390,844,2]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr});
   await page.route(/https:\/\/[^/]+\.sentry\.io\//,r=>r.fulfill({status:200,body:'{}'}));
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.goto('http://127.0.0.1:5173/map/2',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('.floorplan-tiles[data-detail="ready"]');
   await page.evaluate(()=>{
    const map=document.querySelector('.map-content');
    let fiber=map[Object.keys(map).find(k=>k.startsWith('__reactFiber'))];
    while(fiber&&!fiber.memoizedProps?.transformComponentRef)fiber=fiber.return;
    window.vectorTestTransform=fiber.memoizedProps.transformComponentRef;
   });
   for(const zoom of [8,20,100]){
    await page.evaluate(({zoom,width,height})=>{
     const floor=document.querySelector('.floorplan-tiles');
     const h=parseFloat(floor.style.height);
     window.vectorTestTransform.current.setTransform((width-2000*zoom)/2,(height-h*zoom)/2,zoom,0);
    },{zoom,width,height});
    await page.waitForSelector('.floorplan-tiles[data-detail="ready"]');
    const stats=await page.evaluate(()=>{
     const host=document.querySelector('.floorplan-tiles');
     const tiles=[...host.querySelectorAll('.floorplan-detail canvas')];
     return{quality:tiles[0].width/parseFloat(tiles[0].style.width),detailPixels:tiles.reduce((n,c)=>n+c.width*c.height,0),retainedFloorPixels:[...host.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height,0),layers:document.querySelectorAll('[id^=floorplan-layer-]').length,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert(stats.quality>4,'vector detail should exceed old scale ceiling');
    assert(stats.detailPixels<=1835008);assert(stats.retainedFloorPixels<=4194304);
    assert.equal(stats.layers,1);assert.equal(stats.overflow,false);
    if(dpr===1){assert(Math.abs(stats.quality-zoom)<zoom*1e-6);assert(stats.detailPixels>=width*height);assert(stats.detailPixels<=(width+1)*(height+1));}
    results.push({width,height,dpr,zoom,...stats});
   }
   await page.screenshot({path:`frontend/test-results/vector-zoom-${width}.png`});
   await page.getByTitle('Open Menu',{exact:true}).focus();
   assert(await page.getByTitle('Open Menu',{exact:true}).evaluate(el=>el===document.activeElement));
   await page.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync('frontend/test-results/vector-zoom-report.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
