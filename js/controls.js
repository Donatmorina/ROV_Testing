import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { appState, interactionState, pathState, threeJsState } from './state.js';
import { camera } from './sceneManager.js';
import * as pathManager from './pathManager.js';
import { EDIT_FALLOFF_DEFAULT, PATH_EDIT_SPEED_DEFAULT, CAMERA_FREE_MOVE_SPEED } from './config.js';

/**
 * @fileoverview Manages user input from mouse and keyboard, and Three.js controls.
 */

const keys = {}; // Tracks currently pressed keys
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let pathEditSpeed = PATH_EDIT_SPEED_DEFAULT;
let editFalloff = EDIT_FALLOFF_DEFAULT;

/**
 * Initializes all user controls and event listeners.
 * @param {THREE.Camera} camera - The main perspective camera.
 * @param {HTMLElement} domElement - The renderer's canvas element.
 * @param {THREE.Scene} scene - The main scene.
 */
export function init(camera, domElement, scene) {
    // --- Three.js Controls ---
    threeJsState.orbitControls = new OrbitControls(camera, domElement);
    threeJsState.orbitControls.enableDamping = true;
    threeJsState.orbitControls.dampingFactor = 0.1;

    const transformControls = new TransformControls(camera, domElement);
    transformControls.setSize(1.2);
    transformControls.visible = false;
    transformControls.addEventListener('dragging-changed', (event) => {
        threeJsState.orbitControls.enabled = !event.value;
        appState.isTransformControlsDragging = event.value;
        if (event.value) { // Drag start
            pathManager.saveStateForUndo();
            interactionState.originalPath = pathState.path.map(p => p.clone());
        }
    });
    transformControls.addEventListener('objectChange', onTransform);
    scene.add(transformControls);
    threeJsState.transformControls = transformControls;


    // --- DOM Event Listeners ---
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    domElement.addEventListener('wheel', onMouseWheel, { passive: false });
}

/**
 * Update function called in the main animation loop for continuous input.
 * @param {number} deltaTime 
 */
export function update(deltaTime) {
    threeJsState.orbitControls.update();
    
    if (appState.isEditingPath && interactionState.selectedPointIndex !== null) {
        handleKeyboardWaypointEditing(deltaTime);
    } else if (appState.cameraMode === 'FREE') {
        updateFreeCameraMovement(deltaTime);
    }
}

// --- Event Handlers ---

function onKeyDown(event) {
    keys[event.code] = true;

    if (event.code === 'Escape' && appState.isEditingPath) {
        pathManager.deselectPoint();
    }
    if (event.ctrlKey && event.code === 'KeyZ') {
        event.preventDefault();
        pathManager.handleUndo();
    }
    if (event.ctrlKey && event.code === 'KeyY') {
        event.preventDefault();
        pathManager.handleRedo();
    }
    // --- Path Extension Keyboard ---
    if (appState.isExtendingPath && pathState.path.length > 0) {
        if (event.code === 'KeyR' || event.code === 'KeyF') {
            // Up/Down
            const delta = (event.code === 'KeyR') ? 1 : -1;
            pathManager.extendPathVertical(delta * 0.2);
        } else if (event.code === 'KeyT' || event.code === 'KeyG') {
            // Forward/Backward (camera dir)
            const delta = (event.code === 'KeyT') ? 1 : -1;
            pathManager.extendPathForward(delta * 0.2);
        } else if (event.code === 'Escape') {
            appState.isExtendingPath = false;
        }
    }
}

function onMouseDown(event) {
    if (appState.isTransformControlsDragging) return;
    // --- Path Extension Drag ---
    if (appState.isExtendingPath && pathState.path.length > 0) {
        interactionState.isDragging = true;
        interactionState.originalDraggedPointPosition = pathState.path[pathState.path.length - 1].clone();
        interactionState.draggedPointIndex = pathState.path.length - 1;
        pathManager.startExtendPreview();
        return;
    }

    if (appState.isEditingPath) {
        updateMouse(event);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(threeJsState.editHelpers.children);

        if (intersects.length > 0) {
            const pointIndex = threeJsState.editHelpers.children.indexOf(intersects[0].object);
            pathManager.selectPoint(pointIndex);
            interactionState.isDragging = true;
            interactionState.draggedPointIndex = pointIndex;
            
            // Save state for dragging
            pathManager.saveStateForUndo();
            interactionState.originalDraggedPointPosition = pathState.path[pointIndex].clone();
            interactionState.originalPath = pathState.path.map(p => p.clone());
            threeJsState.orbitControls.enabled = false;
        } else {
            pathManager.deselectPoint();
        }
    }
}

