import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

console.log('RoGold Studio: studio.js loaded successfully');
console.log('RoGold Studio: THREE available:', typeof THREE);
console.log('RoGold Studio: OrbitControls available:', typeof OrbitControls);

// ===== PHYSICS BODY MANAGER =====

class PhysicsBodyManager {
    constructor(physicsWorld) {
        this.physicsWorld = physicsWorld;
        this.bodies = new Map(); // instance -> body mapping
    }

    createBody(instance) {
        console.log(`[PHYSICS] Creating body for ${instance.Name}: Anchored=${instance.Anchored}, CanCollide=${instance.CanCollide}, Size=${instance.Size.toArray()}`);
        if (!instance.threeObject || !this.physicsWorld) {
            console.log(`[PHYSICS] Cannot create body: threeObject=${!!instance.threeObject}, physicsWorld=${!!this.physicsWorld}`);
            return null;
        }

        // Remove existing body if any
        this.destroyBody(instance);

        const shape = new CANNON.Box(new CANNON.Vec3(
            instance.Size.x / 2,
            instance.Size.y / 2,
            instance.Size.z / 2
        ));

        let bodyType = CANNON.Body.KINEMATIC;
        let mass = 0;

        // Determine body type based on Anchored and CanCollide
        if (!instance.Anchored) {
            if (instance.CanCollide) {
                bodyType = CANNON.Body.DYNAMIC;
                mass = instance.Mass || 1; // Default mass
            } else {
                // Non-collidable unanchored parts are still dynamic but don't collide
                bodyType = CANNON.Body.DYNAMIC;
                mass = instance.Mass || 1;
            }
        } else {
            // Anchored parts are kinematic (can be either kinematic or static based on context)
            // For now, treat all anchored parts as kinematic for consistency
            bodyType = CANNON.Body.KINEMATIC;
            mass = 0;
        }

        console.log(`[PHYSICS] Body type: ${bodyType === CANNON.Body.DYNAMIC ? 'DYNAMIC' : bodyType === CANNON.Body.KINEMATIC ? 'KINEMATIC' : 'STATIC'}, mass: ${mass}`);

        const body = new CANNON.Body({
            type: bodyType,
            mass: mass,
            position: new CANNON.Vec3(
                instance.Position.x,
                instance.Position.y,
                instance.Position.z
            ),
            shape: shape
        });

        // Set material properties
        const material = new CANNON.Material({
            friction: instance.Friction || 0.4,
            restitution: instance.Restitution || 0.3
        });
        body.material = material;

        // Set collision filters based on CanCollide property
        if (!instance.CanCollide) {
            body.collisionFilterGroup = 2; // Non-collidable group
            body.collisionFilterMask = 0; // Don't collide with anything
            console.log(`[PHYSICS] Set collision filters: group=2, mask=0 (non-collidable)`);
        } else {
            body.collisionFilterGroup = 1; // Collidable group
            body.collisionFilterMask = -1; // Collide with everything
            console.log(`[PHYSICS] Set collision filters: group=1, mask=-1 (collidable)`);
        }

        this.physicsWorld.addBody(body);
        this.bodies.set(instance, body);
        instance.cannonBody = body;

        console.log(`[PHYSICS] Body created successfully for ${instance.Name}`);
        return body;
    }

    updateBody(instance) {
        const body = this.bodies.get(instance);
        if (!body || !instance.threeObject) return;

        // Update position and rotation from Three.js object
        body.position.copy(instance.threeObject.position);
        body.quaternion.copy(instance.threeObject.quaternion);

        // Update shape if size changed
        if (body.shapes && body.shapes.length > 0) {
            const shape = body.shapes[0];
            if (shape instanceof CANNON.Box) {
                shape.halfExtents.set(
                    instance.Size.x / 2,
                    instance.Size.y / 2,
                    instance.Size.z / 2
                );
                body.updateBoundingRadius();
                body.aabbNeedsUpdate = true;
            }
        }

        // Update material properties
        if (body.material) {
            body.material.friction = instance.Friction || 0.4;
            body.material.restitution = instance.Restitution || 0.3;
        }

        // Set collision filters based on CanCollide property
        if (!instance.CanCollide) {
            body.collisionFilterGroup = 2; // Non-collidable group
            body.collisionFilterMask = 0; // Don't collide with anything
        } else {
            body.collisionFilterGroup = 1; // Collidable group
            body.collisionFilterMask = -1; // Collide with everything
        }

        // Update body type and mass
        if (!instance.Anchored) {
            if (instance.CanCollide) {
                body.type = CANNON.Body.DYNAMIC;
                body.mass = instance.Mass || 1;
                body.updateMassProperties();
            } else {
                body.type = CANNON.Body.DYNAMIC;
                body.mass = instance.Mass || 1;
                body.updateMassProperties();
            }
        } else {
            // Anchored parts are kinematic (can be either kinematic or static based on context)
            // For now, treat all anchored parts as kinematic for consistency
            body.type = CANNON.Body.KINEMATIC;
            body.mass = 0;
            body.updateMassProperties();
        }
    }

    destroyBody(instance) {
        const body = this.bodies.get(instance);
        if (body && this.physicsWorld) {
            this.physicsWorld.removeBody(body);
            this.bodies.delete(instance);
            instance.cannonBody = null;
        }
    }

    syncToThreeJS() {
        // Sync physics bodies back to Three.js objects
        this.bodies.forEach((body, instance) => {
            if (instance.threeObject && body.type !== CANNON.Body.KINEMATIC) {
                const oldPos = instance.threeObject.position.clone();
                instance.threeObject.position.copy(body.position);
                instance.threeObject.quaternion.copy(body.quaternion);
                instance.Position = instance.threeObject.position.clone();
                instance.Rotation = new THREE.Euler().setFromQuaternion(instance.threeObject.quaternion);

                // Log position changes for debugging
                if (!oldPos.equals(instance.threeObject.position)) {
                    console.log(`[PHYSICS] Synced ${instance.Name} position: ${oldPos.toArray()} -> ${instance.threeObject.position.toArray()}`);
                }
            }
        });
    }
}

// ===== ROBLOX INSTANCE CLASS =====

class RobloxInstance {
    constructor(className, name) {
        this.ClassName = className;
        this.Name = name;
        this.Parent = null;
        this.Children = [];
        this.threeObject = null;
        this.cannonBody = null;
        this.isScriptCreated = false;

        // Roblox properties
        this.Anchored = true;
        this.CanCollide = true;
        this.Size = new THREE.Vector3(4, 2, 2);
        this.Position = new THREE.Vector3(0, 5, 0);
        this.Rotation = new THREE.Euler(0, 0, 0);
        this.Color = new THREE.Color(0.5, 0.5, 0.5);
        this.Transparency = 0;
        this.spinning = false;
        this.spinAxis = new THREE.Vector3(0, 1, 0); // Default spin axis (Y)

        // Physics properties
        this.Mass = 1;
        this.Friction = 0.4;
        this.Restitution = 0.3;

        // Event connections
        this.touchedConnections = [];
    }

    // Roblox-like methods
    Spin(axis) {
        this.spinning = true;
        // Accept THREE.Vector3, Roblox-like object {X,Y,Z}, array, or string
        if (axis instanceof THREE.Vector3) {
            this.spinAxis = axis.clone().normalize();
        } else if (axis && typeof axis === 'object' && ('X' in axis || 'x' in axis)) {
            const x = axis.X ?? axis.x ?? 0;
            const y = axis.Y ?? axis.y ?? 0;
            const z = axis.Z ?? axis.z ?? 0;
            this.spinAxis = new THREE.Vector3(x, y, z).normalize();
        } else if (Array.isArray(axis)) {
            this.spinAxis = new THREE.Vector3(axis[0] || 0, axis[1] || 0, axis[2] || 0).normalize();
        }
        addOutput(`${this.Name} is now spinning around axis ${this.spinAxis.toArray()}!`, 'success');
    }

    Destroy() {
        // Remove from parent
        if (this.Parent) {
            this.Parent.Children = this.Parent.Children.filter(child => child !== this);
        }

        // Remove from scene
        if (this.threeObject && this.threeObject.parent) {
            this.threeObject.parent.remove(this.threeObject);
        }

        // Remove physics body through manager
        if (RobloxEnvironment.physicsBodyManager) {
            RobloxEnvironment.physicsBodyManager.destroyBody(this);
        }

        // Clean up children
        this.Children.forEach(child => child.Destroy());
    }

    Clone() {
        const clone = new RobloxInstance(this.ClassName, this.Name + '_Clone');
        clone.Size = this.Size.clone();
        clone.Position = this.Position.clone();
        clone.Rotation = this.Rotation.clone();
        clone.Color = this.Color.clone();
        clone.Transparency = this.Transparency;
        clone.Anchored = this.Anchored;
        clone.CanCollide = this.CanCollide;
        return clone;
    }

    // Get descendants
    GetDescendants() {
        const descendants = [];
        this.Children.forEach(child => {
            descendants.push(child);
            descendants.push(...child.GetDescendants());
        });
        return descendants;
    }

    // Find first child by name
    FindFirstChild(name) {
        return this.Children.find(child => child.Name === name);
    }

    // Wait for child (simplified)
    WaitForChild(name) {
        return this.FindFirstChild(name);
    }
}

// ===== ROBLOX STUDIO ENVIRONMENT =====

// Studio state
let scene, camera, renderer, controls;
let audioListener;
let luaObjects = {};
let currentTab = 'script';
let selectedToolboxItem = null;
let isPlacingPart = false;
let selectedObjects = new Set();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let placementPreview = null;
let isDragging = false;
let dragStartPos = new THREE.Vector2();
let dragPlane = new THREE.Plane();
let transformMode = null; // 'move', 'rotate', or 'scale'

// Transformation gizmos
let moveGizmo = null;
let rotateGizmo = null;
let scaleGizmo = null;
let activeGizmo = null;
let gizmoHandles = [];
let activeGizmoHandle = null;
let gizmoDragAxis = null;
let gizmoDragType = null;
let gizmoDragStart = new THREE.Vector3();

// Roblox Services and Environment
let RobloxEnvironment = {
    Workspace: null,
    Lighting: null,
    Players: null,
    ReplicatedStorage: null,
    ServerStorage: null,
    ServerScriptService: null,
    RunService: null,
    TweenService: null,
    game: null,

    // Global variables
    _G: {},
    shared: {},
    script: null,
    workspace: null,

    // Event system
    events: {},
    connections: [],

    // Game loop
    running: false,
    gameLoopId: null,
    scripts: new Map(), // scriptId -> {source, environment, running}
    currentScriptId: null,

    // Physics system
    physicsWorld: null,
    physicsBodyManager: null,

    // Add wait function to RobloxEnvironment
    wait: function(seconds = 0.03) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        });
    }
};

// Initialize studio
document.addEventListener('DOMContentLoaded', () => {
    initStudio();
    setupEventListeners();
});

function initializeRobloxEnvironment() {
    console.log('RoGold Studio: Initializing Roblox Environment...');

    // Initialize physics world
    console.log('[PHYSICS] Creating physics world with gravity (0, -196.2, 0)');
    RobloxEnvironment.physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, -196.2, 0)
    });

    // Initialize physics body manager
    console.log('[PHYSICS] Creating physics body manager');
    RobloxEnvironment.physicsBodyManager = new PhysicsBodyManager(RobloxEnvironment.physicsWorld);

    // Create services
    RobloxEnvironment.Workspace = new RobloxInstance('Workspace', 'Workspace');
    RobloxEnvironment.Workspace.Children = [];
    RobloxEnvironment.Workspace.ClassName = 'Workspace';

    RobloxEnvironment.Lighting = new RobloxInstance('Lighting', 'Lighting');
    RobloxEnvironment.Lighting.ClassName = 'Lighting';

    RobloxEnvironment.Players = new RobloxInstance('Players', 'Players');
    RobloxEnvironment.Players.ClassName = 'Players';

    RobloxEnvironment.ReplicatedStorage = new RobloxInstance('ReplicatedStorage', 'ReplicatedStorage');
    RobloxEnvironment.ReplicatedStorage.ClassName = 'ReplicatedStorage';

    RobloxEnvironment.ServerStorage = new RobloxInstance('ServerStorage', 'ServerStorage');
    RobloxEnvironment.ServerStorage.ClassName = 'ServerStorage';

    RobloxEnvironment.ServerScriptService = new RobloxInstance('ServerScriptService', 'ServerScriptService');
    RobloxEnvironment.ServerScriptService.ClassName = 'ServerScriptService';

    RobloxEnvironment.RunService = {
        Heartbeat: {
            Connect: function(callback) {
                // Store callback for heartbeat events
                this._callback = callback;
                return { Disconnect: function() { this._callback = null; } };
            },
            Fire: function(deltaTime) {
                if (this._callback) {
                    this._callback(deltaTime);
                }
            }
        }
    };

    RobloxEnvironment.TweenService = new RobloxInstance('TweenService', 'TweenService');
    RobloxEnvironment.TweenService.ClassName = 'TweenService';

    // Set up global game reference
    RobloxEnvironment.game = {
        Workspace: RobloxEnvironment.Workspace,
        Lighting: RobloxEnvironment.Lighting,
        Players: RobloxEnvironment.Players,
        ReplicatedStorage: RobloxEnvironment.ReplicatedStorage,
        ServerStorage: RobloxEnvironment.ServerStorage,
        ServerScriptService: RobloxEnvironment.ServerScriptService,
        RunService: RobloxEnvironment.RunService,
        TweenService: RobloxEnvironment.TweenService
    };

    // Set up workspace reference
    RobloxEnvironment.workspace = RobloxEnvironment.Workspace;

    console.log('RoGold Studio: Roblox Environment initialized');
}

function initStudio() {
    console.log('RoGold Studio: Initializing studio...');

    // Check if required DOM elements exist
    const requiredElements = [
        'play-btn', 'stop-btn', 'save-btn', 'load-btn', 'back-btn',
        'viewport-canvas', 'output-panel'
    ];

    requiredElements.forEach(id => {
        const element = document.getElementById(id);
        if (!element) {
            console.error(`RoGold Studio: Required element '${id}' not found!`);
        } else {
            console.log(`RoGold Studio: Found element '${id}'`);
        }
    });

    // Initialize Roblox Environment
    initializeRobloxEnvironment();

    // Initialize 3D scene for viewport
    initViewport3D();

    // Set initial tab
    switchTab('viewport');


    // Set default tool to move so gizmos appear when selecting objects
    switchToTool('move');

    console.log('RoGold Studio: Studio initialization complete');
}

function initViewport3D() {
    // Scene setup - match game sky color
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue like the game
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.00025); // Exponential fog like the game

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);

    // Renderer setup
    const canvas = document.getElementById('viewport-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(800, 600);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controls setup
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI;

    // Lighting - match game lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 2); // Brighter ambient like game
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); // Brighter directional like game
    directionalLight.position.set(1, 1, 0.5).normalize();
    directionalLight.castShadow = false; // Game doesn't use shadows
    scene.add(directionalLight);

    // Create all gizmos
    createMoveGizmo();
    createRotateGizmo();
    createScaleGizmo();

    // Add baseplate like the game
    createBaseplate();

    // Add spawn point like the game
    createSpawnPoint();

    // Add skybox like the game
    createSkybox();

    // Grid helper removed

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Set up viewport interaction
    setupViewportInteraction();

    animate();
}

