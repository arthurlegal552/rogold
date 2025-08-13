import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// User management system
class UserManager {
    constructor() {
        this.currentUser = null;
        try {
            this.users = JSON.parse(localStorage.getItem('rogold_users')) || {};
        } catch (e) {
            console.error("Error parsing rogold_users from localStorage, resetting:", e);
            this.users = {};
            // Optionally clear corrupt data to prevent repeated errors
            localStorage.removeItem('rogold_users'); 
        }
    }

    register(username, password) {
        if (this.users[username]) {
            return { success: false, message: 'Usuário já existe!' };
        }
        this.users[username] = { password, createdAt: new Date().toISOString() };
        localStorage.setItem('rogold_users', JSON.stringify(this.users));
        return { success: true };
    }

    login(username, password) {
        const user = this.users[username];
        if (!user || user.password !== password) {
            return { success: false, message: 'Usuário ou senha incorretos!' };
        }
        this.currentUser = username;
        localStorage.setItem('rogold_currentUser', username);
        return { success: true };
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('rogold_currentUser');
    }

    getCurrentUser() {
        return localStorage.getItem('rogold_currentUser');
    }

    updateUser(currentUsername, currentPassword, newUsername, newPassword) {
        const user = this.users[currentUsername];
        if (!user || user.password !== currentPassword) {
            return { success: false, message: 'Senha atual incorreta!' };
        }

        let actualNewUsername = newUsername || currentUsername; // Determine the actual new username

        // If username is changing
        if (newUsername && newUsername !== currentUsername) {
            if (this.users[newUsername]) {
                return { success: false, message: 'Novo usuário já existe!' };
            }
            // IMPORTANT: Migrate profile data BEFORE deleting old user entry
            profileManager.migrateProfileUsername(currentUsername, newUsername);

            this.users[newUsername] = { ...this.users[currentUsername] };
            delete this.users[currentUsername];
            
            // Update session
            localStorage.setItem('rogold_currentUser', newUsername);
            this.currentUser = newUsername;
        }

        // Se está mudando a senha (apply to the actual new username)
        if (newPassword) {
            this.users[actualNewUsername].password = newPassword;
        }

        localStorage.setItem('rogold_users', JSON.stringify(this.users));
        return { success: true, newUsername: actualNewUsername };
    }

    getAllUsernames() {
        return Object.keys(this.users);
    }
}

const userManager = new UserManager();

// Profile functionality
class ProfileManager {
    constructor(userManager) {
        this.userManager = userManager;
        try {
            this.profiles = JSON.parse(localStorage.getItem('rogold_profiles')) || {};
        } catch (e) {
            console.error("Error parsing rogold_profiles from localStorage, resetting:", e);
            this.profiles = {};
            // Optionally clear corrupt data to prevent repeated errors
            localStorage.removeItem('rogold_profiles');
        }
    }

    getProfile(username) {
        let rawProfile = this.profiles[username];

        const defaultProfile = {
            bio: 'Este usuário ainda não escreveu uma descrição.',
            status: 'Offline',
            friends: [],
            sentRequests: [],
            receivedRequests: [],
            favorites: [],
            profilePicture: null,
            coins: 500, 
            inventory: [], 
            equippedItems: {} 
        };

        // Merge existing profile data with default values to ensure all fields are present.
        const mergedProfile = { ...defaultProfile, ...rawProfile };

        // Ensure array types for lists and filter out non-string/empty values
        ['friends', 'sentRequests', 'receivedRequests', 'favorites', 'inventory'].forEach(key => { 
            if (!Array.isArray(mergedProfile[key])) {
                mergedProfile[key] = [];
            }
            mergedProfile[key] = mergedProfile[key].filter(item => typeof item === 'string' && item.trim() !== '');
        });

        // Ensure equippedItems is an object
        if (typeof mergedProfile.equippedItems !== 'object' || mergedProfile.equippedItems === null) {
            mergedProfile.equippedItems = {};
        }

        // Specifically handle `joinDate` as it might be sourced from `userManager.users`
        if (!mergedProfile.joinDate) {
            mergedProfile.joinDate = this.userManager.users[username]?.createdAt || new Date().toISOString();
        }

        // Ensure coins is a number
        if (typeof mergedProfile.coins !== 'number' || isNaN(mergedProfile.coins)) {
            mergedProfile.coins = defaultProfile.coins;
        }

        // Update the stored profile with the merged structure.
        this.profiles[username] = mergedProfile;
        this.saveProfiles();
        
        return mergedProfile;
    }

    updateProfile(username, updates) {
        if (this.profiles[username]) {
            Object.assign(this.profiles[username], updates);
            this.saveProfiles();
            return true;
        }
        return false;
    }

    // Add this new method to ProfileManager
    migrateProfileUsername(oldUsername, newUsername) {
        if (this.profiles[oldUsername]) {
            this.profiles[newUsername] = { ...this.profiles[oldUsername] }; 
            delete this.profiles[oldUsername]; 
            this.saveProfiles();
            console.log(`Profile migrated from ${oldUsername} to ${newUsername}`);
            return true;
        }
        return false;
    }

    // Send a friend request
    sendFriendRequest(senderUsername, receiverUsername) {
        if (senderUsername === receiverUsername) {
            return { success: false, message: 'Você não pode enviar um pedido de amizade para si mesmo!' };
        }
        if (!this.userManager.users[receiverUsername]) {
            return { success: false, message: 'Usuário não encontrado.' };
        }

        const senderProfile = this.getProfile(senderUsername);
        const receiverProfile = this.getProfile(receiverUsername);

        if (senderProfile.friends.includes(receiverUsername)) {
            return { success: false, message: 'Vocês já são amigos!' };
        }
        if (senderProfile.sentRequests.includes(receiverUsername)) {
            return { success: false, message: 'Você já enviou um pedido de amizade para este usuário!' };
        }
        if (senderProfile.receivedRequests.includes(receiverUsername)) {
            return { success: false, message: 'Este usuário já enviou um pedido de amizade para você! Aceite-o.' };
        }

        senderProfile.sentRequests.push(receiverUsername);
        receiverProfile.receivedRequests.push(senderUsername);
        this.saveProfiles();
        return { success: true, message: `Pedido de amizade enviado para ${receiverUsername}!` };
    }

    // Accept a friend request
    acceptFriendRequest(accepterUsername, senderUsername) {
        const accepterProfile = this.getProfile(accepterUsername);
        const senderProfile = this.getProfile(senderUsername);

        // Remove from received requests
        accepterProfile.receivedRequests = accepterProfile.receivedRequests.filter(user => user !== senderUsername);
        // Add to friends list for accepter
        accepterProfile.friends.push(senderUsername);

        // Remove from sent requests for sender
        senderProfile.sentRequests = senderProfile.sentRequests.filter(user => user !== accepterUsername);
        // Add to friends list for sender
        senderProfile.friends.push(accepterUsername);
        
        this.saveProfiles();
        return { success: true, message: `Você e ${senderUsername} agora são amigos!` };
    }

    // Decline a friend request
    declineFriendRequest(declinerUsername, senderUsername) {
        const declinerProfile = this.getProfile(declinerUsername);
        const senderProfile = this.getProfile(senderUsername);

        // Remove from received requests for decliner
        declinerProfile.receivedRequests = declinerProfile.receivedRequests.filter(user => user !== senderUsername);
        // Remove from sent requests for sender
        senderProfile.sentRequests = senderProfile.sentRequests.filter(user => user !== declinerUsername);

        this.saveProfiles();
        return { success: true, message: `Pedido de amizade de ${senderUsername} recusado.` };
    }

    // Check if two users are friends
    areFriends(user1, user2) {
        const profile1 = this.getProfile(user1);
        return profile1.friends.includes(user2);
    }

    // Check if a request has been sent
    hasSentRequest(sender, receiver) {
        const senderProfile = this.getProfile(sender);
        return senderProfile.sentRequests.includes(receiver);
    }

    // Check if a request has been received
    hasReceivedRequest(receiver, sender) {
        const receiverProfile = this.getProfile(receiver);
        return receiverProfile.receivedRequests.includes(sender);
    }

    // Add a game to favorites
    addFavorite(username, gameTitle) {
        const profile = this.getProfile(username);
        // Ensure gameTitle is a valid string before adding
        if (typeof gameTitle !== 'string' || gameTitle.trim() === '') {
            console.error("Attempted to add invalid game title to favorites:", gameTitle); 
            return { success: false, message: 'Nome de jogo inválido.' };
        }
        if (!profile.favorites.includes(gameTitle)) {
            profile.favorites.push(gameTitle);
            this.saveProfiles();
            return { success: true, message: `'${gameTitle}' adicionado aos seus favoritos!` };
        }
        return { success: false, message: `'${gameTitle}' já está nos seus favoritos.` };
    }

    // Remove a game from favorites
    removeFavorite(username, gameTitle) {
        const profile = this.getProfile(username);
        const initialLength = profile.favorites.length;
        // Ensure gameTitle is a valid string for comparison
        if (typeof gameTitle !== 'string' || gameTitle.trim() === '') {
            console.error("Attempted to remove invalid game title from favorites:", gameTitle); 
            return { success: false, message: 'Nome de jogo inválido para remover.' };
        }
        profile.favorites = profile.favorites.filter(game => game !== gameTitle);
        if (profile.favorites.length < initialLength) {
            this.saveProfiles();
            return { success: true, message: `'${gameTitle}' removido dos seus favoritos.` };
        }
        return { success: false, message: `'${gameTitle}' não está nos seus favoritos.` };
    }

