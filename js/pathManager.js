import * as THREE from 'three';
import { appState, pathState, interactionState, threeJsState } from './state.js';
import { EDIT_HELPER_MATERIALS, PATH_LINE_COLOR } from './config.js';
import { scene } from './sceneManager.js';
import { updateUiList } from './uiManager.js';

/**
 * @fileoverview Manages all logic for path data, visuals, and editing.
 */

// --- History Management ---

/**
 * Saves the current state of the path for an undo operation.
 */
export function saveStateForUndo() {
    const pathCopy = pathState.path.map(p => p.clone());
    pathState.history.push({ path: pathCopy });
    pathState.redoStack = []; // Clear redo stack on new action
    // We will call a UI update function from the main controller
}

export function handleUndo() {
    if (pathState.history.length > 0) {
        const pathCopy = pathState.path.map(p => p.clone());
        pathState.redoStack.push({ path: pathCopy });

        const lastState = pathState.history.pop();
        pathState.path = lastState.path.map(p => p.clone());

        deselectPoint();
        updatePathVisuals();
        return "Undo successful.";
    }
    return "Nothing to undo.";
}

export function handleRedo() {
    if (pathState.redoStack.length > 0) {
        const nextState = pathState.redoStack.pop();
        const pathCopy = pathState.path.map(p => p.clone());
        pathState.history.push({ path: pathCopy });

        pathState.path = nextState.path.map(p => p.clone());

        deselectPoint();
        updatePathVisuals();
        return "Redo successful.";
    }
    return "Nothing to redo.";
}


// --- Visual Updates ---

/**
 * Redraws the path line and updates edit helpers based on the current pathState.
 * @param {boolean} isDragging - If true, avoids updating the edit helpers for performance.
 */
export function updatePathVisuals(isDragging = false) {
    // Remove the old line
    if (threeJsState.pathLine) {
        scene.remove(threeJsState.pathLine);
        threeJsState.pathLine.geometry.dispose();
        threeJsState.pathLine.material.dispose();
        threeJsState.pathLine = null;
    }
    pathState.pathCurve = null;

    if (pathState.path.length < 2) {
        if (!isDragging) updateEditHelpers();
        return;
    }

    // --- Apply Global Rotation for Visualization ---
    let origin = new THREE.Vector3();
    if (pathState.rotationOriginIndex < pathState.path.length) {
         origin.copy(pathState.path[pathState.rotationOriginIndex]);
    } else if (pathState.path.length > 0) { // Fallback to centroid
        for (const p of pathState.path) origin.add(p);
        origin.divideScalar(pathState.path.length);
    }
    const qGlobal = new THREE.Quaternion().setFromEuler(pathState.pathGlobalRotation);
    const rotatedPoints = pathState.path.map(p => p.clone().sub(origin).applyQuaternion(qGlobal).add(origin));
    // ---

    const geometry = new THREE.BufferGeometry().setFromPoints(rotatedPoints);
    const material = new THREE.LineBasicMaterial({ color: PATH_LINE_COLOR });
    threeJsState.pathLine = new THREE.Line(geometry, material);
    scene.add(threeJsState.pathLine);

    pathState.pathCurve = new THREE.CatmullRomCurve3(rotatedPoints);

    if (!isDragging) {
        updateEditHelpers();
    }
    updateUiList();
}

/**
 * Updates the visibility and position of the small cube helpers used for editing.
 */
export function updateEditHelpers() {
    while (threeJsState.editHelpers.children.length > 0) {
        threeJsState.editHelpers.remove(threeJsState.editHelpers.children[0]);
    }
    interactionState.hoveredHelper = null;

    if (!appState.isEditingPath) {
        deselectPoint();
        return;
    }

    const helperGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);

    // Apply the same rotation logic as updatePathVisuals to position helpers correctly
    let origin = new THREE.Vector3();
    if (pathState.rotationOriginIndex < pathState.path.length) {
        origin.copy(pathState.path[pathState.rotationOriginIndex]);
    } else if (pathState.path.length > 0) {
        for (const p of pathState.path) origin.add(p);
        origin.divideScalar(pathState.path.length);
    }
    const qGlobal = new THREE.Quaternion().setFromEuler(pathState.pathGlobalRotation);
    
    pathState.path.forEach((point, i) => {
        let material = EDIT_HELPER_MATERIALS.normal;
        if (i === interactionState.selectedPointIndex) {
            material = EDIT_HELPER_MATERIALS.selected;
        }

        const helper = new THREE.Mesh(helperGeometry, material.clone()); // Clone to avoid state issues
        let pos = point.clone().sub(origin).applyQuaternion(qGlobal).add(origin);
        helper.position.copy(pos);

        // Apply individual waypoint rotation if it exists
        if (point.rotation) {
            const qLocal = new THREE.Quaternion().setFromEuler(point.rotation);
            helper.quaternion.copy(qGlobal).multiply(qLocal);
        }

        threeJsState.editHelpers.add(helper);
    });

    // Re-attach transform controls if a point is selected
    if (interactionState.selectedPointIndex !== null) {
        selectPoint(interactionState.selectedPointIndex);
    } else {
        deselectPoint();
    }
}


