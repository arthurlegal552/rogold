import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

let scene, camera, renderer, controls;
let player, velocity, direction;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;
let isRespawning = false;
let fallenParts = [];
let physicsWorld;
const mouse = new THREE.Vector2();
const maxDistance = 10; // distância máxima do foguete
const cooldownTime = 1000; // 1 segundo de cooldown
let canShoot = true;
let explosionSound;
const explodingParticles = [];

let partMaterial;

let rotateCameraLeft = false;
let rotateCameraRight = false;
let zoomCameraIn = false;
let zoomCameraOut = false;

let animationTime = 0; // For walking animation

let raycaster;

const objects = [];
let prevTime = performance.now();
const playerSpeed = 20.0;

let cameraOffset;
let cameraTarget = new THREE.Vector3();

let audioListener, walkSound, jumpSound, clickSound, spawnSound, deathSound, ouchSound, launchSound,currentDeathSound;
let isMobile = false; // This will be updated dynamically
let controlOverride = localStorage.getItem('controlOverride'); // 'pc', 'mobile', or null

let renderTarget, postScene, postCamera;

let socket = io();
let otherPlayers = {};
let playerId;

let lastSentTime = 0;
const sendInterval = 100; // ms, so 10 times per second

function playClickSound() {
    if (clickSound && clickSound.buffer) {
        if (clickSound.isPlaying) {
            clickSound.stop();  
        }
        clickSound.play();
    }
}

function areMobileControlsActive() {
    if (controlOverride === 'mobile') return true;
    if (controlOverride === 'pc') return false;
    // 'auto' mode
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    if (msg.toLowerCase() === '/e dance') {
        startDance();
        input.value = '';
        return;
    }
    if (msg && socket && socket.connected) {
        socket.emit('chat', msg);
        input.value = '';
    }
}

// Listen for chat messages from server
// Ensure this runs after DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    const chatSendBtn = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');
    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') sendChatMessage();
        });
    }

    const hideBtn = document.getElementById('hide-player-list-btn');
    const playerList = document.getElementById('player-list');
    const playerListContainer = document.getElementById('player-list-container');

    let isPlayerListHidden = false;

    hideBtn.addEventListener('click', () => {
        isPlayerListHidden = !isPlayerListHidden;
        playerList.style.display = isPlayerListHidden ? 'none' : '';
        hideBtn.textContent = isPlayerListHidden ? 'Show' : 'Hide';
    });
});

// Listen for chat messages from server
if (typeof socket !== 'undefined' && socket) {
    socket.on('chat', ({ playerId: chatPlayerId, message }) => {
        appendChatBoxMessage(chatPlayerId, message);
        showBubbleChat(chatPlayerId, message);
    });
}

