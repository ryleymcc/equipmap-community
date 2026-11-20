const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const context=await browser.newContext();
 await context.addInitScript(()=>localStorage.setItem('token','usage-fixture'));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let fail=false;
 const photo='/uploads/entity-photos/shared.preview.webp';
 const room={id:1,floorplan_id:1,name:'Room 101',description:'Fixture',x_coordinate:300,y_coordinate:250,photo_path:photo,photo_thumbnail_path:photo.replace('.preview.','.thumb.')};
 const equipment={...room,name:'Pump 1',color:'#10b981'};
 const fp={id:1,site_id:1,name:'Floor 1',file_path:'/uploads/test.svg',file_type:'svg',rooms:[room],equipment:[equipment],tickets:[],reference_points:[]};
 const uses=[{type:'rooms',id:1,name:room.name,floorplan_id:1,relationship:'Photo',entity:room},{type:'equipment',id:1,name:equipment.name,floorplan_id:1,relationship:'Photo',entity:equipment},{type:'floorplans',id:1,name:'Floor 1',site_id:1,relationship:'Current drawing'}];
 await context.route('**/uploads/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="white"/></svg>'}));
 await context.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;let data=[];
  if(path==='/api/users/me')data={id:1,username:'tester',role:'admin',can_manage_items:true};
  if(path==='/api/data-manager/uploads')data={files:[{path:'entity-photos/shared.thumb.webp',bytes:100,modified:1700000000,status:'in_use',fingerprint:'a'.repeat(64)}]};
  if(path==='/api/data-manager/uploads/usage'){if(fail)return route.fulfill({status:500,json:{detail:'Usage unavailable'}});data={uses};}
  if(path==='/api/chatgpt/pending-changes')data={results:[],has_more:false};
  if(path==='/api/floorplans/1')data=fp;
  if(path==='/api/sites/1/floorplans')data=[fp];
  if(path==='/api/sites')data=[{id:1,name:'Site'}];
  return route.fulfill({json:data});
 });
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:900});
  for(const type of ['room','equipment']){
   await page.goto('http://localhost:5173/audit-log/data');
   await page.getByLabel('Show files').selectOption('in_use');
   const trigger=page.getByRole('button',{name:'Show usage of entity-photos/shared.thumb.webp',exact:true});
   await trigger.click();
   const dialog=page.getByRole('dialog',{name:'Usage of entity-photos/shared.thumb.webp',exact:true});
   await dialog.getByRole('link',{name:'Open room',exact:true}).waitFor();
   assert.equal(await dialog.getByRole('link').count(),3);
   assert((await dialog.getByRole('link',{name:'Open floorplans',exact:true}).getAttribute('href')).includes('siteId=1'));
   await page.screenshot({path:`test-results/upload-usage-${width}.png`});
   const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   await page.keyboard.press('Escape');assert(await trigger.evaluate(e=>e===document.activeElement));
   await trigger.click();await dialog.getByRole('link',{name:'Open '+type,exact:true}).click();
   const drawer=page.locator(type==='room'?'.room-form-container':'.equipment-form-container');
   await drawer.waitFor();await drawer.getByRole('button',{name:'Remove photo',exact:true}).scrollIntoViewIfNeeded();
   assert(await drawer.getByRole('button',{name:'Remove photo',exact:true}).isEnabled());
  }
  console.log(width+': shared usage list, correct photo drawers, keyboard focus passed');
 }
 await page.goto('http://localhost:5173/audit-log/data');await page.getByLabel('Show files').selectOption('in_use');
 fail=true;await page.getByRole('button',{name:'Show usage of entity-photos/shared.thumb.webp',exact:true}).click();
 await page.getByRole('alert').waitFor();fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByRole('link',{name:'Open room',exact:true}).waitFor();
 assert.equal(errors.length,0,errors.join('\n'));console.log('Error/retry and runtime console passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
