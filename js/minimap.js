import * as THREE from 'three';
import { appState, threeJsState } from './state.js';
import { MINIMAP_SETTINGS } from './config.js';
import { camera } from './sceneManager.js';

/**
 * @fileoverview Handles all logic for drawing and updating the 2D minimap.
 */

let minimapCtx;

export function init() {
    const minimapCanvas = document.getElementById('minimap-canvas');
    if (minimapCanvas) {
        minimapCtx = minimapCanvas.getContext('2d');
        minimapCanvas.width = MINIMAP_SETTINGS.size;
        minimapCanvas.height = MINIMAP_SETTINGS.size;
    }
}

export function update() {
    if (!minimapCtx || !appState.minimapVisible || !threeJsState.rov) return;

    const { size, padding, worldSize, rovColor, lineColor } = MINIMAP_SETTINGS;
    minimapCtx.clearRect(0, 0, size, size);

    // Determine center of the minimap
    let centerX, centerZ;
    if (appState.minimapFollow) {
        const targetPos = appState.cameraMode === 'FREE' ? camera.position : threeJsState.rov.position;
        centerX = targetPos.x;
        centerZ = targetPos.z;
    } else {
        centerX = 0;
        centerZ = 0;
    }

    const scale = (size - 2 * padding) / worldSize;
    const offsetX = size / 2 - centerX * scale;
    const offsetZ = size / 2 - centerZ * scale;

    const worldToMinimap = (x, z) => ({
        x: x * scale + offsetX,
        y: z * scale + offsetZ
    });

    // Draw path
    const path = threeJsState.pathLine ? threeJsState.pathLine.geometry.attributes.position.array : [];
    if (path.length > 0) {
        minimapCtx.strokeStyle = lineColor;
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        const firstPoint = worldToMinimap(path[0], path[2]);
        minimapCtx.moveTo(firstPoint.x, firstPoint.y);
        for (let i = 3; i < path.length; i += 3) {
            const point = worldToMinimap(path[i], path[i + 2]);
            minimapCtx.lineTo(point.x, point.y);
        }
        minimapCtx.stroke();
    }

    // Draw ROV
    const rovPos = worldToMinimap(threeJsState.rov.position.x, threeJsState.rov.position.z);
    minimapCtx.fillStyle = rovColor;
    minimapCtx.beginPath();
    minimapCtx.arc(rovPos.x, rovPos.y, 6, 0, Math.PI * 2);
    minimapCtx.fill();

    // Draw ROV direction
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(threeJsState.rov.quaternion);
    const directionEnd = worldToMinimap(threeJsState.rov.position.x + direction.x * 15, threeJsState.rov.position.z + direction.z * 15);
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(rovPos.x, rovPos.y);
    minimapCtx.lineTo(directionEnd.x, directionEnd.y);
    minimapCtx.stroke();
}