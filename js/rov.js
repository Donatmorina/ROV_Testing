import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ROV_MODEL_PATH, ROV_SPEED_DEFAULT, ROV_TURN_SPEED } from './config.js';
import { appState, pathState, threeJsState } from './state.js';

/**
 * @fileoverview Manages the ROV model, its properties, and its movement logic.
 */

/**
 * Creates the ROV model, loads its GLTF asset, and adds it to the scene.
 * @param {THREE.Scene} scene - The main Three.js scene to add the ROV to.
 * @param {function} onModelLoad - A callback function to execute once the model is loaded.
 */
export function createROV(scene, onModelLoad) {
    // The main ROV object is a Group, which will contain the model and lights.
    const rovGroup = new THREE.Group();
    threeJsState.rov = rovGroup; // Store the reference in our global state
    scene.add(rovGroup);
    rovGroup.position.set(0, 6.3, 0);

    const loader = new GLTFLoader();
    loader.load(
        ROV_MODEL_PATH,
        (gltf) => {
            const rovModel = gltf.scene;
            rovModel.position.set(0, 0, 0);
            rovModel.rotation.set(0, 0, 0);
            rovModel.scale.set(1, 1, 1);
            rovGroup.add(rovModel); // Add the loaded model to our group

            // Add the spotlight to the ROV
            const rovLight = new THREE.SpotLight(0xffffff, 5, 200, Math.PI / 4, 0.5, 2);
            rovLight.position.set(0, 0.5, 2);
            rovLight.target.position.set(0, 0, -10);
            rovGroup.add(rovLight);
            rovGroup.add(rovLight.target);

            console.log('ROV model loaded successfully.');
            if (onModelLoad) onModelLoad();
        },
        undefined, // onProgress callback (optional)
        (error) => {
            console.error('Error loading ROV model:', error);
            // In a real app, you might want to update a UI element here
        }
    );
}

/**
 * Updates the ROV's position and rotation based on keyboard input.
 * This is called in the main animation loop.
 * @param {number} deltaTime - The time elapsed since the last frame.
 * @param {object} keys - The current state of the keyboard keys.
 * @param {number} rovSpeed - The current speed setting for the ROV.
 */
export function updateROVMovement(deltaTime, keys, rovSpeed) {
    if (!threeJsState.rov) return;

    const moveSpeed = rovSpeed * deltaTime;
    const turnSpeed = ROV_TURN_SPEED * deltaTime;

    // Handle movement
    if (keys['KeyW']) threeJsState.rov.translateZ(-moveSpeed);
    if (keys['KeyS']) threeJsState.rov.translateZ(moveSpeed);
    if (keys['KeyR']) threeJsState.rov.position.y += moveSpeed;
    if (keys['KeyF']) threeJsState.rov.position.y -= moveSpeed;

    // Handle rotation
    if (keys['KeyA']) threeJsState.rov.rotateY(turnSpeed);
    if (keys['KeyD']) threeJsState.rov.rotateY(-turnSpeed);

    // If recording, add a new point to the path if the ROV has moved enough
    if (appState.isRecording && !appState.isPaused) {
        const lastPoint = pathState.path[pathState.path.length - 1];
        if (threeJsState.rov.position.distanceTo(lastPoint) > 0.2) {
            const waypoint = threeJsState.rov.position.clone();
            waypoint.rotation = threeJsState.rov.rotation.clone();
            pathState.path.push(waypoint);
            // We will call a function to update the path visuals from the main loop
        }
    }
}