function updateGizmoVisibility() {
    try {
        // Hide all gizmos first
        if (moveGizmo) moveGizmo.visible = false;
        if (rotateGizmo) rotateGizmo.visible = false;
        if (scaleGizmo) scaleGizmo.visible = false;

        // Show the active gizmo if objects are selected and we have a transform mode
        if (selectedObjects.size > 0 && transformMode) {
            // Calculate center position for multi-object selection
            const center = new THREE.Vector3();
            let count = 0;
            selectedObjects.forEach(obj => {
                if (obj.threeObject) {
                    center.add(obj.threeObject.position);
                    count++;
                }
            });
            if (count > 0) {
                center.divideScalar(count);

                if (transformMode === 'move' && moveGizmo) {
                    moveGizmo.position.copy(center);

                    // Update move handle positions to be outside the object
                    if (selectedObjects.size === 1) {
                        const obj = Array.from(selectedObjects)[0];
                        if (obj.Size) {
                            // Position arrow tips outside the object (half size + half arrow length to avoid entering)
                            const xArrow = moveGizmo.children.find(c => c.userData.axis === 'x');
                            if (xArrow) xArrow.position.x = (obj.Size.x / 2) + 1;

                            const yArrow = moveGizmo.children.find(c => c.userData.axis === 'y');
                            if (yArrow) yArrow.position.y = (obj.Size.y / 2) + 1;

                            const zArrow = moveGizmo.children.find(c => c.userData.axis === 'z');
                            if (zArrow) zArrow.position.z = (obj.Size.z / 2) + 1;
                        }
                    }

                    moveGizmo.visible = true;
                } else if (transformMode === 'rotate' && rotateGizmo) {
                    rotateGizmo.position.copy(center);

                    // Update rotate ring positions to be outside the object
                    if (selectedObjects.size === 1) {
                        const obj = Array.from(selectedObjects)[0];
                        if (obj.Size) {
                            // Calculate the maximum half-extent of the object
                            const maxHalfSize = Math.max(obj.Size.x / 2, obj.Size.y / 2, obj.Size.z / 2);
                            // Position rings at distance = max half-size + ring inner radius (9) + margin (1)
                            const ringDistance = maxHalfSize + 9 + 1;

                            // Position rings at calculated distance from center
                            const xRing = rotateGizmo.children.find(c => c.userData.axis === 'x');
                            if (xRing) xRing.position.x = 0; // X ring rotates around Y axis, stays at center

                            const yRing = rotateGizmo.children.find(c => c.userData.axis === 'y');
                            if (yRing) yRing.position.y = 0; // Y ring rotates around X axis, stays at center

                            const zRing = rotateGizmo.children.find(c => c.userData.axis === 'z');
                            if (zRing) zRing.position.z = 0; // Z ring stays at center
                        }
                    }

                    rotateGizmo.visible = true;
                } else if (transformMode === 'scale' && scaleGizmo) {
                    scaleGizmo.position.copy(center);

                    // Update scale handle positions to be outside the object
                    if (selectedObjects.size === 1) {
                        const obj = Array.from(selectedObjects)[0];
                        if (obj.Size) {
                            // Position handles outside the object (half size + half handle size to avoid entering)
                            const xHandle = scaleGizmo.children.find(c => c.userData.axis === 'x');
                            if (xHandle) xHandle.position.x = (obj.Size.x / 2) + 0.5;

                            const yHandle = scaleGizmo.children.find(c => c.userData.axis === 'y');
                            if (yHandle) yHandle.position.y = (obj.Size.y / 2) + 0.5;

                            const zHandle = scaleGizmo.children.find(c => c.userData.axis === 'z');
                            if (zHandle) zHandle.position.z = (obj.Size.z / 2) + 0.5;
                        }
                    }

                    scaleGizmo.visible = true;
                }
            }
        }
    } catch (error) {
        console.error('Error updating gizmo visibility:', error);
        addOutput(`Error updating gizmo visibility: ${error.message}`, 'error');
    }
}

function setupViewportInteraction() {
    const canvas = document.getElementById('viewport-canvas');

    canvas.addEventListener('mousedown', (event) => {
        // Prevent camera movement during any interaction
        event.preventDefault();
        event.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Check for gizmo interaction first - only check handles whose parent gizmo is visible
        raycaster.setFromCamera(mouse, camera);
        const validHandles = gizmoHandles.filter(h => {
            if (!h || !h.handle || !h.handle.parent) return false;
            // Check if the handle's parent gizmo is visible
            return h.handle.parent.visible === true;
        }).map(h => h.handle);
        const gizmoIntersects = raycaster.intersectObjects(validHandles, true);

        if (gizmoIntersects.length > 0) {
            const gizmoHandle = gizmoIntersects[0].object;
            const handleData = gizmoHandles.find(h => h.handle === gizmoHandle);
            if (handleData) {
                startGizmoDrag(handleData, event);
                return;
            }
        }

        // Check for object selection
        const intersects = raycaster.intersectObjects(scene.children, true);
        let selectedObject = null;

        for (const intersect of intersects) {
            let obj = intersect.object;
            while (obj.parent && obj.parent !== scene) {
                obj = obj.parent;
            }

            // Skip gizmos
            if (obj === moveGizmo) continue;

            // Check if this is one of our luaObjects
            for (const [name, luaObj] of Object.entries(luaObjects)) {
                if (luaObj.threeObject === obj) {
                    selectedObject = luaObj;
                    break;
                }
            }
            if (selectedObject) break;
        }

        if (selectedObject) {
            clearObjectSelection();
            selectedObjects.add(selectedObject);
            if (selectedObject.threeObject) {
                selectedObject.threeObject.material.emissive = new THREE.Color(0x444400);
            }
            updateGizmoVisibility();
            updatePropertiesPanel();
            addOutput(`Selected ${selectedObject.Name}`, 'success');
        } else {
            clearObjectSelection();
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update placement preview if placing parts
        if (isPlacingPart) {
            updatePlacementPreview();
        }
    });

    // Document listeners will be added dynamically during dragging

    canvas.addEventListener('click', (event) => {
        if (isPlacingPart && placementPreview && placementPreview.visible) {
            placePartAtMouse();
        }
    });

    // Prevent context menu during interactions
    canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
}

function createBaseplate() {
    const textureLoader = new THREE.TextureLoader();
    const studsTexture = textureLoader.load('studs.png');
    studsTexture.wrapS = THREE.RepeatWrapping;
    studsTexture.wrapT = THREE.RepeatWrapping;
    studsTexture.repeat.set(128, 128);

    const geometry = new THREE.PlaneGeometry(500, 500);
    const material = new THREE.MeshLambertMaterial({ map: studsTexture });
    const baseplate = new THREE.Mesh(geometry, material);
    baseplate.rotation.x = -Math.PI / 2;
    baseplate.receiveShadow = false;
    scene.add(baseplate);

    // Create physics body for baseplate collision
    if (RobloxEnvironment.physicsWorld) {
        console.log('[PHYSICS] Creating static plane body for baseplate');
        const planeShape = new CANNON.Plane();
        const planeBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: planeShape
        });

        // Position at ground level
        planeBody.position.set(0, 0, 0);

        // Rotate to make normal point up (horizontal plane for floor collision)
        planeBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);

        // Set material properties matching parts
        const material = new CANNON.Material({
            friction: 0.4,
            restitution: 0.3
        });
        planeBody.material = material;

        // Set collision filters - collidable with everything
        planeBody.collisionFilterGroup = 1;
        planeBody.collisionFilterMask = -1;

        RobloxEnvironment.physicsWorld.addBody(planeBody);
        console.log('[PHYSICS] Baseplate physics body added to world');
    }
}

function createSpawnPoint() {
    const spawnGroup = new THREE.Group();

    // Create 3D spawn platform
    const spawnGeometry = new THREE.BoxGeometry(10, 0.5, 10);
    const textureLoader = new THREE.TextureLoader();
    const spawnTexture = textureLoader.load('spawn.png');

    const topMaterial = new THREE.MeshLambertMaterial({ map: spawnTexture });
    const sideMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });

    const materials = [
        sideMaterial, // right
        sideMaterial, // left
        topMaterial,  // top
        sideMaterial, // bottom
        sideMaterial, // front
        sideMaterial  // back
    ];

    const spawn = new THREE.Mesh(spawnGeometry, materials);
    spawn.position.y = 0.25;
    spawn.receiveShadow = false;
    spawnGroup.add(spawn);

    scene.add(spawnGroup);
}

function createSkybox() {
    const skyGeometry = new THREE.SphereGeometry(400, 32, 32);
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load('1eprhbtmvoo51.png');
    skyTexture.wrapS = THREE.RepeatWrapping;
    skyTexture.wrapT = THREE.RepeatWrapping;
    skyTexture.repeat.set(1, 1);

    const skyMaterial = new THREE.MeshBasicMaterial({
        map: skyTexture,
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);
}

function updatePlacementPreview() {
    if (!placementPreview) {
        const geometry = new THREE.BoxGeometry(4, 4, 4); // Match the part size
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5,
            wireframe: true
        });
        placementPreview = new THREE.Mesh(geometry, material);
        scene.add(placementPreview);
    }

    // Cast ray to find intersection with ground plane
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    if (intersection) {
        // Free placing - no grid snapping
        const freePosition = intersection.clone();
        freePosition.y = 3; // Place on ground

        placementPreview.position.copy(freePosition);
        placementPreview.visible = true;
    } else {
        placementPreview.visible = false;
    }
}

function selectObjectAtMouse() {
    // First check for gizmo intersections
    raycaster.setFromCamera(mouse, camera);
    const gizmoIntersects = raycaster.intersectObjects(gizmoHandles, true);

    if (gizmoIntersects.length > 0) {
        // Handle gizmo interaction
        const gizmoHandle = gizmoIntersects[0].object;
        let handle = gizmoHandle;

        // Traverse up to find the handle group
        while (handle.parent && handle.parent !== scene && !handle.userData.axis) {
            handle = handle.parent;
        }

        if (handle.userData && handle.userData.axis) {
            startGizmoDrag(handle);
            return true; // Gizmo interaction, not object selection
        }
    }

    // Cast ray to find intersections with objects
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Find the first intersected object that belongs to our luaObjects
    let selectedObject = null;
    for (const intersect of intersects) {
        let obj = intersect.object;
        // Traverse up to find the root object
        while (obj.parent && obj.parent !== scene) {
            obj = obj.parent;
        }

        // Skip gizmos
        if (obj === moveGizmo || obj === rotateGizmo || obj === scaleGizmo || gizmoHandles.includes(obj)) {
            continue;
        }

        // Check if this object belongs to our luaObjects
        for (const [name, luaObj] of Object.entries(luaObjects)) {
            if (luaObj.threeObject === obj) {
                selectedObject = luaObj;
                break;
            }
        }
        if (selectedObject) break;
    }

    if (selectedObject) {
        // Clear previous selection and select this object
        clearObjectSelection();
        selectedObjects.add(selectedObject);
        if (selectedObject.threeObject) {
            selectedObject.threeObject.material.emissive = new THREE.Color(0x444400);
        }
        addOutput(`Selected ${selectedObject.Name}`, 'success');
        updateGizmoVisibility();
        updatePropertiesPanel();
        return true;
    } else {
        // Clear selection if clicking empty space
        clearObjectSelection();
        return false;
    }
}

function clearObjectSelection() {
    selectedObjects.forEach(obj => {
        if (obj.threeObject) {
            obj.threeObject.material.emissive = new THREE.Color(0x000000);
        }
    });
    selectedObjects.clear();
    if (moveGizmo) moveGizmo.visible = false;
    if (rotateGizmo) rotateGizmo.visible = false;
    if (scaleGizmo) scaleGizmo.visible = false;
    updatePropertiesPanel();
}

function deleteSelectedObjects() {
    if (selectedObjects.size === 0) {
        addOutput('No objects selected to delete!', 'error');
        return;
    }

    let deletedCount = 0;
    selectedObjects.forEach(obj => {
        // Remove from scene
        if (obj.threeObject && obj.threeObject.parent) {
            obj.threeObject.parent.remove(obj.threeObject);
        }

        // Remove from workspace
        if (obj.Parent) {
            obj.Parent.Children = obj.Parent.Children.filter(child => child !== obj);
        }

        // Remove from workspace tree
        removeFromWorkspaceTree(obj.Name);

        // Remove from luaObjects
        for (const [name, luaObj] of Object.entries(luaObjects)) {
            if (luaObj === obj) {
                delete luaObjects[name];
                break;
            }
        }

        deletedCount++;
    });

    selectedObjects.clear();
    if (moveGizmo) moveGizmo.visible = false;
    if (rotateGizmo) rotateGizmo.visible = false;
    if (scaleGizmo) scaleGizmo.visible = false;
    addOutput(`Deleted ${deletedCount} object(s)!`, 'success');

    // Play delete sound after deletion completes
    playDeleteSound();
}

function playDeleteSound() {
    console.log('Playing delete sound...');
    // Play the Delete.wav sound file
    const audio = new Audio('Delete.wav');
    audio.volume = 0.5;
    audio.play().then(() => {
        console.log('Delete sound played successfully');
    }).catch(e => {
        console.log('Could not play delete sound:', e);
        // Fallback to synthetic sound if file fails
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
        console.log('Fallback synthetic sound played');
    });
}

function addToWorkspaceTree(objectName, objectType) {
    const workspaceChildren = document.getElementById('workspace-children');
    if (!workspaceChildren) return;

    const item = document.createElement('div');
    item.className = `workspace-item workspace-object ${objectType}`;
    item.textContent = objectName;
    item.dataset.objectName = objectName;
    item.addEventListener('click', () => selectObjectFromWorkspace(objectName));

    workspaceChildren.appendChild(item);
}

function removeFromWorkspaceTree(objectName) {
    const workspaceChildren = document.getElementById('workspace-children');
    if (!workspaceChildren) return;

    const items = workspaceChildren.querySelectorAll('.workspace-item');
    items.forEach(item => {
        if (item.dataset.objectName === objectName) {
            item.remove();
        }
    });
}

function selectObjectFromWorkspace(objectName) {
    const obj = luaObjects[objectName];
    if (!obj) return;

    // Clear previous selection
    document.querySelectorAll('.workspace-item').forEach(item => item.classList.remove('selected'));

    // Select in workspace
    const workspaceItem = document.querySelector(`[data-object-name="${objectName}"]`);
    if (workspaceItem) {
        workspaceItem.classList.add('selected');
    }

    // Select in 3D scene
    clearObjectSelection();
    selectedObjects.add(obj);
    if (obj.threeObject) {
        obj.threeObject.material.emissive = new THREE.Color(0x444400);
    }

    // If it's a script, open it in a dedicated tab
    if (obj.ClassName === 'Script') {
        openScriptTab(obj);
    }

    addOutput(`Selected ${objectName} from workspace`, 'success');
}


function startGizmoDrag(handleData, event) {
    try {
        activeGizmoHandle = handleData.handle;
        gizmoDragAxis = handleData.axis;
        gizmoDragType = handleData.type;
        isDragging = true;
        dragStartPos.set(event.clientX, event.clientY);

        // Set drag plane for move tool
        if (gizmoDragType === 'move') {
            const obj = selectedObjects.values().next().value;
            if (obj && obj.threeObject) {
                dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), obj.threeObject.position);
            }
        }

        // Disable camera controls during gizmo dragging
        if (controls) {
            controls.enabled = false;
        }

        // Add document listeners for dragging (to capture events outside canvas)
        document.addEventListener('mousemove', handleDocumentMouseMove);
        document.addEventListener('mouseup', handleDocumentMouseUp);

        // Highlight the active gizmo handle
        activeGizmoHandle.traverse(child => {
            if (child.isMesh) {
                child.material.color.setHex(0xffffff); // Make it white when active
            }
        });

        // Store initial positions for all selected objects
        selectedObjects.forEach(obj => {
            if (obj.threeObject) {
                obj.threeObject.userData.dragStartPos = obj.threeObject.position.clone();
                obj.threeObject.userData.dragStartQuat = obj.threeObject.quaternion.clone();
                obj.threeObject.userData.dragStartScale = obj.threeObject.scale.clone();
                obj.threeObject.userData.totalDelta = new THREE.Vector3();
                obj.threeObject.userData.totalScaleDelta = new THREE.Vector3(0, 0, 0);
                obj.threeObject.userData.lastMousePos = new THREE.Vector2(event.clientX, event.clientY);

                // For scale tool, store initial handle position relative to object
                if (gizmoDragType === 'scale') {
                    obj.threeObject.userData.initialHandleOffset = new THREE.Vector3();
                    if (gizmoDragAxis === 'x') obj.threeObject.userData.initialHandleOffset.x = 2;
                    else if (gizmoDragAxis === 'y') obj.threeObject.userData.initialHandleOffset.y = 2;
                    else if (gizmoDragAxis === 'z') obj.threeObject.userData.initialHandleOffset.z = 2;
                }
            }
        });

        addOutput(`Dragging ${handleData.type} gizmo on ${gizmoDragAxis.toUpperCase()} axis`, 'success');
    } catch (error) {
        console.error('Error starting gizmo drag:', error);
        addOutput(`Error starting gizmo drag: ${error.message}`, 'error');
        endGizmoDrag(); // Clean up on error
    }
}