    // NEW: Coins management
    addCoins(username, amount) {
        const profile = this.getProfile(username);
        if (profile) {
            profile.coins = (profile.coins || 0) + amount;
            this.saveProfiles();
            return { success: true, newBalance: profile.coins };
        }
        return { success: false, message: 'Usuário não encontrado.' };
    }

    subtractCoins(username, amount) {
        const profile = this.getProfile(username);
        if (profile) {
            if (profile.coins >= amount) {
                profile.coins -= amount;
                this.saveProfiles();
                return { success: true, newBalance: profile.coins };
            }
            return { success: false, message: 'Moedas insuficientes.' };
        }
        return { success: false, message: 'Usuário não encontrado.' };
    }

    // NEW: Inventory and Equipment management
    addItemToInventory(username, itemId) {
        const profile = this.getProfile(username);
        if (profile && !profile.inventory.includes(itemId)) {
            profile.inventory.push(itemId);
            this.saveProfiles();
            return { success: true, message: 'Item adicionado ao inventário!' };
        }
        return { success: false, message: 'Item já está no inventário ou usuário não encontrado.' };
    }

    // Equip an item, making sure it's in inventory and replacing existing item of same type
    equipItem(username, itemId, itemType) {
        const profile = this.getProfile(username);
        if (!profile) {
            return { success: false, message: 'Usuário não encontrado.' };
        }
        if (!profile.inventory.includes(itemId)) {
            return { success: false, message: 'Você não possui este item.' };
        }
        
        profile.equippedItems[itemType] = itemId; 
        this.saveProfiles();
        return { success: true, message: 'Item equipado com sucesso!' };
    }

    unequipItem(username, itemType) {
        const profile = this.getProfile(username);
        if (!profile) {
            return { success: false, message: 'Usuário não encontrado.' };
        }
        if (profile.equippedItems[itemType]) {
            delete profile.equippedItems[itemType];
            this.saveProfiles();
            return { success: true, message: `Item do tipo ${itemType} desequipado.` };
        }
        return { success: false, message: `Nenhum item do tipo ${itemType} está equipado.` };
    }

    saveProfiles() {
        localStorage.setItem('rogold_profiles', JSON.stringify(this.profiles));
    }
}

const profileManager = new ProfileManager(userManager);

