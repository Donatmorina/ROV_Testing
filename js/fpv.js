import * as THREE from 'three';
import { appState, threeJsState } from './state.js';
import { FPV_CAMERA_OFFSET } from './config.js';
import { scene, camera } from './sceneManager.js';

/**
 * @fileoverview Manages the First-Person View (FPV) camera and renderer.
 */

let fpvRenderer;
let fpvCamera;

export function init() {
    const fpvCanvas = document.getElementById('fpv-canvas');
    if (fpvCanvas) {
        fpvRenderer = new THREE.WebGLRenderer({ canvas: fpvCanvas, antialias: true });
        fpvRenderer.setSize(200, 200);
        fpvCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 10000);
    }
}

export function update() {
    if (!fpvRenderer || !appState.fpvVisible || !threeJsState.rov) return;

    // Update FPV camera position to be on the ROV
    const fpvWorldPos = threeJsState.rov.localToWorld(FPV_CAMERA_OFFSET.clone());
    fpvCamera.position.copy(fpvWorldPos);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(threeJsState.rov.quaternion);
    fpvCamera.lookAt(fpvWorldPos.clone().add(forward));

    // Render the FPV view
    fpvRenderer.render(scene, fpvCamera);
}