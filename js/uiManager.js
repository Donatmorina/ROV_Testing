import { appState, pathState, interactionState, threeJsState } from './state.js';
import * as pathManager from './pathManager.js';
import * as dataManager from './dataManager.js';

/**
 * @fileoverview Manages all DOM elements, UI updates, and event listeners.
 */

// This object will hold references to all our DOM elements.
export const ui = {};

// A function to be set from our main script to handle starting/stopping playback.
let handlePlay = () => {};
// A function to handle view switching
let handleSwitchView = () => {};
// A function to handle ROV speed changes
let handleRovSpeedChange = () => {};


/**
 * Finds all necessary DOM elements and stores them in the `ui` object.
 */
function queryDOMElements() {
    const ids = [
        'recordBtn', 'stopBtn', 'playBtn', 'playBackwardsBtn', 'resumeFromBtn', 'editPathBtn',
        'switchViewBtn', 'freeViewBtn', 'undoBtn', 'redoBtn', 'saveBtn', 'loadBtn', 'loadInput',
        'clearBtn', 'waypoint-list', 'deleteSelectedWaypointsBtn', 'cycleWaypointsBtn', 'teleportBtn',
        'teleport-dropdown', 'status-bar', 'coords-bar', 'playbackSpeed', 'speedValue', 'rovSpeed',
        'rovSpeedValue', 'minimapToggleMenuBtn', 'minimap-follow', 'minimap-container',
        'toggleControlsBtn', 'editFalloff', 'editFalloffValue', 'pathEditSpeed', 'pathEditSpeedValue',
        'proportional-edit-controls', 'editModeFreeBtn', 'editModeHorizontalBtn', 'editModeVerticalBtn',
        'fullscreenBtn', 'fpvToggleMenuBtn', 'fpvHideBtn', 'fpvSwitchMainBtn', 'extendPathBtn',
        'extendPathMode', 'extend-path-controls', 'resumeFromDropdown', 'editPathCoordsBtn',
        'pathCoordsPanel', 'pathCoordX', 'pathCoordY', 'pathCoordZ', 'gizmoModeBtn', 'rotatePathBtn',
        'pathRotatePanel', 'pathRotX', 'pathRotY', 'pathRotZ', 'pathRotXSlider', 'pathRotYSlider', 'pathRotZSlider',
        'pathRotLeft', 'pathRotRight', 'pathRotUp', 'pathRotDown', 'pathRotZp', 'pathRotZm', 'pathRotReset',
        'rotationOriginSelect'
    ];
    ids.forEach(id => {
        ui[id] = document.getElementById(id);
        if (!ui[id]) {
            console.warn('UI element not found:', id);
        }
    });
}

/**
 * Attaches event listeners to the UI elements.
 */