function handleDrag(event) {
    try {
        if (!activeGizmoHandle || !gizmoDragAxis) {
            // Fallback to old drag behavior
            const deltaX = event.clientX - dragStartPos.x;
            const deltaY = event.clientY - dragStartPos.y;
            const worldDelta = new THREE.Vector3(deltaX * 0.01, -deltaY * 0.01, 0);

            selectedObjects.forEach(obj => {
                if (!obj.threeObject) return;
                if (transformMode === 'move') {
                    obj.threeObject.position.add(worldDelta);
                } else if (transformMode === 'scale') {
                    const scaleFactor = 1 + (deltaX + deltaY) * 0.001;
                    obj.threeObject.scale.multiplyScalar(Math.max(0.1, scaleFactor));
                }
            });
            dragStartPos.set(event.clientX, event.clientY);
            return;
        }

    // Gizmo-based transformation
    const currentMousePos = new THREE.Vector2(event.clientX, event.clientY);
    const deltaX = currentMousePos.x - dragStartPos.x;
    const deltaY = currentMousePos.y - dragStartPos.y;

    // Convert to world space movement along the specific axis
    const moveSpeed = 0.1;
    const scaleSpeed = 0.02;

    selectedObjects.forEach(obj => {
        if (!obj.threeObject) return;

        const lastMousePos = obj.threeObject.userData.lastMousePos || dragStartPos.clone();
        const frameDeltaX = currentMousePos.x - lastMousePos.x;
        const frameDeltaY = currentMousePos.y - lastMousePos.y;

        if (gizmoDragType === 'move') {
            // Move along specific axis
            const delta = new THREE.Vector3();
            if (gizmoDragAxis === 'x') delta.x = frameDeltaX * moveSpeed;
            else if (gizmoDragAxis === 'y') delta.y = -frameDeltaY * moveSpeed;
            else if (gizmoDragAxis === 'z') delta.z = -frameDeltaX * moveSpeed;

            obj.threeObject.userData.totalDelta.add(delta);
            obj.threeObject.position.copy(obj.threeObject.userData.dragStartPos).add(obj.threeObject.userData.totalDelta);
            obj.Position = obj.threeObject.position.clone();
            // Update physics body position if it exists
            if (obj.cannonBody) {
                obj.cannonBody.position.copy(obj.threeObject.position);
                obj.cannonBody.quaternion.copy(obj.threeObject.quaternion);
            }
            // Update gizmo position
            updateGizmoVisibility();
        } else if (gizmoDragType === 'rotate') {
            // Rotate around specific axis using appropriate mouse movement component
            const rotateSpeed = 0.02;
            let rotationDelta = 0;

            // Standardize mouse axis mapping: horizontal mouse movement for Y/Z, vertical for X (pitch)
            if (gizmoDragAxis === 'x') {
                // X-axis rotation (red ring) - use vertical mouse movement for pitch
                rotationDelta = -frameDeltaY * rotateSpeed;
            } else if (gizmoDragAxis === 'y') {
                // Y-axis rotation (green ring) - use horizontal mouse movement
                rotationDelta = -frameDeltaX * rotateSpeed;
            } else if (gizmoDragAxis === 'z') {
                // Z-axis rotation (blue ring) - use horizontal mouse movement
                rotationDelta = -frameDeltaX * rotateSpeed;
            }

            // Create rotation axis in world space
            const axis = new THREE.Vector3();
            if (gizmoDragAxis === 'x') axis.set(1, 0, 0);
            else if (gizmoDragAxis === 'y') axis.set(0, 1, 0);
            else if (gizmoDragAxis === 'z') axis.set(0, 0, 1);

            // Apply rotation using rotateOnWorldAxis for consistent world-space rotation
            obj.threeObject.rotateOnWorldAxis(axis, rotationDelta);

            // Copy to physics body if exists
            if (obj.cannonBody) {
                obj.cannonBody.position.copy(obj.threeObject.position);
                obj.cannonBody.quaternion.copy(obj.threeObject.quaternion);
            }

            // Update Roblox Rotation property (convert quaternion to Euler)
            obj.Rotation = new THREE.Euler().setFromQuaternion(obj.threeObject.quaternion);

            // Update properties panel to reflect new rotation
            updatePropertiesPanel();
        } else if (gizmoDragType === 'scale') {
            // Scale along specific axis - use axis-specific mouse movement
            let scaleDelta = 0;
            if (gizmoDragAxis === 'x') {
                scaleDelta = frameDeltaX * scaleSpeed;
            } else if (gizmoDragAxis === 'y') {
                scaleDelta = -frameDeltaY * scaleSpeed; // Invert Y for natural feel
            } else if (gizmoDragAxis === 'z') {
                scaleDelta = frameDeltaX * scaleSpeed; // Use horizontal movement for Z
            }

            const newScale = obj.threeObject.userData.dragStartScale.clone();

            if (gizmoDragAxis === 'x') {
                obj.threeObject.userData.totalScaleDelta.x += scaleDelta;
                newScale.x = obj.threeObject.userData.dragStartScale.x * Math.max(0.1, 1 + obj.threeObject.userData.totalScaleDelta.x);
            } else if (gizmoDragAxis === 'y') {
                obj.threeObject.userData.totalScaleDelta.y += scaleDelta;
                newScale.y = obj.threeObject.userData.dragStartScale.y * Math.max(0.1, 1 + obj.threeObject.userData.totalScaleDelta.y);
            } else if (gizmoDragAxis === 'z') {
                obj.threeObject.userData.totalScaleDelta.z += scaleDelta;
                newScale.z = obj.threeObject.userData.dragStartScale.z * Math.max(0.1, 1 + obj.threeObject.userData.totalScaleDelta.z);
            }

            // Store original position before scaling
            const originalPosition = obj.threeObject.position.clone();

            obj.threeObject.scale.copy(newScale);

            // Restore original position to prevent movement during scaling
            obj.threeObject.position.copy(originalPosition);

            // Update gizmo position to follow the scaled object
            updateGizmoVisibility();

            // Update Size property to match the new scale
            obj.Size = new THREE.Vector3(
                newScale.x * 4, // Convert scale back to size (4 is default part size)
                newScale.y * 4,
                newScale.z * 4
            );

            // Update physics body if it exists through the manager
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(obj);
            }

            // Update properties panel to reflect new size
            updatePropertiesPanel();
        }

        obj.threeObject.userData.lastMousePos.copy(currentMousePos);
    });

    dragStartPos.set(event.clientX, event.clientY);
    } catch (error) {
        console.error('Error during drag operation:', error);
        addOutput(`Error during drag operation: ${error.message}`, 'error');
        endGizmoDrag(); // Clean up on error
    }
}

function handleDocumentMouseMove(event) {
    // Prevent camera movement during dragging
    event.preventDefault();
    event.stopPropagation();
    handleDrag(event);
}

function handleDocumentMouseUp(event) {
    // Prevent camera movement when releasing drag
    event.preventDefault();
    event.stopPropagation();
    endGizmoDrag();
}

function endGizmoDrag() {
    try {
        isDragging = false;

        // Remove document listeners
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);

        // Reset gizmo handle color
        if (activeGizmoHandle) {
            activeGizmoHandle.traverse(child => {
                if (child.isMesh) {
                    // Reset to original color based on axis
                    if (gizmoDragAxis === 'x') child.material.color.setHex(0xff0000);
                    else if (gizmoDragAxis === 'y') child.material.color.setHex(0x00ff00);
                    else if (gizmoDragAxis === 'z') child.material.color.setHex(0x0000ff);
                }
            });
        }

        // Re-enable camera controls
        if (controls) {
            controls.enabled = true;
        }

        // Clear drag state
        activeGizmoHandle = null;
        gizmoDragAxis = null;
        gizmoDragType = null;

        // Clear stored drag data from all objects
        selectedObjects.forEach(obj => {
            if (obj.threeObject) {
                delete obj.threeObject.userData.dragStartPos;
                delete obj.threeObject.userData.dragStartQuat;
                delete obj.threeObject.userData.dragStartScale;
                delete obj.threeObject.userData.totalDelta;
                delete obj.threeObject.userData.totalScaleDelta;
                delete obj.threeObject.userData.lastMousePos;
                delete obj.threeObject.userData.initialHandleOffset;
            }
        });

        // Ensure gizmos stay visible after dragging
        updateGizmoVisibility();

        addOutput('Gizmo drag ended', 'success');
    } catch (error) {
        console.error('Error ending gizmo drag:', error);
        addOutput(`Error ending gizmo drag: ${error.message}`, 'error');
    }
}


function switchToTool(toolType) {
    // Clear previous selection
    document.querySelectorAll('.toolbox-item').forEach(i => i.classList.remove('selected'));
    clearObjectSelection();

    // Select the tool
    const toolElement = document.querySelector(`[data-type="${toolType}"]`);
    if (toolElement) {
        toolElement.classList.add('selected');
    }

    // Update tool state
    selectedToolboxItem = toolType;
    if (toolType === 'select') {
        isPlacingPart = false;
        transformMode = null;
        activeGizmo = null;
        addOutput('👆 Select tool active', 'success');
    } else if (toolType === 'move') {
        isPlacingPart = false;
        transformMode = 'move';
        activeGizmo = moveGizmo;
        addOutput('📍 Move tool active - use gizmo arrows', 'success');
    } else if (toolType === 'rotate') {
        isPlacingPart = false;
        transformMode = 'rotate';
        activeGizmo = rotateGizmo;
        addOutput('🔄 Rotate tool active - use gizmo rings', 'success');
    } else if (toolType === 'scale') {
        isPlacingPart = false;
        transformMode = 'scale';
        activeGizmo = scaleGizmo;
        addOutput('📏 Scale tool active - use gizmo circles', 'success');
    } else {
        isPlacingPart = true;
        transformMode = null;
        activeGizmo = null;
        addOutput(`Selected ${toolType} tool`, 'success');
    }

    updateGizmoVisibility();
    updatePropertiesPanel();
}

function updatePropertiesPanel() {
    console.log('updatePropertiesPanel called, selectedObjects.size:', selectedObjects.size);

    // Update properties for the first selected object
    if (selectedObjects.size === 0) {
        console.log('No objects selected, clearing properties');
        // Clear all property inputs when nothing is selected
        const inputs = document.querySelectorAll('#properties-content input');
        console.log('Found inputs to clear:', inputs.length);
        inputs.forEach(input => {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else {
                input.value = '0';
            }
        });

        // Hide script source textarea if it exists
        const scriptSource = document.getElementById('script-source');
        if (scriptSource) {
            scriptSource.style.display = 'none';
        }
        return;
    }

    // Show properties for the first selected object
    const selectedObj = Array.from(selectedObjects)[0];
    console.log('Updating properties for object:', selectedObj.Name, selectedObj.ClassName);

    // Update object name
    const nameInput = document.getElementById('prop-name');
    if (nameInput) {
        nameInput.value = selectedObj.Name || 'Object';
        console.log('Set name to:', nameInput.value);
    } else {
        console.error('prop-name input not found');
    }

    // Anchored checkbox
    const anchoredInput = document.getElementById('prop-anchored');
    if (anchoredInput) {
        anchoredInput.checked = selectedObj.Anchored !== false; // Default to true
        anchoredInput.title = "Toggle anchoring for this part";
        anchoredInput.onchange = (e) => {
            selectedObj.Anchored = e.target.checked;
            updateAnchoredVisualFeedback(selectedObj);

            // Update physics body
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }

            console.log(`Set Anchored for ${selectedObj.Name} to ${selectedObj.Anchored}`);
        };
    }

    // CanCollide checkbox - now enabled in studio for physics testing
    const canCollideInput = document.getElementById('prop-can-collide');
    if (canCollideInput) {
        canCollideInput.checked = selectedObj.CanCollide !== false; // Default to true
        canCollideInput.disabled = false; // Enabled in studio for testing
        canCollideInput.title = "Toggle collision for this part";
        canCollideInput.onchange = (e) => {
            selectedObj.CanCollide = e.target.checked;
            updateCollisionVisualFeedback(selectedObj);

            // Update physics body collision filters
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }

            console.log(`Set CanCollide for ${selectedObj.Name} to ${selectedObj.CanCollide}`);
        };
    }

    // Update position
    if (selectedObj.threeObject) {
        const pos = selectedObj.threeObject.position;
        const posX = document.getElementById('prop-pos-x');
        const posY = document.getElementById('prop-pos-y');
        const posZ = document.getElementById('prop-pos-z');

        if (posX) posX.value = pos.x.toFixed(2);
        if (posY) posY.value = pos.y.toFixed(2);
        if (posZ) posZ.value = pos.z.toFixed(2);
        console.log('Set position to:', pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2));

        const rot = selectedObj.threeObject.rotation;
        const rotX = document.getElementById('prop-rot-x');
        const rotY = document.getElementById('prop-rot-y');
        const rotZ = document.getElementById('prop-rot-z');

        if (rotX) rotX.value = rot.x.toFixed(2);
        if (rotY) rotY.value = rot.y.toFixed(2);
        if (rotZ) rotZ.value = rot.z.toFixed(2);
        console.log('Set rotation to:', rot.x.toFixed(2), rot.y.toFixed(2), rot.z.toFixed(2));

        const scale = selectedObj.threeObject.scale;
        const sizeX = document.getElementById('prop-size-x');
        const sizeY = document.getElementById('prop-size-y');
        const sizeZ = document.getElementById('prop-size-z');

        if (sizeX) sizeX.value = (scale.x * 4).toFixed(2); // Size is 4x scale (since default part is 4x4x4)
        if (sizeY) sizeY.value = (scale.y * 4).toFixed(2);
        if (sizeZ) sizeZ.value = (scale.z * 4).toFixed(2);
        console.log('Set size to:', (scale.x * 4).toFixed(2), (scale.y * 4).toFixed(2), (scale.z * 4).toFixed(2));

        if (selectedObj.threeObject.material && selectedObj.threeObject.material.color) {
            const color = selectedObj.threeObject.material.color;
            const colorR = document.getElementById('prop-color-r');
            const colorG = document.getElementById('prop-color-g');
            const colorB = document.getElementById('prop-color-b');

            if (colorR) colorR.value = color.r.toFixed(2);
            if (colorG) colorG.value = color.g.toFixed(2);
            if (colorB) colorB.value = color.b.toFixed(2);
            console.log('Set color to:', color.r.toFixed(2), color.g.toFixed(2), color.b.toFixed(2));
        }

        if (selectedObj.threeObject.material && typeof selectedObj.threeObject.material.opacity !== 'undefined') {
            const transparency = document.getElementById('prop-transparency');
            if (transparency) {
                transparency.value = (1 - selectedObj.threeObject.material.opacity).toFixed(2);
                console.log('Set transparency to:', transparency.value);
            }
        }
    }

    // CanCollide checkbox - disabled in studio, only for game mode
    if (canCollideInput) {
        canCollideInput.checked = selectedObj.CanCollide !== false; // Default to true
        canCollideInput.disabled = true; // Disabled in studio
        canCollideInput.title = "Collision only works in game mode";
        canCollideInput.onchange = (e) => {
            // Prevent changes in studio
            e.target.checked = selectedObj.CanCollide !== false;
            addOutput('Collision can only be toggled in game mode', 'success');
        };
    }

    // Update Body Type selector
    const bodyTypeSelect = document.getElementById('prop-body-type');
    if (bodyTypeSelect) {
        // Determine current body type based on Anchored and CanCollide
        let currentBodyType = 'dynamic';
        if (selectedObj.Anchored) {
            currentBodyType = 'kinematic';
        } else if (!selectedObj.CanCollide) {
            currentBodyType = 'dynamic'; // Non-collidable unanchored parts are still dynamic
        } else {
            currentBodyType = 'dynamic';
        }
        bodyTypeSelect.value = currentBodyType;

        bodyTypeSelect.onchange = (e) => {
            const newBodyType = e.target.value;
            if (newBodyType === 'kinematic') {
                selectedObj.Anchored = true;
                selectedObj.CanCollide = true; // Kinematic bodies can collide
            } else if (newBodyType === 'static') {
                selectedObj.Anchored = true;
                selectedObj.CanCollide = true; // Static bodies can collide
            } else if (newBodyType === 'dynamic') {
                selectedObj.Anchored = false;
                // Keep CanCollide as is, but ensure it's set appropriately
                if (selectedObj.CanCollide === undefined) {
                    selectedObj.CanCollide = true;
                }
            }

            // Update physics body
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }

            // Update visual feedback
            updateAnchoredVisualFeedback(selectedObj);
            updateCollisionVisualFeedback(selectedObj);

            console.log(`Set Anchored for ${selectedObj.Name} to ${selectedObj.Anchored}`);

            console.log(`Set body type to: ${newBodyType} for ${selectedObj.Name}`);
        };
    }

    // Update Mass input
    const massInput = document.getElementById('prop-mass');
    if (massInput) {
        massInput.value = selectedObj.Mass || 1;
        massInput.oninput = (e) => {
            selectedObj.Mass = parseFloat(e.target.value) || 1;
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }
        };
    }

    // Update Friction input
    const frictionInput = document.getElementById('prop-friction');
    if (frictionInput) {
        frictionInput.value = (selectedObj.Friction !== undefined ? selectedObj.Friction : 0.4).toFixed(2);
        frictionInput.oninput = (e) => {
            selectedObj.Friction = parseFloat(e.target.value) || 0.4;
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }
        };
    }

    // Update Restitution input
    const restitutionInput = document.getElementById('prop-restitution');
    if (restitutionInput) {
        restitutionInput.value = (selectedObj.Restitution !== undefined ? selectedObj.Restitution : 0.3).toFixed(2);
        restitutionInput.oninput = (e) => {
            selectedObj.Restitution = parseFloat(e.target.value) || 0.3;
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
            }
        };
    }

    // Show script source for Script objects
    const scriptSource = document.getElementById('script-source');
    if (scriptSource) {
        if (selectedObj.ClassName === 'Script') {
            scriptSource.style.display = 'block';
            scriptSource.value = selectedObj.Source || '';
        } else {
            scriptSource.style.display = 'none';
        }
    }
}