// NEW: Generic 3D Viewer Class to manage multiple viewers
class ThreeDViewer {
    constructor(containerId, initialModelPath = null, isAvatarViewer = false) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`3D Viewer container '${containerId}' not found.`);
            return;
        }

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.renderer = null; 
        this.controls = null; 
        this.currentModel = null;
        this.animateLoopId = null;
        this.loader = new GLTFLoader();
        this.isAvatarViewer = isAvatarViewer; 

        this.init(initialModelPath);
    }

    init(initialModelPath) {
        // Clear previous canvas if it exists
        const existingCanvas = this.container.querySelector('canvas');
        if (existingCanvas) {
            this.container.removeChild(existingCanvas);
            this.stopAnimation();
        }

        // Remove placeholder text if viewer is being initialized
        const placeholder = this.container.querySelector('.viewer-placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        this.scene.background = new THREE.Color(0xadd8e6); 

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        // Lights (add only once)
        if (!this.scene.getObjectByName('ambientLight')) {
            const ambientLight = new THREE.AmbientLight(0x404040); 
            ambientLight.name = 'ambientLight';
            this.scene.add(ambientLight);
        }
        if (!this.scene.getObjectByName('directionalLight')) {
            const directionalLight = new THREE.DirectionalLight(0xffffff, 1); 
            directionalLight.position.set(0, 5, 5).normalize();
            directionalLight.name = 'directionalLight';
            this.scene.add(directionalLight);
        }

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enablePan = false;
        this.controls.enableZoom = true; 
        // Allow full vertical orbit for item viewer, limited for avatar viewer
        if (this.isAvatarViewer) {
            this.controls.minPolarAngle = Math.PI / 2 - 0.5;
            this.controls.maxPolarAngle = Math.PI / 2 + 0.5;
            this.controls.target.set(0, 0.5, 0); // Target center of avatar body (half of the new height)
        } else {
            this.controls.minPolarAngle = 0; // Look from top
            this.controls.maxPolarAngle = Math.PI; // Look from bottom
            this.controls.target.set(0, 0, 0); // Default target for items
        }
        this.controls.update();

        // Animation loop
        const animate = () => {
            this.animateLoopId = requestAnimationFrame(animate);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();

        // Handle window resize
        this.onWindowResize = () => {
            const newWidth = this.container.clientWidth;
            const newHeight = this.container.clientHeight;
            this.camera.aspect = newWidth / newHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(newWidth, newHeight);
        };
        window.addEventListener('resize', this.onWindowResize);

        if (initialModelPath) {
            this.loadModel(initialModelPath);
        }
    }

    stopAnimation() {
        if (this.animateLoopId) {
            cancelAnimationFrame(this.animateLoopId);
            this.animateLoopId = null;
        }
        window.removeEventListener('resize', this.onWindowResize);
    }

    clearScene() {
        // Remove all objects from the scene except lights
        const objectsToRemove = this.scene.children.filter(obj => 
            obj.name !== 'ambientLight' && obj.name !== 'directionalLight'
        );
        objectsToRemove.forEach(obj => this.scene.remove(obj));
        this.currentModel = null;
    }

    // New loadModel signature: isAccessory indicates if it's being added as an accessory
    // accessoryType and modelPathForAccessory are only relevant if isAccessory is true
    loadModel(modelPath, isAccessory = false, accessoryType = null) {
        if (!isAccessory) {
            this.clearScene();
        }

        this.loader.load(modelPath, (gltf) => {
            const newModel = gltf.scene;
            newModel.name = modelPath; 

            // Step 1: Apply intrinsic model-specific transformations (e.g., for rotation issues)
            this._applyIntrinsicModelTransforms(newModel, modelPath);

            if (!isAccessory) {
                // If it's a standalone model (item viewer or base avatar)
                this.currentModel = newModel;
                this.scene.add(this.currentModel);
                // Step 2: Fit model to viewer, which also positions it at origin and scales it generally
                this._fitCameraAndModelToViewer(this.currentModel);
            } else {
                // If it's an accessory being added to an existing model (avatar viewer)
                this.scene.add(newModel);
                // Step 3: Position and scale the accessory relative to the main avatar
                this._positionAccessoryOnAvatar(newModel, modelPath, accessoryType);
            }

        }, undefined, (error) => {
            console.error(`Error loading 3D model ${modelPath}:`, error);
            // Removed specific error message for item viewer placeholder.
            // If it's an accessory and fails, it just won't show.
        });
    }

    // Renamed and refined fitCameraToModel
    _fitCameraAndModelToViewer(model) {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Handle case where size is zero (empty or invalid model)
        if (size.lengthSq() === 0) {
            console.warn("Model has zero size bounding box, cannot fit camera.");
            this.camera.position.set(0, 0, 5);
            this.controls.target.set(0, 0, 0);
            this.camera.updateProjectionMatrix();
            this.controls.update();
            return;
        }

        // Position model on the ground (y=0) and center horizontally
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        // Recalculate box after moving model to origin
        const newBox = new THREE.Box3().setFromObject(model);
        const newSize = newBox.getSize(new THREE.Vector3());
        const newCenter = newBox.getCenter(new THREE.Vector3());

        // Apply a universal scale to make models roughly 'targetHeight' tall for consistent viewing
        const targetHeight = 0.5; // Changed from 2.0 to 1.0
        if (newSize.y > 0) { // Avoid division by zero
            const scaleFactor = targetHeight / newSize.y;
            model.scale.multiplyScalar(scaleFactor);
            // Recalculate box and center after final scaling
            newBox.setFromObject(model);
            newSize.copy(newBox.getSize(new THREE.Vector3()));
            newCenter.copy(newBox.getCenter(new THREE.Vector3()));
        }

        // Calculate camera distance to frame the object based on its largest dimension and camera FOV
        const maxDim = Math.max(newSize.x, newSize.y, newSize.z);
        const fov = this.camera.fov * (Math.PI / 180); 
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)); 
        
        // Add some padding to the view distance
        cameraZ *= 1.5; 

        // Set camera position and target
        this.camera.position.set(newCenter.x, newCenter.y, cameraZ); 
        this.controls.target.set(newCenter.x, newCenter.y, newCenter.z); 
        
        this.camera.near = 0.1; 
        this.camera.far = cameraZ + maxDim * 2; 
        this.camera.updateProjectionMatrix();

        this.controls.update();
    }

    // New: Applies fixed rotation for models with export issues (Z-up vs Y-up)
    _applyIntrinsicModelTransforms(model, modelPath) {
        const commonRotationX = Math.PI / 2; // Rotate 90 degrees around X to orient correctly (Z-up to Y-up)

        // Apply this rotation to all GLB models that are known to be Z-up exports
        if (modelPath.includes('.glb') && !modelPath.includes('player.glb')) { // Don't rotate player.glb
            model.rotation.set(commonRotationX, 0, 0); 
        }
    }

    // New: Positions and scales accessories relative to the avatar
    _positionAccessoryOnAvatar(accessoryModel, modelPath, accessoryType) {
        let offset = { x: 0, y: 0, z: 0 };
        const avatarHeight = 0.8; // mesmo targetHeight do avatar
        
        // Calculate the bounding box for the raw accessory model AFTER intrinsic transforms
        const originalBox = new THREE.Box3().setFromObject(accessoryModel);
        const originalSize = originalBox.getSize(new THREE.Vector3());

        // Desired visual height for a hat on a 1-unit player (adjust as needed for aesthetics)
        let targetVisualHeight = 0.2; 

        if (accessoryType === 'hat') {
            // Base Y position for hats on a 1-unit tall avatar (assuming 1 unit is head top)

            if (originalSize.y > 0) {
                let scaleFactor = targetVisualHeight / originalSize.y;

                // Apply model-specific adjustments if some hats are intrinsically larger/smaller
                // or if they need a different visual prominence.
                if (modelPath.includes('doge_roblox_hat.glb')) {
                    scaleFactor *= 1.5; // Make doge hat larger
                    offset.y = avatarHeight * 0.8; // topo da cabeça
                    offset.z = 0.05; // Slightly forward
                } else if (modelPath.includes('roblox_r_baseball_cap_r6.glb')) {
                    scaleFactor *= 1.2; // Slightly larger for baseball cap
                    offset.y = 1.08; // Adjust position for cap
                    offset.z = 0.05;
                } else if (modelPath.includes('roblox_fedora.glb')) {
                    scaleFactor *= 1.1; // Slightly larger for fedora
                    offset.y = 1.08; // Adjust position for fedora
                    offset.z = 0.05;
                }
                
                accessoryModel.scale.multiplyScalar(scaleFactor);
            }
        }
        
        // After scaling, re-center the accessory if its pivot isn't at the bottom
        const scaledBox = new THREE.Box3().setFromObject(accessoryModel);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
        
        // Adjust position so the base of the *scaled* accessory sits correctly relative to the target offset
        accessoryModel.position.x = offset.x - scaledCenter.x;
        accessoryModel.position.y = offset.y - scaledBox.min.y; // Align bottom of accessory with target Y
        accessoryModel.position.z = offset.z - scaledCenter.z;
    }

    destroy() {
        this.stopAnimation();
        if (this.renderer && this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        this.scene.traverse((object) => { // Dispose of geometries, materials, textures
            if (object.isMesh) {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    // In case of multiple materials or material arrays
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });
        this.scene.clear(); // Clear all objects from the scene
        this.renderer.dispose();
        if (this.controls) this.controls.dispose();
        // Nullify references to aid garbage collection
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.currentModel = null;
    }
}

// Global 3D viewer instances
// This variable will hold the instance of our ThreeDViewer class for the avatar.
let avatar3DViewer = null; 

// Catalog Management
class CatalogManager {
    constructor() {
        this.items = [
            // Only 3D items with modelPath and a corresponding imageUrl (thumbnail)
            { id: 'hat_red', name: 'Boné Vermelho R', type: 'hat', price: 100, imageUrl: 'hat_red_thumbnail.png', modelPath: 'roblox_r_baseball_cap_r6.glb' },
            { id: 'hat_doge', name: 'Chapéu Doge', type: 'hat', price: 500, imageUrl: 'hat_doge_thumbnail.png', modelPath: 'doge_roblox_hat.glb' },
            { id: 'hat_fedora_black', name: 'Fedora Preta', type: 'hat', price: 300, imageUrl: 'hat_fedora_black_thumbnail.png', modelPath: 'roblox_fedora.glb' }
            // Removed all 2D items as per user request
        ]
    }

    getAllItems() {
        return this.items;
    }

    getItemsByType(type) {
        if (type === 'all') {
            return this.items;
        }
        return this.items.filter(item => item.type === type);
    }

    getItemById(id) {
        return this.items.find(item => item.id === id);
    }
}

const catalogManager = new CatalogManager();

// Community Management
class CommunityManager {
    constructor() {
        try {
            this.blogs = JSON.parse(localStorage.getItem('rogold_blogs')) || [];
        } catch (e) {
            console.error("Error parsing rogold_blogs from localStorage, resetting:", e);
            this.blogs = [];
            // Optionally clear corrupt data to prevent repeated errors
            localStorage.removeItem('rogold_blogs');
        }
        this.currentBlog = null;
    }

    createBlog(title, message, author) {
        const blog = {
            id: Date.now(),
            title,
            message,
            author,
            createdAt: new Date().toISOString(),
            messages: []
        };
        
        this.blogs.unshift(blog);
        this.saveBlogs();
        return blog;
    }

    getBlogs() {
        return this.blogs;
    }

    getBlog(id) {
        return this.blogs.find(blog => blog.id === id);
    }

    addMessage(blogId, message, author) {
        const blog = this.getBlog(blogId);
        if (blog) {
            const newMessage = {
                id: Date.now(),
                message,
                author,
                timestamp: new Date().toISOString()
            };
            blog.messages.push(newMessage);
            this.saveBlogs();
            return newMessage;
        }
        return null;
    }

    saveBlogs() {
        localStorage.setItem('rogold_blogs', JSON.stringify(this.blogs));
    }
}

const communityManager = new CommunityManager();

// Helper functions for showing/hiding sections with fade animation
function showSection(sectionElement) {
    if (!sectionElement) return;
    sectionElement.style.opacity = '0'; 
    sectionElement.classList.remove('hidden'); 
    // Force reflow for transition to apply correctly
    sectionElement.offsetHeight; 
    sectionElement.style.opacity = '1'; 
}

function hideSection(sectionElement) {
    if (!sectionElement) return;
    sectionElement.style.opacity = '0'; 
    // After transition, set display to none
    setTimeout(() => {
        sectionElement.classList.add('hidden');
    }, 300); 
}

// Function to manage which auth/form section is visible
// This function hides all auth forms except the target one.
function showOnlyAuthSection(targetId) {
    // This list should only contain top-level authentication/settings forms
    // that overlay or replace the main content area.
    const authSections = ['login-section', 'register-section', 'settings-section', 'profile-edit-section']; // Corrected list
    
    authSections.forEach(id => {
        const section = document.getElementById(id);
        if (section) {
            if (id === targetId) {
                showSection(section);
            } else {
                hideSection(section);
            }
        }
    });
}

// Global UI functions for inline HTML event handlers (e.g., onclick) and event listeners
// Defined as function declarations so they are hoisted and available throughout the script.
async function openLoginModal() {
    // Hide all main content sections and display only the target auth section
    hideSection(document.getElementById('featured-games'));
    hideSection(document.querySelector('.banner'));
    hideSection(document.getElementById('profile-section'));
    hideSection(document.getElementById('community-section'));
    hideSection(document.getElementById('catalog-section')); 
    hideSection(document.getElementById('blog-list')); 

    showOnlyAuthSection('login-section');
    setActiveNavLink(null); 
}

async function openRegisterModal() {
    // Hide all main content sections and display only the target auth section
    hideSection(document.getElementById('featured-games'));
    hideSection(document.querySelector('.banner'));
    hideSection(document.getElementById('profile-section'));
    hideSection(document.getElementById('community-section'));
    hideSection(document.getElementById('catalog-section')); 
    hideSection(document.getElementById('blog-list')); 

    showOnlyAuthSection('register-section');
    setActiveNavLink(null); 
}

async function openSettingsModal() {
    const currentUser = userManager.getCurrentUser();
    if (currentUser) {
        document.getElementById('current-username-inline').value = currentUser;
        
        // Hide all main content sections and display only the target auth section
        hideSection(document.getElementById('featured-games'));
        hideSection(document.querySelector('.banner'));
        hideSection(document.getElementById('profile-section'));
        hideSection(document.getElementById('community-section'));
        hideSection(document.getElementById('catalog-section')); 
        hideSection(document.getElementById('blog-list')); 
        
        showOnlyAuthSection('settings-section');
        setActiveNavLink(null); 
    } else {
        await alert('Você precisa estar logado para acessar as configurações.');
        openLoginModal(); 
    }
}

// Function to handle user logout
async function logoutUser() {
    const confirmLogout = await confirm('Tem certeza que deseja sair da sua conta?');
    if (confirmLogout) {
        userManager.logout();
        await alert('Você saiu da sua conta.');
        
        // Ensure all active content sections and auth forms are hidden
        hideSection(document.getElementById('profile-section'));
        hideSection(document.getElementById('community-section'));
        hideSection(document.getElementById('catalog-section')); 
        hideSection(document.getElementById('blog-list')); 
        showOnlyAuthSection(''); 
        
        // Stop the avatar 3D viewer when logging out
        stopAvatar3DViewer();
        stopCoinRewardTimer();

        // After a short delay for transitions to complete, show main content and then login
        setTimeout(() => {
            showMainContent(); 
            updateProfileLink();
            updateFeaturedGameCards(); 
            updateUserCoinsDisplay(); 
            openLoginModal(); 
        }, 300); 
    }
}

// This function is for closing an auth form and returning to the main page content.
function hideCurrentAuthFormAndShowMainContent() {
    // Hide all auth forms first
    showOnlyAuthSection(''); 

    // Then show the default main page content
    showMainContent();
}

// NEW: Function to show the main content (banner and featured games)
function showMainContent() {
    hideSection(document.getElementById('profile-section'));
    hideSection(document.getElementById('community-section'));
    hideSection(document.getElementById('catalog-section')); 
    hideSection(document.getElementById('blog-list'));
    showOnlyAuthSection(''); 

    showSection(document.getElementById('featured-games'));
    showSection(document.querySelector('.banner'));
    
    updateFeaturedGameCards(); 
    setActiveNavLink('home-link'); 
}

// Enhanced UI Functions
function showProfile(username) {
    const profileSection = document.getElementById('profile-section');
    
    // Update profile data
    const profile = profileManager.getProfile(username);
    document.getElementById('profile-username').textContent = username;
    document.getElementById('profile-bio').textContent = profile.bio;
    document.querySelector('.profile-status').textContent = `Status: ${profile.status}`;
    document.getElementById('join-date').textContent = new Date(profile.joinDate).toLocaleDateString('pt-BR');
    document.getElementById('favorite-count').textContent = profile.favorites.length;
    document.getElementById('user-coins').textContent = profile.coins; 

    // Update profile picture
    const profileAvatarImg = document.getElementById('profile-avatar-img');
    const avatarPlaceholder = document.getElementById('avatar-placeholder');

    if (profile.profilePicture) {
        profileAvatarImg.src = profile.profilePicture;
        profileAvatarImg.classList.remove('hidden');
        avatarPlaceholder.classList.add('hidden');
    } else {
        profileAvatarImg.classList.add('hidden');
        avatarPlaceholder.classList.remove('hidden');
    }
    
    // Hide other sections, show profile
    hideSection(document.getElementById('featured-games'));
    hideSection(document.querySelector('.banner'));
    hideSection(document.getElementById('community-section')); 
    hideSection(document.getElementById('catalog-section')); 
    hideSection(document.getElementById('blog-list')); 
    showOnlyAuthSection(''); 
    
    showSection(profileSection); 
    setActiveNavLink('profile-link'); 
    
    // Setup tab functionality
    updateProfileTabs();
}

function hideProfile() {
    const profileSection = document.getElementById('profile-section');
    
    hideSection(profileSection); 
    
    setTimeout(() => {
        showMainContent(); 
        showOnlyAuthSection(''); 
    }, 300);
}

// New functions for community section
function showCommunity() {
    const communitySection = document.getElementById('community-section');
    const blogList = document.getElementById('blog-list'); 
    const createBlogForm = document.getElementById('create-blog-form'); // Get reference
    const blogDetail = document.getElementById('blog-detail'); // Get reference

    // Hide main content and profile section
    hideSection(document.getElementById('featured-games'));
    hideSection(document.querySelector('.banner'));
    hideSection(document.getElementById('profile-section'));
    hideSection(document.getElementById('catalog-section')); 
    showOnlyAuthSection(''); // Ensure top-level auth forms are hidden

    // Ensure only the blog list is visible within the community section
    // Hide create form and blog detail by default when showing community overview
    if (createBlogForm) hideSection(createBlogForm); // Explicitly hide
    if (blogDetail) hideSection(blogDetail); // Explicitly hide

    // Show community section and load blogs
    showSection(communitySection);
    showSection(blogList); 
    loadBlogs();
    setActiveNavLink('community-link'); 
}

function hideCommunity() {
    const communitySection = document.getElementById('community-section');
    const blogList = document.getElementById('blog-list'); 
    hideSection(communitySection); 
    hideSection(blogList); 

    setTimeout(() => {
        showMainContent(); 
        showOnlyAuthSection(''); 
    }, 300);
}

// Function to initialize and render the Avatar 3D Viewer
function setupAndLoadAvatar3DViewer() {
    if (!avatar3DViewer) {
        avatar3DViewer = new ThreeDViewer('avatar-preview-display', 'player.glb', true); 
    } else {
        // If already exists, just ensure base model is loaded (it should clear accessories)
        // Clear accessories manually to avoid re-loading base player if it's already there
        const objectsToRemove = avatar3DViewer.scene.children.filter(obj => 
            obj.name && obj.name !== 'player.glb' && obj.name !== 'ambientLight' && obj.name !== 'directionalLight'
        );
        objectsToRemove.forEach(obj => avatar3DViewer.scene.remove(obj));
        
        // Ensure the base player model is indeed present.
        const basePlayer = avatar3DViewer.scene.getObjectByName('player.glb');
        if (!basePlayer) {
            avatar3DViewer.loadModel('player.glb');
        }
    }
    updateEquippedAvatarItems(); 
}

// Function to stop the Avatar 3D Viewer
function stopAvatar3DViewer() {
    if (avatar3DViewer) {
        avatar3DViewer.destroy();
        avatar3DViewer = null; 
    }
}

// NEW: Function to update equipped items on the 3D avatar preview
function updateEquippedAvatarItems() {
    const avatarDisplay = document.getElementById('avatar-preview-display');
    const currentUser = userManager.getCurrentUser();

    if (!currentUser) {
        // If no user, destroy existing viewer and show placeholder
        if (avatar3DViewer) {
            avatar3DViewer.destroy();
            avatar3DViewer = null;
        }
        if (avatarDisplay) {
            avatarDisplay.innerHTML = '<p class="viewer-placeholder">Faça login para ver seu personagem 3D.</p>';
        }
        return;
    }

    // If user is logged in, ensure viewer is initialized
    if (!avatar3DViewer) {
        setupAndLoadAvatar3DViewer(); // This re-initializes and loads player.glb
    } else {
        // Ensure base player model is present, clear only accessories
        const basePlayer = avatar3DViewer.scene.getObjectByName('player.glb');
        if (!basePlayer) {
            avatar3DViewer.loadModel('player.glb'); // Reload base player if somehow missing
        }
        // Remove only accessories from the scene
        const objectsToRemove = avatar3DViewer.scene.children.filter(obj => 
            obj.name && obj.name !== 'player.glb' && obj.name !== 'ambientLight' && obj.name !== 'directionalLight'
        );
        objectsToRemove.forEach(obj => avatar3DViewer.scene.remove(obj));
    }

    // Remove any existing placeholder if viewer is now active
    const existingPlaceholder = avatarDisplay.querySelector('.viewer-placeholder');
    if (existingPlaceholder) {
        existingPlaceholder.remove();
    }

    const profile = profileManager.getProfile(currentUser);

    for (const type in profile.equippedItems) {
        const itemId = profile.equippedItems[type];
        const item = catalogManager.getItemById(itemId);

        if (item && item.modelPath) {
            avatar3DViewer.loadModel(item.modelPath, true, item.type);
        }
    }
    avatar3DViewer.controls.update(); 
}

function showCatalog() {
    const catalogSection = document.getElementById('catalog-section');
    const currentUser = userManager.getCurrentUser();

    if (!currentUser) {
        alert('Você precisa estar logado para acessar o catálogo.');
        return;
    }

    updateUserCoinsDisplay();
    
    // Hide other sections
    hideSection(document.getElementById('featured-games'));
    hideSection(document.querySelector('.banner'));
    hideSection(document.getElementById('profile-section'));
    hideSection(document.getElementById('community-section')); 
    hideSection(document.getElementById('blog-list')); 
    showOnlyAuthSection(''); 

    showSection(catalogSection);
    renderCatalogItems('all'); 

    // Initialize the Avatar 3D viewer when catalog is shown
    setupAndLoadAvatar3DViewer(); 

    setActiveNavLink('catalog-link'); 
}

function hideCatalog() {
    const catalogSection = document.getElementById('catalog-section');
    hideSection(catalogSection);

    // Stop the Avatar 3D viewer when catalog is hidden
    stopAvatar3DViewer();

    setTimeout(() => {
        showMainContent();
    }, 300);
}

function updateUserCoinsDisplay() {
    const currentUser = userManager.getCurrentUser();
    const currentCatalogCoinsElement = document.getElementById('current-catalog-coins');
    const userCoinsProfileElement = document.getElementById('user-coins'); 

    if (currentUser) {
        const profile = profileManager.getProfile(currentUser);
        if (currentCatalogCoinsElement) {
            currentCatalogCoinsElement.textContent = profile.coins;
        }
        if (userCoinsProfileElement) {
            userCoinsProfileElement.textContent = profile.coins;
        }
    } else {
        if (currentCatalogCoinsElement) {
            currentCatalogCoinsElement.textContent = '---';
        }
        if (userCoinsProfileElement) {
            userCoinsProfileElement.textContent = '---';
        }
    }
}

function renderCatalogItems(category) {
    const currentUser = userManager.getCurrentUser();
    const itemsGrid = document.getElementById('catalog-items-grid');
    if (!itemsGrid) return;

    const items = catalogManager.getItemsByType(category);
    let userProfile = null;
    if (currentUser) {
        userProfile = profileManager.getProfile(currentUser);
    }

    if (items.length === 0) {
        itemsGrid.innerHTML = '<p class="empty-message">Nenhum item disponível nesta categoria.</p>';
        return;
    }

    itemsGrid.innerHTML = items.map(item => {
        let buttonHtml = '';
        const isOwned = userProfile && userProfile.inventory.includes(item.id);
        const isEquipped = userProfile && userProfile.equippedItems[item.type] === item.id;

        if (!currentUser) {
            buttonHtml = `<button class="buy-button" disabled>Entrar para Comprar</button>`;
        } else if (isOwned) {
            if (isEquipped) {
                buttonHtml = `<button class="equipped-button" data-item-id="${item.id}" data-item-type="${item.type}" disabled>Equipado</button>`;
            } else {
                buttonHtml = `<button class="equip-button" data-item-id="${item.id}" data-item-type="${item.type}">Equipar</button>`;
            }
        } else {
            buttonHtml = `<button class="buy-button" data-item-id="${item.id}" data-item-type="${item.type}">Comprar ${item.price}</button>`;
        }

        // Removed the view3DButton as per user request
        const view3DButton = ''; // No more "View 3D" button

        return `
            <div class="catalog-item-card">
                <div class="catalog-item-thumbnail">
                    <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">
                </div>
                <h4>${escapeHtml(item.name)}</h4>
                <div class="item-price">
                    ${!isOwned ? `<img src="roglux_coins.png" alt="Coins" class="coins-icon">` : ''}
                    ${!isOwned ? item.price : ''}
                </div>
                ${buttonHtml}
                ${view3DButton}
            </div>
        `;
    }).join('');
}

// Tab switching functionality
function updateProfileTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(button => {
        button.onclick = null; 
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Remove active classes
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));

            // Add active class to clicked button and corresponding panel
            button.classList.add('active');
            const targetPanel = document.getElementById(`${targetTab}-tab`);
            if (targetPanel) targetPanel.classList.add('active');

            // Special handling for 'friends' tab
            if (targetTab === 'friends') {
                renderFriendLists();
            } else if (targetTab === 'favorites') { 
                renderFavoriteGamesList();
            }
        });
    });
    // Ensure the initially active tab is rendered
    const activeTabButton = document.querySelector('.profile-tabs .tab-button.active');
    if (activeTabButton) {
        const targetTab = activeTabButton.dataset.tab;
        if (targetTab === 'friends') {
            renderFriendLists();
        } else if (targetTab === 'favorites') {
            renderFavoriteGamesList();
        }
    }
}

