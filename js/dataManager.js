import * as THREE from 'three';
import { pathState } from './state.js';
import { clearPath } from './pathManager.js';

/**
 * @fileoverview Handles saving and loading of path data to and from JSON files.
 */

/**
 * Serializes the current path data into a JSON format and triggers a download.
 */
export function saveData() {
    if (pathState.path.length === 0) {
        console.warn("Path is empty, nothing to save.");
        return "Path is empty, nothing to save.";
    }

    const qGlobal = new THREE.Quaternion().setFromEuler(pathState.pathGlobalRotation);

    // Calculate centroid to make the saved path's origin (0,0,0) if rotated
    let centroid = new THREE.Vector3();
    if (pathState.path.length > 0) {
        for (const p of pathState.path) centroid.add(p);
        centroid.divideScalar(pathState.path.length);
    }
    
    const dataToSave = pathState.path.map((p, i) => {
        // Apply global rotation to each point before saving
        let pos = p.clone().sub(centroid).applyQuaternion(qGlobal).add(centroid);
        
        // Combine global and local rotation for the final saved rotation
        let finalRotation = new THREE.Euler();
        if (p.rotation) {
            const qLocal = new THREE.Quaternion().setFromEuler(p.rotation);
            const qFinal = qGlobal.clone().multiply(qLocal);
            finalRotation.setFromQuaternion(qFinal);
        } else {
            finalRotation.setFromQuaternion(qGlobal);
        }

        return {
            Name: `waypoint${i}`,
            pose_x: pos.x,
            pose_y: pos.y,
            pose_z: pos.z,
            roll: finalRotation.x,
            pitch: finalRotation.y,
            yaw: finalRotation.z,
            wait_time: 0.0,
            speed: 0.2
        };
    });

    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rov-path-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    return "Data saved successfully.";
}

/**
 * Reads a user-selected file and parses it to populate the path data.
 * @param {Event} event - The file input change event.
 * @param {function} onLoaded - A callback function to run after the path has been loaded.
 */
export function loadData(event, onLoaded) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            clearPath(); // Start with a clean slate
            const data = JSON.parse(e.target.result);

            if (Array.isArray(data) && data.length > 0 && 'pose_x' in data[0]) {
                pathState.path = data.map(wp => {
                    const vec = new THREE.Vector3(wp.pose_x, wp.pose_y, wp.pose_z);
                    // Store rotation on the vector itself
                    vec.rotation = new THREE.Euler(wp.roll || 0, wp.pitch || 0, wp.yaw || 0);
                    return vec;
                });
            } else {
                throw new Error("Invalid or unrecognized path format.");
            }
            
            if (onLoaded) onLoaded();

        } catch (error) {
            console.error("Error loading or parsing file:", error);
            // In a real app, you would call a UI function to show the error
        } finally {
            // Clear the input value to allow loading the same file again
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}