function createMoveGizmo() {
    moveGizmo = new THREE.Group();

    // X-axis arrow (Red)
    const xArrow = createArrowGeometry(0xff0000);
    xArrow.rotation.z = -Math.PI / 2;
    xArrow.position.x = 2;
    xArrow.userData.axis = 'x';
    xArrow.userData.type = 'move';
    moveGizmo.add(xArrow);
    // Push the arrow head and shaft meshes for intersection (more clickable)
    const xHead = xArrow.children[1]; // The cone head
    xHead.userData.axis = 'x';
    xHead.userData.type = 'move';
    gizmoHandles.push({ handle: xHead, axis: 'x', type: 'move' });
    const xShaft = xArrow.children[0]; // The cylinder shaft
    xShaft.userData.axis = 'x';
    xShaft.userData.type = 'move';
    gizmoHandles.push({ handle: xShaft, axis: 'x', type: 'move' });

    // Y-axis arrow (Green)
    const yArrow = createArrowGeometry(0x00ff00);
    yArrow.position.y = 2;
    yArrow.userData.axis = 'y';
    yArrow.userData.type = 'move';
    moveGizmo.add(yArrow);
    const yHead = yArrow.children[1];
    yHead.userData.axis = 'y';
    yHead.userData.type = 'move';
    gizmoHandles.push({ handle: yHead, axis: 'y', type: 'move' });
    const yShaft = yArrow.children[0];
    yShaft.userData.axis = 'y';
    yShaft.userData.type = 'move';
    gizmoHandles.push({ handle: yShaft, axis: 'y', type: 'move' });

    // Z-axis arrow (Blue)
    const zArrow = createArrowGeometry(0x0000ff);
    zArrow.rotation.x = Math.PI / 2;
    zArrow.position.z = 2;
    zArrow.userData.axis = 'z';
    zArrow.userData.type = 'move';
    moveGizmo.add(zArrow);
    const zHead = zArrow.children[1];
    zHead.userData.axis = 'z';
    zHead.userData.type = 'move';
    gizmoHandles.push({ handle: zHead, axis: 'z', type: 'move' });
    const zShaft = zArrow.children[0];
    zShaft.userData.axis = 'z';
    zShaft.userData.type = 'move';
    gizmoHandles.push({ handle: zShaft, axis: 'z', type: 'move' });

    moveGizmo.visible = false;
    scene.add(moveGizmo);
}

function createScaleGizmo() {
    scaleGizmo = new THREE.Group();

    // X-axis cube (Red) - positioned at positive X end
    const xCube = createCubeGeometry(0xff0000);
    xCube.position.x = 2;
    xCube.userData.axis = 'x';
    xCube.userData.type = 'scale';
    scaleGizmo.add(xCube);
    gizmoHandles.push({ handle: xCube, axis: 'x', type: 'scale' });

    // Y-axis cube (Green) - positioned at positive Y end
    const yCube = createCubeGeometry(0x00ff00);
    yCube.position.y = 2;
    yCube.userData.axis = 'y';
    yCube.userData.type = 'scale';
    scaleGizmo.add(yCube);
    gizmoHandles.push({ handle: yCube, axis: 'y', type: 'scale' });

    // Z-axis cube (Blue) - positioned at positive Z end
    const zCube = createCubeGeometry(0x0000ff);
    zCube.position.z = 2;
    zCube.userData.axis = 'z';
    zCube.userData.type = 'scale';
    scaleGizmo.add(zCube);
    gizmoHandles.push({ handle: zCube, axis: 'z', type: 'scale' });

    scaleGizmo.visible = false;
    scene.add(scaleGizmo);
}

function createRotateGizmo() {
    rotateGizmo = new THREE.Group();

    // X-axis rotation ring (Red)
    const xRing = createRotationRingGeometry(0xff0000);
    xRing.rotation.y = Math.PI / 2;
    xRing.userData.axis = 'x';
    xRing.userData.type = 'rotate';
    rotateGizmo.add(xRing);
    gizmoHandles.push({ handle: xRing, axis: 'x', type: 'rotate' });

    // Y-axis rotation ring (Green)
    const yRing = createRotationRingGeometry(0x00ff00);
    yRing.rotation.x = Math.PI / 2;
    yRing.userData.axis = 'y';
    yRing.userData.type = 'rotate';
    rotateGizmo.add(yRing);
    gizmoHandles.push({ handle: yRing, axis: 'y', type: 'rotate' });

    // Z-axis rotation ring (Blue)
    const zRing = createRotationRingGeometry(0x0000ff);
    zRing.userData.axis = 'z';
    zRing.userData.type = 'rotate';
    rotateGizmo.add(zRing);
    gizmoHandles.push({ handle: zRing, axis: 'z', type: 'rotate' });

    rotateGizmo.visible = false;
    scene.add(rotateGizmo);
}

function createArrowGeometry(color) {
    const group = new THREE.Group();

    // Arrow shaft - made much thicker for easier clicking
    const shaftGeometry = new THREE.CylinderGeometry(1.0, 1.0, 12, 8);
    const shaftMaterial = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0, depthWrite: false, depthTest: true });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.position.y = 6;
    shaft.renderOrder = 1;
    group.add(shaft);

    // Arrow head - made much bigger for easier clicking
    const headGeometry = new THREE.ConeGeometry(3.0, 4.0, 8);
    const headMaterial = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0, depthWrite: false, depthTest: true });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 12;
    head.renderOrder = 1;
    group.add(head);

    return group;
}

function createCubeGeometry(color) {
    // Create cubes for scale gizmos - positioned at ends of axes
    const geometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0, depthWrite: false, depthTest: true });
    const cube = new THREE.Mesh(geometry, material);
    cube.renderOrder = 1;
    return cube;
}

function createRotationRingGeometry(color) {
    // Create a larger torus for rotation rings - easier to click
    const geometry = new THREE.TorusGeometry(9, 0.6, 8, 64);
    const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0, depthWrite: false, depthTest: true });
    const ring = new THREE.Mesh(geometry, material);
    ring.renderOrder = 1;
    return ring;
}


function updateAnchoredVisualFeedback(obj) {
    if (!obj.threeObject) return;

    // Store original material if not already stored
    if (!obj.originalMaterial) {
        obj.originalMaterial = obj.threeObject.material.clone();
    }

    if (obj.Anchored === false) {
        // Show wireframe/transparent when not anchored (dynamic)
        obj.threeObject.material = obj.originalMaterial.clone();
        obj.threeObject.material.wireframe = true;
        obj.threeObject.material.transparent = true;
        obj.threeObject.material.opacity = 0.8;
        obj.threeObject.material.emissive = new THREE.Color(0x004400); // Green tint for dynamic
    } else {
        // Restore normal appearance for anchored parts
        obj.threeObject.material = obj.originalMaterial.clone();
        obj.threeObject.material.wireframe = false;
        obj.threeObject.material.transparent = false;
        obj.threeObject.material.opacity = 1.0;
        obj.threeObject.material.emissive = new THREE.Color(0x000000);
    }
}

function updateCollisionVisualFeedback(obj) {
    if (!obj.threeObject) return;

    // Store original material if not already stored
    if (!obj.originalMaterial) {
        obj.originalMaterial = obj.threeObject.material.clone();
    }

    if (obj.CanCollide === false) {
        // Show wireframe/transparent when not collidable
        obj.threeObject.material = obj.originalMaterial.clone();
        obj.threeObject.material.wireframe = true;
        obj.threeObject.material.transparent = true;
        obj.threeObject.material.opacity = 0.7;
        obj.threeObject.material.emissive = new THREE.Color(0x440000); // Red tint
    } else {
        // Restore normal appearance
        obj.threeObject.material = obj.originalMaterial.clone();
        obj.threeObject.material.wireframe = false;
        obj.threeObject.material.transparent = false;
        obj.threeObject.material.opacity = 1.0;
        obj.threeObject.material.emissive = new THREE.Color(0x000000);
    }
}

function placePartAtMouse() {
    if (!placementPreview || !placementPreview.visible || !selectedToolboxItem) return;

    const objectName = `${selectedToolboxItem}_${Object.keys(luaObjects).length + 1}`;
    const instance = new RobloxInstance(selectedToolboxItem, objectName);
    luaObjects[objectName] = instance;

    // Create 3D representation based on type
    switch (selectedToolboxItem) {
        case 'part':
            const geometry = new THREE.BoxGeometry(4, 4, 4); // Standard 4x4x4 stud part
            const material = new THREE.MeshLambertMaterial({ color: 0xff6600 });
            const part = new THREE.Mesh(geometry, material);
            part.position.copy(placementPreview.position);
            part.castShadow = true;
            part.receiveShadow = true;
            scene.add(part);
            instance.threeObject = part;
            instance.ClassName = 'Part';
            instance.CanCollide = true; // Default to collidable
            instance.Size = new THREE.Vector3(4, 4, 4);
            instance.Position = placementPreview.position.clone();

            // Create physics body through manager (will be dynamic if unanchored)
            if (RobloxEnvironment.physicsBodyManager) {
                RobloxEnvironment.physicsBodyManager.createBody(instance);
            }

            // Apply visual feedback for collision state
            updateCollisionVisualFeedback(instance);
            break;

        case 'light':
            const light = new THREE.PointLight(0xffffff, 1, 20);
            light.position.copy(placementPreview.position);
            light.position.y = 8; // Place above ground
            light.castShadow = true;
            scene.add(light);
            instance.threeObject = light;
            instance.ClassName = 'PointLight';
            break;

        case 'sound':
            // Sounds don't have visual representation, just create the instance
            instance.type = 'sound';
            instance.soundId = '';
            instance.volume = 0.5;
            instance.isPlaying = false;
            instance.audio = null;
            instance.ClassName = 'Sound';
            break;

        case 'model':
            // Models are just containers
            instance.type = 'model';
            instance.ClassName = 'Model';
            break;

        case 'script':
            // Scripts contain Lua code
            instance.type = 'script';
            instance.ClassName = 'Script';
            instance.Source = '-- New script\nprint("Hello from script!")';
            break;
    }

    // Set parent to workspace
    instance.Parent = RobloxEnvironment.Workspace;
    RobloxEnvironment.Workspace.Children.push(instance);

    // Add to workspace tree
    addToWorkspaceTree(objectName, selectedToolboxItem);

    addOutput(`${selectedToolboxItem} "${objectName}" placed in workspace!`, 'success');

    // If it's a script, open a dedicated tab with code editor
    if (selectedToolboxItem === 'script') {
        openScriptTab(instance);
        addOutput(`Script "${instance.Name}" opened in editor`, 'success');
        // Switch to the Script tab to show the main editor
        switchTab('script');
    }

    // Reset placement mode
    isPlacingPart = false;
    selectedToolboxItem = null;
    if (placementPreview) {
        placementPreview.visible = false;
    }

    // Update toolbox button states
    document.querySelectorAll('.toolbox-item').forEach(item => {
        item.classList.remove('selected');
    });
}

function animate() {
    requestAnimationFrame(animate);

    if (controls) {
        controls.update();
    }

    // Step physics world
    if (RobloxEnvironment.physicsWorld) {
        console.log(`[PHYSICS] Stepping physics world, ${RobloxEnvironment.physicsWorld.bodies.length} bodies`);
        RobloxEnvironment.physicsWorld.step(1/60);

        // Sync physics bodies back to Three.js objects
        if (RobloxEnvironment.physicsBodyManager) {
            RobloxEnvironment.physicsBodyManager.syncToThreeJS();
        }

        // Check for collision events
        RobloxEnvironment.physicsWorld.contacts.forEach(contact => {
            const bodyA = contact.bi;
            const bodyB = contact.bj;
    
            // Find the RobloxInstance objects for these bodies
            let instanceA = null, instanceB = null;
            RobloxEnvironment.physicsBodyManager.bodies.forEach((body, instance) => {
                if (body === bodyA) instanceA = instance;
                if (body === bodyB) instanceB = instance;
            });
    
            if (instanceA && instanceB) {
                // Fire Touched events for both instances
                if (instanceA.touchedConnections) {
                    instanceA.touchedConnections.forEach(callback => {
                        try {
                            callback(instanceB);
                        } catch (error) {
                            console.error(`[PHYSICS] Error in Touched callback for ${instanceA.Name}:`, error);
                        }
                    });
                }
                if (instanceB.touchedConnections) {
                    instanceB.touchedConnections.forEach(callback => {
                        try {
                            callback(instanceA);
                        } catch (error) {
                            console.error(`[PHYSICS] Error in Touched callback for ${instanceB.Name}:`, error);
                        }
                    });
                }
    
                console.log(`[PHYSICS] Collision detected: ${instanceA.Name} touched ${instanceB.Name}`);
            }
        });
    }

    // Run game loop if active
    if (RobloxEnvironment.running) {
        runGameLoop();
    }

    // Update spinning objects (rotate around configured spinAxis)
    Object.values(luaObjects).forEach(obj => {
        if (obj.spinning && obj.threeObject) {
            // Default axis is Y if not set
            const axis = obj.spinAxis instanceof THREE.Vector3 ? obj.spinAxis.clone().normalize() : (obj.spinAxis ? new THREE.Vector3(obj.spinAxis.x || obj.spinAxis.X || 0, obj.spinAxis.y || obj.spinAxis.Y || 0, obj.spinAxis.z || obj.spinAxis.Z || 0).normalize() : new THREE.Vector3(0,1,0));
            const angle = 0.05; // radians per frame
            // Create quaternion for small rotation around axis
            const q = new THREE.Quaternion();
            q.setFromAxisAngle(axis, angle);
            obj.threeObject.quaternion.premultiply(q);
            // Keep Position and Rotation fields in sync
            obj.Rotation = obj.threeObject.rotation;
            if (obj.cannonBody) {
                obj.cannonBody.quaternion.copy(obj.threeObject.quaternion);
            }
        }
    });

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

function runGameLoop() {
    // Fire heartbeat event
    RobloxEnvironment.RunService.Heartbeat.Fire(1/60); // Assuming 60 FPS

    // Update any running scripts
    RobloxEnvironment.scripts.forEach((scriptData, scriptId) => {
        if (scriptData.running) {
            // Execute any continuous logic here
            // For now, just handle basic updates
        }
    });
}

function startGameLoop() {
    RobloxEnvironment.running = true;
    addOutput('Game loop started!', 'success');
}

function stopGameLoop() {
    RobloxEnvironment.running = false;
    addOutput('Game loop stopped!', 'success');
}

function startStudioPhysics() {
    console.log('[PHYSICS] Starting physics simulation in studio...');
    RobloxEnvironment.running = true;
    addOutput('Physics simulation started in studio!', 'success');
    addOutput('Parts will now fall under gravity. Check console for [PHYSICS] logs.', 'success');
}

function setupEventListeners() {
    console.log('RoGold Studio: Setting up event listeners...');

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            console.log('RoGold Studio: Tab clicked:', tab.dataset.tab);
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });

    // Studio buttons
    const playBtn = document.getElementById('play-btn');
    if (playBtn) {
        playBtn.addEventListener('click', (e) => {
            console.log('RoGold Studio: Play button clicked - Event:', e);
            console.log('RoGold Studio: Play button element:', playBtn);
            // Start physics simulation in studio instead of opening game
            startStudioPhysics();
        });
        console.log('RoGold Studio: Play button event listener attached');
    } else {
        console.error('RoGold Studio: Play button not found!');
    }

    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Stop button clicked');
            stopGame();
        });
    }

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Save button clicked');
            saveProject();
        });
    }

    const loadBtn = document.getElementById('load-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Load button clicked');
            loadProject();
        });
    }

    const testBtn = document.getElementById('test-btn');
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Test button clicked');
            testProject();
        });
    }

    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
        publishBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Publish button clicked');
            publishProject();
        });
    }

    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Delete button clicked');
            deleteSelectedObjects();
        });
    }

    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            console.log('RoGold Studio: Back button clicked');
            window.location.href = '/';
        });
    }


    // Toolbox items
    document.querySelectorAll('.toolbox-item').forEach(item => {
        item.addEventListener('click', () => {
            // Don't change tools if we're currently dragging
            if (isDragging) return;

            console.log('RoGold Studio: Toolbox item clicked:', item.dataset.type);
            const type = item.dataset.type;

            // Clear previous selection
            document.querySelectorAll('.toolbox-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');

            // Clear object selection
            clearObjectSelection();

            // Handle different tools
            selectedToolboxItem = type;
            if (type === 'select') {
                isPlacingPart = false;
                transformMode = null;
                activeGizmo = null;
                addOutput('👆 Select tool active', 'success');
            } else if (type === 'move') {
                isPlacingPart = false;
                transformMode = 'move';
                activeGizmo = moveGizmo;
                addOutput('📍 Move tool active - use gizmo arrows', 'success');
            } else if (type === 'rotate') {
                isPlacingPart = false;
                transformMode = 'rotate';
                activeGizmo = rotateGizmo;
                addOutput('🔄 Rotate tool active - use gizmo rings', 'success');
            } else if (type === 'scale') {
                isPlacingPart = false;
                transformMode = 'scale';
                activeGizmo = scaleGizmo;
                addOutput('📏 Scale tool active - use gizmo circles', 'success');
            } else {
                isPlacingPart = true;
                transformMode = null;
                activeGizmo = null;
                addOutput(`Selected ${type} tool. Click in viewport to place!`, 'success');
            }

            updateGizmoVisibility();
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        // Don't handle shortcuts if any Monaco editor is focused or publish dialog input is active
        const activeElement = document.activeElement;
        if (activeElement && (
            activeElement.classList.contains('monaco-editor') ||
            activeElement.closest('.monaco-editor') ||
            activeElement.tagName === 'TEXTAREA' && activeElement.classList.contains('code-textarea') ||
            activeElement.classList.contains('publish-dialog-input')
        )) {
            return;
        }

        // F5 = Play/Run
        if (event.key === 'F5') {
            event.preventDefault();
            runScript();
        }
        // F9 = Reset/Stop
        else if (event.key === 'F9') {
            event.preventDefault();
            clearScene();
        }
        // Tool shortcuts
        else if (event.key === 'q' || event.key === 'Q') {
            event.preventDefault();
            switchToTool('select');
        } else if (event.key === 'w' || event.key === 'W') {
            event.preventDefault();
            switchToTool('move');
        } else if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();
            switchToTool('rotate');
        } else if (event.key === 'e' || event.key === 'E') {
            event.preventDefault();
            switchToTool('scale');
        } else if (event.key === 't' || event.key === 'T') {
            event.preventDefault();
            switchToTool('part');
        }

        // Delete key (Delete or Backspace)
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedObjects.size > 0) {
                event.preventDefault();
                deleteSelectedObjects();
            }
        }

        // Escape key to clear selection
        if (event.key === 'Escape') {
            clearObjectSelection();
            addOutput('Selection cleared', 'success');
        }
    });

    // Size input event listeners
    const sizeXInput = document.getElementById('prop-size-x');
    if (sizeXInput) {
        sizeXInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    const newSize = parseFloat(e.target.value) || 4;
                    selectedObj.threeObject.scale.x = newSize / 4; // Convert size to scale
                    selectedObj.Size.x = newSize;

                    // Update physics body through manager
                    if (RobloxEnvironment.physicsBodyManager) {
                        RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
                    }
                }
            }
        });
    }

    const sizeYInput = document.getElementById('prop-size-y');
    if (sizeYInput) {
        sizeYInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    const newSize = parseFloat(e.target.value) || 4;
                    selectedObj.threeObject.scale.y = newSize / 4; // Convert size to scale
                    selectedObj.Size.y = newSize;

                    // Update physics body through manager
                    if (RobloxEnvironment.physicsBodyManager) {
                        RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
                    }
                }
            }
        });
    }

    const sizeZInput = document.getElementById('prop-size-z');
    if (sizeZInput) {
        sizeZInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    const newSize = parseFloat(e.target.value) || 4;
                    selectedObj.threeObject.scale.z = newSize / 4; // Convert size to scale
                    selectedObj.Size.z = newSize;

                    // Update physics body through manager
                    if (RobloxEnvironment.physicsBodyManager) {
                        RobloxEnvironment.physicsBodyManager.updateBody(selectedObj);
                    }
                }
            }
        });
    }

    // Rotation input event listeners
    const rotXInput = document.getElementById('prop-rot-x');
    if (rotXInput) {
        rotXInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    selectedObj.threeObject.rotation.x = parseFloat(e.target.value) || 0;
                }
            }
        });
    }

    const rotYInput = document.getElementById('prop-rot-y');
    if (rotYInput) {
        rotYInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    selectedObj.threeObject.rotation.y = parseFloat(e.target.value) || 0;
                }
            }
        });
    }

    const rotZInput = document.getElementById('prop-rot-z');
    if (rotZInput) {
        rotZInput.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.threeObject) {
                    selectedObj.threeObject.rotation.z = parseFloat(e.target.value) || 0;
                }
            }
        });
    }

    // CanCollide checkbox event listener is handled in updatePropertiesPanel

    // Script source editing
    const scriptSourceTextarea = document.getElementById('script-source');
    if (scriptSourceTextarea) {
        scriptSourceTextarea.addEventListener('input', (e) => {
            if (selectedObjects.size > 0) {
                const selectedObj = Array.from(selectedObjects)[0];
                if (selectedObj.ClassName === 'Script') {
                    selectedObj.Source = e.target.value;
                }
            }
        });
    }


    // Window resize
    window.addEventListener('resize', () => {
        if (renderer && camera) {
            const canvas = document.getElementById('viewport-canvas');
            camera.aspect = canvas.clientWidth / canvas.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        }
    });

    console.log('RoGold Studio: Event listeners setup complete');
}

