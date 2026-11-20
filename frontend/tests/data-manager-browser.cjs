const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base = process.env.DATA_MANAGER_TEST_URL || 'http://localhost:5173';
fs.mkdirSync('test-results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const context=await browser.newContext({ serviceWorkers: 'block' });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>localStorage.setItem('token','test-token'));
 let role='admin',fail=false,deleteCalls=0,undoDisabled=false;
 let files=Array.from({length:105},(_,id)=>({path:`entity-photos/unused-${id}.thumb.webp`,bytes:2048,modified:1700000000,status:'unused',fingerprint:'a'.repeat(64)}));
 files[0].modified=Date.now()/1000;
 files.push({path:'scene.glb',bytes:100,modified:1700000000,status:'history',fingerprint:'c'.repeat(64)}, {path:'drawing.svg',bytes:100,modified:1700000000,status:'history',fingerprint:'d'.repeat(64)});
 files.push(...['in_use','history','recent'].map(status=>({path:`${status}.pdf`,bytes:4000,modified:1700000000,status:status==='recent'?'history':status,fingerprint:'b'.repeat(64)})));
 await context.route('**/uploads/**',async route=>{
  const path=new URL(route.request().url()).pathname;
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
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(base + '/audit-log');
  try { await page.getByRole('link',{name:'Data manager',exact:true}).click({timeout:5000}); } catch(e) { console.log('body',await page.locator('body').innerText());console.log(errors);throw e; }
  await page.getByText('105 files · 210.0 KiB',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Show files').inputValue(),'not_in_use');
  assert.equal(await page.getByRole('option',{name:'Uploaded within 24 hours',exact:true}).count(),0);
  assert(await page.getByRole('checkbox',{name:'Select entity-photos/unused-0.thumb.webp',exact:true}).isEnabled());
  await page.getByLabel('Show files').selectOption('history');
  assert(await page.getByRole('button',{name:'history.pdf',exact:true}).isVisible());
  await page.getByLabel('Show files').selectOption('not_in_use');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
  await page.screenshot({path:`test-results/data-manager-${width}.png`});
  const opener=page.getByRole('button',{name:'entity-photos/unused-0.thumb.webp',exact:true});
  await opener.click();
  const preview=page.getByRole('dialog',{name:'Preview entity-photos/unused-0.thumb.webp',exact:true});
  await preview.locator('img').evaluate(img=>img.decode());
  await page.screenshot({path:`test-results/upload-preview-image-${width}.png`});
  await preview.getByRole('button',{name:'Full screen',exact:true}).click();
  await page.getByRole('dialog',{name:/Fullscreen photo/}).waitFor();
  await page.keyboard.press('Escape');
  await preview.waitFor();
  await page.keyboard.press('Escape');
  assert(await opener.evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await page.getByText('Page 2 of 2' ,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Previous page',exact:true}).click();
  await page.getByLabel('Show files').selectOption('all');
  await page.getByLabel('Per page:',{exact:true}).selectOption('all');
  const protectedCheckbox=page.getByRole('checkbox',{name:'Select in_use.pdf',exact:true});
  assert(await protectedCheckbox.isDisabled());
  await page.getByRole('button',{name:'in_use.pdf',exact:true}).click();
  const pdf=page.getByRole('dialog',{name:'Preview in_use.pdf',exact:true});
  await pdf.getByText('Page 1 of 2',{exact:true}).waitFor();
  await pdf.locator('canvas').waitFor();
  await pdf.getByRole('button',{name:'Next page',exact:true}).click();
  await pdf.getByText('Page 2 of 2',{exact:true}).waitFor();
  await page.screenshot({path:`test-results/upload-preview-pdf-${width}.png`});
  const bounds=await pdf.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await pdf.getByRole('button',{name:'Close upload preview',exact:true}).click();
  await page.getByRole('button',{name:'drawing.svg',exact:true}).click();
  await page.getByRole('dialog',{name:'Preview drawing.svg',exact:true}).locator('img').evaluate(img=>img.decode());
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'scene.glb',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('dialog model-viewer')?.loaded===true);
  await page.keyboard.press('Escape');
  console.log(`data manager ${width}: navigation, pagination, protected controls, layout passed`);
 }
 await page.getByLabel('Show files').selectOption('history');
 const retained=page.getByRole('checkbox',{name:'Select history.pdf',exact:true});
 assert.equal(await page.getByRole('checkbox',{name:'Allow deleting files retained for undo',exact:true}).count(),0);
 assert(await retained.isEnabled());
 await retained.check();
 await page.screenshot({path:'test-results/data-manager-discard-undo.png'});
 page.once('dialog',dialog=>{
  assert(dialog.message().includes('undo actions requiring these files will become permanently unavailable'));
  assert(dialog.message().includes('Audit records will remain'));
  dialog.accept();
 });
 await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();
 await page.getByText(/Undo disabled for 1 audit entries/).waitFor();
 await page.getByRole('link',{name:'Audit history',exact:true}).click();
 await page.getByText('Undo unavailable · required upload deleted',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),0);
 await page.getByRole('link',{name:'Data manager',exact:true}).click();
 await page.getByText('105 files · 210.0 KiB',{exact:true}).waitFor();
 deleteCalls=0;
 await page.getByLabel('Show files').selectOption('unused');
 const checkbox=page.getByRole('checkbox',{name:'Select entity-photos/unused-0.thumb.webp',exact:true});
 await checkbox.focus();await page.keyboard.press('Space');
 page.once('dialog',dialog=>dialog.dismiss());
 await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();assert.equal(deleteCalls,0);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();
 await page.getByText('Deleted 1 files and freed 2.0 KiB.',{exact:true}).waitFor();assert.equal(deleteCalls,1);
 fail=true;await page.getByRole('button',{name:'Refresh uploads',exact:true}).click();await page.getByRole('alert').waitFor();
 fail=false;files=files.filter(f=>f.status!=='unused');await page.getByRole('button',{name:'Refresh uploads',exact:true}).click();
 await page.getByText('No uploads are ready for deletion.',{exact:true}).waitFor();
 role='editor';await page.reload();await page.getByText('Only admins can manage upload storage.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Data manager',exact:true}).count(),0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('keyboard selection, cancel/confirm, success/error/empty states, editor access, console passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