// Append message to chat box
function appendChatBoxMessage(chatPlayerId, message) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';
    msgDiv.textContent = `${chatPlayerId}: ${message}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}
// Show bubble chat above player
function showBubbleChat(chatPlayerId, message) {
    let targetPlayer = chatPlayerId === playerId ? player : otherPlayers[chatPlayerId];
    if (!targetPlayer) return;

    // Try to find the head mesh
    let headMesh = null;
    targetPlayer.traverse(child => {
        if (child.isMesh && child.name === "Head") {
            headMesh = child;
        }
    });
    // Fallback to player group if head not found
    const bubbleTarget = headMesh || targetPlayer;

    // Create bubble element
    const bubble = document.createElement('div');
    bubble.className = 'bubble-chat';
    bubble.textContent = message;
    bubble.style.position = 'absolute';
    bubble.style.background = 'rgba(255,255,255,0.85)';
    bubble.style.borderRadius = '16px';
    bubble.style.padding = '6px 14px';
    bubble.style.fontSize = '16px';
    bubble.style.pointerEvents = 'none';
    bubble.style.whiteSpace = 'pre-line';
    bubble.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    bubble.style.transition = 'opacity 0.3s';
    bubble.style.zIndex = 200;

    document.body.appendChild(bubble);

    // Position bubble above head
    function updateBubblePosition() {
        let worldPos = new THREE.Vector3();
        bubbleTarget.getWorldPosition(worldPos);
        worldPos.y += 1.2; // Adjust to be above the head

        // Project to screen
        let screenPos = worldPos.clone().project(camera);
        let x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        let y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

        bubble.style.left = `${x - bubble.offsetWidth / 2}px`;
        bubble.style.top = `${y - bubble.offsetHeight - 10}px`;
    }

    updateBubblePosition();
    let interval = setInterval(updateBubblePosition, 16);

    // Remove bubble after 3 seconds
    setTimeout(() => {
        bubble.style.opacity = '0';
        setTimeout(() => {
            bubble.remove();
            clearInterval(interval);
        }, 300);
    }, 3000);
}

function createPlayer(headModel) {
    const playerGroup = new THREE.Group();
    playerGroup.name = "Player";

    // Materials - Classic Roblox "noob" colors
    const torsoMaterial = new THREE.MeshLambertMaterial({ color: 0x00A2FF }); // Blue
    const legMaterial = new THREE.MeshLambertMaterial({ color: 0x80C91C }); // Green

    // Arm Materials - with stud texture on top and bottom
    const textureLoader = new THREE.TextureLoader();
    
    const topStudsTexture = textureLoader.load('roblox-stud.png');
    topStudsTexture.wrapS = THREE.RepeatWrapping;
    topStudsTexture.wrapT = THREE.RepeatWrapping;
    topStudsTexture.repeat.set(1, 1);

    const bottomStudsTexture = textureLoader.load('Studdown.png');
    bottomStudsTexture.wrapS = THREE.RepeatWrapping;
    bottomStudsTexture.wrapT = THREE.RepeatWrapping;
    bottomStudsTexture.repeat.set(1, 1);

    const armTopMaterial = new THREE.MeshLambertMaterial({ color: 0xFAD417, map: topStudsTexture });
    armTopMaterial.name = "ArmTop"; // For color changing
    
    const armBottomMaterial = new THREE.MeshLambertMaterial({ color: 0xFAD417, map: bottomStudsTexture });
    armBottomMaterial.name = "ArmBottom"; // For color changing

    const armSidesMaterial = new THREE.MeshLambertMaterial({ color: 0xFAD417 });
    armSidesMaterial.name = "ArmSides"; // For color changing

    const armMaterials = [
        armSidesMaterial, // right
        armSidesMaterial, // left
        armTopMaterial,   // top
        armBottomMaterial, // bottom
        armSidesMaterial, // front
        armSidesMaterial  // back
    ];

    // Torso
    const torsoGeometry = new THREE.BoxGeometry(2, 2, 1);
    const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
    torso.castShadow = false;
    torso.receiveShadow = false;
    torso.name = "Torso"; // Name for easy selection
    playerGroup.add(torso);

    // Head
    const head = headModel;
    head.position.y = 1.7;
    head.scale.set(1.15, 1.15, 1.15);
    head.castShadow = false;
    head.receiveShadow = false;
    playerGroup.add(head);

    // Face Overlay
    const faceTextureLoader = new THREE.TextureLoader();
    const faceTexture = faceTextureLoader.load('OriginalGlitchedFace.webp');
    faceTexture.minFilter = THREE.NearestFilter;
    faceTexture.magFilter = THREE.NearestFilter;
    const faceMaterial = new THREE.MeshLambertMaterial({ 
        map: faceTexture, 
        transparent: true,
        alphaTest: 0.1 // To avoid rendering fully transparent parts
    });
    const faceGeometry = new THREE.PlaneGeometry(1.05, 1.05);
    const facePlane = new THREE.Mesh(faceGeometry, faceMaterial);
    
    // Position it relative to the head. The head is a cylinder model,
    // so we place the face on its surface on the Z axis.
    facePlane.position.set(0, 0, 0.75); // radius of the head model
    head.add(facePlane);

    // -- Roblox 2006 Badge --
    const badgeTextureLoader = new THREE.TextureLoader();
    const badgeTexture = badgeTextureLoader.load('Roblox_icon_2006.svg');
    const badgeMaterial = new THREE.MeshLambertMaterial({ 
        map: badgeTexture,
        transparent: true,
        opacity: 1
    });
    
    const badgeGeometry = new THREE.PlaneGeometry(0.4, 0.4);
    const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
    badge.position.set(0.6, 0.75, 0.51);
    badge.rotation.y = 0;
    torso.add(badge);

    // -- Limbs with Pivots for Animation --

    const armGeometry = new THREE.BoxGeometry(1, 2, 1);
    const legGeometry = new THREE.BoxGeometry(1, 2, 1);

    // Left Arm
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-1.5, 1, 0); // Shoulder position
    const leftArm = new THREE.Mesh(armGeometry, armMaterials);
    leftArm.name = "Arm"; // Name for easy selection
    leftArm.position.y = -1; // Move down from pivot
    leftArm.castShadow = false;
    leftArm.receiveShadow = false;
    leftArmPivot.add(leftArm);
    playerGroup.add(leftArmPivot);
    playerGroup.leftArm = leftArmPivot;

    // Right Arm
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(1.5, 1, 0); // Shoulder position
    const rightArm = new THREE.Mesh(armGeometry, armMaterials);
    rightArm.name = "Arm"; // Name for easy selection
    rightArm.position.y = -1; // Move down from pivot
    rightArm.castShadow = false;
    rightArm.receiveShadow = false;
    rightArmPivot.add(rightArm);
    playerGroup.add(rightArmPivot);
    playerGroup.rightArm = rightArmPivot;

    // Left Leg
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.5, -1, 0); // Hip position
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.name = "Leg"; // Name for easy selection
    leftLeg.position.y = -1; // Move down from pivot
    leftLeg.castShadow = false;
    leftLeg.receiveShadow = false;
    leftLegPivot.add(leftLeg);
    playerGroup.add(leftLegPivot);
    playerGroup.leftLeg = leftLegPivot;

    // Right Leg
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.5, -1, 0); // Hip position
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.name = "Leg"; // Name for easy selection
    rightLeg.position.y = -1; // Move down from pivot
    rightLeg.castShadow = false;
    rightLeg.receiveShadow = false;
    rightLegPivot.add(rightLeg);
    playerGroup.add(rightLegPivot);
    playerGroup.rightLeg = rightLegPivot;

    // The bottom of the legs is at y = -1 (hip) - 2 (leg length) = -3.
    // We will offset the whole group so its bottom is at y=0.
    playerGroup.position.y = 3;

    return playerGroup;
}

function updatePlayerColors(player, colors) {
    if (!player || !colors) return;

    player.traverse((child) => {
        if (child.isMesh) {
            switch (child.name) {
                case "Head":
                    child.material.color.set(colors.head);
                    break;
                case "Torso":
                    child.material.color.set(colors.torso);
                    break;
                case "Leg":
                    child.material.color.set(colors.legs);
                    break;
                case "Arm":
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => {
                            if (material.name === "ArmTop" || material.name === "ArmSides" || material.name === "ArmBottom") {
                                material.color.set(colors.arms);
                            }
                        });
                    }
                    break;
            }
        }
    });
}

function createRemotePlayer(headModel, playerData) {
    const playerGroup = createPlayer(headModel);
    playerGroup.position.set(playerData.x, playerData.y, playerData.z);
    playerGroup.rotation.y = playerData.rotation;
    // Set initial network data targets for interpolation
    playerGroup.userData.targetPosition = new THREE.Vector3(playerData.x, playerData.y, playerData.z);
    playerGroup.userData.targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, playerData.rotation, 0));

    updatePlayerColors(playerGroup, playerData.colors);
    return playerGroup;
}

function initSocket() {
    // Get the current host for socket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    socket = io(`${protocol}//${host}`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    const statusEl = document.getElementById('online-status');
    
    socket.on('connect', () => {
        console.log('Connected to server');
        playerId = socket.id;
        statusEl.textContent = `Online (${Object.keys(otherPlayers).length + 1} players)`;
        statusEl.className = 'connected';
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        statusEl.textContent = 'Connection Failed';
        statusEl.className = 'disconnected';
        
        // Try to reconnect
        setTimeout(() => {
            if (!socket.connected) {
                socket.connect();
            }
        }, 1000);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'disconnected';
        
        if (reason === 'io server disconnect') {
            // Server initiated disconnect, try to reconnect
            socket.connect();
        }
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected after', attemptNumber, 'attempts');
        statusEl.textContent = `Online (${Object.keys(otherPlayers).length + 1} players)`;
        statusEl.className = 'connected';
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('Reconnection attempt', attemptNumber);
        statusEl.textContent = `Reconnecting... (${attemptNumber}/5)`;
    });
    
    socket.on('reconnect_failed', () => {
        console.error('Failed to reconnect');
        statusEl.textContent = 'Connection Lost';
        statusEl.className = 'disconnected';
    });
    
    socket.on('initialPlayers', (serverPlayers) => {
        console.log('Received initial players:', serverPlayers);
        Object.values(serverPlayers).forEach(playerData => {
            if (playerData.id !== playerId) {
                const loader = new GLTFLoader();
                loader.load('old_roblox_head_2007-2009.glb', (gltf) => {
                    const head = gltf.scene;
                    head.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = false;
                            child.receiveShadow = false;
                            child.material = new THREE.MeshLambertMaterial({ color: 0xFAD417 });
                            child.name = "Head";
                        }
                    });
                    
                    const remotePlayer = createRemotePlayer(head, playerData);
                    remotePlayer.userData.playerId = playerData.id;
                    otherPlayers[playerData.id] = remotePlayer;
                    scene.add(remotePlayer);
                });
            }
        });
        statusEl.textContent = `Online (${Object.keys(serverPlayers).length} players)`;
    });
    
    socket.on('playerJoined', (playerData) => {
        if (playerData.id !== playerId) {
            const loader = new GLTFLoader();
            loader.load('old_roblox_head_2007-2009.glb', (gltf) => {
                const head = gltf.scene;
                head.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = false;
                        child.receiveShadow = false;
                        child.material = new THREE.MeshLambertMaterial({ color: 0xFAD417 });
                        child.name = "Head";
                    }
                });
                
                const remotePlayer = createRemotePlayer(head, playerData);
                remotePlayer.userData.playerId = playerData.id;
                otherPlayers[playerData.id] = remotePlayer;
                scene.add(remotePlayer);
                
                // Update player count
                statusEl.textContent = `Online (${Object.keys(otherPlayers).length + 1} players)`;
            });
        }
    });
    
    socket.on('gameState', (serverPlayers) => {
        if (!player) return;

        // Remove players who have disconnected
        Object.keys(otherPlayers).forEach(id => {
            if (!serverPlayers[id]) {
                scene.remove(otherPlayers[id]);
                delete otherPlayers[id];
            }
        });

        Object.values(serverPlayers).forEach(playerData => {
            if (playerData.id === playerId) {
                // This is our own data, we don't need to do anything with it
                return;
            }

            if (!otherPlayers[playerData.id]) {
                // This is a new player that joined, but we missed the 'playerJoined' event.
                // This can happen if we join after them. Let's create them.
                 const loader = new GLTFLoader();
                 loader.load('old_roblox_head_2007-2009.glb', (gltf) => {
                     const head = gltf.scene;
                     head.traverse((child) => {
                         if (child.isMesh) {
                             child.castShadow = false;
                             child.receiveShadow = false;
                             child.material = new THREE.MeshLambertMaterial({ color: 0xFAD417 });
                             child.name = "Head";
                         }
                     });

                     const remotePlayer = createRemotePlayer(head, playerData);
                     remotePlayer.userData.playerId = playerData.id;
                     otherPlayers[playerData.id] = remotePlayer;
                     scene.add(remotePlayer);
                 });

            } else {
                 // This is an existing player, update their state for interpolation
                const remotePlayer = otherPlayers[playerData.id];
                remotePlayer.userData.targetPosition.set(playerData.x, playerData.y, playerData.z);
                
                const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, playerData.rotation, 0));
                remotePlayer.userData.targetQuaternion = targetQuaternion;

                // Update animation based on server state
                if (playerData.isInAir) {

                    // Jump pose for remote player

                    const jumpAngle = -Math.PI;

                    remotePlayer.leftArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.leftArm.rotation.x, jumpAngle, 0.3);

                    remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightArm.rotation.x, jumpAngle, 0.3);

                    remotePlayer.leftLeg.rotation.x = THREE.MathUtils.lerp(remotePlayer.leftLeg.rotation.x, 0, 0.2);

                    remotePlayer.rightLeg.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightLeg.rotation.x, 0, 0.2);

                } else if (playerData.isMoving) {

                    const swingAngle = Math.sin(Date.now() * 0.01) * 0.8;

                    remotePlayer.leftArm.rotation.x = swingAngle;

                    remotePlayer.rightArm.rotation.x = -swingAngle;

                    remotePlayer.leftLeg.rotation.x = -swingAngle;

                    remotePlayer.rightLeg.rotation.x = swingAngle;

                } else {

                    remotePlayer.leftArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.leftArm.rotation.x, 0, 0.2);

                    remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightArm.rotation.x, 0, 0.2);

                    remotePlayer.leftLeg.rotation.x = THREE.MathUtils.lerp(remotePlayer.leftLeg.rotation.x, 0, 0.2);

                    remotePlayer.rightLeg.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightLeg.rotation.x, 0, 0.2);

                }
                
                // Update colors if they have changed
                updatePlayerColors(remotePlayer, playerData.colors);
            }
        });
         // Update player count
        statusEl.textContent = `Online (${Object.keys(serverPlayers).length} players)`;
    });
    
    socket.on('playerMoved', (playerData) => {
        // This is now handled by 'gameState'
    });
    
    socket.on('playerLeft', (playerId) => {
        if (otherPlayers[playerId]) {
            scene.remove(otherPlayers[playerId]);
            delete otherPlayers[playerId];
            // Update player count is now handled by gameState
        }
    });

    socket.on('dance', (dancerId) => {
        if (dancerId && otherPlayers[dancerId]) {
            otherPlayers[dancerId].isDancing = true;
            // Optionally, play dance music for others or show a visual effect
        }
    });

    // Quando outro player equipa