function switchTab(tabName) {
    currentTab = tabName;

    // Update tab styles
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }

    // Show/hide content
    const viewportTab = document.getElementById('viewport-tab');
    const scriptTab = document.getElementById('script-tab');

    if (viewportTab) viewportTab.classList.toggle('hidden', tabName !== 'viewport');
    if (scriptTab) scriptTab.classList.toggle('hidden', tabName !== 'script');

    // Resize renderer when switching to viewport
    if (tabName === 'viewport' && renderer && camera) {
        const canvas = document.getElementById('viewport-canvas');
        if (canvas) {
            const container = canvas.parentElement;
            // Delay resize to ensure container has proper dimensions after showing
            setTimeout(() => {
                const width = container.clientWidth || 800;
                const height = container.clientHeight || 600;
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height);
            }, 100);
        }
    }

    // Resize Monaco Editor when switching to script tab
    if (tabName === 'script' && window.monacoEditor) {
        setTimeout(() => {
            window.monacoEditor.layout();
        }, 100);
    }
}

// Keep the original runScript for backward compatibility, but use the enhanced version
function runScript(scriptName = null) {
    runScriptWithErrorHandling(scriptName);
}

function clearScene() {
    // Stop game loop
    stopGameLoop();

    // Clear selection
    clearObjectSelection();

    // Clear script-created objects but keep manually placed parts
    Object.entries(luaObjects).forEach(([name, obj]) => {
        if (obj && obj.isScriptCreated) {
            if (obj.threeObject && obj.threeObject.parent) {
                obj.threeObject.parent.remove(obj.threeObject);
            }
            if (obj.audio) {
                obj.audio.stop();
            }
            if (obj.Destroy) {
                obj.Destroy();
            }
            delete luaObjects[name];
        }
    });

    // Clear script-created workspace children
    if (RobloxEnvironment.Workspace) {
        RobloxEnvironment.Workspace.Children = RobloxEnvironment.Workspace.Children.filter(child => {
            if (child.isScriptCreated) {
                // Remove from workspace tree
                removeFromWorkspaceTree(child.Name);
                return false;
            }
            return true;
        });
    }

    // Close all script tabs
    closeAllScriptTabs();

    addOutput('Script objects cleared. Manually placed parts remain.', 'success');
}

function saveProject() {
    // Collect all script sources
    const scripts = {};
    Object.entries(luaObjects).forEach(([name, obj]) => {
        if (obj.ClassName === 'Script') {
            scripts[name] = obj.Source || '';
        }
    });

    // Also save the main script editor content
    if (window.monacoEditor) {
        scripts['Main Script'] = window.monacoEditor.getValue();
    }

    const projectData = {
        scripts: scripts,
        objects: luaObjects,
        timestamp: new Date().toISOString(),
        version: '1.0',
        studio: 'RoGold Studio'
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'rogold_project.json';
    a.click();

    URL.revokeObjectURL(url);
    addOutput('Project saved!', 'success');
}

function serializeGameState() {
    // Collect all script sources
    const scripts = {};
    Object.entries(luaObjects).forEach(([name, obj]) => {
        if (obj.ClassName === 'Script') {
            scripts[name] = obj.Source || '';
        }
    });

    // Also save the main script editor content
    if (window.monacoEditor) {
        scripts['Main Script'] = window.monacoEditor.getValue();
    }

    // Serialize objects without circular references
    const serializedObjects = {};
    Object.entries(luaObjects).forEach(([name, obj]) => {
        serializedObjects[name] = {
            ClassName: obj.ClassName,
            Name: obj.Name,
            Anchored: obj.Anchored,
            CanCollide: obj.CanCollide,
            Size: obj.Size ? obj.Size.toArray() : [4, 2, 2],
            Position: obj.Position ? obj.Position.toArray() : [0, 5, 0],
            Rotation: obj.Rotation ? [obj.Rotation.x, obj.Rotation.y, obj.Rotation.z] : [0, 0, 0],
            Color: obj.Color ? obj.Color.toArray() : [0.5, 0.5, 0.5],
            Transparency: obj.Transparency || 0,
            Source: obj.Source || '',
            type: obj.type || '',
            soundId: obj.soundId || '',
            volume: obj.volume || 0.5,
            isPlaying: obj.isPlaying || false
        };
    });

    return {
        scripts: scripts,
        objects: serializedObjects,
        timestamp: new Date().toISOString(),
        version: '1.0'
    };
}

function generateFallbackThumbnail() {
    console.log('RoGold Studio: Generating fallback thumbnail');
    addOutput('Generating fallback thumbnail due to scene issues', 'success');

    // Create a simple 256x256 canvas with a gradient background
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#4a90e2');
    gradient.addColorStop(1, '#357abd');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    // Add text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('RoGold Studio', 128, 120);
    ctx.font = '16px Arial';
    ctx.fillText('No Scene Available', 128, 150);

    return canvas.toDataURL('image/png');
}

function generateSceneScreenshot() {
    console.log('RoGold Studio: Attempting to generate scene screenshot');

    // Check for missing critical components
    if (!renderer) {
        console.error('RoGold Studio: Renderer not available for screenshot');
        addOutput('Renderer not available for thumbnail generation', 'error');
        return generateFallbackThumbnail();
    }

    if (!scene) {
        console.error('RoGold Studio: Scene not available for screenshot');
        addOutput('Scene not available for thumbnail generation', 'error');
        return generateFallbackThumbnail();
    }

    if (!camera) {
        console.error('RoGold Studio: Camera not available for screenshot');
        addOutput('Camera not available for thumbnail generation', 'error');
        return generateFallbackThumbnail();
    }

    try {
        // Check if scene has any objects (excluding helpers and lights)
        const hasObjects = scene.children.some(child => {
            return child.type === 'Mesh' || child.type === 'Group' || child.userData.isRobloxObject;
        });

        if (!hasObjects) {
            console.warn('RoGold Studio: Scene appears empty (no objects found)');
            addOutput('Scene appears empty, using fallback thumbnail', 'success');
            return generateFallbackThumbnail();
        }

        // Set camera to isometric view for consistent thumbnail
        const originalPosition = camera.position.clone();
        const originalRotation = camera.rotation.clone();
        camera.position.set(10, 10, 10);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        // Render the scene
        renderer.render(scene, camera);

        // Capture screenshot
        const dataURL = renderer.domElement.toDataURL('image/png');

        // Restore original camera position
        camera.position.copy(originalPosition);
        camera.rotation.copy(originalRotation);
        camera.updateProjectionMatrix();

        // Re-render to restore view
        renderer.render(scene, camera);

        console.log('RoGold Studio: Scene screenshot generated successfully');
        addOutput('Scene thumbnail generated successfully', 'success');

        return dataURL;
    } catch (error) {
        console.error('RoGold Studio: Error during scene screenshot generation:', error);
        addOutput(`Error generating scene thumbnail: ${error.message}`, 'error');
        return generateFallbackThumbnail();
    }
}

function showPublishDialog(defaultThumbnail = null) {
    return new Promise((resolve) => {
        // Create modal dialog
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            min-width: 300px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Publish Game';
        title.style.marginTop = '0';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter game title...';
        input.value = 'My RoGold Game';
        input.className = 'publish-dialog-input';
        input.style.cssText = `
            width: 100%;
            padding: 8px;
            margin: 10px 0;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-sizing: border-box;
        `;

        const thumbnailLabel = document.createElement('label');
        thumbnailLabel.textContent = 'Game Thumbnail:';
        thumbnailLabel.style.cssText = `
            display: block;
            margin: 10px 0 5px 0;
            font-weight: bold;
        `;

        const thumbnailInput = document.createElement('input');
        thumbnailInput.type = 'file';
        thumbnailInput.accept = 'image/*';
        thumbnailInput.style.cssText = `
            width: 100%;
            padding: 8px;
            margin: 5px 0;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-sizing: border-box;
        `;

        const thumbnailPreview = document.createElement('img');
        thumbnailPreview.style.cssText = `
            max-width: 100px;
            max-height: 100px;
            margin: 10px 0;
            display: none;
            border: 1px solid #ccc;
            border-radius: 4px;
        `;

        // Set default thumbnail if provided
        if (defaultThumbnail) {
            thumbnailPreview.src = defaultThumbnail;
            thumbnailPreview.style.display = 'block';
        }

        thumbnailInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    thumbnailPreview.src = e.target.result;
                    thumbnailPreview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            } else if (defaultThumbnail) {
                // Revert to default if no file selected
                thumbnailPreview.src = defaultThumbnail;
                thumbnailPreview.style.display = 'block';
            } else {
                thumbnailPreview.style.display = 'none';
            }
        };

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            border: 1px solid #ccc;
            background: white;
            border-radius: 4px;
            cursor: pointer;
        `;

        const publishBtn = document.createElement('button');
        publishBtn.textContent = 'Publish';
        publishBtn.style.cssText = `
            padding: 8px 16px;
            border: none;
            background: #007bff;
            color: white;
            border-radius: 4px;
            cursor: pointer;
        `;

        cancelBtn.onclick = () => {
            document.body.removeChild(modal);
            resolve(null);
        };

        publishBtn.onclick = async () => {
            const gameTitle = input.value.trim() || 'Untitled Game';
            let thumbnailData = defaultThumbnail; // Use default if no custom uploaded

            if (thumbnailInput.files[0]) {
                thumbnailData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsDataURL(thumbnailInput.files[0]);
                });
            }

            document.body.removeChild(modal);
            resolve({ title: gameTitle, thumbnail: thumbnailData });
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                publishBtn.click();
            } else if (e.key === 'Escape') {
                cancelBtn.click();
            }
        };

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(publishBtn);
        dialog.appendChild(title);
        dialog.appendChild(input);
        dialog.appendChild(thumbnailLabel);
        dialog.appendChild(thumbnailInput);
        dialog.appendChild(thumbnailPreview);
        dialog.appendChild(buttonContainer);
        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // Focus input
        setTimeout(() => input.focus(), 100);
    });
}

function showPublishProgress(message) {
    // Create or update progress dialog
    let progressDialog = document.getElementById('publish-progress-dialog');
    if (!progressDialog) {
        progressDialog = document.createElement('div');
        progressDialog.id = 'publish-progress-dialog';
        progressDialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            text-align: center;
        `;
        document.body.appendChild(progressDialog);
    }

    progressDialog.innerHTML = `
        <div style="margin-bottom: 10px;">${message}</div>
        <div style="width: 200px; height: 4px; background: #eee; border-radius: 2px; overflow: hidden;">
            <div style="width: 100%; height: 100%; background: #007bff; animation: progress 1s ease-in-out infinite;"></div>
        </div>
    `;

    // Add CSS animation if not already present
    if (!document.getElementById('publish-progress-style')) {
        const style = document.createElement('style');
        style.id = 'publish-progress-style';
        style.textContent = `
            @keyframes progress {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
        `;
        document.head.appendChild(style);
    }
}

function hidePublishProgress() {
    const progressDialog = document.getElementById('publish-progress-dialog');
    if (progressDialog) {
        document.body.removeChild(progressDialog);
    }
    const style = document.getElementById('publish-progress-style');
    if (style) {
        document.head.removeChild(style);
    }
}

function showPublishResult(success, message) {
    const resultDialog = document.createElement('div');
    resultDialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10002;
        text-align: center;
        max-width: 400px;
    `;

    const icon = success ? '✅' : '❌';
    const title = success ? 'Success!' : 'Error';

    resultDialog.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 10px;">${icon}</div>
        <h3 style="margin: 0 0 10px 0; color: ${success ? '#28a745' : '#dc3545'};">${title}</h3>
        <div style="margin-bottom: 20px;">${message}</div>
        <button style="
            padding: 8px 16px;
            border: none;
            background: #007bff;
            color: white;
            border-radius: 4px;
            cursor: pointer;
        " onclick="this.parentElement.parentElement.remove()">OK</button>
    `;

    document.body.appendChild(resultDialog);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (resultDialog.parentElement) {
            document.body.removeChild(resultDialog);
        }
    }, 5000);
}

async function publishProject() {
    try {
        // Generate automatic thumbnail from current scene
        const autoThumbnail = generateSceneScreenshot();

        // Show publish dialog to get game title and thumbnail
        const publishData = await showPublishDialog(autoThumbnail);
        if (!publishData) {
            return; // User cancelled
        }

        const { title: gameTitle, thumbnail: customThumbnail } = publishData;

        // Show progress indicator
        showPublishProgress('Preparing game data...');

        // Serialize game state
        const gameData = serializeGameState();

        // Prepare project data - use custom thumbnail if uploaded, otherwise use auto-generated
        const projectData = {
            title: gameTitle,
            ...gameData,
            published: true,
            gameId: 'game_' + Date.now(),
            thumbnail: customThumbnail || autoThumbnail // Use custom if uploaded, otherwise auto-generated
        };

        // Update progress
        showPublishProgress('Publishing to server...');

        // Send to server
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectData)
        });

        hidePublishProgress();

        if (response.ok) {
            const result = await response.json();
            showPublishResult(true, `Game "${gameTitle}" published successfully! Game ID: ${result.gameId || projectData.gameId}`);
            addOutput('Game published successfully! Title: ' + gameTitle, 'success');
            addOutput('Your game is now available in the games list!', 'success');

            // Refresh the games list on the main page if we're in a browser context
            if (typeof window !== 'undefined' && window.loadPublishedGames) {
                window.loadPublishedGames();
            }
        } else {
            const error = await response.text();
            showPublishResult(false, `Failed to publish game: ${error}`);
            addOutput('Failed to publish game: ' + error, 'error');
        }

    } catch (error) {
        hidePublishProgress();
        showPublishResult(false, `Error publishing game: ${error.message}`);
        addOutput('Error publishing game: ' + error.message, 'error');
        console.error('Publish error:', error);
    }
}

