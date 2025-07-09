import * as THREE from 'three';
import * as sceneManager from './sceneManager.js';
import * as rov from './rov.js';
import * as ui from './uiManager.js';
import * as controls from './controls.js';
import * as pathManager from './pathManager.js';
import { appState, pathState, interactionState, threeJsState } from './state.js';
import { ROV_SPEED_DEFAULT } from './config.js';
import * as fpv from './fpv.js';
import * as minimap from './minimap.js';
import { keys } from './controls.js';

/**
 * @fileoverview Main application entry point.
 * Initializes all modules and runs the main animation loop.
 */

class ROVPathPlannerApp {
    constructor() {
        this.sceneContainer = document.getElementById('scene-container');
        if (!this.sceneContainer) {
            console.error('Scene container not found!');
            return;
        }
        this.clock = new THREE.Clock();
        this.rovSpeed = ROV_SPEED_DEFAULT;
        this.init();
    }

    init() {
        // --- 1. Initialize Core Systems ---
        const { scene, camera, renderer } = sceneManager.init(this.sceneContainer);
        
        // --- 2. Initialize UI and Controls ---
        // Pass handler functions from this main class to the UI manager
        ui.init({
            handlePlay: (isReversed) => this.handlePlay(isReversed),
            handleSwitchView: () => this.handleSwitchView(),
            handleRovSpeedChange: (speed) => {
                this.rovSpeed = parseFloat(speed);
                // In a real app, update a UI value here if needed
            }
        });

        controls.init(camera, renderer.domElement, scene);

        minimap.init();
        fpv.init();

        // --- 3. Create 3D Objects ---
        rov.createROV(scene, () => {
            // This callback runs after the model is loaded
            console.log("ROV Model is ready.");
            // You could enable UI elements here that depend on the ROV
        });
        
        scene.add(threeJsState.editHelpers);

        // --- 4. Start the Animation Loop ---
        window.addEventListener('resize', sceneManager.onWindowResize);
        this.animate();
    }

    // --- Core Logic Handlers ---

    handlePlay(isReversed = false) {
        if (!appState.isPlaying) {
            appState.isReversed = isReversed;
            pathState.playbackTime = isReversed ? 1 : 0;
            appState.isPlaying = true;
            appState.isPlaybackPaused = false;
            ui.updateStatus(isReversed ? 'Playing path backwards...' : 'Playing path...');
        } else {
            // If the direction is different, switch, otherwise toggle pause
            if (appState.isReversed !== isReversed) {
                appState.isReversed = isReversed;
                appState.isPlaybackPaused = false;
            } else {
                appState.isPlaybackPaused = !appState.isPlaybackPaused;
            }
            ui.updateStatus(appState.isPlaybackPaused ? 'Playback paused.' : 'Playing...');
        }
        ui.updateUI();
    }

    handleSwitchView() {
        if (appState.cameraMode === 'ORBIT') {
            appState.cameraMode = 'POV';
            threeJsState.orbitControls.enabled = false;
        } else if (appState.cameraMode === 'POV') {
            appState.cameraMode = 'FREE';
            threeJsState.orbitControls.enabled = true;
        } else {
            appState.cameraMode = 'ORBIT';
            threeJsState.orbitControls.enabled = true;
        }
        ui.updateStatus(`Switched to ${appState.cameraMode} view.`);
        ui.updateUI();
    }

    // --- Main Animation Loop ---

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();

        // Update systems that need continuous checks
        controls.update(deltaTime);

        if (appState.isPlaying) {
            this.updatePlayback(deltaTime);
        } else if (!appState.isEditingPath) {
            // Only allow manual ROV movement if not playing back or editing
            rov.updateROVMovement(deltaTime, keys, this.rovSpeed);
            if(appState.isRecording) pathManager.updatePathVisuals();
        }

        this.updateCamera();
        ui.updateCoordinateDisplay();

        minimap.update();
        fpv.update();
        
        // Final render call
        sceneManager.renderer.render(sceneManager.scene, sceneManager.camera);
    }
    
    updatePlayback(deltaTime) {
        if (!pathState.pathCurve || appState.isPlaybackPaused) return;

        const speedMultiplier = parseFloat(ui.ui.playbackSpeed.value);
        const direction = appState.isReversed ? -1 : 1;
        pathState.playbackTime += (deltaTime * speedMultiplier * 0.1) * direction;

        if (pathState.playbackTime >= 1 || pathState.playbackTime <= 0) {
            pathState.playbackTime = THREE.MathUtils.clamp(pathState.playbackTime, 0, 1);
            appState.isPlaying = false;
            ui.updateStatus('Playback finished.');
            ui.updateUI();
        }

        const pos = pathState.pathCurve.getPointAt(pathState.playbackTime);
        threeJsState.rov.position.copy(pos);
        
        const tangent = pathState.pathCurve.getTangentAt(pathState.playbackTime).normalize();
        threeJsState.rov.lookAt(pos.clone().add(tangent));
    }
    
    updateCamera() {
        if (!threeJsState.rov) return;
        const rovPosition = threeJsState.rov.position;
        const camera = sceneManager.camera;

        if (appState.cameraMode === 'ORBIT') {
            threeJsState.orbitControls.target.lerp(rovPosition, 0.1);
        } else if (appState.cameraMode === 'POV') {
            const offset = new THREE.Vector3(0, 1.5, 3);
            const cameraPos = threeJsState.rov.localToWorld(offset);
            camera.position.lerp(cameraPos, 0.1);
            camera.lookAt(rovPosition);
        }
        // In 'FREE' mode, the controls updater handles everything.
    }
}

// --- Start the application ---
window.addEventListener('load', () => new ROVPathPlannerApp());