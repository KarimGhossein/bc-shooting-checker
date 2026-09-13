// Regression test for v96's leaflet.draw "Clear All" fix -- a plain Node
// test (no browser needed), because the app's own network-stubbed
// leaflet-stub.js (used by every Playwright test in this suite) is a
// generic chainable Proxy with no real L.EditToolbar class to patch against
// -- see that file's own top comment. Testing the patch logic for real
// needs a stand-in L.EditToolbar that actually behaves like leaflet-draw
// v1.0.4's real one (verbatim from its own src/edit/EditToolbar.js
// getActions(), fetched directly from the library's GitHub source, not
// guessed), which is exactly what this file builds.
//
// Root problem this guards against: leaflet.draw's delete-mode ("trash
// can", top-left of the map) action popout normally offers Save, Cancel,
// and "Clear All" -- L.EditToolbar.getActions() adds "Clear All" whenever
// the active handler defines removeAllLayers(), which only
// L.EditToolbar.Delete does. That's a one-click, no-confirmation wipe of
// every pin/line/area in "My Markup" sitting right next to "Cancel" --
// Karim asked for it removed ("remove the 'Clear all' button that's live
// in the pop out menu from the trash can icon on the left side of the
// app" -- explicitly NOT the Tools drawer's "Clear ▾" dropdown, which v95
// mistakenly removed instead and this version restores in full).
//
// Fix: index.html patches L.EditToolbar.prototype.getActions to filter out
// the action whose callback is the instance's own _clearAllLayers --
// matching by callback identity rather than button text/title, so a
// L.drawLocal locale override (which only translates the text) can't slip
// the real "Clear All" action past this filter.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Extract the exact patch block from index.html rather than
  // re-transcribing it here -- so this test fails loudly if that block is
  // ever edited in a way that breaks the extraction (e.g. the guard
  // comment or variable names change), instead of silently testing a stale
  // copy of logic the app no longer runs.
  const m = html.match(/if\(typeof L\.EditToolbar !== 'undefined' && !L\.EditToolbar\.prototype\._clearAllActionRemoved\)\{[\s\S]*?L\.EditToolbar\.prototype\._clearAllActionRemoved = true;\s*\n\s*\}/);
  const patchSource = m ? m[0] : null;

  // ---- Build a faithful stand-in for leaflet-draw v1.0.4's real
  // L.EditToolbar, using its actual getActions() implementation verbatim
  // (fetched from Leaflet/Leaflet.draw's own GitHub source at tag v1.0.4,
  // src/edit/EditToolbar.js) rather than a hand-simplified approximation --
  // so this test would catch the patch breaking against the real shape of
  // the library's actions array, not just an idealized one.
  function EditToolbar(){}
  EditToolbar.prototype._save = function(){ this._saveCalled = true; };
  EditToolbar.prototype._clearAllLayers = function(){ this._clearAllCalled = true; };
  EditToolbar.prototype.disable = function(){ this._disableCalled = true; };
  const ORIGINAL_GET_ACTIONS = function (handler) {
    var actions = [
      { title: 'save-title', text: 'Save', callback: this._save, context: this },
      { title: 'cancel-title', text: 'Cancel', callback: this.disable, context: this }
    ];
    if (handler.removeAllLayers) {
      actions.push({ title: 'clearall-title', text: 'Clear All', callback: this._clearAllLayers, context: this });
    }
    return actions;
  };
  EditToolbar.prototype.getActions = ORIGINAL_GET_ACTIONS;

  const L = { EditToolbar: EditToolbar };

  let evalThrew = false, evalErr = null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('L', 'window', patchSource);
    fn(L, { __leafletDrawLoadFailed: false });
  } catch (e) { evalThrew = true; evalErr = e.message; }

  const instance = new L.EditToolbar();
  const editModeHandler = { removeAllLayers: undefined };   // L.EditToolbar.Edit never had Clear All
  const deleteModeHandler = { removeAllLayers: function(){} }; // L.EditToolbar.Delete: used to add it

  const editActions = L.EditToolbar.prototype.getActions.call(instance, editModeHandler);
  const deleteActions = L.EditToolbar.prototype.getActions.call(instance, deleteModeHandler);

  const results = {
    patchBlockFound: !!patchSource,
    evalThrew, evalErr,
    patchedFlagSet: L.EditToolbar.prototype._clearAllActionRemoved === true,
    editActionTexts: editActions.map(a => a.text),
    deleteActionTexts: deleteActions.map(a => a.text),
    deleteKeepsSave: deleteActions.some(a => a.text === 'Save'),
    deleteKeepsCancel: deleteActions.some(a => a.text === 'Cancel'),
    deleteLosesClearAll: !deleteActions.some(a => a.text === 'Clear All'),
    // Sanity check: without the patch, the real library WOULD have shown
    // Clear All for the delete handler -- confirms this test scenario is
    // the real one leaflet-draw produces, not an accidental no-op. Calls
    // the pre-patch function directly (not through the now-patched
    // prototype, which shares the same object the patch just rewrote).
    unpatchedWouldHaveShownClearAll: ORIGINAL_GET_ACTIONS.call(new EditToolbar(), deleteModeHandler).some(a => a.text === 'Clear All'),
    // Double-invoking the patch (e.g. a duplicate script include) must not
    // wrap getActions twice and silently double-filter or break it.
    secondPatchNoOp: (function(){
      const before = L.EditToolbar.prototype.getActions;
      try { new Function('L', 'window', patchSource)(L, { __leafletDrawLoadFailed: false }); } catch(e) { return false; }
      return L.EditToolbar.prototype.getActions === before;
    })(),
  };

  const pass = results.patchBlockFound
    && !results.evalThrew
    && results.patchedFlagSet
    && JSON.stringify(results.editActionTexts) === JSON.stringify(['Save', 'Cancel'])
    && JSON.stringify(results.deleteActionTexts) === JSON.stringify(['Save', 'Cancel'])
    && results.deleteKeepsSave
    && results.deleteKeepsCancel
    && results.deleteLosesClearAll
    && results.unpatchedWouldHaveShownClearAll
    && results.secondPatchNoOp;

  console.log('=== RESULTS ===', JSON.stringify(results, null, 2));
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