function editProfile() {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) return;
    
    const profile = profileManager.getProfile(currentUser);
    document.getElementById('bio-input-inline').value = profile.bio;
    document.getElementById('status-input-inline').value = profile.status;
    
    showOnlyAuthSection('profile-edit-section'); 
    setActiveNavLink(null); 
}

function closeProfileEdit() {
    // This will hide the edit form and then re-show the profile section
    showOnlyAuthSection(''); 
    showProfile(userManager.getCurrentUser()); 
    setActiveNavLink('profile-link'); 
}

// Replace native dialogs
function customAlert(message, title = 'Alerta') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'browser-dialog-overlay';
        overlay.innerHTML = `
            <div class="browser-dialog">
                <div class="browser-dialog-title">${escapeHtml(title)}</div>
                <div class="browser-dialog-message">${escapeHtml(message)}</div>
                <div class="browser-dialog-buttons">
                    <button class="browser-dialog-button" data-value="ok">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        overlay.querySelector('button').addEventListener('click', () => {
            overlay.remove();
            resolve();
        });
    });
};

function customConfirm(message, title = 'Confirmação') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'browser-dialog-overlay';
        overlay.innerHTML = `
            <div class="browser-dialog">
                <div class="browser-dialog-title">${escapeHtml(title)}</div>
                <div class="browser-dialog-message">${escapeHtml(message)}</div>
                <div class="browser-dialog-buttons">
                    <button class="browser-dialog-button" data-value="true">Sim</button>
                    <button class="browser-dialog-button cancel" data-value="false">Não</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        overlay.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', (e) => {
                const result = e.target.dataset.value === 'true';
                overlay.remove();
                resolve(result);
            });
        });
    });
};