socket.on("remoteEquip", (data) => {
    const remotePlayer = otherPlayers[data.playerId];
    if (!remotePlayer) return;

    remotePlayer.userData.equippedTool = data.tool;
    remotePlayer.userData.isEquipping = true;
    remotePlayer.userData.equipAnimProgress = 0;

    // Cria modelo na mão do outro player (se ainda não existir)
    if (!remotePlayer.userData.rocketLauncherModel) {
        const model = rocketLauncherModel.clone();
        model.visible = true;
        remotePlayer.rightArm.add(model);
        remotePlayer.userData.rocketLauncherModel = model;
    }
});

// Quando outro player desequipa
socket.on("remoteUnequip", (data) => {
    const remotePlayer = otherPlayers[data.playerId];
    if (!remotePlayer) return;

    remotePlayer.userData.isUnequipping = true;
    remotePlayer.userData.unequipAnimProgress = 0;
});


    socket.on('stopDance', (dancerId) => {
        if (dancerId && otherPlayers[dancerId]) {
            otherPlayers[dancerId].isDancing = false;
        }
    });
}

function updatePlayerList() {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    // Combine your player and otherPlayers
    const allPlayers = [playerId, ...Object.keys(otherPlayers)];
    playerList.innerHTML = '';
    allPlayers.forEach(id => {
        const li = document.createElement('li');
        li.textContent = id === playerId ? 'You' : id;
        playerList.appendChild(li);
    });
}

// Call updatePlayerList() whenever a player joins/leaves
if (typeof socket !== 'undefined' && socket) {
    socket.on('playerJoined', () => updatePlayerList());
    socket.on('playerLeft', () => updatePlayerList());
    socket.on('connect', () => updatePlayerList());
    socket.on('disconnect', () => updatePlayerList());
}

