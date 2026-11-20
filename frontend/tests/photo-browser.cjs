const { chromium } = require('playwright');
const assert = require('node:assert/strict');
require('node:fs').mkdirSync('test-results', {recursive:true});
async function checkFullscreen(page, scope, name, screenshot, offline = false) {
 const expand = scope.getByRole('button', {name:'Full screen',exact:true});
 await expand.click();
 const viewer = page.getByRole('dialog', {name:`Fullscreen photo of ${name}`,exact:true});
 await viewer.locator('img').evaluate(img=>img.decode());
 const box = await viewer.boundingBox();
 const viewport = page.viewportSize();
 assert(Math.abs(box.width-viewport.width)<2 && Math.abs(box.height-viewport.height)<2,'viewer must fill viewport');
 assert((await viewer.locator('img').getAttribute('src')).endsWith(offline ? '.thumb.webp' : '.preview.webp'));
 await page.waitForFunction(()=>document.querySelector('.entity-photo-fullscreen button[aria-label="Zoom in"]')?.disabled===false);
 await viewer.getByRole('button',{name:'Zoom in',exact:true}).focus();
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>Number(document.querySelector('.entity-photo-fullscreen output')?.textContent.replace('%',''))>100);
 const content = viewer.locator('.entity-photo-zoom-content');
 const beforePan=await content.getAttribute('style');
 await page.mouse.move(viewport.width/2, viewport.height/2);
 await page.mouse.down();
 await page.mouse.move(viewport.width/2+40,viewport.height/2+35,{steps:5});
 await page.mouse.up();
 assert.notEqual(await content.getAttribute('style'),beforePan,'drag must pan');
 await viewer.getByRole('button',{name:'Fit image',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.entity-photo-fullscreen output')?.textContent==='100%');
 await page.mouse.move(viewport.width/2, viewport.height/2);
 await page.mouse.wheel(0,-160);
 await page.waitForFunction(()=>Number(document.querySelector('.entity-photo-fullscreen output')?.textContent.replace('%',''))>100);
 await viewer.getByRole('button',{name:'Fit image',exact:true}).click();
 if(viewport.width===390 && !offline) {
  const cdp=await page.context().newCDPSession(page);
  const centerX=viewport.width/2, centerY=viewport.height/2;
  const points=distance=>[{x:centerX-distance,y:centerY,id:0},{x:centerX+distance,y:centerY,id:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(30)});
  for(const distance of [35,45,55,70]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(distance)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>Number(document.querySelector('.entity-photo-fullscreen output')?.textContent.replace('%',''))>100);
  await cdp.detach();
  await viewer.getByRole('button',{name:'Fit image',exact:true}).click();
 }
 await page.screenshot({path:`test-results/${screenshot}.png`});
 await page.keyboard.press('Escape');
 assert.equal(await viewer.count(),0,'Escape must close only fullscreen');
 assert(await expand.evaluate(el=>el===document.activeElement),'fullscreen must restore focus');
}

(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
 const context = await browser.newContext({ viewport:{width:1440,height:900} });
 await context.request.post('http://127.0.0.1:4187/api/equipment/1/photo', {multipart:{photo:{name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=','base64')}}});
 const page = await context.newPage();
 const errors=[];
 page.on('pageerror', error=>errors.push(error.message));
 page.on('console',msg=>{if(msg.type()==='error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text());});
 await context.addInitScript(()=>localStorage.setItem('token','fixture-token'));
 await page.goto('http://127.0.0.1:4187/equipment');
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload();
 const sizes=[[1440,900],[1024,768],[390,844]];
 for(const [width,height] of sizes) {
  await page.setViewportSize({width,height});
  for(const [kind,name,form] of [['equipment','Pump 1','equipment'],['rooms','Room 101','room']]) {
   await page.goto(`http://127.0.0.1:4187/${kind}`);
   const trigger=page.getByRole('button',{name:`View photo of ${name}`}).filter({visible:true});
   await trigger.click();
   const image=page.locator('dialog[open] .entity-photo-image');
   await image.evaluate(img=>img.decode());
   const pickerEvent=page.waitForEvent('filechooser');
   await page.getByRole('button',{name:'Replace photo',exact:true}).focus();
   await page.keyboard.press('Enter');
   const picker=await pickerEvent;
   assert.equal(await picker.element().getAttribute('capture'),null);
   assert.equal(await picker.element().getAttribute('accept'),'image/*');
   await checkFullscreen(page, page.locator('dialog[open]'), name, `fullscreen-${kind}-${width}`);
   assert((await image.getAttribute('src')).endsWith('.preview.webp'));
   await page.screenshot({path:`test-results/photo-${kind}-${width}.png`});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page horizontal overflow');
   const box=await page.locator('dialog[open]').boundingBox();
   assert(box.x>=0 && box.x+box.width<=width && box.y>=0 && box.y+box.height<=height,'dialog clipped');
   await page.keyboard.press('Escape');
   assert(await trigger.evaluate(el=>el===document.activeElement),'focus not restored');
   await page.getByRole('button',{name:/^(Go to Map|Map)$/}).filter({visible:true}).click();
   await page.waitForTimeout(1000);
   await page.mouse.click(width/2,height/2);
   const drawer=page.locator(`.${form}-form-container .entity-photo`);
   try { await drawer.waitFor({timeout:5000}); } catch(e) { await page.screenshot({path:'test-results/photo-failure.png'}); console.log('failed map',await page.locator('body').innerText()); throw e; }
   await drawer.locator('img').scrollIntoViewIfNeeded();
   await drawer.locator('img').evaluate(img=>img.decode());
   // Returning from Android's native picker must not refresh the floorplan
   // underneath the mounted photo input in an existing-entity drawer.
   const resumeRequests=[];
   const resumed=request=>{if (/\/api\/floorplans\/\d+(?:\?|$)/.test(request.url())) resumeRequests.push(request.url());};
   await page.waitForTimeout(500);
   page.on('request',resumed);
   await drawer.locator('input[type=file]').evaluate(input=>{
    input.dataset.resumeProbe='mounted';
    document.dispatchEvent(new Event('visibilitychange'));
   });
   await page.waitForTimeout(500);
   page.off('request',resumed);
   assert.equal(resumeRequests.length,0,'resume refreshed a floorplan with an open entity drawer');
   assert.equal(await drawer.locator('input[type=file]').getAttribute('data-resume-probe'),'mounted','photo input remounted on resume');
   await checkFullscreen(page, drawer, name, `fullscreen-${kind}-drawer-${width}`);
   await drawer.getByRole('button',{name:'Replace photo',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`test-results/photo-${kind}-drawer-${width}.png`});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'drawer horizontal overflow');
   console.log(`${kind} table/dialog/drawer ${width}: passed`);
  }
 }
 // Exercise replacement and deletion through the real equipment table photo dialog.
 await page.setViewportSize({width:1440,height:900});
 await page.goto('http://127.0.0.1:4187/equipment');
 await page.getByRole('button',{name:'View photo of Pump 1'}).filter({visible:true}).click();
 const before=await page.locator('dialog img').getAttribute('src');
 const replacementChooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Replace photo',exact:true}).click();
 await (await replacementChooser).setFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=','base64')});
 await page.waitForFunction(old=>document.querySelector('dialog img')?.src!==old,before);
 await page.getByRole('button',{name:'Replace photo',exact:true}).waitFor();
 await page.locator('dialog img').evaluate(img=>img.decode());
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Remove photo',exact:true}).click();
 await page.getByText('No photo',{exact:true}).waitFor();
 console.log('replace/remove: passed');
 await page.keyboard.press('Escape');
 // Room retains its image; offline must render only thumbnail and disable modifications.
 await page.goto('http://127.0.0.1:4187/rooms');
 await page.getByRole('button',{name:'View photo of Room 101'}).filter({visible:true}).click();
 await page.locator('dialog img').evaluate(img=>img.decode());
 await page.waitForFunction(async()=>{const c=await caches.open('entity-photo-thumbnails-v1');return (await c.keys()).length>0;});
 assert.equal(errors.length,0,errors.join('\n'));
 errors.length=0;
 await context.setOffline(true);
 await page.getByText('Offline · saved thumbnail only',{exact:true}).waitFor();
 await page.locator('dialog img').evaluate(img=>img.decode());
 assert((await page.locator('dialog img').getAttribute('src')).endsWith('.thumb.webp'));
 assert(await page.getByRole('button',{name:'Replace photo',exact:true}).isDisabled());
 await checkFullscreen(page, page.locator('dialog[open]'), 'Room 101', 'fullscreen-offline', true);
 const cached=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){const c=await caches.open(name);result.push(...(await c.keys()).map(k=>k.url));}return result;});
 assert(!cached.some(url=>url.includes('.preview.webp')),'preview entered offline cache');
 await page.reload();
 await page.getByRole('button',{name:'View photo of Room 101'}).filter({visible:true}).click();
 await page.locator('dialog img').evaluate(img=>img.decode());
 assert((await page.locator('dialog img').getAttribute('src')).endsWith('.thumb.webp'));
 assert.equal(errors.length,0,errors.join('\n'));
 assert(await page.evaluate(()=>localStorage.getItem('token')==='fixture-token'),'offline reload lost saved session');
 console.log('offline reload, thumbnail-only cache, disabled editing, console: passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
