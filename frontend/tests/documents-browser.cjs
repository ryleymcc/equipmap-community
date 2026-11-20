const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
require('node:fs').mkdirSync('test-results',{recursive:true});
(async()=>{
 const server=spawn('python',['tests/photo-browser-fixture.py'],{windowsHide:true});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext();
 await context.addInitScript(()=>localStorage.setItem('token','fixture-token'));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 let files=[];
 await page.route('**/api/equipment/1/documents**',async route=>{
  const method=route.request().method();
  if(method==='POST')files=[{id:1,filename:'Pump operating manual with a long descriptive filename.pdf',size_bytes:2048,path:'/uploads/manual.pdf'}];
  if(method==='DELETE')files=[];
  await route.fulfill({json:method==='POST'?files[0]:method==='DELETE'?{}:files});
 });
 for(const [width,height] of [[1440,900],[1024,768],[390,844]]){
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:4187/equipment');
  await page.getByRole('button',{name:/^(Go to Map|Map)$/}).filter({visible:true}).click();
  await page.waitForTimeout(1500);await page.mouse.click(width/2,height/2);
  await page.screenshot({path:`test-results/documents-map-${width}.png`});
  const trigger=page.getByRole('button',{name:'Documents & manuals',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog',{name:'Documents & manuals',exact:true});
  await dialog.getByText('No documents yet.',{exact:false}).waitFor();
  await dialog.locator('input[type=file]').setInputFiles({name:'manual.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF test')});
  const link=dialog.getByRole('link',{name:/Open Pump/});await link.waitFor();assert.equal(await link.getAttribute('target'),'_blank');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const box=await dialog.boundingBox();assert(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1);
  await page.screenshot({path:`test-results/documents-${width}.png`});
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:/Remove Pump/}).click();await dialog.getByText('No documents yet.',{exact:false}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert(await trigger.evaluate(el=>el===document.activeElement));
  console.log(`${width}: drawer, upload, external link, remove, layout, Escape and focus passed`);
 }
 assert.deepEqual(errors,[]);console.log('Console clean');
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1)});