// Also call updatePlayerList() after you update otherPlayers in your code
function initGame() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 0, 750);

    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        1,
        1000
    );
    camera.position.y = 10;

    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('game-canvas'),
        antialias: false
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(1, 1, 0.5).normalize();
    directionalLight.castShadow = false;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Physics world setup
    physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, -9.82 * 20, 0), // Stronger gravity
    });

    const groundMaterial = new CANNON.Material("groundMaterial");
    partMaterial = new CANNON.Material("partMaterial");

    const groundPartContactMaterial = new CANNON.ContactMaterial(
        groundMaterial,
        partMaterial,
        {
            friction: 0.4, // How much it slides
            restitution: 0.1 // How much it bounces
        }
    );
    physicsWorld.addContactMaterial(groundPartContactMaterial);

    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: groundMaterial
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // horizontal
    physicsWorld.addBody(groundBody);

    // Post-processing setup for pixelated effect
    const renderTargetSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(renderTargetSize);
    const lowResWidth = 750;
    const lowResHeight = Math.round(lowResWidth / (renderTargetSize.x / renderTargetSize.y));

    renderTarget = new THREE.WebGLRenderTarget(lowResWidth, lowResHeight);
    renderTarget.texture.minFilter = THREE.NearestFilter;
    renderTarget.texture.magFilter = THREE.NearestFilter;

    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    const postMaterial = new THREE.MeshBasicMaterial({ map: renderTarget.texture });
    const postPlane = new THREE.PlaneGeometry(2, 2);
    const postQuad = new THREE.Mesh(postPlane, postMaterial);
    postScene.add(postQuad);

    // Audio setup
    audioListener = new THREE.AudioListener();
    camera.add(audioListener);

    walkSound = new THREE.Audio(audioListener);
    jumpSound = new THREE.Audio(audioListener);
    clickSound = new THREE.Audio(audioListener);
    spawnSound = new THREE.Audio(audioListener);
    deathSound = new THREE.Audio(audioListener);
    ouchSound = new THREE.Audio(audioListener);
    launchSound = new THREE.Audio(audioListener);
    explosionSound = new THREE.Audio(audioListener);

    currentDeathSound = deathSound; // Default death sound

    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('walk.mp3', (buffer) => {
        walkSound.setBuffer(buffer);
        walkSound.setLoop(true);
        walkSound.setVolume(0.5);
    });

    audioLoader.load('roblox-classic-jump.mp3', (buffer) => {
        jumpSound.setBuffer(buffer);
        jumpSound.setVolume(0.5);
    });

    audioLoader.load('explosion.mp3', (buffer) => {
    explosionSound.setBuffer(buffer);
    explosionSound.setVolume(0.8);
});

    audioLoader.load('roblox-button-made-with-Voicemod.mp3', (buffer) => {
        clickSound.setBuffer(buffer);
        clickSound.setVolume(0.5);
    });

    audioLoader.load('roblox-rocket-firing-made-with-Voicemod.mp3', (buffer) => {
        launchSound.setBuffer(buffer);
        launchSound.setVolume(0.5);
    });

    audioLoader.load('roblox-rocket-explode-made-with-Voicemod.mp3', (buffer) => {
        explosionSound.setBuffer(buffer);
        explosionSound.setVolume(0.8);
    });

    audioLoader.load('roblox-spawn.mp3', (buffer) => {
        spawnSound.setBuffer(buffer);
        spawnSound.setVolume(0.5);
    });

    audioLoader.load('roblox-death-sound_1.mp3', (buffer) => {
        deathSound.setBuffer(buffer);
        deathSound.setVolume(0.5);
    });

    audioLoader.load('ouch.mp3', (buffer) => {
        ouchSound.setBuffer(buffer);
        ouchSound.setVolume(0.5);
    });

    audioLoader.load('mash.mp3', (buffer) => {
        danceMusic = new THREE.Audio(audioListener);
        danceMusic.setBuffer(buffer);
        danceMusic.setLoop(true);
        danceMusic.setVolume(0.7);
    });

    // Load head model first, then initialize the rest
    const loader = new GLTFLoader();
    loader.load('old_roblox_head_2007-2009.glb', (gltf) => {
        const head = gltf.scene;
        head.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
                child.material = new THREE.MeshLambertMaterial({ color: 0xFAD417 }); // yellow noob color
                child.name = "Head";
            }
        });

        // Create player model with the loaded head
        player = createPlayer(head);
        player.position.set(0, 3, 0);
        scene.add(player);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, player.position.y + 1, 0);
        controls.enableDamping = false;
        controls.enableZoom = false; 
        controls.minDistance = 5;
        controls.maxDistance = 50;
        controls.maxPolarAngle = Math.PI / 2;
        controls.screenSpacePanning = false;
        controls.enableRotate = false;
        controls.enablePan = false;
        
        camera.position.set(0, 10, 15);

        cameraOffset = new THREE.Vector3(0, 5, 15);

        // This listener will handle all clicks/taps on the page to play the sound
        // and ensures the AudioContext is started.
        document.addEventListener('mousedown', function() {
            // Check if the audio context is running, and resume it if not.
            if (audioListener.context.state === 'suspended') {
                audioListener.context.resume();
            }
            playClickSound();
        });

        // The hint logic can be simplified as OrbitControls doesn't have a lock/unlock state
        document.querySelector('.controls-hint').style.display = 'block';

        raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 10);

        velocity = new THREE.Vector3();
        direction = new THREE.Vector3();

        // Initialize socket connection after player is created
        initSocket();

        animate(); // Start animation loop after player is created

    }, undefined, (error) => {
        console.error('An error happened while loading the model:', error);
        // As a fallback, create player with a default head
        const headGeometry = new THREE.CylinderGeometry(0.75, 0.75, 1.5, 32);
        const headMaterial = new THREE.MeshLambertMaterial({ color: 0xFAD417 });
        const fallbackHead = new THREE.Mesh(headGeometry, headMaterial);
        player = createPlayer(fallbackHead);
        scene.add(player);
        initSocket();
        animate();
    });

    // Create scene elements that don't depend on the player
    createBaseplate();
    createSpawnPoint();
    createSkybox();

    initUI(); // Initialize UI event listeners
    initMobileControls();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onWindowResize);

    const gltfLoader = new GLTFLoader();
    gltfLoader.load('roblox_classic_rocket_launcher.glb', (gltf) => {
        rocketLauncherModel = gltf.scene;
        rocketLauncherModel.visible = false;
        scene.add(rocketLauncherModel);
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

function emitColorChange() {
    if (!socket || !socket.connected) return;

    const colors = {
        head: document.getElementById('head-color').value,
        torso: document.getElementById('torso-color').value,
        arms: document.getElementById('arm-color').value,
        legs: document.getElementById('leg-color').value,
    };
    socket.emit('playerCustomize', colors);
}

function updateControls() {
    const mobileActive = areMobileControlsActive();
    isMobile = mobileActive; // Update global flag for legacy checks
    const controlsModeBtn = document.getElementById('controls-mode-btn');

    document.getElementById('mobile-controls').style.display = mobileActive ? 'block' : 'none';
    
    // Desktop-specific UI elements
    const hintElement = document.querySelector('.controls-hint');
    const zoomElement = document.querySelector('.zoom-controls');

    if (hintElement) hintElement.style.display = mobileActive ? 'none' : 'block';
    if (zoomElement) zoomElement.style.display = mobileActive ? 'none' : 'flex'; // Use flex for column layout

    if (mobileActive) {
        controlsModeBtn.textContent = 'Controls: Mobile';
    } else {
        controlsModeBtn.textContent = 'Controls: PC';
    }
}

function initUI() {
    const customizeBtn = document.getElementById('customize-btn');
    const customizerPanel = document.getElementById('color-customizer');
    const potionsBtn = document.getElementById('potions-btn');
    const potionsPanel = document.getElementById('potions-customizer');
    const headColorInput = document.getElementById('head-color');
    const torsoColorInput = document.getElementById('torso-color');
    const armColorInput = document.getElementById('arm-color');
    const legColorInput = document.getElementById('leg-color');
    const respawnBtn = document.getElementById('respawn-btn');
    const controlsModeBtn = document.getElementById('controls-mode-btn');

    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    customizeBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent document mousedown from firing again
        playClickSound();
        const isDisplayed = customizerPanel.style.display === 'block';
        customizerPanel.style.display = isDisplayed ? 'none' : 'block';
        potionsPanel.style.display = 'none'; // Close other panel
    });

    potionsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        playClickSound();
        const isDisplayed = potionsPanel.style.display === 'block';
        potionsPanel.style.display = isDisplayed ? 'none' : 'block';
        customizerPanel.style.display = 'none'; // Close other panel
    });

    controlsModeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        playClickSound();

        const mobileActive = areMobileControlsActive();
        if (mobileActive) {
            // Was mobile, switch to PC
            controlOverride = 'pc';
        } else {
            // Was PC, switch to mobile
            controlOverride = 'mobile';
        }
        localStorage.setItem('controlOverride', controlOverride);
        
        updateControls();
    });

    document.querySelectorAll('.potion-option').forEach(option => {
        option.addEventListener('click', (event) => {
            playClickSound();
            document.querySelector('.potion-option.active').classList.remove('active');
            event.currentTarget.classList.add('active');

            const sound = event.currentTarget.dataset.sound;
            if (sound === 'classic') {
                currentDeathSound = deathSound;
            } else if (sound === 'ouch') {
                currentDeathSound = ouchSound;
            }
        });
    });

    respawnBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        playClickSound();
        respawnPlayer();
    });

    // We can remove the individual click sound handlers from the color pickers
    // because the main document mousedown listener will catch them.
    headColorInput.addEventListener('input', (event) => {
        const newColor = new THREE.Color(event.target.value);
        player.traverse((child) => {
            if (child.isMesh && child.name === "Head") {
                child.material.color.set(newColor);
            }
        });
        emitColorChange();
    });

    torsoColorInput.addEventListener('input', (event) => {
        const newColor = new THREE.Color(event.target.value);
        player.traverse((child) => {
            if (child.isMesh && child.name === "Torso") {
                child.material.color.set(newColor);
            }
        });
        emitColorChange();
    });

    armColorInput.addEventListener('input', (event) => {
        const newColor = new THREE.Color(event.target.value);
        player.traverse((child) => {
            if (child.isMesh && child.name === "Arm") {
                // When a mesh has an array of materials, child.material is that array.
                // We need to iterate over it to set the color on each material.
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => {
                        if (material.name === "ArmTop" || material.name === "ArmSides" || material.name === "ArmBottom") {
                            material.color.set(newColor);
                        }
                    });
                }
            }
        });
        emitColorChange();
    });

    legColorInput.addEventListener('input', (event) => {
        const newColor = new THREE.Color(event.target.value);
        player.traverse((child) => {
            if (child.isMesh && child.name === "Leg") {
                child.material.color.set(newColor);
            }
        });
        emitColorChange();
    });

    zoomInBtn.addEventListener('mousedown', () => {
        zoomCameraIn = true;
    });
    zoomInBtn.addEventListener('mouseup', () => zoomCameraIn = false);
    zoomInBtn.addEventListener('mouseleave', () => zoomCameraIn = false); // Stop if mouse leaves button

    zoomOutBtn.addEventListener('mousedown', () => {
        zoomCameraOut = true;
    });
    zoomOutBtn.addEventListener('mouseup', () => zoomCameraOut = false);
    zoomOutBtn.addEventListener('mouseleave', () => zoomCameraOut = false);

    updateControls(); // Initial setup
}