function customPrompt(message, defaultValue = '', title = 'Pergunta') {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'browser-dialog-overlay';
        overlay.innerHTML = `
            <div class="browser-dialog">
                <div class="browser-dialog-title">${escapeHtml(title)}</div>
                <div class="browser-dialog-message">${escapeHtml(message)}</div>
                <input type="text" class="browser-dialog-input" value="${escapeHtml(defaultValue)}" placeholder="Digite aqui...">
                <div class="browser-dialog-buttons">
                    <button class="browser-dialog-button" data-value="ok">OK</button>
                    <button class="browser-dialog-button cancel" data-value="cancel">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        const input = overlay.querySelector('.browser-dialog-input');
        input.focus();
        input.select();
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                overlay.querySelector('[data-value="ok"]').click();
            }
        });

        overlay.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', (e) => {
                const result = e.target.dataset.value === 'ok' ? input.value : null;
                overlay.remove();
                resolve(result);
            });
        });
    });
};

// Replace native dialogs
window.alert = customAlert;
window.confirm = customConfirm;
window.prompt = customPrompt;

// Fix navigation
function updateProfileLink() {
    const profileLink = document.getElementById('profile-link');
    const currentUser = userManager.getCurrentUser();
    
    if (profileLink) { 
        if (currentUser) {
            profileLink.textContent = currentUser;
            profileLink.onclick = function(e) {
                e.preventDefault();
                showProfile(currentUser);
            };
        } else {
            profileLink.textContent = 'Perfil';
            profileLink.onclick = function(e) {
                e.preventDefault();
                openLoginModal();
            };
        }
    }
}

// NEW: Function to manage active navigation link
function setActiveNavLink(activeLinkId) {
    document.querySelectorAll('.menu a').forEach(link => {
        link.classList.remove('active');
    });
    if (activeLinkId) {
        const activeLink = document.getElementById(activeLinkId);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }
}

// Friend Request Functionality
function renderFriendLists() {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        document.getElementById('friends-list').innerHTML = '<p class="empty-message">Faça login para ver e gerenciar seus amigos.</p>';
        document.getElementById('incoming-requests').innerHTML = '';
        document.getElementById('outgoing-requests').innerHTML = '';
        document.getElementById('user-search-results').innerHTML = '<p class="empty-message">Procure por usuários para adicionar como amigo.</p>';
        return;
    }

    const profile = profileManager.getProfile(currentUser);

    // Render current friends
    const friendsListContainer = document.getElementById('friends-list');
    if (profile.friends.length === 0) {
        friendsListContainer.innerHTML = '<p class="empty-message">Nenhum amigo ainda.</p>';
    } else {
        friendsListContainer.innerHTML = profile.friends.map(friend => {
            const friendProfile = profileManager.getProfile(friend);
            const safeFriend = typeof friend === 'string' ? friend : 'Desconhecido';
            const friendAvatarHtml = friendProfile.profilePicture 
                ? `<img src="${escapeHtml(friendProfile.profilePicture)}" alt="${escapeHtml(safeFriend)} Avatar">`
                : `<div class="avatar-placeholder-small">${escapeHtml(safeFriend.charAt(0).toUpperCase())}</div>`; 
            return `
                <div class="friend-card">
                    <div class="friend-avatar">${friendAvatarHtml}</div>
                    <span class="friend-name">${escapeHtml(safeFriend)}</span>
                </div>
            `;
        }).join('');
    }

    // Render incoming requests
    const incomingRequestsContainer = document.getElementById('incoming-requests');
    if (profile.receivedRequests.length === 0) {
        incomingRequestsContainer.innerHTML = '<p class="empty-message">Nenhum pedido de amizade recebido.</p>';
    } else {
        incomingRequestsContainer.innerHTML = profile.receivedRequests.map(sender => {
            const senderProfile = profileManager.getProfile(sender);
            const safeSender = typeof sender === 'string' ? sender : 'Desconhecido';
            const senderAvatarHtml = senderProfile.profilePicture 
                ? `<img src="${escapeHtml(senderProfile.profilePicture)}" alt="${escapeHtml(safeSender)} Avatar">`
                : `<div class="avatar-placeholder-small">${escapeHtml(safeSender.charAt(0).toUpperCase())}</div>`;
            return `
                <div class="request-card">
                    <div class="friend-avatar">${senderAvatarHtml}</div>
                    <span class="username">${escapeHtml(safeSender)}</span>
                    <div class="actions">
                        <button class="primary-button" onclick="acceptFriendRequest('${escapeHtml(sender)}')">Aceitar</button>
                        <button class="danger-button" onclick="declineFriendRequest('${escapeHtml(sender)}')">Recusar</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render outgoing requests
    const outgoingRequestsContainer = document.getElementById('outgoing-requests');
    if (profile.sentRequests.length === 0) {
        outgoingRequestsContainer.innerHTML = '<p class="empty-message">Nenhum pedido de amizade enviado.</p>';
    } else {
        outgoingRequestsContainer.innerHTML = profile.sentRequests.map(receiver => {
            const receiverProfile = profileManager.getProfile(receiver);
            const safeReceiver = typeof receiver === 'string' ? receiver : 'Desconhecido';
            const receiverAvatarHtml = receiverProfile.profilePicture 
                ? `<img src="${escapeHtml(receiverProfile.profilePicture)}" alt="${escapeHtml(safeReceiver)} Avatar">`
                : `<div class="avatar-placeholder-small">${escapeHtml(safeReceiver.charAt(0).toUpperCase())}</div>`;
            return `
                <div class="request-card">
                    <div class="friend-avatar">${receiverAvatarHtml}</div>
                    <span class="username">${escapeHtml(safeReceiver)}</span>
                    <div class="actions">
                        <button class="secondary-button" disabled>Pendente</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function searchUsers() {
    const searchInput = document.getElementById('user-search-input').value.toLowerCase();
    const searchResultsContainer = document.getElementById('user-search-results');
    const currentUser = userManager.getCurrentUser();

    if (!currentUser) {
        searchResultsContainer.innerHTML = '<p class="empty-message">Faça login para procurar usuários.</p>';
        return;
    }

    if (!searchInput) {
        searchResultsContainer.innerHTML = '<p class="empty-message">Digite um nome de usuário para procurar.</p>';
        return;
    }

    const allUsernames = userManager.getAllUsernames();
    const matchingUsers = allUsernames.filter(username => 
        username.toLowerCase().includes(searchInput) && username !== currentUser
    );

    if (matchingUsers.length === 0) {
        searchResultsContainer.innerHTML = `<p class="empty-message">Nenhum usuário encontrado com "${escapeHtml(searchInput)}".</p>`;
        return;
    }

    const currentUserProfile = profileManager.getProfile(currentUser);

    searchResultsContainer.innerHTML = matchingUsers.map(user => {
        const userProfile = profileManager.getProfile(user);
        const safeUser = typeof user === 'string' ? user : 'Desconhecido';
        const userAvatarHtml = userProfile.profilePicture 
            ? `<img src="${escapeHtml(userProfile.profilePicture)}" alt="${escapeHtml(safeUser)} Avatar">`
            : `<div class="avatar-placeholder-small">${escapeHtml(safeUser.charAt(0).toUpperCase())}</div>`;

        let buttonHtml;
        if (currentUserProfile.friends.includes(safeUser)) {
            buttonHtml = '<button class="secondary-button" disabled>Amigo</button>';
        } else if (currentUserProfile.sentRequests.includes(safeUser)) {
            buttonHtml = '<button class="secondary-button" disabled>Pedido Enviado</button>';
        } else if (currentUserProfile.receivedRequests.includes(safeUser)) {
            buttonHtml = `<button class="primary-button" onclick="acceptFriendRequest('${escapeHtml(safeUser)}')">Aceitar Pedido</button>`;
        } else {
            buttonHtml = `<button class="primary-button" onclick="sendFriendRequest('${escapeHtml(safeUser)}')">Adicionar Amigo</button>`;
        }
        return `
            <div class="user-card">
                <div class="friend-avatar">${userAvatarHtml}</div>
                <span class="username">${escapeHtml(safeUser)}</span>
                <div class="actions">
                    ${buttonHtml}
                </div>
            </div>
        `;
    }).join('');
}

async function sendFriendRequest(receiverUsername) {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        await alert('Você precisa estar logado para enviar pedidos de amizade.');
        return;
    }

    const result = profileManager.sendFriendRequest(currentUser, receiverUsername);
    await alert(result.message);
    if (result.success) {
        renderFriendLists(); 
        searchUsers(); 
    }
}

async function acceptFriendRequest(senderUsername) {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        await alert('Você precisa estar logado para aceitar pedidos de amizade.');
        return;
    }

    const result = await confirm(`Tem certeza que deseja aceitar o pedido de amizade de ${escapeHtml(senderUsername)}?`);
    if (result) {
        const acceptResult = profileManager.acceptFriendRequest(currentUser, senderUsername);
        await alert(acceptResult.message);
        if (acceptResult.success) {
            renderFriendLists();
            searchUsers(); 
        }
    }
}

async function declineFriendRequest(senderUsername) {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        await alert('Você precisa estar logado para recusar pedidos de amizade.');
        return;
    }

    const result = await confirm(`Tem certeza que deseja recusar o pedido de amizade de ${escapeHtml(senderUsername)}?`);
    if (result) {
        const declineResult = profileManager.declineFriendRequest(currentUser, senderUsername);
        await alert(declineResult.message);
        if (declineResult.success) {
            renderFriendLists();
            searchUsers(); 
        }
    }
}

// NEW: Function to render favorited games in the profile tab
function renderFavoriteGamesList() {
    const currentUser = userManager.getCurrentUser();
    const favoritesListContainer = document.getElementById('favorite-games-list');

    if (!currentUser) {
        favoritesListContainer.innerHTML = '<p class="empty-message">Faça login para ver seus jogos favoritos.</p>';
        return;
    }

    const profile = profileManager.getProfile(currentUser);
    const favorites = profile.favorites;

    if (favorites.length === 0) {
        favoritesListContainer.innerHTML = '<p class="empty-message">Nenhum jogo favorito ainda.</p>';
    } else {
        favoritesListContainer.innerHTML = favorites.map(gameTitle => {
            const safeGameTitle = typeof gameTitle === 'string' ? gameTitle : ''; 
            // Map game titles to the correct thumbnail file paths
            let imageSrc = '';
            if (safeGameTitle === 'Natural Disaster Survival') {
                imageSrc = 'thumbnail1.jpg';
            } else if (safeGameTitle === 'Work at a Pizza Place') {
                imageSrc = 'thumbnail2.jpg';
            } else {
                imageSrc = 'default_game_thumbnail.png'; 
            }

            return `
                <div class="game-card game-card-favorite" data-game-title="${escapeHtml(safeGameTitle)}">
                    <div class="game-thumbnail">
                        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(safeGameTitle)} Thumbnail">
                    </div>
                    <h4>${escapeHtml(safeGameTitle)}</h4>
                    <button class="play-button" data-game-title="${escapeHtml(safeGameTitle)}">Jogar</button>
                    <button class="favorite-toggle-button remove-favorite-button" data-game-title="${escapeHtml(safeGameTitle)}">Remover</button>
                </div>
            `;
        }).join('');
    }
}

// NEW: Function to update favorite buttons on featured game cards
function updateFeaturedGameCards() {
    const currentUser = userManager.getCurrentUser();
    const gameCards = document.querySelectorAll('#featured-games .game-card');

    gameCards.forEach(card => {
        const gameTitle = card.dataset.gameTitle;
        const favoriteButton = card.querySelector('.favorite-toggle-button');
        const gameThumbnail = card.querySelector('.game-thumbnail');
        const playButton = card.querySelector('.play-button'); 

        // Ensure gameTitle is a string before operations, default to empty string if not
        const safeGameTitle = typeof gameTitle === 'string' ? gameTitle : '';

        // Dynamically set game thumbnail based on safeGameTitle
        let imageSrc = '';
        if (safeGameTitle === 'Natural Disaster Survival') {
            imageSrc = 'thumbnail1.jpg';
        } else if (safeGameTitle === 'Work at a Pizza Place') {
            imageSrc = 'thumbnail2.jpg';
        } else {
            imageSrc = 'default_game_thumbnail.png'; 
        }
        
        if (gameThumbnail) {
            gameThumbnail.innerHTML = `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(safeGameTitle)} Thumbnail">`;
        }

        // Update favorite button state
        if (favoriteButton) {
            if (currentUser) {
                const profile = profileManager.getProfile(currentUser);
                // Use safeGameTitle for includes check
                if (profile.favorites.includes(safeGameTitle)) { 
                    favoriteButton.textContent = 'Remover Favorito';
                    favoriteButton.classList.add('remove-favorite-button');
                    favoriteButton.classList.remove('add-favorite-button');
                } else {
                    favoriteButton.textContent = 'Favoritar';
                    favoriteButton.classList.add('add-favorite-button');
                    favoriteButton.classList.remove('remove-favorite-button');
                }
                favoriteButton.disabled = false;
            } else {
                favoriteButton.textContent = 'Favoritar';
                favoriteButton.classList.add('add-favorite-button');
                favoriteButton.classList.remove('remove-favorite-button');
                favoriteButton.disabled = true; 
            }
            // Ensure data-game-title is set on the button itself for delegation
            favoriteButton.setAttribute('data-game-title', safeGameTitle);
        }

        // Update play button state (it's always enabled now, login check is inside handler)
        if (playButton) {
            // Set data-game-title attribute on play button for easier access
            playButton.setAttribute('data-game-title', safeGameTitle);
        }
    });
}

