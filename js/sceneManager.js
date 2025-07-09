import * as THREE from 'three';
import { SCENE_BACKGROUND_COLOR } from './config.js';

/**
 * @fileoverview Initializes and manages the core Three.js components: scene, camera, and renderer.
 */

// These will be initialized in the init function and exported for use in other modules.
export let scene;
export let camera;
export let renderer;

/**
 * Initializes the Three.js scene, camera, and renderer.
 * @param {HTMLElement} sceneContainer - The DOM element to mount the canvas in.
 * @returns {{scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer}}
 */
export function init(sceneContainer) {
    // --- Basic Setup ---
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        75,
        sceneContainer.clientWidth / sceneContainer.clientHeight,
        0.1,
        10000
    );
    camera.position.set(-200, 150, 250);
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    renderer.setClearColor(SCENE_BACKGROUND_COLOR);
    sceneContainer.appendChild(renderer.domElement);

    // --- Lighting ---
    scene.add(new THREE.AmbientLight(0x404040, 2.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);

    // --- Helpers ---
    const gridHelper = new THREE.GridHelper(2000, 100);
    scene.add(gridHelper);

    return { scene, camera, renderer };
}

/**
 * Handles window resize events to keep the camera and renderer updated.
 */
export function onWindowResize() {
    if (camera && renderer) {
        const sceneContainer = renderer.domElement.parentElement;
        camera.aspect = sceneContainer.clientWidth / sceneContainer.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    }
}