function initMobileControls() {
    // We set up the joystick regardless, but its visibility is controlled by updateControls()
    // This simplifies toggling controls without re-creating the joystick.
    // isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
    // if (!isMobile) return;

    // Joystick
    const joystickZone = document.getElementById('joystick-zone');
    const joystickOptions = {
        zone: joystickZone,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 120
    };
    const manager = nipplejs.create(joystickOptions);

    manager.on('move', (evt, data) => {
        if (!data.angle || !data.force) {
            return;
        }
        const angle = data.angle.radian;
        const force = data.force;

        // Reset movement flags
        moveForward = moveBackward = moveLeft = moveRight = false;
        
        // Use a threshold to avoid jittering when joystick is near center
        if (force > 0.1) {
            // Convert angle to movement directions
            // Note: NippleJS angle starts from right (0 rad) and goes counter-clockwise.
            // Angle ranges for 4-way movement (diagonals activate two flags)
            const deg = data.angle.degree;
            if (deg > 22.5 && deg <= 157.5) moveForward = true;
            if (deg > 202.5 && deg <= 337.5) moveBackward = true;
            if (deg > 112.5 && deg <= 247.5) moveLeft = true;
            if ((deg >= 0 && deg <= 67.5) || (deg > 292.5 && deg <= 360)) moveRight = true;
        }

        if (walkSound && !walkSound.isPlaying && canJump) {
            walkSound.play();
        }
    });

    manager.on('end', () => {
        moveForward = moveBackward = moveLeft = moveRight = false;
        if (walkSound && walkSound.isPlaying) {
            walkSound.stop();
        }
    });

    // Buttons
    const jumpBtn = document.getElementById('mobile-jump-btn');
    const rotateLeftBtn = document.getElementById('mobile-rotate-left');
    const rotateRightBtn = document.getElementById('mobile-rotate-right');

    const handleJump = () => {
        if (canJump === true) {
            velocity.y += 50;
            canJump = false;
            if (jumpSound && jumpSound.buffer) {
                if (jumpSound.isPlaying) jumpSound.stop();
                jumpSound.play();
            }
        }
    };
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleJump(); });

    rotateLeftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); rotateCameraLeft = true; });
    rotateLeftBtn.addEventListener('touchend', (e) => { e.preventDefault(); rotateCameraLeft = false; });
    rotateLeftBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); rotateCameraLeft = false; });

    rotateRightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); rotateCameraRight = true; });
    rotateRightBtn.addEventListener('touchend', (e) => { e.preventDefault(); rotateCameraRight = false; });
    rotateRightBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); rotateCameraRight = false; });
}