// Event Listeners
document.getElementById('profile-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    const currentUser = userManager.getCurrentUser();
    
    if (currentUser) {
        showProfile(currentUser);
    } else {
        // Se não estiver logado, mostra o login
        openLoginModal();
    }
});

document.getElementById('community-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    showCommunity();
});

// NEW: Event listener for "Catalog" link
document.getElementById('catalog-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    showCatalog();
});

// NEW: Event listener for "Home" link
document.getElementById('home-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    showMainContent();
});

// NEW: Event listener for "Jogos" link
document.getElementById('games-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    // For game.html, "Jogos" link points back to index.html and shows main content
    if (window.location.pathname.endsWith('game.html')) {
        window.location.href = 'index.html'; // Navigate back to index.html
    } else {
        showMainContent(); 
    }
});

document.getElementById('switch-to-register-inline')?.addEventListener('click', openRegisterModal);
document.getElementById('switch-to-login-inline')?.addEventListener('click', openLoginModal);
document.getElementById('close-settings-inline')?.addEventListener('click', hideCurrentAuthFormAndShowMainContent);
document.getElementById('close-profile-edit-inline')?.addEventListener('click', closeProfileEdit);

document.getElementById('login-form-inline')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const username = document.getElementById('username-inline').value;
    const password = document.getElementById('password-inline').value;
    
    const result = userManager.login(username, password);
    if (result.success) {
        await alert(`Bem-vindo de volta, ${username}!`);
        hideCurrentAuthFormAndShowMainContent(); 
        updateProfileLink();
        updateFeaturedGameCards(); 
        updateUserCoinsDisplay(); 
        startCoinRewardTimer(); // Start timer if login happens on a non-index page
    } else {
        await alert(result.message);
    }
});

