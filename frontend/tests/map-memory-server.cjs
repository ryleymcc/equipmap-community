const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]);
 const file=name.startsWith('/uploads/memory-fixtures/')?path.join(root,'test-results/map-fixtures',path.basename(name)):path.join(root,'dist',name);
 if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(4188,'0.0.0.0',()=>console.log('Memory prototype listening on 4188'));