function respawnPlayer() {
    if (isRespawning) return;
    isRespawning = true;

    // Update health to 0 when dying
    document.getElementById('health-text').textContent = '0';
    document.getElementById('health-fill').style.width = '0%';

    player.visible = false;
    if (walkSound && walkSound.isPlaying) {
        walkSound.stop();
    }

    const partsToBreak = [
        player.getObjectByName("Torso"),
        player.getObjectByName("Head"),
        player.leftArm.children[0], // The Mesh inside the pivot
        player.rightArm.children[0],
        player.leftLeg.children[0],
        player.rightLeg.children[0],
    ];

    partsToBreak.forEach(part => {
        if (!part) return;

        const worldPos = new THREE.Vector3();
        part.getWorldPosition(worldPos);

        const worldQuat = new THREE.Quaternion();
        part.getWorldQuaternion(worldQuat);

        const fallenPartMesh = part.clone();
        fallenPartMesh.position.copy(worldPos);
        fallenPartMesh.quaternion.copy(worldQuat);
        fallenPartMesh.castShadow = false;
        fallenPartMesh.receiveShadow = false;
        scene.add(fallenPartMesh);

        // Create physics body
        const partSize = new THREE.Vector3();
        new THREE.Box3().setFromObject(part).getSize(partSize);
        
        const shape = new CANNON.Box(new CANNON.Vec3(partSize.x / 2, partSize.y / 2, partSize.z / 2));
        const body = new CANNON.Body({
            mass: 1,
            position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z),
            quaternion: new CANNON.Quaternion(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w),
            shape: shape,
            material: partMaterial,
            angularDamping: 0.5, // helps stop rolling
            linearDamping: 0.1
        });

        // Apply explosion-like impulse
        const impulse = new CANNON.Vec3(
             (Math.random() - 0.5) * 40,
             Math.random() * 30 + 10,
             (Math.random() - 0.5) * 40
        );
        body.applyImpulse(impulse, CANNON.Vec3.ZERO);

        physicsWorld.addBody(body);
        
        fallenParts.push({ mesh: fallenPartMesh, body: body });
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();


    setTimeout(() => {
        fallenParts.forEach(part => {
            scene.remove(part.mesh);
            physicsWorld.removeBody(part.body);
             // Properly dispose of geometries and materials to free up memory
            if (part.mesh.geometry) part.mesh.geometry.dispose();
            if (Array.isArray(part.mesh.material)) {
                part.mesh.material.forEach(m => m.dispose());
            } else if (part.mesh.material) {
                part.mesh.material.dispose();
            }
        });
        fallenParts = [];

        player.position.set(0, 3, 0);
        velocity.set(0, 0, 0);
        player.visible = true;
        
        // Update health to 100 when respawning
        document.getElementById('health-text').textContent = '100';
        document.getElementById('health-fill').style.width = '100%';
        
        if (spawnSound && !spawnSound.isPlaying) {
            spawnSound.play();
        }

        isRespawning = false;
    }, 3000);

    if (currentDeathSound && currentDeathSound.buffer) {
        if (currentDeathSound.isPlaying) currentDeathSound.stop();
        currentDeathSound.play();
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Update render target size to match aspect ratio
    const lowResWidth = 320;
    const lowResHeight = Math.round(lowResWidth / (window.innerWidth / window.innerHeight));
    renderTarget.setSize(lowResWidth, lowResHeight);
}

// Helper to check if chat input is focused
function isChatInputFocused() {
    const chatInput = document.getElementById('chat-input');
    return document.activeElement === chatInput;
}

function onKeyDown(event) {
    if (isMobile) return;
    if (isChatInputFocused()) return;
    if (isMenuOpen) return; // Block movement/jump if menu is open
    // Stop dancing on any movement or jump
    if (isDancing && (
        ['ArrowUp','KeyW','ArrowLeft','KeyA','ArrowDown','KeyS','ArrowRight','KeyD','Space'].includes(event.code)
    )) {
        stopDance();
    }
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = true;
            if (walkSound && !walkSound.isPlaying && canJump) {
                walkSound.play();
            }
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = true;
            if (walkSound && !walkSound.isPlaying && canJump) {
                walkSound.play();
            }
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = true;
            if (walkSound && !walkSound.isPlaying && canJump) {
                walkSound.play();
            }
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = true;
            if (walkSound && !walkSound.isPlaying && canJump) {
                walkSound.play();
            }
            break;
        case 'Space':
            if (canJump === true) {
                velocity.y += 50;
                canJump = false;
                if (jumpSound && jumpSound.buffer) {
                    if (jumpSound.isPlaying) jumpSound.stop();
                    jumpSound.play();
                }
            }
            break;
        case 'KeyQ':
            rotateCameraLeft = true;
            break;
        case 'KeyE':
            rotateCameraRight = true;
            break;
    }
}

function onKeyUp(event) {
    if (isMobile) return;
    if (isChatInputFocused()) return;
    if (isMenuOpen) return; // Block movement/jump if menu is open
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
            moveForward = false;
            break;
        case 'ArrowLeft':
        case 'KeyA':
            moveLeft = false;
            break;
        case 'ArrowDown':
        case 'KeyS':
            moveBackward = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            moveRight = false;
            break;
    }

    switch (event.code) {
        case 'KeyQ':
            rotateCameraLeft = false;
            break;
        case 'KeyE':
            rotateCameraRight = false;
            break;
    }

    if (!moveForward && !moveBackward && !moveLeft && !moveRight) {
        if (walkSound && walkSound.isPlaying) {
            walkSound.stop();
        }
    }
}

function startDance() {
    if (isDancing) return;
    isDancing = true;
    if (danceMusic && !danceMusic.isPlaying) {
        danceMusic.play();
    }
    if (socket && socket.connected) {
        socket.emit('dance');
    }
}

function stopDance() {
    if (!isDancing) return;
    isDancing = false;
    if (danceMusic && danceMusic.isPlaying) {
        danceMusic.stop();
    }
    if (socket && socket.connected) {
        socket.emit('stopDance');
    }
}

let equippedTool = null;
let rocketLauncherModel = null;
let isEquipping = false;
let isUnequipping = false;
let equipAnimProgress = 0;
let unequipAnimProgress = 0;
const equipAnimDuration = 0.25; // seconds
let equipTargetRotation = -Math.PI / 2;

// Equip function: attaches to right arm pivot, at the top (like a hand)
function equipRocketLauncher() {
    if (!rocketLauncherModel || isEquipping || equippedTool === 'rocketLauncher') return;
    isEquipping = true;
    equipAnimProgress = 0;

    // Remove from scene if already present elsewhere
    scene.remove(rocketLauncherModel);

    // Attach to right arm pivot (player.rightArm)
    player.rightArm.add(rocketLauncherModel);

    // Position at the top of the arm (like a hand)
    rocketLauncherModel.position.set(0, -1, 0.5); // y: -1 is top of arm, z: 0.5 is in front
    rocketLauncherModel.rotation.set(1.5, Math.PI / 2, 0); // Rotate 90 degrees around Y axis

    rocketLauncherModel.visible = true;
    equippedTool = 'rocketLauncher';

    if (socket && socket.connected) {
        socket.emit("equipTool", { tool: "rocketLauncher" });
    }

    // Highlight button
    document.getElementById('equip-tool-btn').classList.add('equipped');
}