document.getElementById('register-form-inline')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username-inline').value;
    const password = document.getElementById('reg-password-inline').value;
    const confirmPassword = document.getElementById('reg-confirm-password-inline').value;

    if (password !== confirmPassword) {
        await alert('As senhas não coincidem!');
        return;
    }

    const result = userManager.register(username, password);
    if (result.success) {
        // After successful registration, initialize profile with default coins
        profileManager.getProfile(username); 
        await alert('Conta criada com sucesso! Faça login.');
        openLoginModal(); 
    } else {
        await alert(result.message);
    }
});

document.getElementById('settings-form-inline')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const currentUsername = userManager.getCurrentUser();
    const currentPassword = document.getElementById('current-password-inline').value;
    const newUsername = document.getElementById('new-username-inline').value.trim();
    const newPassword = document.getElementById('new-password-inline').value;
    const confirmNewPassword = document.getElementById('confirm-new-password-inline').value;

    if (newPassword && newPassword !== confirmNewPassword) {
        await alert('As novas senhas não coincidem!');
        return;
    }

    const result = userManager.updateUser(
        currentUsername,
        currentPassword,
        newUsername || null,
        newPassword || null
    );

    if (result.success) {
        await alert('Conta atualizada com sucesso!');
        hideCurrentAuthFormAndShowMainContent(); 
        updateProfileLink();
        updateFeaturedGameCards(); 
        updateUserCoinsDisplay(); 
    } else {
        await alert(result.message);
    }
});

document.getElementById('profile-edit-form-inline')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) return;
    
    const bio = document.getElementById('bio-input-inline').value;
    const status = document.getElementById('status-input-inline').value;
    
    profileManager.updateProfile(currentUser, { bio, status });
    
    // Update UI
    // The showProfile(currentUser) call in closeProfileEdit will re-render everything
    // For immediate feedback on the edit screen without full re-render, we could update here:
    // document.getElementById('profile-bio').textContent = bio;
    // document.querySelector('.profile-status').textContent = `Status: ${status}`;
    
    // Re-render the profile to reflect changes, including the picture if updated
    closeProfileEdit(); 
});

// Event listener for profile picture input
document.getElementById('profile-picture-input')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    const currentUser = userManager.getCurrentUser();
    
    if (file && currentUser) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const base64Image = event.target.result;
            profileManager.updateProfile(currentUser, { profilePicture: base64Image });
            
            // Immediately update the avatar on the edit profile screen (if visible)
            const profileAvatarImg = document.getElementById('profile-avatar-img');
            const avatarPlaceholder = document.getElementById('avatar-placeholder');
            if (profileAvatarImg && avatarPlaceholder) {
                profileAvatarImg.src = base64Image;
                profileAvatarImg.classList.remove('hidden');
                avatarPlaceholder.classList.add('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
});

// Event listener for remove profile picture button
document.getElementById('remove-profile-picture')?.addEventListener('click', async function() {
    const currentUser = userManager.getCurrentUser();
    if (currentUser) {
        profileManager.updateProfile(currentUser, { profilePicture: null });
        
        // Clear file input value
        document.getElementById('profile-picture-input').value = '';

        // Immediately update the avatar on the edit profile screen (if visible)
        const profileAvatarImg = document.getElementById('profile-avatar-img');
        const avatarPlaceholder = document.getElementById('avatar-placeholder');
        if (profileAvatarImg && avatarPlaceholder) {
            profileAvatarImg.classList.add('hidden');
            avatarPlaceholder.classList.remove('hidden');
        }
        await alert('Foto de perfil removida.');
    }
});

// Event listener for logout button
document.getElementById('logout-button')?.addEventListener('click', logoutUser);

// Event listeners for friend request functionality
document.getElementById('search-users-button')?.addEventListener('click', searchUsers);
document.getElementById('user-search-input')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchUsers();
    }
});

// NEW: Event delegation for Catalog category buttons
document.getElementById('catalog-section')?.addEventListener('click', function(e) {
    if (e.target.classList.contains('category-button')) {
        const category = e.target.dataset.category;
        document.querySelectorAll('.catalog-categories .category-button').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        renderCatalogItems(category);
    }
});

// NEW: Event delegation for Catalog item actions (Buy, Equip)
document.getElementById('catalog-items-grid')?.addEventListener('click', async function(e) {
    const currentUser = userManager.getCurrentUser();
    
    const button = e.target;
    const itemId = button.dataset.itemId;
    const itemType = button.dataset.itemType;
    const item = catalogManager.getItemById(itemId);

    if (!item) {
        await alert('Erro: Item não encontrado no catálogo.');
        return;
    }

    if (button.classList.contains('buy-button')) {
        if (!currentUser) {
            await alert('Você precisa estar logado para interagir com o catálogo.');
            return;
        }

        const confirmBuy = await confirm(`Deseja comprar "${item.name}" por ${item.price} Coins?`);
        if (confirmBuy) {
            const subtractResult = profileManager.subtractCoins(currentUser, item.price);
            if (subtractResult.success) {
                const addResult = profileManager.addItemToInventory(currentUser, item.id);
                if (addResult.success) {
                    await alert(`Você comprou "${item.name}"!`);
                    updateUserCoinsDisplay(); 
                    renderCatalogItems(document.querySelector('.category-button.active').dataset.category); 
                } else {
                    // This case should ideally not happen if inventory check is correct
                    await alert(addResult.message); 
                    // Refund coins if item could not be added to inventory
                    profileManager.addCoins(currentUser, item.price);
                    updateUserCoinsDisplay();
                }
            } else {
                await alert(subtractResult.message);
            }
        }
    } else if (button.classList.contains('equip-button')) {
        if (!currentUser) {
            await alert('Você precisa estar logado para interagir com o catálogo.');
            return;
        }
        const equipResult = profileManager.equipItem(currentUser, item.id, item.type);
        if (equipResult.success) {
            await alert(`"${item.name}" equipado com sucesso!`);
            updateEquippedAvatarItems(); 
            renderCatalogItems(document.querySelector('.category-button.active').dataset.category); 
            // Simulate a socket event for equipping an item
            console.log(`[SOCKET_EVENT] User ${currentUser} equipped item: { id: "${item.id}", name: "${item.name}", type: "${item.type}" }`);
        } else {
            await alert(equipResult.message);
        }
    }
    // Removed the 'view-3d-button' handling
});

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
    const isIndexPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');

    if (isIndexPage) {
        // Hide all secondary sections and auth forms initially
        const profileSection = document.getElementById('profile-section');
        if (profileSection) {
            profileSection.classList.add('hidden');
            profileSection.style.opacity = '0';
        }
        const communitySection = document.getElementById('community-section');
        if (communitySection) {
            communitySection.classList.add('hidden');
            communitySection.style.opacity = '0';
        }
        const catalogSection = document.getElementById('catalog-section');
        if (catalogSection) {
            catalogSection.classList.add('hidden');
            catalogSection.style.opacity = '0';
        }

        const sectionsToHideCompletely = ['login-section', 'register-section', 'settings-section', 'profile-edit-section', 'create-blog-form', 'blog-detail', 'blog-list'];
        sectionsToHideCompletely.forEach(id => {
            const section = document.getElementById(id);
            if (section) {
                section.classList.add('hidden');
                section.style.opacity = '0';
            }
        });

        showMainContent(); 
        updateProfileLink();
        updateFeaturedGameCards(); 
        updateUserCoinsDisplay(); 
        stopCoinRewardTimer(); // Ensure timer is stopped on index page
    } else {
        // Logic for non-index.html pages (e.g., game.html)
        const params = new URLSearchParams(window.location.search);
        const gameTitle = params.get('game');
        const gameTitleDisplay = document.getElementById('game-title-display');
        const gameTitlePlaceholder = document.getElementById('game-title-placeholder');

        if (gameTitleDisplay) { // Check if elements exist (they won't on index.html)
            if (gameTitle) {
                gameTitleDisplay.textContent = gameTitle;
                if (gameTitlePlaceholder) gameTitlePlaceholder.textContent = gameTitle;
                document.title = `Rogold - Jogando ${gameTitle}`;
            } else {
                gameTitleDisplay.textContent = 'Jogo Desconhecido';
                if (gameTitlePlaceholder) gameTitlePlaceholder.textContent = 'Desconhecido';
                document.title = 'Rogold - Jogo Desconhecido';
            }
        }
        
        // Set active nav link (always Home/Jogos when on a game page)
        const homeLink = document.getElementById('home-link');
        if (homeLink) homeLink.classList.remove('active');
        const gamesLink = document.getElementById('games-link');
        if (gamesLink) gamesLink.classList.add('active');

        startCoinRewardTimer(); // Start coin reward timer when on a non-index page
    }

    // --- Event Delegation for Play and Favorite buttons ---
    document.body.addEventListener('click', async function(e) {
        // Handle Play Button clicks
        if (e.target.classList.contains('play-button')) {
            e.preventDefault(); 
            const currentUser = userManager.getCurrentUser();
            if (!currentUser) {
                await alert('Espere um pouco aí! Primeiro logue para conseguir jogar.');
                return;
            }
            
            const gameTitle = e.target.dataset.gameTitle;
            if (gameTitle) {
                window.location.href = `game.html?game=${encodeURIComponent(gameTitle)}`;
            } else {
                await alert("Não foi possível iniciar o jogo: título do jogo não encontrado.");
            }
        } 
        // Handle Favorite Toggle Button clicks
        else if (e.target.classList.contains('favorite-toggle-button')) {
            e.preventDefault(); 
            const currentUser = userManager.getCurrentUser();
            if (!currentUser) {
                await alert('Você precisa estar logado para favoritar jogos.');
                return;
            }

            // Get the game title from the button's dataset
            const gameTitle = e.target.dataset.gameTitle; 
            
            // Ensure gameTitle is a string, default to empty string if not
            const safeGameTitle = typeof gameTitle === 'string' ? gameTitle.trim() : '';
            
            if (safeGameTitle === '') {
                await alert("Não foi possível identificar o jogo. O título está vazio.");
                console.error("Game title is empty after parsing dataset and trimming.", e.target);
                return;
            }

            const profile = profileManager.getProfile(currentUser);
            let result;

            // Use safeGameTitle for favorite operations
            if (profile.favorites.includes(safeGameTitle)) {
                result = profileManager.removeFavorite(currentUser, safeGameTitle);
            } else {
                result = profileManager.addFavorite(currentUser, safeGameTitle);
            }
            await alert(result.message); 
            if (result.success) {
                // Update favorite count on profile header if profile is visible
                const favoriteCountElement = document.getElementById('favorite-count');
                if (favoriteCountElement) {
                    favoriteCountElement.textContent = profileManager.getProfile(currentUser).favorites.length;
                }
                updateFeaturedGameCards(); 
                // If favorites tab is open, re-render it
                if (document.getElementById('favorites-tab').classList.contains('active')) {
                    renderFavoriteGamesList(); 
                }
            }
        }
    });
    // --- END Event Delegation ---
});

