/**
 * @fileoverview Manages the dynamic state of the ROV Path Planner application.
 */

import * as THREE from 'three';

/**
 * Core application state, tracking modes and boolean flags.
 */
export const appState = {
    isRecording: false,
    isPaused: false, // Paused during recording
    isPlaying: false,
    isPlaybackPaused: false,
    isReversed: false,
    isEditingPath: false,
    isCyclingWaypoints: false,
    isEditingWaypoint: false, // Flag for when editing a waypoint's coords in the UI list
    isExtendingPath: false,
    isTransformControlsDragging: false, // Flag for when the gizmo is being dragged

    cameraMode: 'ORBIT', // 'ORBIT', 'POV', 'FREE'
    editModeConstraint: 'free', // 'free', 'horizontal', 'vertical'
    extendMode: 'horizontal', // 'horizontal', 'vertical'
    gizmoMode: 'translate', // 'translate', 'rotate'

    minimapVisible: true,
    minimapFollow: true,
    fpvVisible: false,
    fpvMainView: false,
};

/**
 * Data related to user interactions, like mouse dragging and selections.
 */
export const interactionState = {
    isDragging: false, // General mouse dragging on the canvas
    draggedPointIndex: null,
    selectedPointIndex: null,
    hoveredHelper: null,
    cycleIndex: -1,

    // Used during a drag operation to calculate proportional edits
    originalDraggedPointPosition: null,
    originalPath: [],
    originalRotations: [],
};

/**
 * Stores the actual path data, history for undo/redo, and playback info.
 */
export const pathState = {
    path: [], // Array of THREE.Vector3 points
    history: [], // For undo
    redoStack: [], // For redo
    pathCurve: null, // The THREE.CatmullRomCurve3 object for the path
    playbackTime: 0,
    pathGlobalRotation: new THREE.Euler(0, 0, 0),
    rotationOriginIndex: 0, // Waypoint index to rotate the path around
};

/**
 * Holds references to key Three.js objects that are frequently accessed or manipulated.
 */
export const threeJsState = {
    rov: null,
    pathLine: null,
    editHelpers: new THREE.Group(),
    extendPreviewLine: null,
    transformControls: null,
    orbitControls: null,
};