function launchRocket() {
    if (equippedTool !== 'rocketLauncher' || !canShoot) return;

    canShoot = false;
    setTimeout(() => { canShoot = true; }, cooldownTime);

    const rocketGeometry = new THREE.BoxGeometry(1, 1, 1);
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('roblox-stud.png');
    const rocketMaterial = new THREE.MeshBasicMaterial({map: texture,
  color: new THREE.Color('#89CFF0'),
  blending: THREE.MultiplyBlending,
  transparent: true});
    const rocket = new THREE.Mesh(rocketGeometry, rocketMaterial);

    const startPos = new THREE.Vector3();
    rocketLauncherModel.getWorldPosition(startPos);
    rocket.position.copy(startPos);

    raycaster.setFromCamera(mouse, camera);

    const direction = raycaster.ray.direction.clone().normalize();
    const targetPoint = startPos.clone().add(direction.multiplyScalar(maxDistance));

    rocket.lookAt(targetPoint);

    scene.add(rocket);

    if (launchSound && launchSound.buffer) {
        if (launchSound.isPlaying) launchSound.stop();
        launchSound.play();
    }

    const speed = 0.070;
    let travelledDistance = 0;
    const maxTravel = startPos.distanceTo(targetPoint);

    /**
 * Cria uma explosão visual e física em uma determinada posição.
 * @param {THREE.Vector3} position - O ponto central da explosão.
 */
function createExplosion(position) {
    // 1. Tocar o som da explosão
    if (explosionSound && explosionSound.buffer) {
        if (explosionSound.isPlaying) explosionSound.stop();
        if (launchSound.isPlaying) launchSound.stop();
        explosionSound.play();
    }

    // 2. Criar partículas visuais
    const particleCount = 30;
    const particleMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xFFD700,
        blending: THREE.MultiplyBlending,
        transparent: true
    });

    for (let i = 0; i < particleCount; i++) {
        const particleGeometry = new THREE.SphereGeometry(0.2, 8, 8);
        const particle = new THREE.Mesh(particleGeometry, particleMaterial);
        particle.position.copy(position);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 25,
            (Math.random() * 25),
            (Math.random() - 0.5) * 25
        );

        particle.userData = {
            velocity: velocity,
            creationTime: performance.now()
        };

        scene.add(particle);
        explodingParticles.push(particle);
    }

    // 3. Aplicar força física (impulso) a objetos próximos
    const explosionRadius = 20;
    const explosionStrength = 150;

    physicsWorld.bodies.forEach(body => {
        if (body.type === CANNON.Body.STATIC) return;

        const bodyPosition = new CANNON.Vec3().copy(body.position);
        const distanceVec = bodyPosition.vsub(new CANNON.Vec3(position.x, position.y, position.z));
        const distance = distanceVec.length();

        if (distance < explosionRadius) {
            const strength = explosionStrength * (1 - distance / explosionRadius);
            const direction = distanceVec.unit();
            body.applyImpulse(direction.scale(strength), bodyPosition);
        }
    });
}
    
    function animateRocket() {
        rocket.position.add(direction.clone().multiplyScalar(speed));
        travelledDistance += speed;

        if (travelledDistance >= maxTravel) {
            createExplosion(rocket.position);
            scene.remove(rocket);
            return;
        }

        requestAnimationFrame(animateRocket);
    }

    animateRocket();
}

// Unequip function
function unequipTool() {
    if (!rocketLauncherModel || equippedTool !== 'rocketLauncher') return;
    player.rightArm.remove(rocketLauncherModel);
    scene.add(rocketLauncherModel);
    rocketLauncherModel.visible = false;
    equippedTool = null;
    isUnequipping = true;
    player.rightArm.rotation.x = 0; // Reset arm
    document.getElementById('equip-tool-btn').classList.remove('equipped');
}