// --- Point Selection ---

export function selectPoint(index) {
    if (index === null || index >= pathState.path.length) {
        deselectPoint();
        return;
    }

    // Deselect previous point
    if (interactionState.selectedPointIndex !== null && interactionState.selectedPointIndex < threeJsState.editHelpers.children.length) {
        threeJsState.editHelpers.children[interactionState.selectedPointIndex].material = EDIT_HELPER_MATERIALS.normal;
    }

    interactionState.selectedPointIndex = index;
    interactionState.cycleIndex = index;

    // Select new point
    if (index < threeJsState.editHelpers.children.length) {
        threeJsState.editHelpers.children[index].material = EDIT_HELPER_MATERIALS.selected;

        if (threeJsState.transformControls) {
            threeJsState.transformControls.attach(threeJsState.editHelpers.children[index]);
            threeJsState.transformControls.visible = true;
        }
    }

    // Highlight in the UI list
    const oldListItem = document.querySelector('.list-item.highlighted');
    if (oldListItem) oldListItem.classList.remove('highlighted');
    const newListItem = document.getElementById(`waypoint-item-${index}`);
    if (newListItem) {
        newListItem.classList.add('highlighted');
        newListItem.scrollIntoView({ block: 'nearest' });
    }
}

export function deselectPoint() {
    if (interactionState.selectedPointIndex !== null && interactionState.selectedPointIndex < threeJsState.editHelpers.children.length) {
        threeJsState.editHelpers.children[interactionState.selectedPointIndex].material = EDIT_HELPER_MATERIALS.normal;
    }
    interactionState.selectedPointIndex = null;
    interactionState.cycleIndex = -1;

    if (threeJsState.transformControls) {
        threeJsState.transformControls.detach();
        threeJsState.transformControls.visible = false;
    }

    const oldListItem = document.querySelector('.list-item.highlighted');
    if (oldListItem) oldListItem.classList.remove('highlighted');
}


// --- Path Editing Logic ---

/**
 * Moves a point and proportionally moves its neighbors.
 * @param {number} selectedIndex - The index of the primary point being moved.
 * @param {THREE.Vector3} moveDelta - The amount to move the primary point by.
 * @param {number} falloff - The range of influence for the proportional edit.
 */
