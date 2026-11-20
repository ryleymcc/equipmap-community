const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
const server=spawn('python',['tests/photo-browser-fixture.py'],{windowsHide:true});
await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j)});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.addInitScript(()=>localStorage.setItem('token','fixture'));
let files=[{path:'equipment-documents/abc123.docx',filename:'Pump operating manual with a descriptive original filename.docx',status:'history',bytes:100,modified:1700000000,fingerprint:'a'.repeat(64)}];
await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let body=[];
if(path==='/api/users/me')body={id:1,username:'fixture',role:'admin',can_manage_items:true};
if(path==='/api/chatgpt/pending-changes')body={results:[],has_more:false};
if(path==='/api/data-manager/uploads')body={files};
if(path==='/api/data-manager/uploads/delete'){assert.equal(route.request().postDataJSON().files[0].path,'equipment-documents/abc123.docx');files=[];body={deleted:1,bytes_freed:100,failed:[],disabled_undo_count:1}}
await route.fulfill({json:body})});
for(const width of [1440,1024,390]){
await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4187/audit-log/data');
const name=files[0].filename;const link=page.getByRole('button',{name,exact:true});await link.waitFor();
assert(await page.getByText('equipment-documents/abc123.docx',{exact:true}).isVisible());
await page.getByLabel('Search filenames').fill('Pump operating');assert(await link.isVisible());
await link.focus();assert(await link.evaluate(el=>el===document.activeElement));
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:`test-results/document-filenames-${width}.png`});
console.log(`${width}: original name, stored path, search, focus and layout passed`);
}
await page.getByRole('checkbox',{name:`Select ${files[0].filename}`,exact:true}).check();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();await page.getByText(/Deleted 1 files/).waitFor();assert.deepEqual(errors,[]);console.log('Deletion path preserved; console clean');
}finally{await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exit(1)});
