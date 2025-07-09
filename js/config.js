import * as THREE from 'three';

/**
 * @fileoverview Configuration constants for the ROV Path Planner application.
 */

// --- Speeds & Movement ---
export const ROV_SPEED_DEFAULT = 10.0;
export const PATH_EDIT_SPEED_DEFAULT = 8.0;
export const CAMERA_FREE_MOVE_SPEED = 30.0;
export const ROV_TURN_SPEED = 2.0;

// --- Path Editing ---
export const EDIT_FALLOFF_DEFAULT = 10.0;
export const WAYPOINT_MIN_DISTANCE = 0.2; // Min distance before a new waypoint is recorded

// --- Materials & Colors ---
export const SCENE_BACKGROUND_COLOR = 0x1a2a3a;
export const PATH_LINE_COLOR = 0xffff00;
export const PREVIEW_LINE_COLOR = 0x00ff00;

export const EDIT_HELPER_MATERIALS = {
    normal: new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 }),
    highlight: new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.7 }),
    selected: new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: false })
};

// --- Minimap Settings ---
export const MINIMAP_SETTINGS = {
    size: 200,
    padding: 20,
    worldSize: 1000,
    rovColor: '#3b82f6',
    cameraColor: '#ef4444',
    lineColor: '#ffff00',
    gridColor: 'rgba(255, 255, 255, 0.1)',
};

// --- FPV Settings ---
export const FPV_CAMERA_OFFSET = new THREE.Vector3(0, 0, -0.95);

// --- Models ---
export const ROV_MODEL_PATH = 'AID_ROV.glb';