export function applyProportionalMove(selectedIndex, moveDelta, falloff) {
    const originalPath = interactionState.originalPath;
    if (!originalPath || originalPath.length === 0) return;

    for (let i = 0; i < pathState.path.length; i++) {
        const pointToMove = originalPath[i];
        const distance = pointToMove.distanceTo(originalPath[selectedIndex]);
        
        let influence = 0;
        if (i === selectedIndex) {
            influence = 1;
        } else if (falloff > 0 && distance < falloff) {
            const normalizedDistance = distance / falloff;
            // Cosine falloff function
            influence = (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
        }

        if (influence > 0) {
            const influencedDelta = moveDelta.clone().multiplyScalar(influence);
            pathState.path[i].copy(pointToMove).add(influencedDelta);
            if (i < threeJsState.editHelpers.children.length) {
                threeJsState.editHelpers.children[i].position.copy(pathState.path[i]);
            }
        }
    }
    updatePathVisuals(true);
}

/**
 * Clears the entire path and history.
 */
export function clearPath() {
    appState.isRecording = false;
    appState.isPlaying = false;
    pathState.path = [];
    pathState.history = [];
    pathState.redoStack = [];

    if (threeJsState.pathLine) scene.remove(threeJsState.pathLine);
    threeJsState.pathLine = null;
    pathState.pathCurve = null;

    updateEditHelpers();
    deselectPoint();
    
    if (threeJsState.rov) {
        threeJsState.rov.position.set(0, 6.3, 0);
        threeJsState.rov.quaternion.set(0, 0, 0, 1);
    }
}

/**
 * Deletes waypoints selected via checkboxes in the UI.
 */
export function deleteSelectedWaypoints() {
    const waypointList = document.getElementById('waypoint-list');
    const checkboxes = waypointList.querySelectorAll('input[type="checkbox"]:checked');
    const indicesToDelete = Array.from(checkboxes).map(cb => parseInt(cb.dataset.waypointIndex, 10));

    if (indicesToDelete.length === 0) {
        return "No waypoints selected for deletion.";
    }

    saveStateForUndo();

    // Sort indices in descending order to splice correctly
    indicesToDelete.sort((a, b) => b - a);
    indicesToDelete.forEach(index => {
        pathState.path.splice(index, 1);
    });

    deselectPoint();
    updatePathVisuals();
    return `Deleted ${indicesToDelete.length} waypoint(s).`;
}

// --- Path Extension Logic ---
export function extendPathVertical(deltaY) {
    if (pathState.path.length === 0) return;
    saveStateForUndo();
    const last = pathState.path[pathState.path.length - 1].clone();
    last.y += deltaY;
    pathState.path.push(last);
    updatePathVisuals();
}
export function extendPathForward(delta) {
    if (pathState.path.length === 0) return;
    saveStateForUndo();
    // Get camera direction (XZ plane)
    const camera = require('./sceneManager.js').camera;
    let camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() > 0) camDir.normalize();
    else camDir.set(1, 0, 0);
    const last = pathState.path[pathState.path.length - 1].clone();
    const moveVec = camDir.clone().multiplyScalar(delta);
    last.add(moveVec);
    pathState.path.push(last);
    updatePathVisuals();
}
export function startExtendPreview() {
    // Called on drag start
    threeJsState.extendPreviewLine = null;
}
export function updateExtendPreview(event, camera) {
    // Called on drag move
    const rect = camera.domElement.getBoundingClientRect ? camera.domElement.getBoundingClientRect() : {left:0,top:0,width:1,height:1};
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const last = pathState.path[pathState.path.length - 1];
    let plane;
    if (appState.extendMode === 'horizontal') {
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -last.y);
    } else {
        plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -last.z);
    }
    const intersectPoint = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersectPoint);
    // Show preview line
    if (threeJsState.extendPreviewLine) {
        require('./sceneManager.js').scene.remove(threeJsState.extendPreviewLine);
        threeJsState.extendPreviewLine.geometry.dispose();
        threeJsState.extendPreviewLine.material.dispose();
        threeJsState.extendPreviewLine = null;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([last, intersectPoint]);
    const material = new THREE.LineDashedMaterial({ color: 0x00ff00, dashSize: 1, gapSize: 0.5 });
    threeJsState.extendPreviewLine = new THREE.Line(geometry, material);
    threeJsState.extendPreviewLine.computeLineDistances();
    require('./sceneManager.js').scene.add(threeJsState.extendPreviewLine);
}
export function finishExtendPreview() {
    // Called on drag end
    if (threeJsState.extendPreviewLine) {
        const points = threeJsState.extendPreviewLine.geometry.getAttribute('position');
        if (points && points.count === 2) {
            const start = new THREE.Vector3().fromArray(points.array, 0);
            const end = new THREE.Vector3().fromArray(points.array, 3);
            // Interpolate waypoints if distance > threshold
            const minDist = 0.2;
            const dist = start.distanceTo(end);
            const steps = Math.max(1, Math.floor(dist / minDist));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const wp = new THREE.Vector3().lerpVectors(start, end, t);
                pathState.path.push(wp);
            }
            updatePathVisuals();
        }
        require('./sceneManager.js').scene.remove(threeJsState.extendPreviewLine);
        threeJsState.extendPreviewLine.geometry.dispose();
        threeJsState.extendPreviewLine.material.dispose();
        threeJsState.extendPreviewLine = null;
    }
}

// --- Global Path Rotation Logic ---
export function updateGlobalRotation(axis, value) {
    if (isNaN(value)) return;
    pathState.pathGlobalRotation[axis] = THREE.MathUtils.degToRad(value);
    updatePathVisuals();
}
export function incrementGlobalRotation(axis, deltaDeg) {
    let currentDeg = THREE.MathUtils.radToDeg(pathState.pathGlobalRotation[axis]);
    currentDeg += deltaDeg;
    pathState.pathGlobalRotation[axis] = THREE.MathUtils.degToRad(currentDeg);
    updatePathVisuals();
}
export function resetGlobalRotation() {
    pathState.pathGlobalRotation.set(0, 0, 0);
    updatePathVisuals();
}
export function setRotationOriginIndex(index) {
    pathState.rotationOriginIndex = index;
    updatePathVisuals();
}
export function applyGlobalRotation() {
    // Apply the current global rotation to all waypoints, then reset global rotation
    let origin = new THREE.Vector3();
    if (pathState.rotationOriginIndex < pathState.path.length) {
        origin.copy(pathState.path[pathState.rotationOriginIndex]);
    } else if (pathState.path.length > 0) {
        for (const p of pathState.path) origin.add(p);
        origin.divideScalar(pathState.path.length);
    }
    const qGlobal = new THREE.Quaternion().setFromEuler(pathState.pathGlobalRotation);
    for (let i = 0; i < pathState.path.length; i++) {
        pathState.path[i].sub(origin).applyQuaternion(qGlobal).add(origin);
        if (pathState.path[i].rotation) {
            const qLocal = new THREE.Quaternion().setFromEuler(pathState.path[i].rotation);
            qLocal.premultiply(qGlobal);
            pathState.path[i].rotation.setFromQuaternion(qLocal);
        }
    }
    pathState.pathGlobalRotation.set(0, 0, 0);
    updatePathVisuals();
}