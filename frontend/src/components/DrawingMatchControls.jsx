import { MAX_DRAWING_MATCHES } from '../drawingWarp';

export function DrawingMatchStatus({ model }) {
  const count = model.matches.length;
  let instruction;
  if (model.matchPhase === 'preview') instruction = 'Check the overlay against a landmark you did not match.';
  else if (count >= MAX_DRAWING_MATCHES) instruction = 'Point limit reached. Preview the result or remove a pair.';
  else if (model.matchPhase === 'target') instruction = `Point ${count + 1}: pick the same landmark on the floorplan.`;
  else instruction = `Point ${count + 1}: pick a landmark on the drawing.`;
  return <p className="drawing-note" role="status">{instruction}</p>;
}

export default function DrawingMatchControls({ model }) {
  const count = model.matches.length;
  const previewing = model.matchPhase === 'preview';
  const enterPoint = event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    model.addMatchPoint({ x: Number(fields.get('x')), y: Number(fields.get('y')) });
    form.reset();
  };
  return <div className="drawing-match-controls">
    <DrawingMatchStatus model={model} />
    <p className="drawing-note">{count} matched {count === 1 ? 'pair' : 'pairs'}. Start with four spread-out landmarks. Add more where the sheet bends.</p>
    {!model.editing.placement.coverage && <p className="drawing-note">Set Coverage points before saving to choose where the warped drawing appears.</p>}
    {count > 0 && <p className="drawing-note">Select a numbered point, then select the red X to remove its pair.</p>}
    {count >= 4 && !model.matchValid && <p className="drawing-sheet-status" role="alert">These points would fold or distort the drawing. Remove a pair and try a different landmark.</p>}
    {model.matchError && <p className="drawing-sheet-status" role="alert">{model.matchError}</p>}
    <div className="drawing-actions">
      <button type="button" className="btn btn-secondary" onClick={model.toggleMatchPreview} disabled={!model.matchValid || model.matchPhase === 'target'}>{previewing ? 'Add more points' : 'Preview warp'}</button>
      {model.matchPhase === 'target' && <button type="button" className="btn btn-secondary" onClick={model.cancelMatchPair}>Cancel this pair</button>}
    </div>
    {!previewing && count < MAX_DRAWING_MATCHES && <details className="drawing-crop">
      <summary>Enter point coordinates</summary>
      <form className="drawing-match-controls" onSubmit={enterPoint}>
        <div className="drawing-form-grid">
          <div className="equip-field"><label htmlFor="drawing-match-x">X (%)</label><input className="input-field" id="drawing-match-x" name="x" type="number" min="0" max="100" step="any" required /></div>
          <div className="equip-field"><label htmlFor="drawing-match-y">Y (%)</label><input className="input-field" id="drawing-match-y" name="y" type="number" min="0" max="100" step="any" required /></div>
        </div>
        <div className="drawing-actions"><button type="submit" className="btn btn-secondary">Add point</button></div>
      </form>
    </details>}
    <div className="drawing-actions"><button type="button" className="btn btn-secondary" onClick={() => model.showRegion(model.matchPhase === 'source' ? 'crop' : 'coverage', { x: 0, y: 0, width: 100, height: 100 })}>{model.matchPhase === 'source' ? 'Fit drawing' : 'Fit floorplan'}</button></div>
  </div>;
}