// Button and keyboard events
window.addEventListener('DOMContentLoaded', () => {
    const equipBtn = document.getElementById('equip-tool-btn');
    equipBtn.addEventListener('click', () => {
        if (equippedTool) {
            unequipTool();
        } else {
            equipRocketLauncher();
        }
    });

    // Keyboard: 1 to equip/unequip
    document.addEventListener('keydown', (e) => {
        if (e.key === '1' && !isChatInputFocused() && !isMenuOpen) {
            if (equippedTool) {
                unequipTool();
            } else {
                equipRocketLauncher();
            }
        }
    });
});

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    const fixedTimeStep = 1 / 60; // 60 FPS

    for (let i = explodingParticles.length - 1; i >= 0; i--) {
    const particle = explodingParticles[i];
    const elapsedTime = (performance.now() - particle.userData.creationTime) / 1000;

    // Aplica gravidade à velocidade da partícula
    particle.userData.velocity.y -= 9.82 * delta * 2; // gravidade

    // Atualiza a posição
    particle.position.x += particle.userData.velocity.x * delta;
    particle.position.y += particle.userData.velocity.y * delta;
    particle.position.z += particle.userData.velocity.z * delta;

    // Desvanece a partícula e a remove depois de um tempo
    if (elapsedTime > 0.5) {
        particle.material.opacity = 1.0 - (elapsedTime - 0.5);
        particle.material.transparent = true;
    }

    if (elapsedTime > 1.5 || particle.position.y < -1) {
        scene.remove(particle);
        particle.geometry.dispose();
        particle.material.dispose();
        explodingParticles.splice(i, 1);
    }
}

    // Interpolate other players
    for (const id in otherPlayers) {
        const remotePlayer = otherPlayers[id];
        if (remotePlayer.userData.targetPosition && remotePlayer.userData.targetQuaternion) {
            remotePlayer.position.lerp(remotePlayer.userData.targetPosition, 0.2);
            remotePlayer.quaternion.slerp(remotePlayer.userData.targetQuaternion, 0.2);
        }
    }

    for (const id in otherPlayers) {
    const remotePlayer = otherPlayers[id];
    const model = remotePlayer.userData.rocketLauncherModel;

    if (!model) continue;

    // EQUIP animação
    if (remotePlayer.userData.isEquipping) {
        remotePlayer.userData.equipAnimProgress += delta;
        const t = Math.min(remotePlayer.userData.equipAnimProgress / equipAnimDuration, 1);
        remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightArm.rotation.x, equipTargetRotation, t);
    }

    // UNEQUIP animação
    if (remotePlayer.userData.isUnequipping) {
    remotePlayer.userData.unequipAnimProgress += delta;
    const t = Math.min(remotePlayer.userData.unequipAnimProgress / equipAnimDuration, 1);
    remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(remotePlayer.rightArm.rotation.x, 0, t);
    if (t >= 1) {
        remotePlayer.userData.isUnequipping = false;
        remotePlayer.rightArm.rotation.x = 0;

        // Remove modelo da mão
        if (model.parent) model.parent.remove(model);
        model.visible = false;
    }
}
}


    // Step physics world
    physicsWorld.step(fixedTimeStep, delta, 3);

    // Animate fallen parts with physics
    if (isRespawning) {
        fallenParts.forEach(part => {
            // Update mesh position and rotation from physics body
            part.mesh.position.copy(part.body.position);
            part.mesh.quaternion.copy(part.body.quaternion);
        });
    }

    // Handle camera keyboard controls
    const cameraRotationSpeed = 1.5;
    const cameraZoomSpeed = 15.0;

    if (rotateCameraLeft) {
        cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotationSpeed * delta);
    }
    if (rotateCameraRight) {
        cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -cameraRotationSpeed * delta);
    }
    if (zoomCameraIn) {
        cameraOffset.multiplyScalar(1.0 - cameraZoomSpeed * delta * 0.1);
    }
    if (zoomCameraOut) {
        cameraOffset.multiplyScalar(1.0 + cameraZoomSpeed * delta * 0.1);
    }

    // Clamp zoom distance
    const distance = cameraOffset.length();
    if (distance < controls.minDistance) {
        cameraOffset.setLength(controls.minDistance);
    }
    if (distance > controls.maxDistance) {
        cameraOffset.setLength(controls.maxDistance);
    }

    if (isRespawning) {
        prevTime = time;
         // Render scene to low-res render target
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);

        // Render pixelated texture to screen
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCamera);
        return; // Skip player logic while respawning
    }

    velocity.y -= 9.8 * 20.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize();

    if (true) {
        const isMoving = direction.length() > 0.001;

        if (isMoving) {
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            cameraDirection.y = 0;
            cameraDirection.normalize();

            const rightDirection = new THREE.Vector3().crossVectors(cameraDirection, new THREE.Vector3(0, 1, 0)).normalize();
            
            const moveDirection = cameraDirection.clone().multiplyScalar(direction.z).add(rightDirection.clone().multiplyScalar(direction.x));
            moveDirection.normalize();

            player.position.add(moveDirection.clone().multiplyScalar(playerSpeed * delta));
            
            if (moveDirection.length() > 0.1) {
                player.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
            }
        } else {
            if (walkSound && walkSound.isPlaying) {
                walkSound.stop();
            }
        }
        
        // Animation logic
        const isMovingOnGround = isMoving && canJump;

        if (!canJump) {
            animationTime = 0;
            const jumpAngle = -Math.PI;
            player.leftArm.rotation.x = THREE.MathUtils.lerp(player.leftArm.rotation.x, jumpAngle, 0.2);
            player.rightArm.rotation.x = THREE.MathUtils.lerp(player.rightArm.rotation.x, jumpAngle, 0.2);
            player.leftLeg.rotation.x = THREE.MathUtils.lerp(player.leftLeg.rotation.x, 0, 0.1);
            player.rightLeg.rotation.x = THREE.MathUtils.lerp(player.rightLeg.rotation.x, 0, 0.1);

        } else if (isMovingOnGround) {
            animationTime += delta * 10;
            const swingAngle = Math.sin(animationTime) * 0.8;
            player.leftArm.rotation.x = swingAngle;
            player.rightArm.rotation.x = -swingAngle;
            player.leftLeg.rotation.x = -swingAngle;
            player.rightLeg.rotation.x = swingAngle;
        } else {
            animationTime = 0;
            player.leftArm.rotation.x = THREE.MathUtils.lerp(player.leftArm.rotation.x, 0, 0.1);
            player.rightArm.rotation.x = THREE.MathUtils.lerp(player.rightArm.rotation.x, 0, 0.1);
            player.leftLeg.rotation.x = THREE.MathUtils.lerp(player.leftLeg.rotation.x, 0, 0.1);
            player.rightLeg.rotation.x = THREE.MathUtils.lerp(player.rightLeg.rotation.x, 0, 0.1);
        }
    }

    player.position.y += (velocity.y * delta);

    if (player.position.y < 3) {
        velocity.y = 0;
        player.position.y = 3;
        canJump = true;
    }

    // Send player position to server (throttled)
    if (socket && socket.connected && time > lastSentTime + sendInterval) {
        socket.emit('playerMove', {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            rotation: player.rotation.y,
            isMoving: direction.length() > 0.001,
            isInAir: !canJump // <-- send whether player is in the air (jumping/falling)
        });
        lastSentTime = time;
    }

    // DANCE ANIMATION
    if (isDancing) {
        animationTime += delta * 8;
        player.leftArm.rotation.x = Math.sin(animationTime) * 1.2 + 1.2;
        player.rightArm.rotation.x = Math.cos(animationTime) * 1.2 + 1.2;
        player.leftLeg.rotation.x = Math.sin(animationTime) * 0.8;
        player.rightLeg.rotation.x = Math.cos(animationTime) * 0.8;
        player.rotation.y += delta * 2; // Spin
        // Optionally, add a little bounce:
        player.position.y = 3 + Math.abs(Math.sin(animationTime) * 0.2);
        // Render and return early to skip normal movement/animation
        // Camera follow logic
        const desiredPosition = player.position.clone().add(cameraOffset);
        camera.position.copy(desiredPosition);
        controls.target.copy(player.position);
        controls.target.y += 1;
        controls.update();
        prevTime = performance.now();
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCamera);
        return;
    }

    // Animate other players' dances
    Object.values(otherPlayers).forEach(otherPlayer => {
        if (otherPlayer.isDancing) {
            // Animate dance for this player
            otherPlayer.animationTime = (otherPlayer.animationTime || 0) + delta * 8;
            otherPlayer.leftArm.rotation.x = Math.sin(otherPlayer.animationTime) * 1.2 + 1.2;
            otherPlayer.rightArm.rotation.x = Math.cos(otherPlayer.animationTime) * 1.2 + 1.2;
            otherPlayer.leftLeg.rotation.x = Math.sin(otherPlayer.animationTime) * 0.8;
            otherPlayer.rightLeg.rotation.x = Math.cos(otherPlayer.animationTime) * 0.8;
            otherPlayer.rotation.y += delta * 2;
            // Optionally, add a little bounce:
            otherPlayer.position.y = 3 + Math.abs(Math.sin(otherPlayer.animationTime) * 0.2);
        }
    });

    // Camera follow logic
    const desiredPosition = player.position.clone().add(cameraOffset);
    camera.position.copy(desiredPosition);
    
    controls.target.copy(player.position);
    controls.target.y += 1; // Look slightly above player's base

    controls.update();

    prevTime = performance.now();

    // Render scene to low-res render target
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, camera);

    // Render pixelated texture to screen
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);

    // Keep right arm straight while rocket launcher is equipped and not equipping
    if (equippedTool === 'rocketLauncher' && !isEquipping) {
        player.rightArm.rotation.x = -Math.PI / 2;
    }

    // --- Equip animation for rocket launcher ---
    if (isEquipping) {
        equipAnimProgress += delta;
        const t = Math.min(equipAnimProgress / equipAnimDuration, 1);
        player.rightArm.rotation.x = THREE.MathUtils.lerp(
            player.rightArm.rotation.x,
            equipTargetRotation,
            t
        );
        if (t >= 1) {
            player.rightArm.rotation.x = equipTargetRotation;
            isEquipping = false;
        }
    } else if (equippedTool === 'rocketLauncher') {
        player.rightArm.rotation.x = equipTargetRotation;
    }
}

// Chat message handling
window.addEventListener('DOMContentLoaded', () => {
    const chatSendBtn = document.getElementById('chat-send');
    const chatInput = document.getElementById('chat-input');
    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') sendChatMessage();
        });
    }

    const menuBtn = document.getElementById('menu-btn');
    const gameMenu = document.getElementById('game-menu');
    const resumeBtn = document.getElementById('resume-btn');
    const optionsBtn = document.getElementById('options-btn');
    const exitBtn = document.getElementById('exit-btn');

    menuBtn.addEventListener('click', () => {
        gameMenu.style.display = 'block';
        isMenuOpen = true;
    });

    resumeBtn.addEventListener('click', () => {
        gameMenu.style.display = 'none';
        isMenuOpen = false;
    });

    optionsBtn.addEventListener('click', () => {
        alert('Options menu coming soon!');
    });

    exitBtn.addEventListener('click', () => {
        window.location.href = '/'; // Or any exit logic you want
    });

    // ESC key closes menu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            gameMenu.style.display = 'none';
            isMenuOpen = false;
        }
    });
});

let isDancing = false;
let danceMusic;

let isMenuOpen = false;

initGame();

if (equippedTool === 'rocketLauncher' && !isEquipping) {
    player.rightArm.rotation.x = -Math.PI / 2; // Keep arm straight
}

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('click', launchRocket);