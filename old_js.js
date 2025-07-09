import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

class ROVPlanner {
    constructor() {
        // --- Basic Setup ---
        this.sceneContainer = document.getElementById('scene-container');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.sceneContainer.clientWidth / this.sceneContainer.clientHeight, 0.1, 10000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.clock = new THREE.Clock();
        this.keys = {};
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.rovSpeed = 10.0;
        this.editFalloff = 10.0;
        this.pathEditSpeed = 8.0;
        
        // --- State Management ---
        this.state = {
            isRecording: false,
            isPaused: false,
            isPlaying: false,
            isPlaybackPaused: false,
            isReversed: false,
            cameraMode: 'ORBIT',
            minimapVisible: true,
            minimapFollow: true,
            isEditingPath: false,
            isCyclingWaypoints: false,
            editModeConstraint: 'free',
            isEditingWaypoint: false,
            fpvVisible: false,
            fpvMainView: false,
            isExtendingPath: false,
            extendMode: 'horizontal',
        };
        
        this.interactionData = {
            isDragging: false,
            previousMouseX: 0,
            draggedPointIndex: null,
            selectedPointIndex: null,
            cycleIndex: -1,
            originalDraggedPointPosition: null,
            originalPath: [],
            hoveredHelper: null,
            originalRotations: [],
        };

        // --- Data & Visuals ---
        this.path = [];
        this.history = [];
        this.redoStack = [];
        this.pathCurve = null;
        this.pathLine = null;
        this.playbackTime = 0;
        this.editHelpers = new THREE.Group();

        this.editHelperMaterials = {
            normal: new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 }),
            highlight: new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.7 }),
            selected: new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: false })
        };

        this.extendPreviewLine = null;
        this.extendStartPoint = null;
        this.isDraggingExtend = false;
        this.extendOriginalLastWaypoint = null;

        this.transformControls = null;
        this.isTransformControlsDragging = false;
        this.gizmoMode = 'translate';

        this.pathGlobalRotation = new THREE.Euler(0, 0, 0);

        this.initialize();
    }

    // --- 1. INITIALIZATION ---

    initialize() {
        this.setupRenderer();
        this.setupScene();
        this.setupControls();
        this.setupMinimap();
        this.setupFPV();
        this.bindEventListeners();
        this.updateUI();
        this.animate();
    }

    setupRenderer() {
        this.renderer.setSize(this.sceneContainer.clientWidth, this.sceneContainer.clientHeight);
        this.renderer.setClearColor(0x1a2a3a);
        this.sceneContainer.appendChild(this.renderer.domElement);
    }

    setupScene() {
        this.scene.add(new THREE.AmbientLight(0x404040, 2.0));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(100, 100, 50);
        this.scene.add(dirLight);

        const gridHelper = new THREE.GridHelper(2000, 100);
        this.scene.add(gridHelper);

        this.createROVModel();

        this.scene.add(this.editHelpers);
        
        this.camera.position.set(-200, 150, 250);
        this.rov.position.set(0, 6.3, 0);

        this.camera.lookAt(this.scene.position);
    }

    createROVModel() {
        this.rov = new THREE.Group();
        this.scene.add(this.rov);

        const loader = new GLTFLoader();
        loader.load('AID_ROV.glb', (gltf) => {
            const rovModel = gltf.scene;
            rovModel.position.set(0, 0, 0);
            rovModel.rotation.set(0, 0, 0);
            rovModel.scale.set(1, 1, 1);
            this.rov.add(rovModel);

            this.rov.position.set(0, 6.3, 0);

            const rovLight = new THREE.SpotLight(0xffffff, 5, 200, Math.PI / 4, 0.5, 2);
            rovLight.position.set(0, 0.5, 2);
            rovLight.target.position.set(0, 0, -10);
            this.rov.add(rovLight);
            this.rov.add(rovLight.target);
        },
        undefined,
        (error) => {
            console.error('Error loading AID_ROV.glb:', error);
            this.updateStatus('Error: Could not load AID_ROV.glb.');
        });
    }
    
    setupControls() {
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.1;

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.setSize(1.2);
        this.transformControls.visible = false;
        this.scene.add(this.transformControls);
        this.transformControls.setMode(this.gizmoMode);

        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.orbitControls.enabled = !event.value;
            this.isTransformControlsDragging = event.value;
            if (event.value) {
                this.saveStateForUndo();
                if (this.interactionData.selectedPointIndex !== null) {
                    this.interactionData.originalPath = this.path.map(p => p.clone());
                    this.interactionData.originalRotations = this.editHelpers.children.map(h => h.rotation.clone());
                }
            }
        });
        
        this.transformControls.addEventListener('objectChange', () => {
            const idx = this.interactionData.selectedPointIndex;
            if (idx !== null && idx < this.path.length) {
                if (this.gizmoMode === 'translate') {
                    const helper = this.editHelpers.children[idx];
                    const original = this.interactionData.originalPath ? this.interactionData.originalPath[idx] : this.path[idx];
                    const moveDelta = new THREE.Vector3().subVectors(helper.position, original);
                    this.applyProportionalMove(idx, moveDelta);
                } else if (this.gizmoMode === 'rotate') {
                    const helper = this.editHelpers.children[idx];
                    const originalRot = this.interactionData.originalRotations ? this.interactionData.originalRotations[idx] : helper.rotation;
                    const qOrig = new THREE.Quaternion().setFromEuler(originalRot);
                    const qNew = new THREE.Quaternion().setFromEuler(helper.rotation);
                    const qDelta = qNew.clone().multiply(qOrig.clone().invert());
                    for (let i = 0; i < this.path.length; i++) {
                        const pointToRotate = this.interactionData.originalPath[i];
                        const rotToRotate = this.interactionData.originalRotations ? this.interactionData.originalRotations[i] : this.editHelpers.children[i].rotation;
                        const distance = pointToRotate.distanceTo(this.interactionData.originalPath[idx]);
                        let influence = 0;
                        if (i === idx) {
                            influence = 1;
                        } else if (this.editFalloff > 0 && distance < this.editFalloff) {
                            const normalizedDistance = distance / this.editFalloff;
                            influence = (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
                        }
                        const qBase = new THREE.Quaternion().setFromEuler(rotToRotate);
                        const qApplied = qBase.clone();
                        if (influence > 0) {
                            const qPartial = new THREE.Quaternion();
                            qPartial.slerpQuaternions(new THREE.Quaternion(), qDelta, influence);
                            qApplied.premultiply(qPartial);
                        }
                        this.editHelpers.children[i].quaternion.copy(qApplied);
                        if (!this.path[i].rotation) this.path[i].rotation = new THREE.Euler();
                        this.path[i].rotation.setFromQuaternion(qApplied);
                    }
                }
            }
        });
    }

    setupMinimap() {
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas.getContext('2d');
        
        this.minimapCanvas.width = 200;
        this.minimapCanvas.height = 200;
        
        this.minimapSettings = {
            size: 200,
            padding: 20,
            worldSize: 1000,
            centerX: 0,
            centerZ: 0
        };
    }
    
    setupFPV() {
        this.fpvContainer = document.getElementById('fpv-container');
        this.fpvCanvas = document.getElementById('fpv-canvas');
        this.fpvRenderer = new THREE.WebGLRenderer({ canvas: this.fpvCanvas, antialias: true });
        this.fpvRenderer.setSize(200, 200);
        this.fpvRenderer.setClearColor(0x1a2a3a);
        this.fpvCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 10000);
    }
    
    bindEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        
        this.renderer.domElement.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.renderer.domElement.addEventListener('wheel', (e) => this.onMouseWheel(e));

        this.ui = {
            recordBtn: document.getElementById('recordBtn'),
            stopBtn: document.getElementById('stopBtn'),
            playBtn: document.getElementById('playBtn'),
            playBackwardsBtn: document.getElementById('playBackwardsBtn'),
            resumeFromBtn: document.getElementById('resumeFromBtn'),
            editPathBtn: document.getElementById('editPathBtn'),
            switchViewBtn: document.getElementById('switchViewBtn'),
            freeViewBtn: document.getElementById('freeViewBtn'),
            undoBtn: document.getElementById('undoBtn'),
            redoBtn: document.getElementById('redoBtn'),
            saveBtn: document.getElementById('saveBtn'),
            loadBtn: document.getElementById('loadBtn'),
            loadInput: document.getElementById('loadInput'),
            clearBtn: document.getElementById('clearBtn'),
            waypointList: document.getElementById('waypoint-list'),
            deleteSelectedWaypointsBtn: document.getElementById('deleteSelectedWaypointsBtn'),
            cycleWaypointsBtn: document.getElementById('cycleWaypointsBtn'),
            teleportBtn: document.getElementById('teleportBtn'),
            teleportDropdown: document.getElementById('teleport-dropdown'),
            statusBar: document.getElementById('status-bar'),
            coordsBar: document.getElementById('coords-bar'),
            playbackSpeed: document.getElementById('playbackSpeed'),
            speedValue: document.getElementById('speedValue'),
            rovSpeed: document.getElementById('rovSpeed'),
            rovSpeedValue: document.getElementById('rovSpeedValue'),
            minimapToggleMenuBtn: document.getElementById('minimapToggleMenuBtn'),
            minimapFollow: document.getElementById('minimap-follow'),
            minimapContainer: document.getElementById('minimap-container'),
            toggleControlsBtn: document.getElementById('toggleControlsBtn'),
            editFalloff: document.getElementById('editFalloff'),
            editFalloffValue: document.getElementById('editFalloffValue'),
            pathEditSpeed: document.getElementById('pathEditSpeed'),
            pathEditSpeedValue: document.getElementById('pathEditSpeedValue'),
            proportionalEditControls: document.getElementById('proportional-edit-controls'),
            editModeFreeBtn: document.getElementById('editModeFreeBtn'),
            editModeHorizontalBtn: document.getElementById('editModeHorizontalBtn'),
            editModeVerticalBtn: document.getElementById('editModeVerticalBtn'),
            fullscreenBtn: document.getElementById('fullscreenBtn'),
            fpvToggleMenuBtn: document.getElementById('fpvToggleMenuBtn'),
            fpvHideBtn: document.getElementById('fpvHideBtn'),
            fpvSwitchMainBtn: document.getElementById('fpvSwitchMainBtn'),
            extendPathBtn: document.getElementById('extendPathBtn'),
            extendPathMode: document.getElementById('extendPathMode'),
            extendPathControls: document.getElementById('extend-path-controls'),
            resumeFromDropdown: document.getElementById('resumeFromDropdown'),
            editPathCoordsBtn: document.getElementById('editPathCoordsBtn'),
            pathCoordsPanel: document.getElementById('pathCoordsPanel'),
            pathCoordX: document.getElementById('pathCoordX'),
            pathCoordY: document.getElementById('pathCoordY'),
            pathCoordZ: document.getElementById('pathCoordZ'),
        };

        this.ui.recordBtn.addEventListener('click', () => this.handleRecord());
        this.ui.stopBtn.addEventListener('click', () => this.handleStop());
        this.ui.playBtn.addEventListener('click', () => this.handlePlay(false));
        this.ui.playBackwardsBtn.addEventListener('click', () => this.handlePlay(true));
        this.ui.resumeFromBtn.addEventListener('click', () => this.handleResumeFrom());
        this.ui.editPathBtn.addEventListener('click', () => this.toggleEditMode());
        this.ui.clearBtn.addEventListener('click', () => this.handleClear());
        this.ui.switchViewBtn.addEventListener('click', () => this.handleSwitchView());
        this.ui.freeViewBtn.addEventListener('click', () => this.handleFreeView());
        this.ui.undoBtn.addEventListener('click', () => this.handleUndo());
        this.ui.redoBtn.addEventListener('click', () => this.handleRedo());
        this.ui.saveBtn.addEventListener('click', () => this.saveData());
        this.ui.loadBtn.addEventListener('click', () => this.ui.loadInput.click());
        this.ui.loadInput.addEventListener('change', (e) => this.loadData(e));
        this.ui.deleteSelectedWaypointsBtn.addEventListener('click', () => this.handleDeleteSelectedWaypoints());
        this.ui.cycleWaypointsBtn.addEventListener('click', () => this.toggleCycleWaypointsMode());
        this.ui.teleportBtn.addEventListener('click', () => this.toggleTeleportDropdown());
        this.ui.teleportDropdown.addEventListener('change', (e) => this.handleTeleport(e));
        this.ui.playbackSpeed.addEventListener('input', (e) => this.updateSpeedDisplay(e.target.value));
        this.ui.rovSpeed.addEventListener('input', (e) => this.handleRovSpeedChange(e.target.value));
        this.ui.minimapToggleMenuBtn.addEventListener('click', () => this.toggleMinimap());
        this.ui.minimapFollow.addEventListener('click', () => this.toggleMinimapFollow());
        this.ui.toggleControlsBtn.addEventListener('click', () => this.handleToggleControls());
        this.ui.editFalloff.addEventListener('input', (e) => this.handleFalloffChange(e.target.value));
        this.ui.editModeFreeBtn.addEventListener('click', () => this.handleEditModeChange('free'));
        this.ui.editModeHorizontalBtn.addEventListener('click', () => this.handleEditModeChange('horizontal'));
        this.ui.editModeVerticalBtn.addEventListener('click', () => this.handleEditModeChange('vertical'));
        this.ui.fullscreenBtn.addEventListener('click', () => this.handleFullscreen());
        this.ui.fpvToggleMenuBtn.addEventListener('click', () => this.toggleFPV());
        this.ui.fpvHideBtn.addEventListener('click', () => this.toggleFPV());
        this.ui.fpvSwitchMainBtn.addEventListener('click', () => this.toggleFPVMainView());
        this.ui.extendPathBtn.addEventListener('click', () => this.handleExtendPath());
        this.ui.extendPathMode.addEventListener('change', (e) => {
            this.state.extendMode = e.target.value;
        });
        this.ui.resumeFromBtn.addEventListener('click', () => this.handleResumeFrom());
        this.ui.resumeFromDropdown.addEventListener('change', (e) => this.handleResumeFromSelect(e));
        this.ui.pathEditSpeed.addEventListener('input', (e) => this.handlePathEditSpeedChange(e.target.value));

        const collapsibles = document.getElementsByClassName("collapsible");
        for (let i = 0; i < collapsibles.length; i++) {
            collapsibles[i].addEventListener("click", function() {
                this.classList.toggle("active");
                var content = this.nextElementSibling;
                if (content.style.display === "block") {
                    content.style.display = "none";
                } else {
                    content.style.display = "block";
                }
            });
        }

        if (!document.getElementById('gizmoModeBtn')) {
            const btn = document.createElement('button');
            btn.id = 'gizmoModeBtn';
            btn.textContent = 'Switch Gizmo Mode (Move/Rotate)';
            btn.style.margin = '8px 0';
            btn.addEventListener('click', () => this.toggleGizmoMode());
            const refBtn = this.ui.editPathBtn;
            refBtn.parentNode.insertBefore(btn, refBtn.nextSibling);
        }
        
        if (!document.getElementById('rotatePathBtn')) {
            const btn = document.createElement('button');
            btn.id = 'rotatePathBtn';
            btn.textContent = 'Rotate Path';
            btn.style.margin = '8px 0';
            btn.addEventListener('click', () => this.toggleRotatePathPanel());
            const refBtn = this.ui.editPathBtn;
            refBtn.parentNode.insertBefore(btn, refBtn.nextSibling);
        }
        if (!document.getElementById('pathRotatePanel')) {
            const panel = document.createElement('div');
            panel.id = 'pathRotatePanel';
            panel.className = 'coords-panel';
            panel.style.display = 'none';
            panel.innerHTML = `
                <label>Rot X:</label><input type="number" step="1" id="pathRotX" style="width:60px;">
                <label>Y:</label><input type="number" step="1" id="pathRotY" style="width:60px;">
                <label>Z:</label><input type="number" step="1" id="pathRotZ" style="width:60px;">
                <div style="margin-top:6px;">
                    <button id="pathRotLeft">&#8592; Y-</button>
                    <button id="pathRotRight">Y+ &#8594;</button>
                    <button id="pathRotUp">&#8593; X-</button>
                    <button id="pathRotDown">X+ &#8595;</button>
                    <button id="pathRotZp">Z+</button>
                    <button id="pathRotZm">Z-</button>
                    <button id="pathRotReset" style="margin-left:10px;">Reset</button>
                </div>
                <div style="margin-top:10px;">
                    <label style="display:block;">X Axis:</label>
                    <input type="range" id="pathRotXSlider" min="-180" max="180" step="1" style="width:90%;">
                    <label style="display:block;">Y Axis:</label>
                    <input type="range" id="pathRotYSlider" min="-180" max="180" step="1" style="width:90%;">
                    <label style="display:block;">Z Axis:</label>
                    <input type="range" id="pathRotZSlider" min="-180" max="180" step="1" style="width:90%;">
                </div>
                <div style="margin-top:10px;">
                    <label for="rotationOriginSelect" style="display:block;">Rotation Origin:</label>
                    <select id="rotationOriginSelect" style="width:100%;"></select>
                </div>
            `;
            const refBtn = document.getElementById('rotatePathBtn');
            refBtn.parentNode.insertBefore(panel, refBtn.nextSibling);
        }
        
        const rotX = document.getElementById('pathRotX');
        const rotY = document.getElementById('pathRotY');
        const rotZ = document.getElementById('pathRotZ');
        const sX = document.getElementById('pathRotXSlider');
        const sY = document.getElementById('pathRotYSlider');
        const sZ = document.getElementById('pathRotZSlider');
        rotX.addEventListener('input', (e) => this.updatePathGlobalRotation('x', e.target.value));
        rotY.addEventListener('input', (e) => this.updatePathGlobalRotation('y', e.target.value));
        rotZ.addEventListener('input', (e) => this.updatePathGlobalRotation('z', e.target.value));
        sX.addEventListener('input', (e) => this.updatePathGlobalRotation('x', e.target.value, true));
        sY.addEventListener('input', (e) => this.updatePathGlobalRotation('y', e.target.value, true));
        sZ.addEventListener('input', (e) => this.updatePathGlobalRotation('z', e.target.value, true));
        document.getElementById('pathRotLeft').addEventListener('click', () => this.incrementPathGlobalRotation('y', -10));
        document.getElementById('pathRotRight').addEventListener('click', () => this.incrementPathGlobalRotation('y', 10));
        document.getElementById('pathRotUp').addEventListener('click', () => this.incrementPathGlobalRotation('x', -10));
        document.getElementById('pathRotDown').addEventListener('click', () => this.incrementPathGlobalRotation('x', 10));
        document.getElementById('pathRotZp').addEventListener('click', () => this.incrementPathGlobalRotation('z', 10));
        document.getElementById('pathRotZm').addEventListener('click', () => this.incrementPathGlobalRotation('z', -10));
        document.getElementById('pathRotReset').addEventListener('click', () => this.resetPathGlobalRotation());

        this.ui.editPathCoordsBtn.addEventListener('click', () => this.toggleCoordsPanel('path'));
        this.ui.pathCoordX.addEventListener('input', (e) => this.updateModelPosition('path', 'x', e.target.value));
        this.ui.pathCoordY.addEventListener('input', (e) => this.updateModelPosition('path', 'y', e.target.value));
        this.ui.pathCoordZ.addEventListener('input', (e) => this.updateModelPosition('path', 'z', e.target.value));
    }

    toggleCoordsPanel(modelType) {
        if (modelType === 'path') {
            if (this.path.length === 0) return;
            const panel = this.ui.pathCoordsPanel;
            let centroid = new THREE.Vector3();
            for (const p of this.path) centroid.add(p);
            centroid.divideScalar(this.path.length);
            if (panel.style.display === 'block') {
                panel.style.display = 'none';
            } else {
                this.ui.pathCoordX.value = centroid.x.toFixed(2);
                this.ui.pathCoordY.value = centroid.y.toFixed(2);
                this.ui.pathCoordZ.value = centroid.z.toFixed(2);
                panel.style.display = 'block';
            }
        }
    }

    updateModelPosition(modelType, axis, value) {
        if (modelType === 'path') {
            if (this.path.length === 0) return;
            let centroid = new THREE.Vector3();
            for (const p of this.path) centroid.add(p);
            centroid.divideScalar(this.path.length);
            const numericValue = parseFloat(value);
            if (!isNaN(numericValue)) {
                const delta = new THREE.Vector3(
                    axis === 'x' ? numericValue - centroid.x : 0,
                    axis === 'y' ? numericValue - centroid.y : 0,
                    axis === 'z' ? numericValue - centroid.z : 0
                );
                for (const p of this.path) {
                    p.add(delta);
                }
                this.updatePathVisuals();
            }
        }
    }
    
    handleRovSpeedChange(value) {
        this.rovSpeed = parseFloat(value);
        this.ui.rovSpeedValue.textContent = this.rovSpeed.toFixed(1);
    }
    
    handleFalloffChange(value) {
        this.editFalloff = parseFloat(value);
        this.ui.editFalloffValue.textContent = this.editFalloff.toFixed(1);
    }

    handlePathEditSpeedChange(value) {
        this.pathEditSpeed = parseFloat(value);
        this.ui.pathEditSpeedValue.textContent = this.pathEditSpeed.toFixed(1);
    }

    handleEditModeChange(mode) {
        this.state.editModeConstraint = mode;
        this.updateUI();
    }
    
    handleUndo() {
        if (this.history.length > 0) {
            const pathCopy = this.path.map(p => p.clone());
            this.redoStack.push({ path: pathCopy });
            
            const lastState = this.history.pop();
            this.path = lastState.path.map(p => p.clone());

            this.deselectPoint();
            this.updatePathVisuals();
            this.updateUI();
            this.updateStatus('Undo successful.');
        } else {
            this.updateStatus('Nothing to undo.');
        }
    }

    saveStateForUndo() {
        const pathCopy = this.path.map(p => p.clone());
        this.history.push({ path: pathCopy });
        this.redoStack = [];
        this.updateUI();
    }

    handleToggleControls() {
        const controlsPanel = document.getElementById('controls-panel');
        controlsPanel.classList.toggle('hidden');
        setTimeout(() => this.onWindowResize(), 300);
        this.updateUI();
    }
    
    handleRecord() {
        if (!this.state.isRecording) {
            this.path = [this.rov.position.clone()];
            this.state.isRecording = true;
            this.state.isPaused = false;
            this.updateStatus('Recording path...');
        } else {
            this.state.isPaused = !this.state.isPaused;
            this.updateStatus(this.state.isPaused ? 'Recording paused.' : 'Recording...');
        }
        this.updateUI();
    }

    handleStop() {
        this.state.isRecording = false;
        this.state.isPaused = false;
        this.state.isPlaying = false;
        this.state.isPlaybackPaused = false;
        this.state.isReversed = false;
        if (this.path.length < 2) {
            this.path = [];
            this.updateStatus('Path too short, cleared.');
        } else {
            this.saveStateForUndo();
            this.updatePathVisuals();
            this.updateStatus('Path recorded.');
        }
        this.updateUI();
    }
    
    handlePlay(isReversed = false) {
        if (!this.state.isPlaying) {
            this.state.isReversed = isReversed;
            this.playbackTime = isReversed ? 1 : 0;
            this.state.isPlaying = true;
            this.state.isPlaybackPaused = false;
            this.updateStatus(isReversed ? 'Playing path backwards...' : 'Playing path...');
        } else {
            if (this.state.isReversed !== isReversed) {
                this.state.isReversed = isReversed;
                this.state.isPlaybackPaused = false;
            } else {
                this.state.isPlaybackPaused = !this.state.isPlaybackPaused;
            }
            this.updateStatus(this.state.isPlaybackPaused ? 'Playback paused.' : 'Playing...');
        }
        this.updateUI();
    }

    handleResumeFrom() {
        this.ui.resumeFromDropdown.innerHTML = '';
        for (let i = 0; i < this.path.length; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `Waypoint ${i}`;
            this.ui.resumeFromDropdown.appendChild(option);
        }
        this.ui.resumeFromDropdown.style.display = 'inline-block';
        this.ui.resumeFromDropdown.focus();
    }
    handleResumeFromSelect(e) {
        const idx = parseInt(e.target.value, 10);
        if (isNaN(idx) || idx < 0 || idx >= this.path.length) return;
        this.saveStateForUndo();
        this.path = this.path.slice(0, idx + 1);
        this.rov.position.copy(this.path[idx]);
        this.state.isRecording = true;
        this.state.isPaused = false;
        this.updatePathVisuals();
        this.updateUI();
        this.updateStatus(`Resumed recording from Waypoint ${idx}.`);
        this.ui.resumeFromDropdown.style.display = 'none';
    }

    handleClear() {
        this.state.isRecording = false;
        this.state.isPlaying = false;
        this.path = [];
        this.history = [];
        if (this.pathLine) this.scene.remove(this.pathLine);
        this.pathLine = null;
        this.pathCurve = null;
        this.updateEditHelpers();
        this.rov.position.set(0, 6.3, 0);
        this.rov.quaternion.set(0,0,0,1);
        this.updateStatus('Data cleared.');
        this.updateUI();
    }
    
    handleSwitchView() {
        if (this.state.cameraMode === 'ORBIT') {
            this.state.cameraMode = 'POV';
            this.orbitControls.enabled = false;
        } else if (this.state.cameraMode === 'POV') {
            this.state.cameraMode = 'FREE';
            this.orbitControls.enabled = true;
            this.orbitControls.target.set(0, 0, 0);
        } else {
            this.state.cameraMode = 'ORBIT';
            this.orbitControls.enabled = true;
            this.orbitControls.target.copy(this.rov.position);
        }
        
        this.updateStatus(`Switched to ${this.state.cameraMode} view.`);
        this.updateUI();
    }

    handleFreeView() {
        this.state.cameraMode = 'FREE';
        this.orbitControls.enabled = true;
        this.orbitControls.target.set(0, 0, 0);
        this.updateStatus('Free view mode activated. Use mouse to move camera freely.');
        this.updateUI();
    }
    
    toggleEditMode() {
        this.state.isEditingPath = !this.state.isEditingPath;
        this.ui.proportionalEditControls.style.display = this.state.isEditingPath ? 'block' : 'none';
        
        if (!this.state.isEditingPath) {
            this.deselectPoint();
            this.state.isCyclingWaypoints = false;
            this.orbitControls.enableZoom = true;
        }

        if (this.state.isEditingPath) {
            this.updateStatus('Path editing enabled. Click to select a point, then use mouse or WASD to move.');
        } else {
            this.updateStatus('Path editing disabled.');
        }

        this.updateEditHelpers();
        this.updateUI();
    }

    toggleCycleWaypointsMode() {
        this.state.isCyclingWaypoints = !this.state.isCyclingWaypoints;
        this.orbitControls.enableZoom = !this.state.isCyclingWaypoints;

        if (this.state.isCyclingWaypoints) {
            this.interactionData.cycleIndex = this.interactionData.selectedPointIndex !== null ? this.interactionData.selectedPointIndex : 0;
            this.selectPoint(this.interactionData.cycleIndex);
            this.updateStatus('Waypoint cycling enabled. Use mouse wheel to navigate.');
        } else {
            this.deselectPoint();
            this.updateStatus('Waypoint cycling disabled.');
        }
        this.updateUI();
    }

    toggleTeleportDropdown() {
        const dropdown = this.ui.teleportDropdown;
        if (dropdown.style.display === 'none') {
            dropdown.style.display = 'inline-block';
            dropdown.innerHTML = '<option value="-1">Select Waypoint</option>';
            this.path.forEach((p, i) => {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `Waypoint ${i}`;
                dropdown.appendChild(option);
            });
        } else {
            dropdown.style.display = 'none';
        }
    }

    handleTeleport(event) {
        const waypointIndex = parseInt(event.target.value, 10);
        if (waypointIndex >= 0) {
            const waypoint = this.path[waypointIndex];
            this.rov.position.copy(waypoint);
            this.updateStatus(`Teleported to Waypoint ${waypointIndex}`);
            this.ui.teleportDropdown.style.display = 'none';
        }
    }

    handleDeleteSelectedWaypoints() {
        const checkboxes = this.ui.waypointList.querySelectorAll('input[type="checkbox"]:checked');
        const indicesToDelete = [];
        checkboxes.forEach(cb => {
            indicesToDelete.push(parseInt(cb.dataset.waypointIndex, 10));
        });

        if (indicesToDelete.length === 0) {
            this.updateStatus("No waypoints selected for deletion.");
            return;
        }

        this.saveStateForUndo();

        indicesToDelete.sort((a, b) => b - a);

        indicesToDelete.forEach(index => {
            this.path.splice(index, 1);
        });

        this.deselectPoint();
        this.updatePathVisuals();
        this.updateUI();
        this.updateStatus(`Deleted ${indicesToDelete.length} waypoint(s).`);
    }
    
    onKeyDown(event) {
        this.keys[event.code] = true;
        
        if (event.code === 'Escape' && this.state.isEditingPath) {
            this.deselectPoint();
        }

        if (event.ctrlKey && event.code === 'KeyZ') {
            event.preventDefault();
            this.handleUndo();
        }

        if (event.ctrlKey && event.code === 'KeyY') {
            event.preventDefault();
            this.handleRedo();
        }

        if (this.state.isExtendingPath && event.code === 'Escape') {
            this.state.isExtendingPath = false;
            this.isDraggingExtend = false;
            if (this.extendPreviewLine) {
                this.scene.remove(this.extendPreviewLine);
                this.extendPreviewLine.geometry.dispose();
                this.extendPreviewLine.material.dispose();
                this.extendPreviewLine = null;
            }
            this.extendStartPoint = null;
            this.extendOriginalLastWaypoint = null;
            this.orbitControls.enabled = true;
            this.updateStatus('Extend Path cancelled.');
            this.updateUI();
            return;
        }
        
        if (this.state.isExtendingPath && !this.isDraggingExtend && this.path.length > 0 && (event.code === 'KeyR' || event.code === 'KeyF')) {
            if (!this.extendOriginalLastWaypoint) {
                this.extendStartPoint = this.path[this.path.length - 1];
                this.extendOriginalLastWaypoint = this.path[this.path.length - 1].clone();
            }
            const delta = (event.code === 'KeyR') ? 1 : -1;
            const lastWaypoint = this.path[this.path.length - 1];
            const newLastWaypoint = lastWaypoint.clone();
            newLastWaypoint.y += delta * 0.2;
            this.saveStateForUndo();
            this.path.push(newLastWaypoint.clone());
            this.updatePathVisuals();
            this.updateStatus(`Path extended ${delta > 0 ? 'up' : 'down'} by 0.2 units.`);
            this.extendOriginalLastWaypoint = newLastWaypoint.clone();
            this.extendStartPoint = this.path[this.path.length - 1];
            return;
        }
        
        if (this.state.isExtendingPath && !this.isDraggingExtend && this.path.length > 0 && (event.code === 'KeyT' || event.code === 'KeyG')) {
            if (!this.extendOriginalLastWaypoint) {
                this.extendStartPoint = this.path[this.path.length - 1];
                this.extendOriginalLastWaypoint = this.path[this.path.length - 1].clone();
            }
            let camDir = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            camDir.y = 0;
            if (camDir.lengthSq() > 0) camDir.normalize();
            else camDir.set(1, 0, 0);
            const delta = (event.code === 'KeyT') ? 1 : -1;
            const lastWaypoint = this.path[this.path.length - 1];
            const moveVec = camDir.clone().multiplyScalar(delta * 0.2);
            const newLastWaypoint = lastWaypoint.clone().add(moveVec);
            this.saveStateForUndo();
            this.path.push(newLastWaypoint.clone());
            this.updatePathVisuals();
            this.updateStatus(`Path extended ${(delta > 0 ? 'forward' : 'backward')} by 0.2 units (camera direction).`);
            this.extendOriginalLastWaypoint = newLastWaypoint.clone();
            this.extendStartPoint = this.path[this.path.length - 1];
            return;
        }
    }
    
    handlePointerDown(x, y) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.state.isEditingPath && !this.state.isCyclingWaypoints) {
            const intersects = this.raycaster.intersectObjects(this.editHelpers.children);
            const newHovered = intersects.length > 0 ? intersects[0].object : null;

            if (newHovered) {
                const pointIndex = this.editHelpers.children.indexOf(newHovered);
                this.selectPoint(pointIndex);
                this.interactionData.draggedPointIndex = pointIndex;
                this.saveStateForUndo();
                this.interactionData.originalDraggedPointPosition = this.path[pointIndex].clone();
                this.interactionData.originalPath = this.path.map(p => p.clone());
                this.orbitControls.enabled = false;
                this.updateStatus(`Dragging point ${pointIndex}.`);
            } else {
                this.deselectPoint();
            }
        }
    }
    
    handlePointerMove(x, y) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((y - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        if (this.state.isEditingPath && this.interactionData.draggedPointIndex !== null) {
            const originalPoint = this.interactionData.originalDraggedPointPosition;
            let intersectPoint = new THREE.Vector3();
            let moveDelta;
            let plane;

            switch (this.state.editModeConstraint) {
                case 'horizontal':
                    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -originalPoint.y);
                    this.raycaster.ray.intersectPlane(plane, intersectPoint);
                    moveDelta = new THREE.Vector3().subVectors(intersectPoint, originalPoint);
                    break;
                case 'vertical':
                    const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
                    const planeNormal = cameraRight.cross(this.camera.up).normalize();
                    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, originalPoint);
                    this.raycaster.ray.intersectPlane(plane, intersectPoint);
                    intersectPoint.x = originalPoint.x;
                    intersectPoint.z = originalPoint.z;
                    moveDelta = new THREE.Vector3().subVectors(intersectPoint, originalPoint);
                    break;
                default:
                    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), originalPoint);
                    this.raycaster.ray.intersectPlane(plane, intersectPoint);
                    moveDelta = new THREE.Vector3().subVectors(intersectPoint, originalPoint);
                    break;
            }
    
            if (moveDelta) {
                this.applyProportionalMove(this.interactionData.draggedPointIndex, moveDelta);
            }
        }
    }

    handlePointerUp() {
         if (this.interactionData.draggedPointIndex !== null) {
            this.interactionData.draggedPointIndex = null;
            this.orbitControls.enabled = true;
            this.updatePathVisuals();
            this.updateStatus(`Point ${this.interactionData.selectedPointIndex} selected. Use WASD to move or Esc to deselect.`);
        }
        if (this.interactionData.isDragging) {
            this.interactionData.isDragging = false;
            if(this.state.cameraMode !== 'POV') {
               this.orbitControls.enabled = true;
            }
        }
    }
    
    onMouseDown(event) {
        if (this.isTransformControlsDragging) return;
        if (this.state.isExtendingPath && this.path.length > 0) {
            this.isDraggingExtend = true;
            this.extendStartPoint = this.path[this.path.length - 1];
            this.extendOriginalLastWaypoint = this.path[this.path.length - 1].clone();
            this.updateStatus('Extending path: drag the last waypoint to desired location, release to drop.');
        } else {
            this.handlePointerDown(event.clientX, event.clientY);
        }
    }
    onMouseMove(event) {
        if (this.isTransformControlsDragging) return;
        if (this.state.isExtendingPath && this.isDraggingExtend && this.extendStartPoint) {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            let plane;
            if (this.state.extendMode === 'horizontal') {
                plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.extendOriginalLastWaypoint.y);
            } else {
                plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.extendOriginalLastWaypoint.z);
            }
            const intersectPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            let newLastWaypoint = intersectPoint.clone();
            if (this.state.extendMode === 'horizontal') {
                newLastWaypoint.y = this.extendOriginalLastWaypoint.y;
            } else {
                newLastWaypoint.x = this.extendOriginalLastWaypoint.x;
                newLastWaypoint.z = this.extendOriginalLastWaypoint.z;
            }
            if (this.extendPreviewLine) {
                this.scene.remove(this.extendPreviewLine);
                this.extendPreviewLine.geometry.dispose();
                this.extendPreviewLine.material.dispose();
                this.extendPreviewLine = null;
            }
            const geometry = new THREE.BufferGeometry().setFromPoints([this.extendOriginalLastWaypoint, newLastWaypoint]);
            const material = new THREE.LineDashedMaterial({ color: 0x00ff00, dashSize: 1, gapSize: 0.5 });
            this.extendPreviewLine = new THREE.Line(geometry, material);
            this.extendPreviewLine.computeLineDistances();
            this.scene.add(this.extendPreviewLine);
            this.extendStartPoint.copy(newLastWaypoint);
            this.updatePathVisuals(true);
        } else {
            this.handlePointerMove(event.clientX, event.clientY);
        }
    }
    onMouseUp(event) {
        if (this.isTransformControlsDragging) return;
        if (this.state.isExtendingPath && this.isDraggingExtend && this.extendStartPoint && this.extendOriginalLastWaypoint) {
            this.isDraggingExtend = false;
            if (this.extendPreviewLine) {
                this.scene.remove(this.extendPreviewLine);
                this.extendPreviewLine.geometry.dispose();
                this.extendPreviewLine.material.dispose();
                this.extendPreviewLine = null;
            }
            const newLastWaypoint = this.path[this.path.length - 1].clone();
            if (!newLastWaypoint.equals(this.extendOriginalLastWaypoint)) {
                this.saveStateForUndo();
                this.path.pop();
                const newPoints = this.interpolateWaypoints(this.extendOriginalLastWaypoint, newLastWaypoint, 0.2);
                for (const p of newPoints) { this.path.push(p); }
                this.updatePathVisuals();
                this.updateStatus('Path extended.');
            } else {
                this.path[this.path.length - 1].copy(this.extendOriginalLastWaypoint);
                this.updateStatus('Extension cancelled (no movement).');
            }
            this.state.isExtendingPath = false;
            this.extendStartPoint = null;
            this.extendOriginalLastWaypoint = null;
            this.orbitControls.enabled = true;
            this.updateUI();
            return;
        } else {
            this.handlePointerUp();
        }
    }
    onMouseWheel(event) {
        if (this.state.isEditingPath && this.state.isCyclingWaypoints) {
            event.preventDefault();
            if (event.deltaY < 0) {
                this.interactionData.cycleIndex--;
                if (this.interactionData.cycleIndex < 0) {
                    this.interactionData.cycleIndex = this.path.length - 1;
                }
            } else {
                this.interactionData.cycleIndex++;
                if (this.interactionData.cycleIndex >= this.path.length) {
                    this.interactionData.cycleIndex = 0;
                }
            }
            this.selectPoint(this.interactionData.cycleIndex);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();

        this.updateHoverEffect();

        if (this.state.isEditingPath && this.interactionData.selectedPointIndex !== null && !this.state.isEditingWaypoint) {
            this.handleKeyboardWaypointEditing(deltaTime);
        } else if (this.state.cameraMode === 'FREE') {
            this.updateFreeCameraMovement(deltaTime);
        } else if (!this.state.isPlaying) {
            this.updateROVMovement(deltaTime);
        }

        if (this.state.isPlaying) {
             this.updatePlayback(deltaTime);
        }
        
        this.updateCamera();
        this.updateCoordinateDisplay();
        this.updateMinimap();
        
        this.updateFPVCamera();
        
        if (this.state.fpvVisible) {
            if (this.state.fpvMainView) {
                const oldAspect = this.camera.aspect;
                this.camera.aspect = 1;
                this.camera.updateProjectionMatrix();
                this.fpvRenderer.render(this.scene, this.camera);
                this.camera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
                this.camera.updateProjectionMatrix();
            } else {
                const oldAspect = this.fpvCamera.aspect;
                this.fpvCamera.aspect = 1;
                this.fpvCamera.updateProjectionMatrix();
                this.fpvRenderer.render(this.scene, this.fpvCamera);
                this.fpvCamera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
                this.fpvCamera.updateProjectionMatrix();
            }
        }
        
        if (this.state.fpvMainView) {
            this.fpvCamera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
            this.fpvCamera.updateProjectionMatrix();
            this.renderer.render(this.scene, this.fpvCamera);
        } else {
            this.camera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    handleKeyboardWaypointEditing(deltaTime) {
        const moveSpeed = this.pathEditSpeed * deltaTime;
        const moveDelta = new THREE.Vector3();

        const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const cameraUp = new THREE.Vector3().copy(this.camera.up);

        if (this.keys['KeyW']) moveDelta.add(cameraUp);
        if (this.keys['KeyS']) moveDelta.sub(cameraUp);
        if (this.keys['KeyA']) moveDelta.sub(cameraRight);
        if (this.keys['KeyD']) moveDelta.add(cameraRight);

        if (moveDelta.lengthSq() > 0) {
            if (this.state.editModeConstraint === 'horizontal') moveDelta.y = 0;
            if (this.state.editModeConstraint === 'vertical') {
                moveDelta.x = 0;
                moveDelta.z = 0;
            }
            
            moveDelta.normalize().multiplyScalar(moveSpeed);
            
            this.saveStateForUndo();
            this.interactionData.originalPath = this.path.map(p => p.clone());
            
            this.applyProportionalMove(this.interactionData.selectedPointIndex, moveDelta);
        }
    }


    applyProportionalMove(selectedIndex, moveDelta) {
        const originalPoint = this.interactionData.originalPath[selectedIndex];
        const window = Math.max(1, Math.round(this.editFalloff));
        const startIdx = Math.max(0, selectedIndex - window);
        const endIdx = Math.min(this.path.length - 1, selectedIndex + window);
        for (let i = 0; i < this.path.length; i++) {
            if (i < startIdx || i > endIdx) continue;
            const pointToMove = this.interactionData.originalPath[i];
            const indexDist = Math.abs(i - selectedIndex);
            let influence = 0;
            if (i === selectedIndex) {
                influence = 1;
            } else if (window > 0 && indexDist <= window) {
                const normalized = indexDist / window;
                influence = (Math.cos(normalized * Math.PI) + 1) / 2;
            }
            const influencedDelta = moveDelta.clone().multiplyScalar(influence);
            this.path[i].copy(pointToMove).add(influencedDelta);
            this.editHelpers.children[i].position.copy(this.path[i]);
        }
        this.updatePathVisuals(true);
    }


    updateHoverEffect() {
        if (!this.state.isEditingPath || this.interactionData.draggedPointIndex !== null || this.state.isCyclingWaypoints) {
            if (this.interactionData.hoveredHelper) {
                if (this.editHelpers.children.indexOf(this.interactionData.hoveredHelper) !== this.interactionData.selectedPointIndex) {
                   this.interactionData.hoveredHelper.material = this.editHelperMaterials.normal;
                }
                this.interactionData.hoveredHelper = null;
            }
            return;
        }
    
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.editHelpers.children);
    
        const oldHovered = this.interactionData.hoveredHelper;
        let newHovered = null;

        if (intersects.length > 0) {
            newHovered = intersects[0].object;
        }

        if (oldHovered !== newHovered) {
            if (oldHovered && this.editHelpers.children.indexOf(oldHovered) !== this.interactionData.selectedPointIndex) {
                oldHovered.material = this.editHelperMaterials.normal;
            }

            if (newHovered && this.editHelpers.children.indexOf(newHovered) !== this.interactionData.selectedPointIndex) {
                 newHovered.material = this.editHelperMaterials.highlight;
            }
            this.interactionData.hoveredHelper = newHovered;
        }
    }

    updateFreeCameraMovement(deltaTime) {
        const cameraMoveSpeed = 30.0 * deltaTime;
        const moveDirection = new THREE.Vector3();

        if (this.keys['KeyW']) moveDirection.z = -1;
        if (this.keys['KeyS']) moveDirection.z = 1;
        if (this.keys['KeyA']) moveDirection.x = -1;
        if (this.keys['KeyD']) moveDirection.x = 1;
        
        moveDirection.normalize().applyQuaternion(this.camera.quaternion);
        this.camera.position.add(moveDirection.multiplyScalar(cameraMoveSpeed));

        if (this.keys['KeyE']) this.camera.position.y += cameraMoveSpeed;
        if (this.keys['KeyQ']) this.camera.position.y -= cameraMoveSpeed;
        
        this.orbitControls.target.copy(this.camera.position).add(new THREE.Vector3(0, 0, -10).applyQuaternion(this.camera.quaternion));
    }
    
    updateROVMovement(deltaTime) {
        const moveSpeed = this.rovSpeed * deltaTime;
        const turnSpeed = 2.0 * deltaTime;

        if (this.keys['KeyW']) this.rov.translateZ(-moveSpeed);
        if (this.keys['KeyS']) this.rov.translateZ(moveSpeed);
        if (this.keys['KeyA']) this.rov.rotateY(turnSpeed);
        if (this.keys['KeyD']) this.rov.rotateY(-turnSpeed);
        if (this.keys['KeyR']) this.rov.position.y += moveSpeed;
        if (this.keys['KeyF']) this.rov.position.y -= moveSpeed;

        if (this.state.isRecording && !this.state.isPaused) {
            const lastPoint = this.path[this.path.length - 1];
            if (this.rov.position.distanceTo(lastPoint) > 0.2) {
                const wp = this.rov.position.clone();
                wp.rotation = this.rov.rotation.clone();
                this.path.push(wp);
                this.updatePathVisuals();
            }
        }
    }

    updatePlayback(deltaTime) {
        if (!this.pathCurve || this.state.isPlaybackPaused) return;

        const speedMultiplier = parseFloat(this.ui.playbackSpeed.value);
        if (this.state.isReversed) {
            this.playbackTime -= deltaTime * speedMultiplier;
        } else {
            this.playbackTime += deltaTime * speedMultiplier;
        }

        if (this.playbackTime >= 1 || this.playbackTime <= 0) {
            this.playbackTime = THREE.MathUtils.clamp(this.playbackTime, 0, 1);
            this.state.isPlaying = false;
            this.updateStatus('Playback finished.');
            this.updateUI();
        }

        const pos = this.pathCurve.getPointAt(this.playbackTime);
        this.rov.position.copy(pos);
        
        const tangent = this.pathCurve.getTangentAt(this.playbackTime).normalize();
        const lookAtPos = pos.clone().add(tangent);
        this.rov.lookAt(lookAtPos);
    }

    updateCamera() {
        if (this.state.cameraMode === 'ORBIT') {
            if(!this.interactionData.isDragging) {
               this.orbitControls.target.lerp(this.rov.position, 0.1);
            }
            this.orbitControls.update();
        } else if (this.state.cameraMode === 'POV') {
            const offset = new THREE.Vector3(0, 1.5, 3);
            const cameraPos = this.rov.localToWorld(offset);
            this.camera.position.lerp(cameraPos, 0.1);
            this.camera.lookAt(this.rov.position);
        } else if (this.state.cameraMode === 'FREE') {
            this.orbitControls.update();
        }
    }
    
    updateUI(rebuildList = true) {
        const { isRecording, isPlaying, isPlaybackPaused, isReversed, cameraMode, minimapVisible, minimapFollow, isEditingPath, isCyclingWaypoints, editModeConstraint, isEditingWaypoint, fpvVisible } = this.state;
        const hasPath = this.path.length > 0;
        const hasMultiplePoints = this.path.length > 1;

        const isInteracting = this.interactionData.isDragging || isEditingWaypoint;

        this.ui.recordBtn.disabled = isInteracting || isPlaying || isEditingPath;
        this.ui.stopBtn.disabled = isInteracting || !isRecording && !isPlaying;
        this.ui.playBtn.disabled = isInteracting || !hasMultiplePoints || isRecording || isEditingPath;
        this.ui.playBackwardsBtn.disabled = isInteracting || !hasMultiplePoints || isRecording || isEditingPath;
        this.ui.resumeFromBtn.disabled = isInteracting || !hasMultiplePoints || isRecording || isEditingPath;
        this.ui.editPathBtn.disabled = isInteracting || !hasMultiplePoints || isRecording || isPlaying;
        this.ui.cycleWaypointsBtn.disabled = isInteracting || !isEditingPath;
        this.ui.teleportBtn.disabled = isInteracting || !hasPath;
        this.ui.undoBtn.disabled = this.history.length === 0 || isInteracting;
        this.ui.redoBtn.disabled = this.redoStack.length === 0 || isInteracting;
        this.ui.saveBtn.disabled = isInteracting || !hasMultiplePoints;
        this.ui.loadBtn.disabled = isInteracting || isRecording || isPlaying;
        this.ui.clearBtn.disabled = isInteracting || isRecording || isPlaying;
        this.ui.deleteSelectedWaypointsBtn.disabled = isInteracting || !hasPath || isRecording || isPlaying || isCyclingWaypoints;
        this.ui.switchViewBtn.disabled = isInteracting;
        this.ui.rovSpeed.disabled = isInteracting || isPlaying;
        this.ui.fullscreenBtn.disabled = isInteracting;

        this.ui.recordBtn.textContent = isRecording ? 'Pause' : 'Record';
        this.ui.playBtn.textContent = isPlaying && !isReversed ? (isPlaybackPaused ? 'Resume' : 'Pause') : 'Play';
        this.ui.playBackwardsBtn.textContent = isPlaying && isReversed ? (isPlaybackPaused ? 'Resume' : 'Pause') : 'Play Backwards';
        this.ui.editPathBtn.textContent = isEditingPath ? 'Stop Editing' : 'Edit Path';
        this.ui.editPathBtn.classList.toggle('active', isEditingPath);
        this.ui.cycleWaypointsBtn.classList.toggle('active', isCyclingWaypoints);
        this.ui.switchViewBtn.textContent = cameraMode === 'ORBIT' ? 'Switch to POV' : cameraMode === 'POV' ? 'Switch to Free' : 'Switch to Orbit';
        this.ui.freeViewBtn.classList.toggle('active', cameraMode === 'FREE');
        
        this.ui.minimapContainer.style.display = minimapVisible ? 'block' : 'none';
        this.ui.minimapToggleMenuBtn.textContent = minimapVisible ? 'Hide Minimap' : 'Show Minimap';
        this.ui.minimapFollow.textContent = minimapFollow ? 'Fixed' : 'Follow';
        this.ui.minimapFollow.classList.toggle('active', minimapFollow);

        this.ui.editModeFreeBtn.classList.toggle('active', editModeConstraint === 'free');
        this.ui.editModeHorizontalBtn.classList.toggle('active', editModeConstraint === 'horizontal');
        this.ui.editModeVerticalBtn.classList.toggle('active', editModeConstraint === 'vertical');
        
        this.ui.fpvToggleMenuBtn.textContent = fpvVisible ? 'Hide FPV' : 'Show FPV';
        const fpvContainer = document.getElementById('fpv-container');
        fpvContainer.style.display = fpvVisible ? 'block' : 'none';

        this.ui.fpvSwitchMainBtn.textContent = this.state.fpvMainView ? 'Switch to Third Person' : 'Switch to Main View';

        if (rebuildList) {
            this.ui.waypointList.innerHTML = '';
            if(this.path.length === 0) {
                this.ui.waypointList.innerHTML = 'None';
            } else {
                this.path.forEach((p, i) => this.addListItem(
                    this.ui.waypointList,
                    `WP ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`,
                    i
                ));
            }
        }
        
        const propEditControls = document.getElementById('proportional-edit-controls');
        if (propEditControls) {
            propEditControls.style.display = (isEditingPath && !document.getElementById('controls-panel').classList.contains('hidden')) ? 'block' : 'none';
        }
        
        if (isEditingPath && this.path.length > 0) {
            this.ui.extendPathControls.style.display = 'block';
            this.ui.extendPathBtn.disabled = isInteracting || this.state.isExtendingPath;
            this.ui.extendPathMode.value = this.state.extendMode;
        } else {
            this.ui.extendPathControls.style.display = 'none';
        }
        this.ui.editPathCoordsBtn.style.display = this.path.length > 0 ? 'inline-block' : 'none';
    }
    
    updatePathVisuals(isDragging = false) {
        if (this.pathLine) {
            this.scene.remove(this.pathLine);
            this.pathLine.geometry.dispose();
            this.pathLine.material.dispose();
            this.pathLine = null;
        }
        this.pathCurve = null;

        if (this.path.length >= 2) {
            let origin = new THREE.Vector3();
            if (document.getElementById('pathRotatePanel')?.style.display === 'block') {
                const idx = this.rotationOriginIndex || 0;
                if (this.path[idx]) origin.copy(this.path[idx]);
                else for (const p of this.path) origin.add(p).divideScalar(this.path.length);
            } else {
                for (const p of this.path) origin.add(p);
                origin.divideScalar(this.path.length);
            }
            const qGlobal = new THREE.Quaternion().setFromEuler(this.pathGlobalRotation);
            const rotatedPoints = this.path.map(p => p.clone().sub(origin).applyQuaternion(qGlobal).add(origin));
            const geometry = new THREE.BufferGeometry().setFromPoints(rotatedPoints);
            const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
            this.pathLine = new THREE.Line(geometry, material);
            this.scene.add(this.pathLine);

            this.pathCurve = new THREE.CatmullRomCurve3(rotatedPoints);
        }

        if (!isDragging) {
            this.updateEditHelpers();
        }

        this.updateUI(!this.state.isEditingWaypoint);
    }

    updateStatus(message) {
        this.ui.statusBar.textContent = message;
    }

    updateCoordinateDisplay() {
        let position;
        if (this.state.cameraMode === 'FREE') {
            position = this.camera.position;
        } else {
            position = this.rov.position;
        }
        const { x, y, z } = position;
        this.ui.coordsBar.textContent = `X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}, Z: ${z.toFixed(2)}`;
    }

    updateMinimap() {
        if (!this.state.minimapVisible) return;
        
        const ctx = this.minimapCtx;
        const { size, padding, worldSize } = this.minimapSettings;
        
        ctx.clearRect(0, 0, size, size);
        
        let centerX, centerZ;
        if (this.state.minimapFollow) {
            const targetPos = this.state.cameraMode === 'FREE' ? this.camera.position : this.rov.position;
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
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = -worldSize/2; i <= worldSize/2; i += 20) {
            const pos1 = worldToMinimap(i, -worldSize/2);
            const pos2 = worldToMinimap(i, worldSize/2);
            ctx.beginPath(); ctx.moveTo(pos1.x, pos1.y); ctx.lineTo(pos2.x, pos2.y); ctx.stroke();
            const pos3 = worldToMinimap(-worldSize/2, i);
            const pos4 = worldToMinimap(worldSize/2, i);
            ctx.beginPath(); ctx.moveTo(pos3.x, pos3.y); ctx.lineTo(pos4.x, pos4.y); ctx.stroke();
        }
        
        if (this.path.length > 1) {
            ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2; ctx.beginPath();
            const firstPoint = worldToMinimap(this.path[0].x, this.path[0].z);
            ctx.moveTo(firstPoint.x, firstPoint.y);
            for (let i = 1; i < this.path.length; i++) {
                const point = worldToMinimap(this.path[i].x, this.path[i].z);
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
        }
        
        const rovPos = worldToMinimap(this.rov.position.x, this.rov.position.z);
        ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(rovPos.x, rovPos.y, 6, 0, Math.PI * 2); ctx.fill();
        
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rov.quaternion);
        const directionEnd = worldToMinimap(this.rov.position.x + direction.x * 5, this.rov.position.z + direction.z * 5);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rovPos.x, rovPos.y); ctx.lineTo(directionEnd.x, directionEnd.y); ctx.stroke();
        
        if (this.state.cameraMode === 'FREE') {
            const cameraPos = worldToMinimap(this.camera.position.x, this.camera.position.z);
            ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(cameraPos.x, cameraPos.y, 4, 0, Math.PI * 2); ctx.fill();
        }
        
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, size, size);
    }

    selectPoint(index) {
        if (this.interactionData.selectedPointIndex !== null && this.interactionData.selectedPointIndex < this.editHelpers.children.length) {
            this.editHelpers.children[this.interactionData.selectedPointIndex].material = this.editHelperMaterials.normal;
        }
        const oldListItem = document.querySelector('.list-item.highlighted');
        if (oldListItem) oldListItem.classList.remove('highlighted');
        this.interactionData.selectedPointIndex = index;
        this.interactionData.cycleIndex = index;
        if (index !== null && index < this.editHelpers.children.length) {
            this.editHelpers.children[index].material = this.editHelperMaterials.selected;
            const newListItem = document.getElementById(`waypoint-item-${index}`);
            if (newListItem) {
                newListItem.classList.add('highlighted');
                newListItem.scrollIntoView({ block: 'nearest' });
            }
            this.updateStatus(`Point ${index} selected. Use WASD/Arrows to move or drag the 3D widget.`);
            
            if (this.transformControls) {
                this.transformControls.detach();
                this.transformControls.visible = true;
                this.transformControls.attach(this.editHelpers.children[index]);
                this.transformControls.setMode(this.gizmoMode);
            }
        }
    }

    deselectPoint() {
        if (this.interactionData.selectedPointIndex !== null && this.interactionData.selectedPointIndex < this.editHelpers.children.length) {
            this.editHelpers.children[this.interactionData.selectedPointIndex].material = this.editHelperMaterials.normal;
        }
        const oldListItem = document.querySelector('.list-item.highlighted');
        if (oldListItem) oldListItem.classList.remove('highlighted');
        this.interactionData.selectedPointIndex = null;
        this.interactionData.cycleIndex = -1;
        
        if (this.transformControls) {
            this.transformControls.detach();
            this.transformControls.visible = false;
        }
        if (this.state.isEditingPath) this.updateStatus('Path editing enabled.');
    }

    onWindowResize() {
        this.camera.aspect = this.sceneContainer.clientWidth / this.sceneContainer.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.sceneContainer.clientWidth, this.sceneContainer.clientHeight);
    }
    
    addListItem(listElement, text, waypointIndex) {
        const item = document.createElement('div');
        item.className = 'list-item';
        if (waypointIndex !== null && waypointIndex !== undefined) {
            item.id = `waypoint-item-${waypointIndex}`;
            item.addEventListener('mouseenter', () => {
                if (this.state.isEditingPath) {
                    const helper = this.editHelpers.children[waypointIndex];
                    if (helper && this.interactionData.selectedPointIndex !== waypointIndex) helper.material = this.editHelperMaterials.highlight;
                }
            });
            item.addEventListener('mouseleave', () => {
                if (this.state.isEditingPath) {
                    const helper = this.editHelpers.children[waypointIndex];
                    if (helper && this.interactionData.selectedPointIndex !== waypointIndex) helper.material = this.editHelperMaterials.normal;
                }
            });
            item.addEventListener('click', (e) => {
                if (this.state.isEditingPath && e.target.type !== 'checkbox' && e.target.tagName.toLowerCase() !== 'button' && e.target.tagName.toLowerCase() !== 'input') {
                    this.selectPoint(waypointIndex);
                }
            });
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox'; checkbox.dataset.waypointIndex = waypointIndex; checkbox.style.marginRight = '10px';
            item.appendChild(checkbox);
        }
        const textSpan = document.createElement('span');
        textSpan.textContent = text; textSpan.style.flexGrow = '1'; textSpan.style.marginRight = '5px';
        item.appendChild(textSpan);

        if (waypointIndex !== null) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit'; editBtn.style.padding = '2px 6px';
            editBtn.addEventListener('click', () => this.enterWaypointEditMode(item, waypointIndex));
            item.appendChild(editBtn);
        }
        listElement.appendChild(item);
    }

    enterWaypointEditMode(item, index) {
        if (this.state.isEditingWaypoint) return;
        this.state.isEditingWaypoint = true;
        this.updateUI(false); 

        const point = this.path[index];
        item.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%;">
                <span style="margin-right: 5px;">${index}:</span>
                <input type="number" value="${point.x.toFixed(2)}" style="width: 50px;" data-axis="x">
                <input type="number" value="${point.y.toFixed(2)}" style="width: 50px;" data-axis="y">
                <input type="number" value="${point.z.toFixed(2)}" style="width: 50px;" data-axis="z">
                <button class="save-wp-btn" style="padding: 2px 4px; margin-left: 5px;">Save</button>
            </div>`;
        
        item.querySelector('.save-wp-btn').addEventListener('click', () => {
            const newX = parseFloat(item.querySelector('input[data-axis="x"]').value);
            const newY = parseFloat(item.querySelector('input[data-axis="y"]').value);
            const newZ = parseFloat(item.querySelector('input[data-axis="z"]').value);
            
            if (!isNaN(newX) && !isNaN(newY) && !isNaN(newZ)) {
                this.saveStateForUndo();
                this.path[index].set(newX, newY, newZ);
                this.updatePathVisuals();
            }
            
            this.state.isEditingWaypoint = false;
            this.updateUI();
        });
    }
    
    updateEditHelpers() {
        while (this.editHelpers.children.length > 0) {
            const child = this.editHelpers.children[0];
            this.editHelpers.remove(child);
        }
        this.interactionData.hoveredHelper = null;
        if (!this.state.isEditingPath) {
            this.deselectPoint();
            return;
        }
        const helperGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        
        let origin = new THREE.Vector3();
        if (document.getElementById('pathRotatePanel')?.style.display === 'block') {
            const idx = this.rotationOriginIndex || 0;
            if (this.path[idx]) origin.copy(this.path[idx]);
            else for (const p of this.path) origin.add(p).divideScalar(this.path.length);
        } else {
            for (const p of this.path) origin.add(p);
            origin.divideScalar(this.path.length);
        }
        const qGlobal = new THREE.Quaternion().setFromEuler(this.pathGlobalRotation);
        this.path.forEach((point, i) => {
            let material = this.editHelperMaterials.normal;
            if (i === this.interactionData.selectedPointIndex) material = this.editHelperMaterials.selected;
            
            let pos = point.clone().sub(origin).applyQuaternion(qGlobal).add(origin);
            const helper = new THREE.Mesh(helperGeometry, material);
            helper.position.copy(pos);
            
            if (point.rotation) {
                const qLocal = new THREE.Quaternion().setFromEuler(point.rotation);
                helper.quaternion.copy(qGlobal).multiply(qLocal);
            }
            this.editHelpers.add(helper);
        });
        
        if (this.interactionData.selectedPointIndex !== null && this.transformControls) {
            const idx = this.interactionData.selectedPointIndex;
            if (idx < this.editHelpers.children.length) {
                this.transformControls.detach();
                this.transformControls.visible = true;
                this.transformControls.attach(this.editHelpers.children[idx]);
                this.transformControls.setMode(this.gizmoMode);
            } else {
                this.transformControls.detach();
                this.transformControls.visible = false;
            }
        } else if (this.transformControls) {
            this.transformControls.detach();
            this.transformControls.visible = false;
        }
    }

    saveData() {
        let centroid = new THREE.Vector3();
        if (this.path.length > 0) {
            for (const p of this.path) centroid.add(p);
            centroid.divideScalar(this.path.length);
        }
        const qGlobal = new THREE.Quaternion().setFromEuler(this.pathGlobalRotation);
        const data = this.path.map((p, i) => {
            let roll = 0, pitch = 0, yaw = 0;
            let pos = p.clone().sub(centroid).applyQuaternion(qGlobal).add(centroid);
            if (p.rotation) {
                const qLocal = new THREE.Quaternion().setFromEuler(p.rotation);
                const qFinal = qGlobal.clone().multiply(qLocal);
                const eFinal = new THREE.Euler().setFromQuaternion(qFinal);
                roll = eFinal.x;
                pitch = eFinal.y;
                yaw = eFinal.z;
            }
            return {
                Name: `waypoint${i}`,
                pose_x: pos.x,
                pose_y: pos.y,
                pose_z: pos.z,
                roll: roll,
                pitch: pitch,
                yaw: yaw,
                wait_time: 0.0,
                speed: 0.2
            };
        });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `rov-path-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.updateStatus('Data saved.');
    }

    loadData(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                this.handleClear(); 
                const data = JSON.parse(e.target.result);
                
                if (Array.isArray(data) && data.length > 0 && 'pose_x' in data[0]) {
                    this.path = data.map(wp => {
                        const v = new THREE.Vector3(wp.pose_x, wp.pose_y, wp.pose_z);
                        v.rotation = new THREE.Euler(
                            wp.roll || 0,
                            wp.pitch || 0,
                            wp.yaw || 0
                        );
                        return v;
                    });
                } else if (data.path) {
                    this.path = data.path.map(p => {
                        const v = new THREE.Vector3(p[0], p[1], p[2]);
                        if (p.rotation) v.rotation = new THREE.Euler(p.rotation.x, p.rotation.y, p.rotation.z);
                        return v;
                    });
                } else if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
                    this.path = data.map(p => new THREE.Vector3(p[0], p[1], p[2]));
                }
                this.updatePathVisuals();
                this.updateStatus('Data loaded successfully.');
            } catch (error) {
                this.updateStatus('Error: Could not load or parse file.');
                console.error(error);
            }
        };
        reader.readAsText(file);
        this.ui.loadInput.value = '';
    }

    updateSpeedDisplay(value) {
        this.ui.speedValue.textContent = `${parseFloat(value).toFixed(2)}x`;
    }

    toggleMinimap() {
        this.state.minimapVisible = !this.state.minimapVisible;
        this.updateUI();
    }

    toggleMinimapFollow() {
        this.state.minimapFollow = !this.state.minimapFollow;
        this.updateUI();
    }

    handleFullscreen() {
        const elem = document.documentElement;
        if (!document.fullscreenElement) {
            if (elem.requestFullscreen) elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
            else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            else if (document.msExitFullscreen) document.msExitFullscreen();
        }
    }

    cycleEditModeConstraint() {
        const modes = ['free', 'horizontal', 'vertical'];
        let current = modes.indexOf(this.state.editModeConstraint);
        current = (current + 1) % modes.length;
        this.handleEditModeChange(modes[current]);
    }
    
    toggleFPV() {
        this.state.fpvVisible = !this.state.fpvVisible;
        this.updateUI();
    }

    toggleFPVMainView() {
        this.state.fpvMainView = !this.state.fpvMainView;
        this.updateUI();
    }

    updateFPVCamera() {
        const fpvOffset = new THREE.Vector3(0, 0, -0.95);
        const fpvWorldPos = this.rov.localToWorld(fpvOffset.clone());
        this.fpvCamera.position.copy(fpvWorldPos);
        
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rov.quaternion);
        this.fpvCamera.lookAt(fpvWorldPos.clone().add(forward));
        this.fpvCamera.up.set(0, 1, 0);
    }

    handleExtendPath() {
        if (this.state.isExtendingPath) {
            this.state.isExtendingPath = false;
            this.orbitControls.enabled = true;
            this.updateStatus('Extend Path cancelled.');
        } else {
            this.state.isExtendingPath = true;
            this.orbitControls.enabled = false;
            this.updateStatus('Click and drag to extend the path.');
        }
        this.updateUI();
    }

    interpolateWaypoints(start, end, minDist = 0.2) {
        const points = [];
        const dist = start.distanceTo(end);
        const steps = Math.max(1, Math.floor(dist / minDist));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            points.push(new THREE.Vector3().lerpVectors(start, end, t));
        }
        return points;
    }

    handleRedo() {
        if (this.redoStack.length > 0) {
            const nextState = this.redoStack.pop();
            
            const pathCopy = this.path.map(p => p.clone());
            this.history.push({ path: pathCopy });

            this.path = nextState.path.map(p => p.clone());
            
            this.deselectPoint();
            this.updatePathVisuals();
            this.updateUI();
            this.updateStatus('Redo successful.');
        } else {
            this.updateStatus('Nothing to redo.');
        }
    }

    toggleGizmoMode() {
        if (!this.transformControls) return;
        if (this.gizmoMode === 'translate') {
            this.gizmoMode = 'rotate';
            this.transformControls.setMode('rotate');
            document.getElementById('gizmoModeBtn').textContent = 'Switch Gizmo Mode (Rotate/Move)';
        } else {
            this.gizmoMode = 'translate';
            this.transformControls.setMode('translate');
            document.getElementById('gizmoModeBtn').textContent = 'Switch Gizmo Mode (Move/Rotate)';
        }
    }

    toggleRotatePathPanel() {
        const panel = document.getElementById('pathRotatePanel');
        const rotationOriginSelect = document.getElementById('rotationOriginSelect');
        if (panel.style.display === 'block') {
            if (this.path.length > 0 && (this.pathGlobalRotation.x !== 0 || this.pathGlobalRotation.y !== 0 || this.pathGlobalRotation.z !== 0)) {
                let origin = new THREE.Vector3();
                const idx = parseInt(rotationOriginSelect.value, 10);
                if (!isNaN(idx) && idx >= 0 && idx < this.path.length) {
                    origin.copy(this.path[idx]);
                } else {
                    for (const p of this.path) origin.add(p);
                    origin.divideScalar(this.path.length);
                }
                const qGlobal = new THREE.Quaternion().setFromEuler(this.pathGlobalRotation);
                for (let i = 0; i < this.path.length; i++) {
                    this.path[i].sub(origin).applyQuaternion(qGlobal).add(origin);
                    if (this.path[i].rotation) {
                        const qLocal = new THREE.Quaternion().setFromEuler(this.path[i].rotation);
                        qLocal.premultiply(qGlobal);
                        this.path[i].rotation.setFromQuaternion(qLocal);
                    }
                }
                this.pathGlobalRotation.set(0, 0, 0);
                this.updatePathVisuals();
            }
            
            if (this._wasEditingPathBeforeRotatePath) {
                this.state.isEditingPath = true;
                this.updateEditHelpers();
            } else {
                this.state.isEditingPath = false;
                this.updateEditHelpers();
            }
            panel.style.display = 'none';
        } else {
            this._wasEditingPathBeforeRotatePath = this.state.isEditingPath;
            
            if (!this.state.isEditingPath) {
                this.state.isEditingPath = true;
                this.updateEditHelpers();
            }
            
            document.getElementById('pathRotX').value = THREE.MathUtils.radToDeg(this.pathGlobalRotation.x).toFixed(1);
            document.getElementById('pathRotY').value = THREE.MathUtils.radToDeg(this.pathGlobalRotation.y).toFixed(1);
            document.getElementById('pathRotZ').value = THREE.MathUtils.radToDeg(this.pathGlobalRotation.z).toFixed(1);
            document.getElementById('pathRotXSlider').value = Math.round(THREE.MathUtils.radToDeg(this.pathGlobalRotation.x));
            document.getElementById('pathRotYSlider').value = Math.round(THREE.MathUtils.radToDeg(this.pathGlobalRotation.y));
            document.getElementById('pathRotZSlider').value = Math.round(THREE.MathUtils.radToDeg(this.pathGlobalRotation.z));
            
            rotationOriginSelect.innerHTML = '';
            for (let i = 0; i < this.path.length; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `Waypoint ${i} (${this.path[i].x.toFixed(2)}, ${this.path[i].y.toFixed(2)}, ${this.path[i].z.toFixed(2)})`;
                rotationOriginSelect.appendChild(opt);
            }
            rotationOriginSelect.value = this.rotationOriginIndex || 0;
            rotationOriginSelect.onchange = (e) => {
                this.rotationOriginIndex = parseInt(e.target.value, 10);
                this.updatePathVisuals();
            };
            panel.style.display = 'block';
        }
    }

    updatePathGlobalRotation(axis, value, fromSlider = false) {
        const numericValue = parseFloat(value);
        if (!isNaN(numericValue)) {
            this.pathGlobalRotation[axis] = THREE.MathUtils.degToRad(numericValue);
            
            if (fromSlider) {
                document.getElementById('pathRot' + axis.toUpperCase()).value = numericValue.toFixed(1);
            } else {
                document.getElementById('pathRot' + axis.toUpperCase() + 'Slider').value = Math.round(numericValue);
            }
            this.updatePathVisuals();
        }
    }

    incrementPathGlobalRotation(axis, deltaDeg) {
        let currentDeg = THREE.MathUtils.radToDeg(this.pathGlobalRotation[axis]);
        currentDeg += deltaDeg;
        this.pathGlobalRotation[axis] = THREE.MathUtils.degToRad(currentDeg);
        document.getElementById('pathRot' + axis.toUpperCase()).value = currentDeg.toFixed(1);
        document.getElementById('pathRot' + axis.toUpperCase() + 'Slider').value = Math.round(currentDeg);
        this.updatePathVisuals();
    }

    resetPathGlobalRotation() {
        this.pathGlobalRotation.set(0, 0, 0);
        document.getElementById('pathRotX').value = '0.0';
        document.getElementById('pathRotY').value = '0.0';
        document.getElementById('pathRotZ').value = '0.0';
        document.getElementById('pathRotXSlider').value = '0';
        document.getElementById('pathRotYSlider').value = '0';
        document.getElementById('pathRotZSlider').value = '0';
        this.updatePathVisuals();
    }
}

// --- GO! ---
window.addEventListener('load', () => new ROVPlanner());