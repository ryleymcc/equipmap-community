from pathlib import Path
import fitz
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]/'test-results'/'map-fixtures'
root.mkdir(parents=True,exist_ok=True)
for name,w,h,rotation in [('vector.pdf',1600,900,0),('portrait.pdf',500,2400,0),('rotated.pdf',1200,700,90)]:
    doc=fitz.open(); page=doc.new_page(width=w,height=h)
    for x in range(0,w,50): page.draw_line((x,0),(x,h),color=(.3,.3,.3))
    for y in range(0,h,50): page.draw_line((0,y),(w,y),color=(.3,.3,.3))
    page.insert_text((100,100),name,fontsize=30);page.set_rotation(rotation);doc.save(root/name);doc.close()
image=Image.new('RGB',(6000,4000),'white');draw=ImageDraw.Draw(image)
for x in range(0,6000,100): draw.line((x,0,x,4000),fill='black',width=3)
for y in range(0,4000,100): draw.line((0,y,6000,y),fill='black',width=3)
image.save(root/'large.jpg',quality=90);image.save(root/'large.png')
doc=fitz.open();page=doc.new_page(width=1500,height=1000);page.insert_image(page.rect,filename=str(root/'large.jpg'));doc.save(root/'scan.pdf');doc.close();image.close()
(root/'drawing.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/><path d="M0 450H1600M800 0V900" stroke="black"/></svg>')
print(root)

(root/'invalid.pdf').write_bytes(b'%PDF-1.7 invalid')
(root/'invalid.jpg').write_bytes(b'invalid image')