function onMouseMove(event) {
    if (appState.isTransformControlsDragging) return;
    
    updateMouse(event); // Update mouse coords for hover effects even if not dragging

    // --- Path Extension Drag ---
    if (appState.isExtendingPath && interactionState.isDragging && pathState.path.length > 0) {
        pathManager.updateExtendPreview(event, camera);
        return;
    }

    if (interactionState.isDragging && interactionState.draggedPointIndex !== null) {
        raycaster.setFromCamera(mouse, camera);
        const originalPoint = interactionState.originalDraggedPointPosition;
        let intersectPoint = new THREE.Vector3();

        // Determine the plane to intersect based on edit mode
        let plane;
        if (appState.editModeConstraint === 'horizontal') {
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -originalPoint.y);
        } else {
            // For 'free' and 'vertical', project onto a plane facing the camera
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                camera.getWorldDirection(new THREE.Vector3()).negate(),
                originalPoint
            );
        }
        
        raycaster.ray.intersectPlane(plane, intersectPoint);

        if (appState.editModeConstraint === 'vertical') {
            intersectPoint.x = originalPoint.x;
            intersectPoint.z = originalPoint.z;
        }

        const moveDelta = new THREE.Vector3().subVectors(intersectPoint, originalPoint);
        pathManager.applyProportionalMove(interactionState.draggedPointIndex, moveDelta, editFalloff);
    }
}

function onMouseUp(event) {
    // --- Path Extension Drag ---
    if (appState.isExtendingPath && interactionState.isDragging && pathState.path.length > 0) {
        interactionState.isDragging = false;
        pathManager.finishExtendPreview();
        return;
    }
    if (interactionState.isDragging) {
        interactionState.isDragging = false;
        interactionState.draggedPointIndex = null;
        threeJsState.orbitControls.enabled = true;
        pathManager.updatePathVisuals(); // Final update after dragging
    }
}

function onMouseWheel(event) {
    if (appState.isEditingPath && appState.isCyclingWaypoints) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? -1 : 1;
        let newIndex = interactionState.cycleIndex + direction;

        if (newIndex >= pathState.path.length) newIndex = 0;
        if (newIndex < 0) newIndex = pathState.path.length - 1;

        pathManager.selectPoint(newIndex);
    }
}

/** Callback for the TransformControls gizmo */
function onTransform() {
    const idx = interactionState.selectedPointIndex;
    if (idx !== null && idx < pathState.path.length) {
        const helper = threeJsState.editHelpers.children[idx];
        pathState.path[idx].copy(helper.position);
        pathManager.updatePathVisuals(true); // isDragging = true for performance
    }
}

// --- Continuous Movement Logic ---

function handleKeyboardWaypointEditing(deltaTime) {
    const moveSpeed = pathEditSpeed * deltaTime;
    const moveDelta = new THREE.Vector3();
    
    // Get camera-relative directions
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const cameraUp = new THREE.Vector3().copy(camera.up);
    
    if (keys['KeyW']) moveDelta.add(cameraUp);
    if (keys['KeyS']) moveDelta.sub(cameraUp);
    if (keys['KeyA']) moveDelta.sub(cameraRight);
    if (keys['KeyD']) moveDelta.add(cameraRight);

    if (moveDelta.lengthSq() > 0) {
        // Apply constraints
        if (appState.editModeConstraint === 'horizontal') moveDelta.y = 0;
        if (appState.editModeConstraint === 'vertical') { moveDelta.x = 0; moveDelta.z = 0; }
        
        moveDelta.normalize().multiplyScalar(moveSpeed);
        
        // Save state before moving
        pathManager.saveStateForUndo();
        interactionState.originalPath = pathState.path.map(p => p.clone());

        pathManager.applyProportionalMove(interactionState.selectedPointIndex, moveDelta, editFalloff);
    }
}

function updateFreeCameraMovement(deltaTime) {
    const moveSpeed = CAMERA_FREE_MOVE_SPEED * deltaTime;
    const moveDirection = new THREE.Vector3();

    if (keys['KeyW']) moveDirection.z = -1;
    if (keys['KeyS']) moveDirection.z = 1;
    if (keys['KeyA']) moveDirection.x = -1;
    if (keys['KeyD']) moveDirection.x = 1;
    
    moveDirection.normalize().applyQuaternion(camera.quaternion);
    camera.position.add(moveDirection.multiplyScalar(moveSpeed));

    if (keys['KeyE']) camera.position.y += moveSpeed;
    if (keys['KeyQ']) camera.position.y -= moveSpeed;
    
    // Update orbit controls target to allow smooth rotation in free mode
    threeJsState.orbitControls.target.copy(camera.position).add(
        new THREE.Vector3(0, 0, -10).applyQuaternion(camera.quaternion)
    );
}

// --- Helpers ---
function updateMouse(event) {
    const rect = event.target.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

export { keys };