function bindEventListeners() {
    ui.clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the entire path? This cannot be undone.')) {
            pathManager.clearPath();
            updateStatus('Data cleared.');
            updateUI();
        }
    });

    ui.undoBtn.addEventListener('click', () => {
        const message = pathManager.handleUndo();
        updateStatus(message);
        updateUI();
    });

    ui.redoBtn.addEventListener('click', () => {
        const message = pathManager.handleRedo();
        updateStatus(message);
        updateUI();
    });

    ui.deleteSelectedWaypointsBtn.addEventListener('click', () => {
        const message = pathManager.deleteSelectedWaypoints();
        updateStatus(message);
        updateUI();
    });
    
    ui.editPathBtn.addEventListener('click', toggleEditMode);

    ui.saveBtn.addEventListener('click', dataManager.saveData);
    ui.loadBtn.addEventListener('click', () => ui.loadInput.click());
    ui.loadInput.addEventListener('change', (e) => dataManager.loadData(e, () => {
        pathManager.updatePathVisuals();
        updateUI();
        updateStatus('Data loaded successfully.');
    }));

    // Buttons that just change state, logic is handled elsewhere
    ui.playBtn.addEventListener('click', () => handlePlay(false));
    ui.playBackwardsBtn.addEventListener('click', () => handlePlay(true));
    ui.switchViewBtn.addEventListener('click', handleSwitchView);
    ui.rovSpeed.addEventListener('input', (e) => handleRovSpeedChange(e.target.value));

    // Simple state toggles
    ui.recordBtn.addEventListener('click', () => {
        appState.isRecording = !appState.isRecording
        if (appState.isRecording && pathState.path.length === 0) {
             pathState.path.push(threeJsState.rov.position.clone());
        }
        updateStatus(appState.isRecording ? 'Recording path...' : 'Recording paused.');
        updateUI();
    });

    ui.stopBtn.addEventListener('click', () => {
        appState.isRecording = false;
        appState.isPlaying = false;
        if (pathState.path.length > 1) {
            pathManager.saveStateForUndo();
            pathManager.updatePathVisuals();
            updateStatus('Path recorded.');
        } else {
            pathManager.clearPath();
            updateStatus('Path too short, cleared.');
        }
        updateUI();
    });

    // --- Path Extension ---
    if (ui.extendPathBtn) {
        ui.extendPathBtn.addEventListener('click', () => {
            appState.isExtendingPath = !appState.isExtendingPath;
            if (appState.isExtendingPath) {
                updateStatus('Click and drag the last waypoint or use R/F/T/G to extend the path.');
            } else {
                updateStatus('Path extension cancelled.');
            }
            updateUI();
        });
    }
    if (ui.extendPathMode) {
        ui.extendPathMode.addEventListener('change', (e) => {
            appState.extendMode = e.target.value;
        });
    }

    // --- Path Rotation Panel ---
    if (ui.rotatePathBtn && ui.pathRotatePanel) {
        ui.rotatePathBtn.addEventListener('click', () => {
            const panel = ui.pathRotatePanel;
            if (panel.style.display === 'block') {
                panel.style.display = 'none';
                pathManager.applyGlobalRotation();
            } else {
                // Populate sliders/inputs with current values
                ui.pathRotX.value = (pathState.pathGlobalRotation.x * 180 / Math.PI).toFixed(1);
                ui.pathRotY.value = (pathState.pathGlobalRotation.y * 180 / Math.PI).toFixed(1);
                ui.pathRotZ.value = (pathState.pathGlobalRotation.z * 180 / Math.PI).toFixed(1);
                ui.pathRotXSlider.value = Math.round(pathState.pathGlobalRotation.x * 180 / Math.PI);
                ui.pathRotYSlider.value = Math.round(pathState.pathGlobalRotation.y * 180 / Math.PI);
                ui.pathRotZSlider.value = Math.round(pathState.pathGlobalRotation.z * 180 / Math.PI);
                // Populate origin dropdown
                ui.rotationOriginSelect.innerHTML = '';
                pathState.path.forEach((p, i) => {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = `Waypoint ${i} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
                    ui.rotationOriginSelect.appendChild(opt);
                });
                ui.rotationOriginSelect.value = pathState.rotationOriginIndex;
                panel.style.display = 'block';
            }
        });
        // Sliders/inputs
        ['X','Y','Z'].forEach(axis => {
            ui[`pathRot${axis}`].addEventListener('input', (e) => {
                pathManager.updateGlobalRotation(axis.toLowerCase(), parseFloat(e.target.value));
            });
            ui[`pathRot${axis}Slider`].addEventListener('input', (e) => {
                pathManager.updateGlobalRotation(axis.toLowerCase(), parseFloat(e.target.value));
            });
        });
        // Increment/decrement buttons
        ui.pathRotLeft.addEventListener('click', () => pathManager.incrementGlobalRotation('y', -10));
        ui.pathRotRight.addEventListener('click', () => pathManager.incrementGlobalRotation('y', 10));
        ui.pathRotUp.addEventListener('click', () => pathManager.incrementGlobalRotation('x', -10));
        ui.pathRotDown.addEventListener('click', () => pathManager.incrementGlobalRotation('x', 10));
        ui.pathRotZp.addEventListener('click', () => pathManager.incrementGlobalRotation('z', 10));
        ui.pathRotZm.addEventListener('click', () => pathManager.incrementGlobalRotation('z', -10));
        ui.pathRotReset.addEventListener('click', () => pathManager.resetGlobalRotation());
        // Origin select
        ui.rotationOriginSelect.addEventListener('change', (e) => {
            pathManager.setRotationOriginIndex(parseInt(e.target.value, 10));
        });
    }
}

/**
 * Initializes the UI manager by querying elements and binding events.
 * @param {object} handlers - Functions from the main controller to handle complex logic.
 */
export function init(handlers) {
    handlePlay = handlers.handlePlay;
    handleSwitchView = handlers.handleSwitchView;
    handleRovSpeedChange = handlers.handleRovSpeedChange;

    queryDOMElements();
    bindEventListeners();
    updateUI();
    updateStatus('Application initialized.');
}

// --- UI Update Functions ---

/**
 * Updates the status bar with a new message.
 * @param {string} message 
 */
export function updateStatus(message) {
    if (ui.statusBar) {
        ui.statusBar.textContent = message;
    }
}

/**
 * Updates the coordinate display with the ROV's position.
 */
export function updateCoordinateDisplay() {
    if (!ui.coordsBar || !threeJsState.rov) return;
    const { x, y, z } = threeJsState.rov.position;
    ui.coordsBar.textContent = `X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`;
}

/**
 * Toggles the path editing mode.
 */
function toggleEditMode() {
    appState.isEditingPath = !appState.isEditingPath;
    if (!appState.isEditingPath) {
        pathManager.deselectPoint();
        appState.isCyclingWaypoints = false;
    }
    pathManager.updateEditHelpers();
    updateStatus(appState.isEditingPath ? 'Path editing enabled.' : 'Path editing disabled.');
    updateUI();
}


/**
 * Rebuilds the waypoint list in the UI panel.
 */
export function updateUiList() {
    if (!ui.waypointList) return;

    ui.waypointList.innerHTML = '';
    if (pathState.path.length === 0) {
        ui.waypointList.innerHTML = '<li>None</li>';
        return;
    }

    const fragment = document.createDocumentFragment();
    pathState.path.forEach((p, i) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.id = `waypoint-item-${i}`;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.waypointIndex = i;
        
        const textSpan = document.createElement('span');
        textSpan.textContent = `WP ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
        
        item.appendChild(checkbox);
        item.appendChild(textSpan);
        
        item.addEventListener('click', (e) => {
            if (appState.isEditingPath && e.target.type !== 'checkbox') {
                pathManager.selectPoint(i);
                updateStatus(`Point ${i} selected.`);
            }
        });
        fragment.appendChild(item);
    });
    ui.waypointList.appendChild(fragment);
}


/**
 * Updates the entire UI based on the current application state.
 */
export function updateUI() {
    if (!ui.recordBtn) return; // Don't run if UI hasn't been initialized

    const { isRecording, isPlaying, isEditingPath } = appState;
    const hasPath = pathState.path.length > 0;
    const hasMultiplePoints = pathState.path.length > 1;

    // Button states
    ui.recordBtn.disabled = isPlaying || isEditingPath;
    ui.stopBtn.disabled = !isRecording && !isPlaying;
    ui.playBtn.disabled = !hasMultiplePoints || isRecording || isEditingPath;
    ui.editPathBtn.disabled = !hasMultiplePoints || isRecording || isPlaying;
    ui.clearBtn.disabled = !hasPath || isRecording || isPlaying;
    ui.saveBtn.disabled = !hasMultiplePoints;
    ui.loadBtn.disabled = isRecording || isPlaying;

    ui.undoBtn.disabled = pathState.history.length === 0;
    ui.redoBtn.disabled = pathState.redoStack.length === 0;

    // Button text and classes
    ui.recordBtn.textContent = isRecording ? 'Pause Recording' : 'Record';
    ui.editPathBtn.textContent = isEditingPath ? 'Stop Editing' : 'Edit Path';
    ui.editPathBtn.classList.toggle('active', isEditingPath);
    
    // Panel visibility
    if (ui.proportionalEditControls) {
        ui.proportionalEditControls.style.display = isEditingPath ? 'block' : 'none';
    }

    updateUiList();

    // Path Extension controls
    if (ui.extendPathControls) {
        ui.extendPathControls.style.display = (appState.isEditingPath && pathState.path.length > 0) ? 'block' : 'none';
        ui.extendPathBtn.disabled = appState.isExtendingPath;
        ui.extendPathMode.value = appState.extendMode;
    }

    // Path Rotation Panel
    if (ui.pathRotatePanel) {
        ui.pathRotatePanel.style.display = appState.isEditingPath ? 'block' : 'none';
    }
}