function testProject() {
    // Save current studio state for testing - exclude main script editor content
    const testData = serializeGameState();

    // Remove the main script editor content for test mode (only execute created Script objects)
    if (testData.scripts && testData.scripts['Main Script']) {
        delete testData.scripts['Main Script'];
    }

    // Store in sessionStorage for the test game to access
    sessionStorage.setItem('rogold_studio_test', JSON.stringify(testData));

    // Open the game in a new window/tab for testing
    const gameUrl = '/game.html?test=true&studio=true';
    window.open(gameUrl, '_blank');
}

function loadProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const projectData = JSON.parse(e.target.result);

                    // Clear current scene first
                    clearScene();

                    // Load scripts
                    if (projectData.scripts) {
                        Object.entries(projectData.scripts).forEach(([name, source]) => {
                            if (name === 'Main Script') {
                                    // Load into main script editor
                                    if (window.monacoEditor) {
                                        window.monacoEditor.setValue(source);
                                    }
                                } else if (luaObjects[name] && luaObjects[name].ClassName === 'Script') {
                                luaObjects[name].Source = source;
                            }
                        });
                    }

                    // Load objects
                    if (projectData.objects) {
                        Object.entries(projectData.objects).forEach(([name, objData]) => {
                            if (!luaObjects[name]) {
                                // Recreate the object
                                const instance = new RobloxInstance(objData.ClassName, name);
                                Object.assign(instance, objData);
                                luaObjects[name] = instance;

                                // Add to workspace if it's a child of workspace
                                if (objData.Parent === RobloxEnvironment.Workspace) {
                                    RobloxEnvironment.Workspace.Children.push(instance);
                                    addToWorkspaceTree(name, objData.ClassName.toLowerCase());
                                }
                            }
                        });
                    }

                    addOutput('Project loaded!', 'success');
                } catch (error) {
                    addOutput('Error loading project: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        }
    };

    input.click();
}

function addToScene(type) {
    let script = '';

    switch (type) {
        case 'part':
            script = `local part = Instance.new('Part')



part.Position = Vector3.new(0, 5, 0)
part.Size = Vector3.new(4, 2, 4)
part.Color = Color3.new(1, 0.5, 0)
part.Parent = workspace

print('Part added to scene!')`;
            break;

        case 'sound':
            script = `local sound = Instance.new('Sound')
sound.SoundId = 'rbxassetid://142700651'
sound.Volume = 0.7
sound:Play()

print('Sound added and playing!')`;
            break;

        case 'light':
            script = `local light = Instance.new('PointLight')
light.Position = Vector3.new(0, 10, 0)
light.Color = Color3.new(1, 1, 1)
light.Range = 20
light.Parent = workspace

print('Light added to scene!')`;
            break;

        case 'model':
            script = `local model = Instance.new('Model')
model.Name = 'MyModel'
model.Parent = workspace

local part = Instance.new('Part')
part.Position = Vector3.new(0, 5, 0)
part.Size = Vector3.new(2, 2, 2)
part.Color = Color3.new(0, 1, 0)
part.Parent = model

print('Model with part created!')`;
            break;
    }

    const scriptInput = document.getElementById('script-input');
    if (scriptInput.value.trim()) {
        scriptInput.value += '\n\n' + script;
    } else {
        scriptInput.value = script;
    }

    addOutput(`Added ${type} template to script.`, 'success');
}

