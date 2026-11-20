/* eslint react-refresh/only-export-components: ["off"] -- Standalone browser verification entry point. */
import { useEffect, useRef, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { createRoot } from 'react-dom/client';
import { MapCanvas as Prototype } from '../src/components/MapCanvas';
import { MapCanvas as Baseline } from '../test-results/BaselineMapCanvas';
const baseline = location.search.includes('baseline');
const MapCanvas = baseline ? Baseline : Prototype;
import '../src/index.css';
import './map-memory-harness.css';
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });
const files = ['vector.pdf','portrait.pdf','rotated.pdf','scan.pdf','large.jpg','large.png','drawing.svg','missing.pdf','CAD - Level 2.pdf','Wellness Entry level plan.pdf','sogh.jpg','invalid.pdf','invalid.jpg'];
const floorplans = files.map((name,id) => ({id:id+1,name,file_path:`/uploads/memory-fixtures/${name}`,file_type:name.endsWith('pdf')?'pdf':name.endsWith('svg')?'svg':'image'}));
function Harness() {
 const transform = useRef(null); const content = useRef(null);
 const drag = useRef(null);
 const [fp,setFp] = useState(floorplans[Number(new URLSearchParams(location.search).get('floor')) || 0]); const [cal,setCal] = useState(false);
 const [overlay,setOverlay] = useState({tx:0,ty:0,scale:1,rotation:0});
 const [dragging,setDragging] = useState(false); const [loaded,setLoaded] = useState(false);
 useEffect(() => { window.mapTest = { select: index => setFp(floorplans[index]), calibration: setCal, overlay: setOverlay,
  zoom: (scale,x=0,y=0) => transform.current.setTransform(x,y,scale,0),
  state: () => transform.current.instance.state, loaded: () => loaded,
  compareRaster: async () => {
   const loading = pdfjs.getDocument({url:fp.file_path,disableRange:true,disableStream:true});
   const pdf = await loading.promise;
   try {
    const page = await pdf.getPage(1);const unit = page.getViewport({scale:1});
    const width = innerWidth,height = innerHeight;
    const reference = document.createElement('canvas');reference.width=width;reference.height=height;
    const expected=reference.getContext('2d');
    await page.render({canvasContext:expected,viewport:page.getViewport({scale:2000/unit.width})}).promise;
    const composite=document.createElement('canvas');composite.width=width;composite.height=height;
    const actual=composite.getContext('2d');actual.fillStyle='white';actual.fillRect(0,0,width,height);
    for(const tile of document.querySelectorAll('.floorplan-tiles canvas'))actual.drawImage(tile,parseFloat(tile.style.left),parseFloat(tile.style.top),parseFloat(tile.style.width),parseFloat(tile.style.height));
    const a=actual.getImageData(0,0,width,height).data;const b=expected.getImageData(0,0,width,height).data;
    let different=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>25)different++;
    return different/(width*height);
   } finally { await loading.destroy(); }
  } }; }, [fp, loaded]);
 return <div className="memory-harness"><MapCanvas transformComponentRef={transform} mapContentRef={content}
 mapMode={{type:'view'}} calibrationMode={cal} floorplan={fp} baseFloorplanId={1} siteFloorplans={baseline ? [fp] : floorplans}
 overlayOpacity={0.5} overlayTransform={overlay} setOverlayTransform={setOverlay} isDraggingOverlay={dragging}
 setIsDraggingOverlay={setDragging} overlayDragRef={drag} setPdfLoaded={setLoaded}
 filteredRooms={[{id:1,name:'Reference',x_coordinate:300,y_coordinate:250}]} pendingRooms={[]}
 dispersedEquipment={[]} handleMapClick={()=>{}} onPinRoomClick={()=>{window.pinClicked=true;}} />
 </div>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
