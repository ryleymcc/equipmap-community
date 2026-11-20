import { useRef } from 'react';

const POINTS = [['top-left', 'Top left', false, false], ['top-right', 'Top right', true, false], ['bottom-right', 'Bottom right', true, true], ['bottom-left', 'Bottom left', false, true], ['top-edge', 'Top edge', null, false], ['right-edge', 'Right edge', true, null], ['bottom-edge', 'Bottom edge', null, true], ['left-edge', 'Left edge', false, null]];

export default function DrawingRegionEditor({ region, kind, onChange, interactive = true }) {
  const svg = useRef(null);
  const drag = useRef(null);
  const name = kind === 'crop' ? 'Crop' : 'Coverage';
  const resize = (point, x, y, original = region) => {
    let left = original.x, top = original.y, right = left + original.width, bottom = top + original.height;
    if (point[2] === true) right = Math.max(left + 0.2, Math.min(100, x));
    else if (point[2] === false) left = Math.max(0, Math.min(right - 0.2, x));
    if (point[3] === true) bottom = Math.max(top + 0.2, Math.min(100, y));
    else if (point[3] === false) top = Math.max(0, Math.min(bottom - 0.2, y));
    onChange({ x: Number(left.toFixed(4)), y: Number(top.toFixed(4)), width: Number((right - left).toFixed(4)), height: Number((bottom - top).toFixed(4)) });
  };
  const pointerMove = event => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    event.stopPropagation();
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    // SVG's inverse screen transform includes map zoom, drawing scale and rotation.
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    resize(drag.current.point, position.x, position.y, drag.current.region);
  };
  return <div className={`drawing-region-editor drawing-region-${kind}`}>
    <svg ref={svg} className="drawing-region-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${name} boundary: left ${region.x.toFixed(1)}%, top ${region.y.toFixed(1)}%, right ${(region.x + region.width).toFixed(1)}%, bottom ${(region.y + region.height).toFixed(1)}%`}>
      <path className="drawing-region-outside" fillRule="evenodd" d={`M0 0H100V100H0Z M${region.x} ${region.y}h${region.width}v${region.height}h${-region.width}Z`} />
      <rect className="drawing-region-boundary" x={region.x} y={region.y} width={region.width} height={region.height} vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="drawing-region-caption" style={{ left: `${region.x}%`, top: `${region.y}%` }}>{name}{interactive ? ' · Drag corner or edge points' : ''}</span>
    {interactive && POINTS.map((point, index) => {
      const x = region.x + (point[2] === null ? region.width / 2 : point[2] ? region.width : 0), y = region.y + (point[3] === null ? region.height / 2 : point[3] ? region.height : 0);
      return <button type="button" key={point[0]} className="drawing-region-handle" aria-label={`${name} ${point[1].toLowerCase()} point`} title={`${point[1]}: X ${x.toFixed(1)}%, Y ${y.toFixed(1)}%. Drag or use arrow keys.`}
        style={{ left: `${x}%`, top: `${y}%` }}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { point, region: { ...region }, pointerId: event.pointerId }; }}
        onPointerMove={pointerMove} onPointerUp={event => { pointerMove(event); drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 1 : 0.1;
          resize(point, x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
        }}><span>{index + 1}</span></button>;
    })}
  </div>;
}