function addOutput(message, type = 'normal') {
    const outputPanel = document.getElementById('output-panel');
    const line = document.createElement('div');
    line.className = `output-line ${type === 'error' ? 'output-error' : type === 'success' ? 'output-success' : ''}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    outputPanel.appendChild(line);
    outputPanel.scrollTop = outputPanel.scrollHeight;
}
function clearOutput() {
    document.getElementById('output-panel').innerHTML = '';
}

// ===== LUA SCRIPT INTERPRETER =====

function interpretLuaScript(script) {
    const actions = [];
    const lines = script.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Handle while loops
        if (line.includes('while ')) {
            const match = line.match(/while\s+(.+)\s+do/);
            if (match) {
                const condition = match[1];
                actions.push({
                    type: 'while_loop',
                    condition: condition,
                    loopLines: extractFunctionBody(lines, i)
                });
                // Skip the loop body lines
                i += countFunctionLines(lines, i);
                continue;
            }
        }

        // Handle event connections (object.Event:Connect(function))
        if (line.includes(':Connect(')) {
            const match = line.match(/(\w+)\.(\w+):Connect\(\s*function\s*\(\s*([^)]*)\s*\)/);
            if (match) {
                const varName = match[1];
                const eventName = match[2];
                const params = match[3];
                actions.push({
                    type: 'connect_event',
                    varName: varName,
                    eventName: eventName,
                    params: params,
                    functionLines: extractFunctionBody(lines, i)
                });
                // Skip the function body lines
                i += countFunctionLines(lines, i);
                continue;
            }
        }

        // Handle Instance.new
        if (line.includes('Instance.new')) {
            const match = line.match(/local\s+(\w+)\s*=\s*Instance\.new\(['"]([^'"]+)['"]\)/);
            if (match) {
                const varName = match[1];
                const className = match[2];
                actions.push({
                    type: 'create_instance',
                    varName: varName,
                    className: className
                });
                continue;
            }
        }

        // Handle property assignments
        if (line.includes('=')) {
            const match = line.match(/(\w+)\.(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                const property = match[2];
                const value = match[3];
                actions.push({
                    type: 'set_property',
                    varName: varName,
                    property: property,
                    value: value
                });
                continue;
            }
        }

        // Handle method calls
        if (line.includes(':')) {
            const match = line.match(/(\w+):(\w+)\(([^)]*)\)/);
            if (match) {
                const varName = match[1];
                const method = match[2];
                const args = match[3];
                actions.push({
                    type: 'call_method',
                    varName: varName,
                    method: method,
                    args: args
                });
                continue;
            }
        }

        // Handle function definitions
        if (line.includes('function ')) {
            const match = line.match(/function\s+(\w+)\s*\(/);
            if (match) {
                const funcName = match[1];
                actions.push({
                    type: 'define_function',
                    funcName: funcName,
                    functionLines: extractFunctionBody(lines, i)
                });
                // Skip the function body lines
                i += countFunctionLines(lines, i);
                continue;
            }
        }

        // Handle print statements
        if (line.startsWith('print(')) {
            const match = line.match(/print\('([^']+)'\)/);
            if (match) {
                actions.push({
                    type: 'print',
                    message: match[1]
                });
                continue;
            }
        }

        // Handle variable assignments
        if (line.includes('=') && !line.includes('local')) {
            const match = line.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                const value = match[2];
                actions.push({
                    type: 'set_variable',
                    varName: varName,
                    value: value
                });
                continue;
            }
        }
    }

    return actions;
}

function extractFunctionBody(lines, startIndex) {
    const body = [];
    let braceCount = 0;
    let inFunction = false;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('function') || line.includes('do')) {
            inFunction = true;
            braceCount++;
        }

        if (inFunction) {
            body.push(line);
        }

        if (line.includes('end')) {
            braceCount--;
            if (braceCount === 0) {
                break;
            }
        }
    }

    return body;
}

function countFunctionLines(lines, startIndex) {
    let count = 0;
    let braceCount = 0;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        count++;

        if (line.includes('function') || line.includes('do')) {
            braceCount++;
        }

        if (line.includes('end')) {
            braceCount--;
            if (braceCount === 0) {
                break;
            }
        }
    }

    return count;
}

function executeLuaActions(actions) {
    const variables = {};
    const functions = {};

    actions.forEach(action => {
        try {
            switch (action.type) {
                case 'create_instance':
                    let instance;
                    if (action.className === 'Frame') {
                        instance = new Frame(action.varName);
                    } else if (action.className === 'TextLabel') {
                        instance = new TextLabel(action.varName);
                    } else if (action.className === 'TextButton') {
                        instance = new TextButton(action.varName);
                    } else if (action.className === 'ScreenGui') {
                        instance = new ScreenGui(action.varName);
                    } else {
                        instance = new RobloxInstance(action.className, action.varName);
                    }
                    instance.isScriptCreated = true;
                    variables[action.varName] = instance;
                    luaObjects[action.varName] = instance; // Also add to global luaObjects for animation

                    // Create 3D representation for parts
                    if (action.className === 'Part') {
                        const geometry = new THREE.BoxGeometry(4, 4, 4);
                        const material = new THREE.MeshLambertMaterial({ color: 0xff6600 });
                        const part = new THREE.Mesh(geometry, material);
                        part.position.set(0, 5, 0); // Default position
                        part.castShadow = true;
                        part.receiveShadow = true;
                        scene.add(part);
                        instance.threeObject = part;
                        instance.CanCollide = true;
                        instance.Size = new THREE.Vector3(4, 4, 4);
                        instance.Position = part.position.clone();

                        // Create physics body through manager
                        if (RobloxEnvironment.physicsBodyManager) {
                            RobloxEnvironment.physicsBodyManager.createBody(instance);
                        }

                        // Set parent to workspace
                        instance.Parent = RobloxEnvironment.Workspace;
                        RobloxEnvironment.Workspace.Children.push(instance);
                        addToWorkspaceTree(action.varName, 'part');
                    }

                    addOutput(`Created ${action.className} instance: ${action.varName}`, 'success');
                    break;

                case 'set_property':
                    const targetObj = variables[action.varName] || luaObjects[action.varName];
                    if (targetObj) {
                        const value = parseValue(action.value);

                        switch (action.property) {
                            case 'Position':
                                if (targetObj instanceof GuiObject) {
                                    // For GUI objects, Position should be Vector2
                                    if (value instanceof THREE.Vector2) {
                                        targetObj.Position = value;
                                        targetObj.updateStyle();
                                    }
                                } else if (value instanceof THREE.Vector3) {
                                    targetObj.Position = value;
                                    if (targetObj.threeObject) {
                                        targetObj.threeObject.position.copy(value);
                                    }
                                    // Update physics body if it exists
                                    if (targetObj.cannonBody) {
                                        targetObj.cannonBody.position.copy(value);
                                    }
                                }
                                break;
                            case 'Size':
                                if (targetObj instanceof GuiObject) {
                                    // For GUI objects, Size should be Vector2
                                    if (value instanceof THREE.Vector2) {
                                        targetObj.Size = value;
                                        targetObj.updateStyle();
                                    }
                                } else if (value instanceof THREE.Vector3) {
                                    targetObj.Size = value;
                                    if (targetObj.threeObject) {
                                        targetObj.threeObject.scale.copy(value).multiplyScalar(0.5);
                                    }
                                }
                                break;
                            case 'Color':
                                if (value instanceof THREE.Color) {
                                    targetObj.Color = value;
                                    if (targetObj.threeObject && targetObj.threeObject.material) {
                                        targetObj.threeObject.material.color = value;
                                    }
                                }
                                break;
                            case 'Transparency':
                                targetObj.Transparency = parseFloat(value) || 0;
                                if (targetObj.threeObject && targetObj.threeObject.material) {
                                    targetObj.threeObject.material.transparent = true;
                                    targetObj.threeObject.material.opacity = 1 - targetObj.Transparency;
                                }
                                break;
                            case 'Anchored':
                                targetObj.Anchored = value === 'true' || value === true;
                                break;
                            case 'CanCollide':
                                targetObj.CanCollide = value === 'true' || value === true;
                                updateCollisionVisualFeedback(targetObj);
                                break;
                            case 'Parent':
                                if (value === 'workspace') {
                                    targetObj.Parent = RobloxEnvironment.Workspace;
                                    RobloxEnvironment.Workspace.Children.push(targetObj);
                                    addToWorkspaceTree(targetObj.Name, targetObj.ClassName.toLowerCase());
                                }
                                break;
                            case 'Name':
                                targetObj.Name = value;
                                break;
                        }
                        addOutput(`Set ${action.varName}.${action.property} = ${action.value}`, 'success');
                    } else {
                        addOutput(`Error: Object '${action.varName}' not found`, 'error');
                    }
                    break;

                case 'connect_event':
                    const eventObj = variables[action.varName] || luaObjects[action.varName];
                    if (eventObj) {
                        // Create event connection
                        const connection = {
                            object: eventObj,
                            eventName: action.eventName,
                            callback: function(...args) {
                                // Execute the function body
                                executeFunctionBody(action.functionLines, action.params, args);
                            }
                        };

                        // Store connection for cleanup
                        if (!eventObj.connections) eventObj.connections = [];
                        eventObj.connections.push(connection);

                        // Set up actual event listeners based on event type
                        if (action.eventName === 'Touched') {
                            // For parts, set up Touched event connections
                            eventObj.Touched = {
                                Connect: function(callback) {
                                    if (!eventObj.touchedConnections) eventObj.touchedConnections = [];
                                    eventObj.touchedConnections.push(callback);
                                    return { Disconnect: function() { /* TODO: implement disconnect */ } };
                                }
                            };
                            addOutput(`Connected ${action.varName}.Touched event`, 'success');
                        } else if (action.eventName === 'Changed') {
                            addOutput(`Connected ${action.varName}.Changed event`, 'success');
                        } else if (action.eventName === 'MouseButton1Click') {
                            // For GUI objects, use the Connect method if available (TextButton), otherwise direct listener
                            if (eventObj instanceof GuiObject && eventObj.element) {
                                if (eventObj.MouseButton1Click && eventObj.MouseButton1Click.Connect) {
                                    // Use the object's Connect method (for TextButton)
                                    eventObj.MouseButton1Click.Connect(() => {
                                        addOutput(`MouseButton1Click triggered for ${action.varName}`, 'success');
                                        // Execute the function body
                                        executeFunctionBody(action.functionLines, action.params, []);
                                    });
                                } else {
                                    // Fallback to direct event listener for other GUI objects
                                    eventObj.element.addEventListener('click', () => {
                                        addOutput(`MouseButton1Click triggered for ${action.varName}`, 'success');
                                        // Execute the function body
                                        executeFunctionBody(action.functionLines, action.params, []);
                                    });
                                }
                                addOutput(`Connected ${action.varName}.MouseButton1Click event`, 'success');
                            }
                        }

                        RobloxEnvironment.connections = RobloxEnvironment.connections || [];
                        RobloxEnvironment.connections.push(connection);
                    }
                    break;

                case 'define_function':
                    functions[action.funcName] = action.functionLines;
                    addOutput(`Defined function: ${action.funcName}`, 'success');
                    break;

                case 'call_method':
                    const methodObj = variables[action.varName] || luaObjects[action.varName];
                    if (methodObj) {
                        switch (action.method) {
                            case 'Play':
                                if (methodObj.ClassName === 'Sound' && methodObj.audio) {
                                    methodObj.audio.play();
                                    addOutput(`Playing sound: ${action.varName}`, 'success');
                                }
                                break;
                            case 'Destroy':
                                if (methodObj.Destroy) {
                                    methodObj.Destroy();
                                    delete variables[action.varName];
                                    delete luaObjects[action.varName];
                                    addOutput(`Destroyed ${action.varName}`, 'success');
                                }
                                break;
                            case 'Spin':
                                if (methodObj.Spin) {
                                    // Parse argument if provided (e.g. Vector3.new(0,0,1))
                                    let axis = null;
                                    if (action.args && action.args.trim()) {
                                        const args = action.args.split(',').map(a => a.trim());
                                        if (args.length > 0 && args[0]) {
                                            axis = parseValue(args[0]);
                                        }
                                    }
                                    methodObj.Spin(axis);
                                    addOutput(`Spinning ${action.varName} (axis=${axis})`, 'success');
                                }
                                break;
                        }
                    } else if (functions[action.varName]) {
                        // Call user-defined function
                        executeFunctionBody(functions[action.varName], '', []);
                        addOutput(`Called function: ${action.varName}`, 'success');
                    } else {
                        // Check if it's a script object in the workspace
                        const scriptObj = luaObjects[action.varName];
                        if (scriptObj && scriptObj.ClassName === 'Script' && scriptObj.Source) {
                            // Execute the script's source code
                            try {
                                const scriptActions = interpretLuaScript(scriptObj.Source);
                                executeLuaActions(scriptActions);
                                addOutput(`Executed script: ${action.varName}`, 'success');
                            } catch (error) {
                                addOutput(`Error executing script ${action.varName}: ${error.message}`, 'error');
                            }
                        } else {
                            addOutput(`Error: Object '${action.varName}' not found for method call`, 'error');
                        }
                    }
                    break;

                case 'set_variable':
                    variables[action.varName] = parseValue(action.value);
                    addOutput(`Set variable ${action.varName} = ${action.value}`, 'success');
                    break;

                case 'while_loop':
                    // Handle while loops - for now just execute once for "while true do"
                    if (action.condition === 'true') {
                        addOutput('Starting infinite loop (while true do)', 'success');
                        // Execute the loop body once for now
                        executeFunctionBody(action.loopLines, '', []);
                    }
                    break;

                case 'print':
                    addOutput(action.message, 'success');
                    break;
            }
        } catch (error) {
            addOutput(`Error executing action: ${error.message}`, 'error');
        }
    });
}

function executeFunctionBody(functionLines, paramString, args) {
    // Simple function execution - for now just execute the lines
    const functionActions = interpretLuaScript(functionLines.join('\n'));
    executeLuaActions(functionActions);
}

function openScriptTab(scriptObj) {
    const scriptName = scriptObj.Name;
    const tabId = `script-tab-${scriptName}`;
    const tabData = `script-${scriptName}`;

    // Check if tab already exists
    if (document.getElementById(tabId)) {
        switchTab(tabData);
        return;
    }

    // Create new tab
    const tabsContainer = document.getElementById('studio-tabs');
    const newTab = document.createElement('div');
    newTab.className = 'tab';
    newTab.setAttribute('data-tab', tabData);
    newTab.textContent = scriptName;
    newTab.onclick = () => switchTab(tabData);

    // Add close button
    const closeBtn = document.createElement('span');
    closeBtn.textContent = ' ×';
    closeBtn.style.marginLeft = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeScriptTab(scriptName);
    };
    newTab.appendChild(closeBtn);

    tabsContainer.appendChild(newTab);

    // Create script editor content
    const contentContainer = document.querySelector('.studio-content');
    const scriptEditor = document.createElement('div');
    scriptEditor.className = 'code-editor';
    scriptEditor.id = tabId;

    // Create the enhanced code editor
    const editorContainer = document.createElement('div');
    editorContainer.className = 'code-editor-container';

    scriptEditor.appendChild(editorContainer);
    contentContainer.appendChild(scriptEditor);

    // Initialize Monaco Editor for script tabs
    (function() {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js';
        script.onload = function() {
            require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
            require(['vs/editor/editor.main'], function() {
                // Register Lua language if not already registered
                if (!monaco.languages.getLanguages().find(lang => lang.id === 'lua')) {
                    monaco.languages.register({ id: 'lua' });
                    monaco.languages.setMonarchTokensProvider('lua', {
                        tokenizer: {
                            root: [
                                [/--.*$/, 'comment'],
                                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                                [/"([^"\\]|\\.)*"/, 'string'],
                                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                                [/'([^'\\]|\\.)*'/, 'string'],
                                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                                [/\d+/, 'number'],
                                [/\b(local|function|end|if|then|else|elseif|for|while|do|repeat|until|return|break|in|and|or|not|true|false|nil)\b/, 'keyword'],
                                [/\b(Instance|new|Vector3|Color3|CFrame|workspace|game|script|print|wait|spawn|delay|tick|time|os|math|string|table)\b/, 'keyword.control'],
                                [/[\+\-\*\/%=<>!]=?/, 'operator'],
                                [/[{}()\[\]]/, 'delimiter']
                            ]
                        }
                    });
                }

                // Create Monaco Editor for this script
                const monacoEditor = monaco.editor.create(editorContainer, {
                    value: scriptObj.Source || `-- Script: ${scriptObj.Name}\n-- Write your Lua code here\n\nprint('Hello from ${scriptObj.Name}!')`,
                    language: 'lua',
                    theme: 'vs-dark',
                    fontSize: 12,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                    tabSize: 4,
                    insertSpaces: true,
                    folding: true,
                    lineNumbers: 'on',
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                    contextmenu: true,
                    mouseWheelZoom: true,
                    smoothScrolling: true,
                    cursorBlinking: 'blink',
                    cursorSmoothCaretAnimation: true,
                    renderLineHighlight: 'line',
                    selectOnLineNumbers: true,
                    roundedSelection: false,
                    readOnly: false,
                    glyphMargin: false,
                    useTabStops: false,
                    autoClosingBrackets: 'always',
                    autoClosingQuotes: 'always',
                    autoSurround: 'languageDefined',
                    autoIndent: 'advanced',
                    formatOnPaste: true,
                    formatOnType: true,
                    acceptSuggestionOnCommitCharacter: true,
                    acceptSuggestionOnEnter: 'on',
                    accessibilitySupport: 'auto',
                    codeLens: false,
                    colorDecorators: true,
                    lightbulb: { enabled: 'on' },
                    quickSuggestions: {
                        other: true,
                        comments: true,
                        strings: true
                    },
                    parameterHints: { enabled: true },
                    suggestOnTriggerCharacters: true,
                    acceptSuggestionOnEnter: 'on',
                    tabCompletion: 'on',
                    wordBasedSuggestions: true
                });

                // Handle editor changes
                monacoEditor.onDidChangeModelContent(function() {
                    scriptObj.Source = monacoEditor.getValue();
                });

                // Store reference
                scriptEditor.monacoEditor = monacoEditor;

                console.log(`Monaco Editor initialized for script: ${scriptObj.Name}`);
            });
        };
        document.head.appendChild(script);
    })();

    // Switch to the new tab
    switchTab(tabData);
}

function closeScriptTab(scriptName) {
    const tabData = `script-${scriptName}`;
    const tabId = `script-tab-${scriptName}`;

    // Remove tab
    const tab = document.querySelector(`[data-tab="${tabData}"]`);
    if (tab) tab.remove();

    // Remove content
    const content = document.getElementById(tabId);
    if (content) content.remove();

    // Switch back to viewport if this was the active tab
    if (currentTab === tabData) {
        switchTab('viewport');
    }
}

// Enhanced error highlighting and debugging features
function addErrorHighlighting(scriptName, errors) {
    const scriptTab = document.getElementById(`script-tab-${scriptName}`);
    if (!scriptTab || !scriptTab.monacoEditor) return;

    const editor = scriptTab.monacoEditor;

    // Clear previous error highlights
    const model = editor.getModel();
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    const errorMarkers = markers.filter(marker => marker.severity === monaco.MarkerSeverity.Error);

    // Add error highlights
    const newMarkers = errors.map(error => ({
        severity: monaco.MarkerSeverity.Error,
        message: error.message,
        startLineNumber: error.line,
        startColumn: 1,
        endLineNumber: error.line,
        endColumn: model.getLineLength(error.line) + 1
    }));

    monaco.editor.setModelMarkers(model, 'lua-syntax', newMarkers);
}

function clearErrorHighlighting(scriptName) {
    const scriptTab = document.getElementById(`script-tab-${scriptName}`);
    if (!scriptTab || !scriptTab.monacoEditor) return;

    const editor = scriptTab.monacoEditor;
    const model = editor.getModel();
    monaco.editor.setModelMarkers(model, 'lua-syntax', []);
}

// Enhanced script execution with error reporting
function runScriptWithErrorHandling(scriptName = null) {
    let scriptInput, script, scriptObj;

    if (scriptName) {
        scriptObj = luaObjects[scriptName];
        if (scriptObj && scriptObj.ClassName === 'Script') {
            script = scriptObj.Source || '';
        } else {
            addOutput(`Error: Script "${scriptName}" not found!`, 'error');
            return;
        }
    } else {
        // For main script editor
        if (window.monacoEditor) {
            script = window.monacoEditor.getValue().trim();
        } else {
            addOutput('Error: No script to run!', 'error');
            return;
        }
    }

    if (!script) {
        addOutput('Error: Script is empty!', 'error');
        return;
    }

    clearOutput();
    clearErrorHighlighting(scriptName);
    addOutput(`Executing ${scriptName ? scriptName : 'script'}...`, 'success');

    try {
        const actions = interpretLuaScript(script);
        console.log('RoGold Studio: Parsed actions:', actions);

        // Check for syntax errors before execution
        const syntaxErrors = checkLuaSyntax(script);
        if (syntaxErrors.length > 0) {
            syntaxErrors.forEach(error => {
                addOutput(`Syntax Error (Line ${error.line}): ${error.message}`, 'error');
            });
            addErrorHighlighting(scriptName, syntaxErrors);
            return;
        }

        executeLuaActions(actions);

        // Start game loop for continuous execution
        startGameLoop();

        addOutput(`Script executed successfully! Generated ${actions.length} actions.`, 'success');
        addOutput('Game loop is now running...', 'success');
    } catch (error) {
        console.error('RoGold Studio: Script execution error:', error);
        addOutput(`Runtime Error: ${error.message}`, 'error');

        // Try to extract line number from error
        const lineMatch = error.message.match(/line (\d+)/i);
        if (lineMatch) {
            const lineNum = parseInt(lineMatch[1]);
            addErrorHighlighting(scriptName, [{ line: lineNum, message: error.message }]);
        }
    }
}

function checkLuaSyntax(script) {
    const errors = [];
    const lines = script.split('\n');

    // Basic syntax checks
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let stringOpen = false;
    let stringChar = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let inComment = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const nextChar = line[j + 1] || '';

            // Handle comments
            if (char === '-' && nextChar === '-') {
                inComment = true;
                break;
            }

            if (inComment) continue;

            // Handle strings
            if ((char === '"' || char === "'") && !stringOpen) {
                stringOpen = true;
                stringChar = char;
            } else if (char === stringChar && stringOpen) {
                stringOpen = false;
                stringChar = '';
            } else if (stringOpen) {
                continue; // Skip characters inside strings
            }

            // Count braces
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;
            else if (char === '(') parenCount++;
            else if (char === ')') parenCount--;
            else if (char === '[') bracketCount++;
            else if (char === ']') bracketCount--;
        }

        // Check for unclosed strings
        if (stringOpen) {
            errors.push({
                line: i + 1,
                message: `Unclosed string literal starting with ${stringChar}`
            });
        }
    }

    // Check for mismatched braces
    if (braceCount > 0) {
        errors.push({ line: lines.length, message: 'Missing closing brace }' });
    } else if (braceCount < 0) {
        errors.push({ line: lines.length, message: 'Extra closing brace }' });
    }

    if (parenCount > 0) {
        errors.push({ line: lines.length, message: 'Missing closing parenthesis )' });
    } else if (parenCount < 0) {
        errors.push({ line: lines.length, message: 'Extra closing parenthesis )' });
    }

    if (bracketCount > 0) {
        errors.push({ line: lines.length, message: 'Missing closing bracket ]' });
    } else if (bracketCount < 0) {
        errors.push({ line: lines.length, message: 'Extra closing bracket ]' });
    }

    return errors;
}

function closeAllScriptTabs() {
    // Close all script tabs
    Object.keys(luaObjects).forEach(name => {
        if (luaObjects[name].ClassName === 'Script') {
            closeScriptTab(name);
        }
    });
}

function clearScript(scriptName) {
    const scriptObj = luaObjects[scriptName];
    if (scriptObj && scriptObj.ClassName === 'Script') {
        scriptObj.Source = '';
        const scriptTab = document.getElementById(`script-tab-${scriptName}`);
        if (scriptTab && scriptTab.monacoEditor) {
            scriptTab.monacoEditor.setValue('');
        }
        clearOutput();
    }
}

function setupScriptEditor() {
    const scriptInput = document.getElementById('script-input');
    const lineNumbers = document.getElementById('script-line-numbers');

    if (!scriptInput || !lineNumbers) {
        console.error('RoGold Studio: Script editor elements not found');
        return;
    }

    // Function to update line numbers
    function updateLineNumbers() {
        const lines = scriptInput.value.split('\n');
        const lineCount = lines.length;
        let lineNumbersHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            lineNumbersHTML += i + '\n';
        }
        lineNumbers.textContent = lineNumbersHTML;
    }

    // Initial line numbers
    updateLineNumbers();

    // Update line numbers on input
    scriptInput.addEventListener('input', updateLineNumbers);

    // Handle scrolling to keep line numbers in sync
    scriptInput.addEventListener('scroll', () => {
        lineNumbers.scrollTop = scriptInput.scrollTop;
    });

    // Handle tab key for indentation
    scriptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = scriptInput.selectionStart;
            const end = scriptInput.selectionEnd;
            const value = scriptInput.value;

            // Insert 4 spaces for tab
            scriptInput.value = value.substring(0, start) + '    ' + value.substring(end);
            scriptInput.selectionStart = scriptInput.selectionEnd = start + 4;
            updateLineNumbers();
        }

        // Handle Ctrl+Enter to run script
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            runScript();
        }

        // Handle basic bracket completion
        if (e.key === '(') {
            const cursorPos = scriptInput.selectionStart;
            const before = scriptInput.value.substring(0, cursorPos);
            const after = scriptInput.value.substring(cursorPos);
            scriptInput.value = before + '()' + after;
            scriptInput.selectionStart = scriptInput.selectionEnd = cursorPos + 1;
            updateLineNumbers();
            e.preventDefault();
        }

        if (e.key === '{') {
            const cursorPos = scriptInput.selectionStart;
            const before = scriptInput.value.substring(0, cursorPos);
            const after = scriptInput.value.substring(cursorPos);
            scriptInput.value = before + '{}' + after;
            scriptInput.selectionStart = scriptInput.selectionEnd = cursorPos + 1;
            updateLineNumbers();
            e.preventDefault();
        }

        if (e.key === '[') {
            const cursorPos = scriptInput.selectionStart;
            const before = scriptInput.value.substring(0, cursorPos);
            const after = scriptInput.value.substring(cursorPos);
            scriptInput.value = before + '[]' + after;
            scriptInput.selectionStart = scriptInput.selectionEnd = cursorPos + 1;
            updateLineNumbers();
            e.preventDefault();
        }

        if (e.key === '"' || e.key === "'") {
            const cursorPos = scriptInput.selectionStart;
            const before = scriptInput.value.substring(0, cursorPos);
            const after = scriptInput.value.substring(cursorPos);
            const quote = e.key;
            scriptInput.value = before + quote + quote + after;
            scriptInput.selectionStart = scriptInput.selectionEnd = cursorPos + 1;
            updateLineNumbers();
            e.preventDefault();
        }
    });

    // Add basic autocomplete/intellisense hints
    scriptInput.addEventListener('keydown', (e) => {
        // Auto-complete on Ctrl+Space
        if (e.ctrlKey && e.key === ' ') {
            e.preventDefault();
            showIntelliSense(scriptInput);
        }

        // Show autocomplete dropdown on typing
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            setTimeout(() => showAutocompleteDropdown(scriptInput), 100);
        }
    });


    console.log('RoGold Studio: Script editor setup complete');
}

function showIntelliSense(textarea) {
    const cursorPos = textarea.selectionStart;
    const text = textarea.value;
    const wordStart = text.lastIndexOf(' ', cursorPos - 1) + 1;
    const currentWord = text.substring(wordStart, cursorPos).toLowerCase();

    // Get all object names from workspace for autocomplete
    const objectNames = Object.keys(luaObjects);

    const suggestions = [
        // Lua keywords
        'local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'for', 'while', 'do', 'repeat', 'until',
        'return', 'break', 'in', 'and', 'or', 'not', 'true', 'false', 'nil',

        // Roblox API
        'Instance.new', 'Vector3.new', 'Color3.new', 'CFrame.new',
        'workspace', 'game', 'script', 'print', 'wait', 'spawn', 'delay',
        'tick', 'time', 'os.time', 'math.random', 'math.floor', 'math.ceil',
        'string.sub', 'string.len', 'string.find', 'table.insert', 'table.remove',

        // Roblox classes
        'Part', 'Model', 'Script', 'PointLight', 'Sound', 'Humanoid', 'Player', 'Frame', 'TextLabel', 'TextButton', 'ScreenGui',

        // Roblox events/properties
        'Touched', 'TouchEnded', 'Changed', 'ChildAdded', 'ChildRemoved',
        'Position', 'Size', 'Color', 'Transparency', 'Anchored', 'CanCollide',
        'Parent', 'Name', 'ClassName',

        // Current workspace objects
        ...objectNames
    ];

    const matches = suggestions.filter(s => s.toLowerCase().startsWith(currentWord));

    if (matches.length > 0) {
        // For now, just insert the first match. A full implementation would show a dropdown
        const completion = matches[0].substring(currentWord.length);
        const before = text.substring(0, cursorPos);
        const after = text.substring(cursorPos);
        textarea.value = before + completion + after;
        textarea.selectionStart = textarea.selectionEnd = cursorPos + completion.length;
        updateLineNumbers();
    }
}

function showAutocompleteDropdown(textarea) {
    // Remove existing dropdown
    const existingDropdown = document.querySelector('.autocomplete-dropdown');
    if (existingDropdown) existingDropdown.remove();

    const cursorPos = textarea.selectionStart;
    const text = textarea.value;
    const wordStart = text.lastIndexOf(' ', cursorPos - 1) + 1;
    const currentWord = text.substring(wordStart, cursorPos).toLowerCase();

    if (currentWord.length < 2) return; // Only show for words 2+ characters

    // Get all object names from workspace for autocomplete
    const objectNames = Object.keys(luaObjects);

    const suggestions = [
        // Lua keywords
        'local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'for', 'while', 'do', 'repeat', 'until',
        'return', 'break', 'in', 'and', 'or', 'not', 'true', 'false', 'nil',

        // Roblox API
        'Instance.new', 'Vector3.new', 'Color3.new', 'CFrame.new',
        'workspace', 'game', 'script', 'print', 'wait', 'spawn', 'delay',
        'tick', 'time', 'os.time', 'math.random', 'math.floor', 'math.ceil',
        'string.sub', 'string.len', 'string.find', 'table.insert', 'table.remove',

        // Roblox classes
        'Part', 'Model', 'Script', 'PointLight', 'Sound', 'Humanoid', 'Player',

        // Roblox events/properties
        'Touched', 'TouchEnded', 'Changed', 'ChildAdded', 'ChildRemoved',
        'Position', 'Size', 'Color', 'Transparency', 'Anchored', 'CanCollide',
        'Parent', 'Name', 'ClassName',

        // Current workspace objects
        ...objectNames
    ];

    const matches = suggestions.filter(s => s.toLowerCase().startsWith(currentWord)).slice(0, 10); // Limit to 10

    if (matches.length === 0) return;

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    dropdown.style.cssText = `
        position: absolute;
        background: #ffffff;
        border: 1px solid #c0c0c0;
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        font-family: Tahoma, sans-serif;
        font-size: 11px;
    `;

    matches.forEach((match, index) => {
        const item = document.createElement('div');
        item.textContent = match;
        item.style.cssText = `
            padding: 2px 4px;
            cursor: pointer;
            background: ${index === 0 ? '#316ac5' : '#ffffff'};
            color: ${index === 0 ? '#ffffff' : '#000000'};
        `;
        item.onmouseover = () => {
            document.querySelectorAll('.autocomplete-dropdown div').forEach(div => {
                div.style.background = '#ffffff';
                div.style.color = '#000000';
            });
            item.style.background = '#316ac5';
            item.style.color = '#ffffff';
        };
        item.onclick = () => {
            const completion = match.substring(currentWord.length);
            const before = text.substring(0, cursorPos);
            const after = text.substring(cursorPos);
            textarea.value = before + completion + after;
            textarea.selectionStart = textarea.selectionEnd = cursorPos + completion.length;
            updateLineNumbers();
            dropdown.remove();
            textarea.focus();
        };
        dropdown.appendChild(item);
    });

    // Position dropdown
    const rect = textarea.getBoundingClientRect();
    const lineHeight = 14; // Approximate line height
    const cursorLine = text.substring(0, cursorPos).split('\n').length;
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.top + (cursorLine * lineHeight) + 'px';
    dropdown.style.width = '200px';

    document.body.appendChild(dropdown);

    // Handle keyboard navigation
    let selectedIndex = 0;
    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, matches.length - 1);
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            updateSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const selectedMatch = matches[selectedIndex];
            const completion = selectedMatch.substring(currentWord.length);
            const before = text.substring(0, cursorPos);
            const after = text.substring(cursorPos);
            textarea.value = before + completion + after;
            textarea.selectionStart = textarea.selectionEnd = cursorPos + completion.length;
            updateLineNumbers();
            dropdown.remove();
            document.removeEventListener('keydown', handleKeyDown);
        } else if (e.key === 'Escape') {
            dropdown.remove();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };

    const updateSelection = () => {
        document.querySelectorAll('.autocomplete-dropdown div').forEach((div, index) => {
            div.style.background = index === selectedIndex ? '#316ac5' : '#ffffff';
            div.style.color = index === selectedIndex ? '#ffffff' : '#000000';
        });
    };

    document.addEventListener('keydown', handleKeyDown);

    // Remove dropdown when clicking outside
    const removeDropdown = (e) => {
        if (!dropdown.contains(e.target) && e.target !== textarea) {
            dropdown.remove();
            document.removeEventListener('click', removeDropdown);
            document.removeEventListener('keydown', handleKeyDown);
        }
    };
    setTimeout(() => document.addEventListener('click', removeDropdown), 100);
}

function initializeMainScriptEditor() {
    // Monaco Editor is initialized in the HTML file
    // This function is kept for compatibility
    console.log('RoGold Studio: Main script editor initialization handled in HTML');
}

function clearMainScript() {
    if (window.monacoEditor) {
        window.monacoEditor.setValue('-- Script code here\n-- Write your Lua code below\n\nprint(\'Hello World!\')');
        clearOutput();
    }
}

function loadScriptIntoEditor(scriptObj) {
    // This function is no longer needed since we use dedicated tabs for each script
    // Keeping it for potential future use
}

// This function is no longer needed since line numbers are handled by the code editor
function updateLineNumbers() {
    // Legacy function - kept for compatibility
}

function parseValue(valueStr) {
    // Parse Vector2.new(x, y) for GUI objects
    const vector2Match = valueStr.match(/Vector2\.new\(([^,]+),\s*([^)]+)\)/);
    if (vector2Match) {
        return new THREE.Vector2(
            parseFloat(vector2Match[1]),
            parseFloat(vector2Match[2])
        );
    }

    // Parse Vector3.new(x, y, z)
    const vectorMatch = valueStr.match(/Vector3\.new\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (vectorMatch) {
        return new THREE.Vector3(
            parseFloat(vectorMatch[1]),
            parseFloat(vectorMatch[2]),
            parseFloat(vectorMatch[3])
        );
    }

    // Parse Color3.new(r, g, b)
    const colorMatch = valueStr.match(/Color3\.new\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (colorMatch) {
        return new THREE.Color(
            parseFloat(colorMatch[1]),
            parseFloat(colorMatch[2]),
            parseFloat(colorMatch[3])
        );
    }

    // Parse strings
    if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
        return valueStr.slice(1, -1);
    }

    // Parse numbers
    if (!isNaN(valueStr)) {
        return parseFloat(valueStr);
    }

    // Return as string for other cases
    return valueStr;
}

// ===== GUI CLASSES =====

class GuiObject extends RobloxInstance {
    constructor(className, name) {
        super(className, name);
        this.Position = new THREE.Vector2(0, 0);
        this.Size = new THREE.Vector2(200, 200);
        this.BackgroundColor = new THREE.Color(0.5, 0.5, 0.5);
        this.BackgroundTransparency = 0;
        this.BorderColor = new THREE.Color(0.1, 0.1, 0.1);
        this.BorderSizePixel = 1;
        this.Visible = true;
        this.ZIndex = 1;

        // Create DOM element
        this.element = document.createElement('div');
        this.element.className = 'rogold-gui ' + className.toLowerCase();
        this.element.style.position = 'absolute';
        this.updateStyle();
    }

    setParent(parent) {
        try {
            // Remove from current parent
            if (this.Parent && this.Parent !== parent) {
                if (this.Parent.Children) {
                    this.Parent.Children = this.Parent.Children.filter(child => child !== this);
                }
                // Only remove from DOM if not moving to PlayerGui (studio preview)
                if (this.element && this.element.parentNode && !(parent === RobloxEnvironment.PlayerGui || parent.Name === 'PlayerGui')) {
                    this.element.parentNode.removeChild(this.element);
                }
            }

            // Set new parent
            this.Parent = parent;

            // Add to new parent
            if (parent) {
                if (parent.Children) {
                    parent.Children.push(this);
                }

                // Handle DOM management for PlayerGui - strict isolation to studio preview
                if (parent === RobloxEnvironment.PlayerGui || parent.Name === 'PlayerGui') {
                    RobloxEnvironment.PlayerGui.AddGui(this);
                }
            }
        } catch (error) {
            console.error('Error setting parent for GUI object:', error);
            addOutput(`Error setting parent for ${this.Name}: ${error.message}`, 'error');
        }
    }

    updateStyle() {
        try {
            this.element.style.left = this.Position.x + 'px';
            this.element.style.top = this.Position.y + 'px';
            this.element.style.width = this.Size.x + 'px';
            this.element.style.height = this.Size.y + 'px';
            this.element.style.backgroundColor = `#${this.BackgroundColor.getHexString()}`;
            this.element.style.opacity = 1 - this.BackgroundTransparency;
            this.element.style.borderColor = `#${this.BorderColor.getHexString()}`;
            this.element.style.borderWidth = this.BorderSizePixel + 'px';
            this.element.style.display = this.Visible ? 'block' : 'none';
            this.element.style.zIndex = this.ZIndex;
        } catch (error) {
            console.error('Error updating GUI style:', error);
            addOutput(`Error updating style for ${this.Name}: ${error.message}`, 'error');
        }
    }

    Destroy() {
        try {
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            super.Destroy();
        } catch (error) {
            console.error('Error destroying GUI object:', error);
            addOutput(`Error destroying ${this.Name}: ${error.message}`, 'error');
        }
    }
}

