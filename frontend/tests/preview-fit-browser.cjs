const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
fs.mkdirSync('test-results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const context=await browser.newContext();
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>localStorage.setItem('token','test-token'));
 let role='admin',fail=false,deleteCalls=0,undoDisabled=false;
 let files=Array.from({length:105},(_,id)=>({path:`entity-photos/unused-${id}.thumb.webp`,bytes:2048,modified:1700000000,status:'unused',fingerprint:'a'.repeat(64)}));
 files[0].modified=Date.now()/1000;
 files.push({path:'scene.glb',bytes:100,modified:1700000000,status:'history',fingerprint:'c'.repeat(64)}, {path:'drawing.svg',bytes:100,modified:1700000000,status:'history',fingerprint:'d'.repeat(64)});
 files.push(...['in_use','history','recent'].map(status=>({path:`${status}.pdf`,bytes:4000,modified:1700000000,status:status==='recent'?'history':status,fingerprint:'b'.repeat(64)})));
 await context.route('**/uploads/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('.webp')) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="3600"><rect width="1800" height="3600" fill="steelblue"/></svg>'});
  if(path.endsWith('.pdf'))return route.fulfill({contentType:'application/pdf',body:fs.readFileSync('test-results/preview.pdf')});
  if(path.endsWith('.glb'))return route.fulfill({contentType:'model/gltf-binary',body:fs.readFileSync('test-results/preview.glb')});
  if(path.endsWith('.svg'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="steelblue"/></svg>'});
  return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=','base64')});
 });
 await context.route('**/api/**' ,async route=>{
  const path=new URL(route.request().url()).pathname;let body=[];
  if(path==='/api/chatgpt/pending-changes')body={results:[],has_more:false};
  if(path==='/api/audit-logs' && undoDisabled)body=[{id:1,timestamp:'2026-11-15T07:00:00Z',action:'update',target_type:'floorplan',target_name:'Test floor',username:'fixture',old_values:{file_path:'/uploads/history.pdf'},undo_unavailable_reason:'A required upload was permanently deleted by an administrator.'}];
  if(path==='/api/users/me')body={id:1,username:'fixture',role,can_manage_items:true};
  if(path==='/api/data-manager/uploads'){
   if(fail){await route.fulfill({status:500,json:{detail:'Test scan failure'}});return;}
   body={files};
  }
  if(path==='/api/data-manager/uploads/delete'){
   const request=route.request().postDataJSON();
   if(request.discard_undo && request.files.some(file=>file.path==='history.pdf'))undoDisabled=true;
   deleteCalls++;const chosen=request.files;files=files.filter(f=>!chosen.some(c=>c.path===f.path));body={disabled_undo_count:chosen.some(file=>file.path==='history.pdf')?1:0,deleted:chosen.length,bytes_freed:chosen.length*2048,failed:[]};
  }
  await route.fulfill({json:body});
 });

 for(const [width,height] of [[1440,900],[1024,768],[390,844],[1024,500]]){
  await page.setViewportSize({width,height});
  await page.goto('http://localhost:5173/audit-log/data');
  await page.getByRole('button',{name:'entity-photos/unused-0.thumb.webp',exact:true}).waitFor();
  await page.getByLabel('Per page:',{exact:true}).selectOption('all');
  const opener=page.getByRole('button',{name:'entity-photos/unused-99.thumb.webp',exact:true});
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'Preview entity-photos/unused-99.thumb.webp',exact:true});
  await dialog.locator('img').evaluate(img=>img.decode());
  const metrics=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),body=el.querySelector('.data-manager-preview-body'),img=el.querySelector('img').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,scroll:body.scrollHeight-body.clientHeight,imageTop:img.top,imageBottom:img.bottom};});
  console.log(width,height,metrics);
  assert(metrics.x>=0&&metrics.y>=0&&metrics.right<=width+1&&metrics.bottom<=height+1,'dialog fits viewport');
  assert(metrics.scroll<=1,'image fits without body scroll');
  await page.screenshot({path:'test-results/preview-fit-'+width+'-'+height+'.png'});
  await page.keyboard.press('Escape');
  assert(await opener.evaluate(el=>el===document.activeElement),'focus returned');
 }
 assert.deepEqual(errors,[]);await browser.close();
 }catch(e){await browser.close();throw e;}
})();