// Comunidade - Blog creation
document.getElementById('blog-create-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const title = document.getElementById('blog-title').value;
    const message = document.getElementById('blog-message').value;
    const currentUser = userManager.getCurrentUser();
    
    if (!currentUser) {
        await alert('Você precisa estar logado para criar um tópico.');
        return;
    }
    
    communityManager.createBlog(title, message, currentUser);
    document.getElementById('blog-title').value = ''; 
    document.getElementById('blog-message').value = ''; 
    hideCreateBlogForm(); 
});

// Comunidade - Message submission
document.getElementById('message-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!communityManager.currentBlog) return;
    
    const message = document.getElementById('reply-message').value;
    const currentUser = userManager.getCurrentUser();
    
    if (!currentUser) {
        await alert('Você precisa estar logado para responder.');
        return;
    }
    
    communityManager.addMessage(communityManager.currentBlog.id, message, currentUser);
    document.getElementById('reply-message').value = '';
    loadBlogMessages();
});

function loadBlogs() {
    const blogs = communityManager.getBlogs();
    const container = document.getElementById('blogs-container');
    
    if (!container) return;

    if (blogs.length === 0) {
        container.innerHTML = '<p class="empty-message">Nenhum tópico criado ainda. Seja o primeiro!</p>';
        return;
    }
    
    container.innerHTML = blogs.map(blog => `
        <div class="blog-card" onclick="openBlog(${blog.id})">
            <h4>${escapeHtml(blog.title)}</h4>
            <p class="blog-preview">${escapeHtml(blog.message.substring(0, 100))}${blog.message.length > 100 ? '...' : ''}</p>
            <div class="blog-info">
                <span>Por ${escapeHtml(blog.author)}</span>
                <span>${new Date(blog.createdAt).toLocaleDateString('pt-BR')}</span>
                <span>${blog.messages.length} resposta${blog.messages.length !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `).join('');
}

function openBlog(blogId) {
    const blog = communityManager.getBlog(blogId);
    if (!blog) return;
    
    communityManager.currentBlog = blog;
    
    // Update detail view
    document.getElementById('blog-detail-title').textContent = blog.title;
    document.getElementById('blog-author').textContent = blog.author;
    document.getElementById('blog-date').textContent = new Date(blog.createdAt).toLocaleDateString('pt-BR');
    
    // Load messages
    loadBlogMessages();
    
    // Show detail view and hide blog list
    hideSection(document.getElementById('blog-list')); 
    showOnlyAuthSection('blog-detail'); 
    setActiveNavLink('community-link'); 
}

function hideBlogDetail() {
    showSection(document.getElementById('blog-list')); 
    showOnlyAuthSection(''); 
    communityManager.currentBlog = null;
    setActiveNavLink('community-link'); 
}

function loadBlogMessages() {
    if (!communityManager.currentBlog) return;
    
    const container = document.getElementById('blog-messages-container');
    if (!container) return;

    const messages = [communityManager.currentBlog, ...communityManager.currentBlog.messages];
    
    container.innerHTML = messages.map((item, index) => {
        // Ensure item properties are strings before escaping
        const safeAuthor = typeof item.author === 'string' ? item.author : 'Desconhecido';
        const safeMessage = typeof item.message === 'string' ? item.message : '';
        const timestamp = item.timestamp || item.createdAt;
        return `
            <div class="message-item ${index === 0 ? 'original-message' : ''}">
                <div class="message-header">
                    <strong>${escapeHtml(safeAuthor)}</strong>
                    <span>${new Date(timestamp).toLocaleString('pt-BR')}</span>
                </div>
                <div class="message-content">${escapeHtml(safeMessage)}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    // Ensure text is treated as a string before setting textContent
    div.textContent = String(text); 
    return div.innerHTML;
}

function showCreateBlogForm() {
    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        alert('Você precisa estar logado para criar um tópico.');
        return;
    }
    hideSection(document.getElementById('blog-list')); 
    showOnlyAuthSection('create-blog-form'); 
    setActiveNavLink('community-link'); 
}

function hideCreateBlogForm() {
    showSection(document.getElementById('blog-list')); 
    showOnlyAuthSection(''); 
    document.getElementById('blog-create-form')?.reset();
    setActiveNavLink('community-link'); 
}

// Re-defining these for clarity in global scope if called from HTML inline
window.openLoginModal = openLoginModal;
window.openRegisterModal = openRegisterModal;
window.openSettingsModal = openSettingsModal;

// Re-defining these for clarity in global scope if called from HTML inline
window.hideProfile = hideProfile;
window.showCommunity = showCommunity;
window.hideCommunity = hideCommunity;
window.showCatalog = showCatalog; 
window.hideCatalog = hideCatalog; 
window.showCreateBlogForm = showCreateBlogForm;
window.hideCreateBlogForm = hideCreateBlogForm;
window.hideBlogDetail = hideBlogDetail;
window.editProfile = editProfile;
window.closeProfileEdit = closeProfileEdit; 
window.openBlog = openBlog;
window.sendFriendRequest = sendFriendRequest; 
window.acceptFriendRequest = acceptFriendRequest; 
window.declineFriendRequest = declineFriendRequest;

// Coin Reward Timer Logic
let coinRewardIntervalId = null;
const COIN_REWARD_AMOUNT = 500;
const COIN_REWARD_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

function startCoinRewardTimer() {
    // Clear any existing timer to prevent multiple timers running
    if (coinRewardIntervalId) {
        clearInterval(coinRewardIntervalId);
        coinRewardIntervalId = null;
    }

    const currentUser = userManager.getCurrentUser();
    if (!currentUser) {
        console.log('User not logged in, coin reward timer not started.');
        return;
    }

    // Timer only runs if not on the index page
    const isIndexPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');
    if (isIndexPage) {
        console.log('On index page, coin reward timer not started.');
        return;
    }

    console.log(`Starting coin reward timer for ${currentUser}. Rewarding ${COIN_REWARD_AMOUNT} coins every ${COIN_REWARD_INTERVAL_MS / 60000} minutes.`);

    coinRewardIntervalId = setInterval(async () => {
        const userNow = userManager.getCurrentUser();
        if (userNow) {
            profileManager.addCoins(userNow, COIN_REWARD_AMOUNT);
            await alert(`Parabéns, ${userNow}! Você ganhou ${COIN_REWARD_AMOUNT} Goldbucks por passar tempo no Rogold!`);
            // Update UI if the user navigates back to a relevant page after the alert
            updateUserCoinsDisplay();
        } else {
            // User logged out while timer was active, stop the timer
            stopCoinRewardTimer();
        }
    }, COIN_REWARD_INTERVAL_MS);
}

function stopCoinRewardTimer() {
    if (coinRewardIntervalId) {
        console.log('Stopping coin reward timer.');
        clearInterval(coinRewardIntervalId);
        coinRewardIntervalId = null;
    }
}