class Frame extends GuiObject {
    constructor(name) {
        super('Frame', name);
        this.element.style.backgroundColor = '#ffffff';
        this.element.style.border = '1px solid #000000';
    }
}

class TextLabel extends GuiObject {
    constructor(name) {
        super('TextLabel', name);
        this.Text = '';
        this.TextColor = new THREE.Color(0, 0, 0);
        this.TextSize = 14;
        this.Font = 'Arial';
        this.TextWrapped = true;
        this.TextXAlignment = 'Left';
        this.TextYAlignment = 'Top';

        this.element.style.color = '#000000';
        this.element.style.fontSize = this.TextSize + 'px';
        this.element.style.fontFamily = this.Font;
        this.element.style.padding = '5px';
        this.updateTextStyle();
    }

    updateTextStyle() {
        this.element.textContent = this.Text;
        this.element.style.color = `#${this.TextColor.getHexString()}`;
        this.element.style.fontSize = this.TextSize + 'px';
        this.element.style.fontFamily = this.Font;
        this.element.style.whiteSpace = this.TextWrapped ? 'normal' : 'nowrap';
        this.element.style.textAlign = this.TextXAlignment.toLowerCase();
        this.element.style.verticalAlign = this.TextYAlignment.toLowerCase();
    }
}

class TextButton extends GuiObject {
    constructor(name) {
        super('TextButton', name);
        this.Text = '';
        this.TextColor = new THREE.Color(0, 0, 0);
        this.TextSize = 14;
        this.Font = 'Arial';
        this.AutoButtonColor = true;

        this.element.style.cursor = 'pointer';
        this.element.style.textAlign = 'center';
        this.element.style.lineHeight = '2';
        this.element.style.userSelect = 'none';
        this.updateTextStyle();

        if (this.AutoButtonColor) {
            this.setupHoverEffects();
        }

        // Event system compatible with Lua :Connect
        this.MouseButton1Click = {
            Connect: (callback) => {
                try {
                    this.element.addEventListener('click', callback);
                    return { Disconnect: () => this.element.removeEventListener('click', callback) };
                } catch (error) {
                    console.error('Error connecting MouseButton1Click event:', error);
                    addOutput(`Error connecting MouseButton1Click for ${this.Name}: ${error.message}`, 'error');
                    return { Disconnect: () => {} };
                }
            }
        };
    }

    updateTextStyle() {
        try {
            this.element.textContent = this.Text;
            this.element.style.color = `#${this.TextColor.getHexString()}`;
            this.element.style.fontSize = this.TextSize + 'px';
            this.element.style.fontFamily = this.Font;
        } catch (error) {
            console.error('Error updating TextButton text style:', error);
            addOutput(`Error updating text style for ${this.Name}: ${error.message}`, 'error');
        }
    }

    setupHoverEffects() {
        try {
            this.element.addEventListener('mouseenter', () => {
                const color = this.BackgroundColor.clone().multiplyScalar(0.9);
                this.element.style.backgroundColor = `#${color.getHexString()}`;
            });
            this.element.addEventListener('mouseleave', () => {
                this.element.style.backgroundColor = `#${this.BackgroundColor.getHexString()}`;
            });
        } catch (error) {
            console.error('Error setting up hover effects:', error);
            addOutput(`Error setting up hover effects for ${this.Name}: ${error.message}`, 'error');
        }
    }
}

// Create GUI preview container for studio
if (!document.getElementById('studio-gui-preview')) {
    const guiPreview = document.createElement('div');
    guiPreview.id = 'studio-gui-preview';
    guiPreview.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: auto;
        z-index: 100;
        background-color: rgba(0, 0, 0, 0.1);
        border: 2px dashed #666;
        box-sizing: border-box;
    `;
    guiPreview.style.display = 'none'; // Hidden by default, shown when GUIs are added
    document.body.appendChild(guiPreview);
}

// Function to detect test mode
function isTestMode() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('test') === 'true' && urlParams.get('studio') === 'true';
}

// Add GUI container to RobloxEnvironment
RobloxEnvironment.PlayerGui = {
    Children: [],
    AddGui: function(gui) {
        try {
            if (gui instanceof GuiObject) {
                if (isTestMode()) {
                    // In test mode, route GUIs to the game GUI container instead of studio preview
                    const gameGuiContainer = document.getElementById('gui-container');
                    if (gameGuiContainer) {
                        // Remove from any other container first
                        if (gui.element && gui.element.parentNode && gui.element.parentNode !== gameGuiContainer) {
                            gui.element.parentNode.removeChild(gui.element);
                        }
                        // Add to game GUI container if not already there
                        if (!gameGuiContainer.contains(gui.element)) {
                            gameGuiContainer.appendChild(gui.element);
                            gameGuiContainer.style.display = 'block'; // Show container when GUIs are added
                        }
                        addOutput(`Added GUI ${gui.Name} to PlayerGui (test mode - routed to game)`, 'success');
                    } else {
                        addOutput('Error: Game GUI container not found in test mode', 'error');
                    }
                } else {
                    // Normal studio operation - use studio preview container
                    const guiPreview = document.getElementById('studio-gui-preview');
                    if (guiPreview) {
                        // Remove from any other container first to ensure strict isolation to studio preview
                        if (gui.element && gui.element.parentNode && gui.element.parentNode !== guiPreview) {
                            gui.element.parentNode.removeChild(gui.element);
                        }
                        // Add to studio preview if not already there
                        if (!guiPreview.contains(gui.element)) {
                            guiPreview.appendChild(gui.element);
                            guiPreview.style.display = 'block'; // Show preview when GUIs are added
                        }
                    }
                    addOutput(`Added GUI ${gui.Name} to PlayerGui`, 'success');
                }
                if (!this.Children.includes(gui)) {
                    this.Children.push(gui);
                }
            } else {
                addOutput('Error: Can only add GuiObject instances to PlayerGui', 'error');
            }
        } catch (error) {
            console.error('Error adding GUI to PlayerGui:', error);
            addOutput(`Error adding GUI to PlayerGui: ${error.message}`, 'error');
        }
    },
    RemoveGui: function(gui) {
        try {
            const index = this.Children.indexOf(gui);
            if (index > -1) {
                this.Children.splice(index, 1);
                if (gui.element && gui.element.parentNode) {
                    gui.element.parentNode.removeChild(gui.element);
                }
                // Hide appropriate container if no GUIs left
                if (isTestMode()) {
                    const gameGuiContainer = document.getElementById('gui-container');
                    if (gameGuiContainer && gameGuiContainer.children.length === 0) {
                        gameGuiContainer.style.display = 'none';
                    }
                } else {
                    const guiPreview = document.getElementById('studio-gui-preview');
                    if (guiPreview && guiPreview.children.length === 0) {
                        guiPreview.style.display = 'none';
                    }
                }
                addOutput(`Removed GUI ${gui.Name} from PlayerGui`, 'success');
            }
        } catch (error) {
            console.error('Error removing GUI from PlayerGui:', error);
            addOutput(`Error removing GUI from PlayerGui: ${error.message}`, 'error');
        }
    }
};

const style = document.createElement('style');
style.textContent = `
.rogold-gui {
    position: absolute;
    box-sizing: border-box;
    font-family: Arial, sans-serif;
}

.rogold-gui.frame {
    background-color: #ffffff;
    border: 1px solid #000000;
}

.rogold-gui.textlabel {
    padding: 5px;
}

.rogold-gui.textbutton {
    background-color: #e0e0e0;
    border: 1px solid #000000;
    cursor: pointer;
    transition: background-color 0.1s;
}

.rogold-gui.textbutton:hover {
    background-color: #cccccc;
}
`;
document.head.appendChild(style);

// Expose GUI classes and a global PlayerGui container so other scripts (game.js / eval) can use them
window.GuiObject = GuiObject;
window.Frame = Frame;
window.TextLabel = TextLabel;
window.TextButton = TextButton;

// Define ScreenGui class if not already defined
class ScreenGui extends GuiObject {
    constructor(name) {
        super('ScreenGui', name);
        this.element.style.width = '100%';
        this.element.style.height = '100%';
        this.element.style.left = '0';
        this.element.style.top = '0';
        this.element.style.backgroundColor = 'transparent';
        this.element.style.border = 'none';
    }
}

window.ScreenGui = ScreenGui;






