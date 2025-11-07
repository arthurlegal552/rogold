import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';

let scene, camera, renderer, controls;
let player, velocity, direction;
let playerVelocity = new THREE.Vector3();
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

// Roblox 2011-style physics constants
const ROBLOX_GRAVITY = -196.2;      // Valor usado no Roblox por volta de 2010–2014
const ROBLOX_FRICTION = 0.03;       // Balanced friction for good traction without being too sticky
const ROBLOX_RESTITUTION = 0.05;    // Colisões duras, pouco quique
const ROBLOX_LINEAR_DAMPING = 0.6;  // Increased damping for better traction and reduced slipperiness
const ROBLOX_ANGULAR_DAMPING = 0.4; // Evita rotação eterna das partes

// Increased jump impulse (higher = stronger jump)
const JUMP_IMPULSE = 300; // Changed from 120 to 200 for higher jumps

let canShoot = true;
let explosionSound;
const explodingParticles = [];
let nickname = localStorage.getItem('rogold_currentUser') || 'Guest' + Math.floor(Math.random() * 10000);
let isFlying = false;
let speedMultiplier = 1;   // começa normal
let isSpeeding = false;    // controle do modo admin
let playerHealth = 100;
const maxHealth = 100;
let playerNameTags = {};

// Face inventory system
let ownedFaces = JSON.parse(localStorage.getItem('rogold_owned_faces') || '["OriginalGlitchedFace.webp"]');

let partMaterial;
let luaObjects = {}; // Global luaObjects for the game environment
let spinningParts = []; // Global list of spinning parts
let isMenuOpen = false;
let isDancing = false;

// Roblox Environment for Lua scripts
let RobloxEnvironment = {
    Workspace: {
        Children: []
    },
    connections: [],
    wait: (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000))
};

// Roblox Instance class for game environment
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
        this.spinAxis = new THREE.Vector3(0, 1, 0); // Default spin axis (Y)
    }

    // Roblox-like methods
    Destroy() {
        // Remove from parent
        if (this.Parent) {
            this.Parent.Children = this.Parent.Children.filter(child => child !== this);
        }

        // Remove from scene
        if (this.threeObject && this.threeObject.parent) {
            this.threeObject.parent.remove(this.threeObject);
        }

        // Remove physics body
        if (this.cannonBody && physicsWorld) {
            physicsWorld.removeBody(this.cannonBody);
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
        
        // Set up physics for the clone
        if (this.cannonBody && physicsWorld) {
            const shape = new CANNON.Box(new CANNON.Vec3(
                clone.Size.x / 2,
                clone.Size.y / 2,
                clone.Size.z / 2
            ));
            
            clone.cannonBody = new CANNON.Body({
                mass: clone.Anchored ? 0 : 1,
                material: partMaterial,
                shape: shape,
                position: new CANNON.Vec3(
                    clone.Position.x,
                    clone.Position.y,
                    clone.Position.z
                ),
                linearDamping: ROBLOX_LINEAR_DAMPING,
                fixedRotation: false
            });
            
            // Apply Roblox-style collision response
            clone.cannonBody.addEventListener('collide', (e) => {
                if (e.contact.getImpactVelocityAlongNormal() > 5) {
                    // Classic Roblox collision response
                    const bounceForce = e.contact.getImpactVelocityAlongNormal() * 0.5;
                    const normal = e.contact.ni;
                    clone.cannonBody.applyImpulse(
                        new CANNON.Vec3(
                            normal.x * bounceForce,
                            normal.y * bounceForce,
                            normal.z * bounceForce
                        ),
                        new CANNON.Vec3(0, 0, 0)
                    );
                }
            });
        }
        
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

    // Spin method for parts
    Spin(axis) {
        this.isSpinning = true;
        if (axis) {
            this.spinAxis = axis instanceof THREE.Vector3 ? axis : new THREE.Vector3(axis.X, axis.Y, axis.Z);
        }
        spinningParts.push(this); // Add to global spinning list
    }

    // Roblox-like Spin method (alias for compatibility)
    spin() {
        this.Spin();
    }
}

// ===== LUA SCRIPT INTERPRETER =====

function interpretLuaScript(script) {
    const actions = [];
    const lines = script.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Handle wait statements
        if (line.startsWith('wait')) {
            const match = line.match(/wait\((.*?)\)/);
            const seconds = match ? parseFloat(match[1]) || 0.03 : 0.03;
            actions.push({
                type: 'wait',
                seconds: seconds
            });
            continue;
        }

        // Handle for loops
        if (line.startsWith('for ')) {
            const match = line.match(/for\s+(\w+)\s*=\s*(\d+),\s*(\d+)\s+do/);
            if (match) {
                const loopVar = match[1];
                const start = parseInt(match[2]);
                const end = parseInt(match[3]);
                const loopBody = extractLoopBody(lines, i);
                actions.push({
                    type: 'for_loop',
                    loopVar: loopVar,
                    start: start,
                    end: end,
                    body: loopBody
                });
                // Skip the loop body lines
                i += countLoopLines(lines, i);
                continue;
            }
        }

        // Handle while loops
        if (line.startsWith('while ')) {
            const match = line.match(/while\s+(.+)\s+do/);
            if (match) {
                const condition = match[1];
                const loopBody = extractLoopBody(lines, i);
                actions.push({
                    type: 'while_loop',
                    condition: condition,
                    body: loopBody
                });
                // Skip the loop body lines
                i += countLoopLines(lines, i);
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
            // Match both single and double quotes
            const match = line.match(/print\(['"]([^'"]+)['"]\)/);
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
            continue; // Skip the function declaration line
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

function extractLoopBody(lines, startIndex) {
    const body = [];
    let braceCount = 0;
    let inLoop = false;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('do')) {
            inLoop = true;
            braceCount++;
        }

        if (inLoop) {
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

        if (line.includes('function') || line.includes('do')) {
            braceCount++;
            count++; // Include the declaration line in count
            continue;
        }

        count++;

        if (line.includes('end')) {
            braceCount--;
            if (braceCount === 0) {
                break;
            }
        }
    }

    return count;
}

function countLoopLines(lines, startIndex) {
    let count = 0;
    let braceCount = 0;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        count++;

        if (line.includes('do')) {
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

// Replace the runScriptWithErrorHandling function with this async version:
async function runScriptWithErrorHandling(scriptName = null, testScript = null) {
    let script;

    if (testScript) {
        script = testScript;
    } else if (scriptName) {
        const scriptObj = luaObjects[scriptName];
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

    // clearOutput(); // Commented out as it's not defined
    // clearErrorHighlighting(scriptName); // Commented out as it's not defined

    try {
        const actions = interpretLuaScript(script);

        // Check for syntax errors before execution
        // const syntaxErrors = checkLuaSyntax(script); // Commented out as it's not defined
        // if (syntaxErrors.length > 0) {
        //     syntaxErrors.forEach(error => {
        //         console.error(`Syntax Error (Line ${error.line}): ${error.message}`);
        //     });
        //     // addErrorHighlighting(scriptName, syntaxErrors); // Commented out as it's not defined
        //     return;
        // }

        await executeLuaActions(actions);

        // Start game loop for continuous execution
        // startGameLoop(); // Commented out as it's not defined
    } catch (error) {
        console.error('RoGold Studio: Script execution error:', error);

        // Try to extract line number from error
        const lineMatch = error.message.match(/line (\d+)/i);
        if (lineMatch) {
            const lineNum = parseInt(lineMatch[1]);
            console.error(`Error at line ${lineNum}: ${error.message}`);
        }
    }
}

async function executeLuaActions(actions, initialVariables = {}) {
    const variables = { ...initialVariables };
    const functions = {};

    for (const action of actions) {
        try {
            switch (action.type) {
                case 'wait':
                    // Convert to milliseconds and wait
                    const waitTime = action.seconds * 1000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    break;

                case 'for_loop':
                    for (let i = action.start; i <= action.end; i++) {
                        // Set loop variable
                        variables[action.loopVar] = i;
                        // Execute loop body
                        const loopActions = interpretLuaScript(action.body.join('\n'));
                        executeLuaActions(loopActions);
                    }
                    break;

                case 'while_loop':
                    let iterations = 0;
                    const maxIterations = 1000; // Prevent infinite loops
                    while (iterations < maxIterations) {
                        // Evaluate condition (simple variable check for now)
                        const conditionValue = variables[action.condition] || parseValue(action.condition);
                        if (!conditionValue) break;

                        // Execute loop body
                        const loopActions = interpretLuaScript(action.body.join('\n'));
                        executeLuaActions(loopActions);
                        iterations++;
                    }
                    if (iterations >= maxIterations) {
                        console.warn('While loop exceeded maximum iterations, breaking to prevent infinite loop');
                    }
                    break;

                case 'create_instance':
                    const instance = new RobloxInstance(action.className, action.varName);
                    instance.isScriptCreated = true;
                    variables[action.varName] = instance;

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

                        // Add physics body
                        if (physicsWorld) {
                            const shape = new CANNON.Box(new CANNON.Vec3(2, 2, 2));
                            const body = new CANNON.Body({
                                mass: instance.Anchored ? 0 : 1,
                                type: instance.Anchored ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
                                position: new CANNON.Vec3(0, 5, 0),
                                shape: shape,
                                material: partMaterial
                            });
                            body.userData = { mesh: part, instance: instance };

                            // Add collision event listener
                            body.addEventListener('collide', (e) => {
                                const otherBody = e.body;
                                const contact = e.contact;

                                // Trigger Touched event if the instance has a Touched connection
                                if (instance.touched && typeof instance.touched === 'function') {
                                    instance.touched(otherBody.userData?.instance || otherBody);
                                }

                                // Apply Roblox-style collision response
                                if (contact.getImpactVelocityAlongNormal() > 5) {
                                    const bounceForce = contact.getImpactVelocityAlongNormal() * 0.5;
                                    const normal = contact.ni;
                                    body.applyImpulse(
                                        new CANNON.Vec3(
                                            normal.x * bounceForce,
                                            normal.y * bounceForce,
                                            normal.z * bounceForce
                                        ),
                                        new CANNON.Vec3(0, 0, 0)
                                    );
                                }
                            });

                            physicsWorld.addBody(body);
                            instance.cannonBody = body;
                        }

                        // Set parent to workspace
                        instance.Parent = RobloxEnvironment.Workspace;
                        RobloxEnvironment.Workspace.Children.push(instance);
                        // addToWorkspaceTree(action.varName, 'part'); // Commented out as it's not defined
                    } else if (action.className === 'Frame' ||
                                action.className === 'TextLabel' ||
                                action.className === 'TextButton' ||
                                action.className === 'ScreenGui') {
                        try {
                            const Constructor = window[action.className];
                            if (!Constructor) {
                                throw new Error(`GUI class ${action.className} not found on window`);
                            }
                            const gui = new Constructor(action.varName);
                            variables[action.varName] = gui;

                            // Ensure GUI is visible by default
                            if (gui.Visible !== false) {
                                gui.Visible = true;
                            }
                            // Force update style after creation
                            gui.updateStyle();
                            if (action.parent === 'game.PlayerGui' || action.parent === 'game.Players.LocalPlayer.PlayerGui') {
                                RobloxEnvironment.PlayerGui.AddGui(gui);
                            }
                        } catch (error) {
                            console.error('Error creating GUI instance:', error.message);
                            throw error;
                        }
                    }
                    break;

                case 'set_property':
                    const targetObj = variables[action.varName] || luaObjects[action.varName];
                    if (targetObj) {
                        const value = parseValue(action.value);

                        switch (action.property) {
                            case 'Position':
                                if (targetObj instanceof GuiObject) {
                                    if (value instanceof RobloxUDim2) {
                                        const threeVec = value.toVector2();
                                        targetObj.Position = threeVec;
                                        targetObj.updateStyle();
                                    } else if (value instanceof THREE.Vector2 || value instanceof RobloxVector2) {
                                        const threeVec = value instanceof RobloxVector2 ? value.toThreeVector2() : value;
                                        targetObj.Position = threeVec;
                                        targetObj.updateStyle();
                                    }
                                } else if (value instanceof THREE.Vector3 || value instanceof RobloxVector3) {
                                    const threeVec = value instanceof RobloxVector3 ? value.toThreeVector3() : value;
                                    targetObj.Position = threeVec;
                                    if (targetObj.threeObject) {
                                        targetObj.threeObject.position.copy(threeVec);
                                    }
                                    // Update physics body if it exists
                                    if (targetObj.cannonBody) {
                                        targetObj.cannonBody.position.copy(threeVec);
                                    }
                                }
                                break;
                            case 'Size':
                                if (targetObj instanceof GuiObject) {
                                    if (value instanceof RobloxUDim2) {
                                        const threeVec = value.toVector2();
                                        targetObj.Size = threeVec;
                                        targetObj.updateStyle();
                                    } else if (value instanceof THREE.Vector2 || value instanceof RobloxVector2) {
                                        const threeVec = value instanceof RobloxVector2 ? value.toThreeVector2() : value;
                                        targetObj.Size = threeVec;
                                        targetObj.updateStyle();
                                    }
                                } else if (value instanceof THREE.Vector3 || value instanceof RobloxVector3) {
                                    const threeVec = value instanceof RobloxVector3 ? value.toThreeVector3() : value;
                                    targetObj.Size = threeVec;
                                    if (targetObj.threeObject) {
                                        targetObj.threeObject.scale.copy(threeVec).multiplyScalar(0.5);
                                    }
                                }
                                break;
                            case 'Rotation':
                                if (value instanceof THREE.Euler || value instanceof RobloxVector3) {
                                    const threeEuler = value instanceof RobloxVector3 ? new THREE.Euler(value.X, value.Y, value.Z) : value;
                                    targetObj.Rotation = threeEuler;
                                    if (targetObj.threeObject) {
                                        targetObj.threeObject.rotation.copy(threeEuler);
                                    }
                                    // Update physics body if it exists
                                    if (targetObj.cannonBody) {
                                        targetObj.cannonBody.quaternion.setFromEuler(threeEuler.x, threeEuler.y, threeEuler.z);
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
                            case 'BackgroundColor3':
                                if (targetObj instanceof GuiObject && value instanceof THREE.Color) {
                                    targetObj.BackgroundColor = value;
                                    targetObj.updateStyle();
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
                                if (targetObj.cannonBody) {
                                    targetObj.cannonBody.mass = targetObj.Anchored ? 0 : 1;
                                    targetObj.cannonBody.type = targetObj.Anchored ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
                                    targetObj.cannonBody.updateMassProperties();
                                }
                                break;
                            case 'CanCollide':
                                targetObj.CanCollide = value === 'true' || value === true;
                                updateCollisionVisualFeedback(targetObj);
                                break;
                            case 'Parent':
                                if (value === 'workspace') {
                                    targetObj.Parent = RobloxEnvironment.Workspace;
                                    RobloxEnvironment.Workspace.Children.push(targetObj);
                                    // addToWorkspaceTree(targetObj.Name, targetObj.ClassName.toLowerCase()); // Commented out as it's not defined
                                } else if (value === 'game.PlayerGui' || value === 'game.Players.LocalPlayer.PlayerGui') {
                                    if (targetObj instanceof GuiObject) {
                                        RobloxEnvironment.PlayerGui.AddGui(targetObj);
                                    }
                                } else {
                                    // Handle parenting to another GUI object
                                    const parentObj = variables[value] || luaObjects[value];
                                    if (parentObj && parentObj instanceof GuiObject && targetObj instanceof GuiObject) {
                                        try {
                                            parentObj.element.appendChild(targetObj.element);
                                            targetObj.Parent = parentObj;
                                            parentObj.Children.push(targetObj);
                                        } catch (error) {
                                            console.error(`Error parenting ${targetObj.Name} to ${parentObj.Name}:`, error.message);
                                        }
                                    }
                                }
                                break;
                            case 'Name':
                                targetObj.Name = value;
                                break;
                            case 'Text':
                                if (targetObj instanceof TextLabel || targetObj instanceof TextButton) {
                                    targetObj.Text = value;
                                    targetObj.updateTextStyle();
                                }
                                break;
                            case 'TextColor3':
                                if (targetObj instanceof TextLabel || targetObj instanceof TextButton) {
                                    if (value instanceof THREE.Color) {
                                        targetObj.TextColor = value;
                                        targetObj.updateTextStyle();
                                    }
                                }
                                break;
                            case 'TextSize':
                                if (targetObj instanceof TextLabel || targetObj instanceof TextButton) {
                                    targetObj.TextSize = parseInt(value) || 14;
                                    targetObj.updateTextStyle();
                                }
                                break;
                        }
                        console.log(`Set ${action.varName}.${action.property} = ${action.value}`);
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
                                // Execute the function body with access to the current variables scope
                                executeFunctionBody(action.functionLines, action.params, args, variables);
                            }
                        };

                        // Store connection for cleanup
                        if (!eventObj.connections) eventObj.connections = [];
                        eventObj.connections.push(connection);

                        // Set up actual event listeners based on event type
                        if (action.eventName === 'Touched') {
                            // For parts, we'll simulate touch events
                            eventObj.touched = false;
                        } else if (action.eventName === 'MouseButton1Click') {
                            // For GUI objects, use the Connect method if available (TextButton), otherwise direct listener
                            if (eventObj instanceof GuiObject && eventObj.element) {
                                if (eventObj.MouseButton1Click && eventObj.MouseButton1Click.Connect) {
                                    // Use the object's Connect method (for TextButton)
                                    eventObj.MouseButton1Click.Connect(() => {
                                        // Execute the function body with access to the current variables scope
                                        executeFunctionBody(action.functionLines, action.params, [], variables);
                                    });
                                } else {
                                    // Fallback to direct event listener for other GUI objects
                                    eventObj.element.addEventListener('click', () => {
                                        // Execute the function body with access to the current variables scope
                                        executeFunctionBody(action.functionLines, action.params, [], variables);
                                    });
                                }
                            }
                        }

                        RobloxEnvironment.connections = RobloxEnvironment.connections || [];
                        RobloxEnvironment.connections.push(connection);
                    }
                    break;

                case 'define_function':
                    functions[action.funcName] = action.functionLines;
                    break;

                case 'call_method':
                    const methodObj = variables[action.varName] || luaObjects[action.varName];
                    if (methodObj) {
                        switch (action.method) {
                            case 'Spin':
                            case 'spin':
                                if (methodObj.Spin) {
                                    let axis = null;
                                    if (action.args && action.args.trim()) {
                                        const args = action.args.split(',').map(arg => arg.trim());
                                        if (args.length > 0 && args[0]) {
                                            axis = parseValue(args[0]);
                                        }
                                    }
                                    methodObj.Spin(axis);
                                }
                                break;
                            case 'Play':
                                if (methodObj.ClassName === 'Sound' && methodObj.audio) {
                                    methodObj.audio.play();
                                }
                                break;
                            case 'Destroy':
                                if (methodObj.Destroy) {
                                    methodObj.Destroy();
                                    delete variables[action.varName];
                                    delete luaObjects[action.varName];
                                }
                                break;
                            case 'wait':
                                // Handle wait() function
                                const waitTime = parseFloat(action.args) || 0.03; // Default to 0.03 seconds
                                await RobloxEnvironment.wait(waitTime);
                                addOutput(`Waited for ${waitTime} seconds`, 'success');
                                break;
                        }
                    } else if (functions[action.varName]) {
                        // Call user-defined function
                        executeFunctionBody(functions[action.varName], '', []);
                    } else {
                        // Check if it's a script object in the workspace
                        const scriptObj = luaObjects[action.varName];
                        if (scriptObj && scriptObj.ClassName === 'Script' && scriptObj.Source) {
                            // Execute the script's source code
                            try {
                                const scriptActions = interpretLuaScript(scriptObj.Source);
                                executeLuaActions(scriptActions);
                                console.log(`Executed script: ${action.varName}`);
                            } catch (error) {
                                console.error(`Error executing script ${action.varName}: ${error.message}`);
                            }
                        } else {
                            console.error(`Error: Object '${action.varName}' not found for method call`);
                        }
                    }
                    break;

                case 'set_variable':
                    variables[action.varName] = parseValue(action.value);
                    break;

                case 'animate_part':
                    const animObj = variables[action.varName] || luaObjects[action.varName];
                    if (animObj && animObj.threeObject) {
                        // Simple animation: move in a circle
                        const time = performance.now() * 0.001;
                        const radius = 5;
                        const x = Math.cos(time) * radius;
                        const z = Math.sin(time) * radius;
                        const newPos = new THREE.Vector3(x, animObj.Position.y, z);
                        animObj.Position = newPos;
                        animObj.threeObject.position.copy(newPos);
                        if (animObj.cannonBody) {
                            animObj.cannonBody.position.copy(newPos);
                        }
                    }
                    break;

                case 'spin_part':
                    const spinObj = variables[action.varName] || luaObjects[action.varName];
                    if (spinObj && spinObj.threeObject) {
                        // Spin the part around Y axis
                        const time = performance.now() * 0.001;
                        const rotationSpeed = 2; // radians per second
                        spinObj.threeObject.rotation.y = time * rotationSpeed;
                        spinObj.Rotation.y = time * rotationSpeed;
                        if (spinObj.cannonBody) {
                            spinObj.cannonBody.quaternion.setFromEuler(0, time * rotationSpeed, 0);
                        }
                    }
                    break;

                case 'print':
                    console.log('LUA PRINT:', action.message);
                    // Also show in chat or UI if possible
                    if (typeof appendChatBoxMessage === 'function') {
                        appendChatBoxMessage('SYSTEM', '[SCRIPT] ' + action.message);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error executing action:', error);
            throw error;
        }
    }
}

function executeFunctionBody(functionLines, paramString, args, variables = {}) {
    // Simple function execution - for now just execute the lines
    const functionActions = interpretLuaScript(functionLines.join('\n'));
    executeLuaActions(functionActions, variables);
}

function parseValue(valueStr) {
    // Parse Vector2.new(x, y)
    const vector2Match = valueStr.match(/Vector2\.new\(([^,]+),\s*([^)]+)\)/);
    if (vector2Match) {
        return new RobloxVector2(
            parseFloat(vector2Match[1]),
            parseFloat(vector2Match[2])
        );
    }

    // Parse Vector3.new(x, y, z)
    const vectorMatch = valueStr.match(/Vector3\.new\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (vectorMatch) {
        return new RobloxVector3(
            parseFloat(vectorMatch[1]),
            parseFloat(vectorMatch[2]),
            parseFloat(vectorMatch[3])
        );
    }

    // Parse UDim2.new(scaleX, offsetX, scaleY, offsetY)
    const udim2Match = valueStr.match(/UDim2\.new\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (udim2Match) {
        return new RobloxUDim2(
            parseFloat(udim2Match[1]),
            parseFloat(udim2Match[2]),
            parseFloat(udim2Match[3]),
            parseFloat(udim2Match[4])
        );
    }

    // Parse CFrame.new(x, y, z) - simplified, just return position vector for now
    const cframeMatch = valueStr.match(/CFrame\.new\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (cframeMatch) {
        return new RobloxVector3(
            parseFloat(cframeMatch[1]),
            parseFloat(cframeMatch[2]),
            parseFloat(cframeMatch[3])
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

// Roblox Vector3 class for Lua scripts
class RobloxVector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.X = x;
        this.Y = y;
        this.Z = z;
    }

    static new(x, y, z) {
        return new RobloxVector3(x, y, z);
    }

    // Convert to THREE.Vector3 for internal use
    toThreeVector3() {
        return new THREE.Vector3(this.X, this.Y, this.Z);
    }

    // Basic operations
    add(other) {
        return new RobloxVector3(this.X + other.X, this.Y + other.Y, this.Z + other.Z);
    }

    multiply(scalar) {
        return new RobloxVector3(this.X * scalar, this.Y * scalar, this.Z * scalar);
    }

    // For debugging
    toString() {
        return `Vector3(${this.X}, ${this.Y}, ${this.Z})`;
    }
}

// Roblox Vector2 class for Lua scripts
class RobloxVector2 {
    constructor(x = 0, y = 0) {
        this.X = x;
        this.Y = y;
    }

    static new(x, y) {
        return new RobloxVector2(x, y);
    }

    // Convert to THREE.Vector2 for internal use
    toThreeVector2() {
        return new THREE.Vector2(this.X, this.Y);
    }

    // Basic operations
    add(other) {
        return new RobloxVector2(this.X + other.X, this.Y + other.Y);
    }

    multiply(scalar) {
        return new RobloxVector2(this.X * scalar, this.Y * scalar);
    }

    // For debugging
    toString() {
        return `Vector2(${this.X}, ${this.Y})`;
    }
}

// Roblox UDim2 class for Lua scripts
class RobloxUDim2 {
    constructor(scaleX = 0, offsetX = 0, scaleY = 0, offsetY = 0) {
        this.ScaleX = scaleX;
        this.OffsetX = offsetX;
        this.ScaleY = scaleY;
        this.OffsetY = offsetY;
    }

    static new(scaleX, offsetX, scaleY, offsetY) {
        return new RobloxUDim2(scaleX, offsetX, scaleY, offsetY);
    }

    // Convert to THREE.Vector2 in pixels (assuming full screen for PlayerGui)
    toVector2() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        return new THREE.Vector2(
            this.ScaleX * width + this.OffsetX,
            this.ScaleY * height + this.OffsetY
        );
    }

    // For debugging
    toString() {
        return `UDim2(${this.ScaleX}, ${this.OffsetX}, ${this.ScaleY}, ${this.OffsetY})`;
    }
}

// Make Vector3, Vector2, and UDim2 available globally for Lua scripts
window.Vector3 = RobloxVector3;
window.Vector2 = RobloxVector2;
window.UDim2 = RobloxUDim2;

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

        // Add to document if parent is PlayerGui
        if (this.Parent === RobloxEnvironment.PlayerGui) {
            RobloxEnvironment.PlayerGui.AddGui(this);
        }
    }

    updateStyle() {
        try {
            this.element.style.position = 'absolute';
            this.element.style.left = this.Position.x + 'px';
            this.element.style.top = this.Position.y + 'px';
            this.element.style.width = this.Size.x + 'px';
            this.element.style.height = this.Size.y + 'px';
            this.element.style.backgroundColor = `#${this.BackgroundColor.getHexString()}`;
            this.element.style.opacity = 1 - this.BackgroundTransparency;
            this.element.style.border = `${this.BorderSizePixel}px solid #${this.BorderColor.getHexString()}`;
            this.element.style.display = this.Visible ? 'block' : 'none';
            this.element.style.zIndex = this.ZIndex || 1;
            this.element.style.boxSizing = 'border-box';
        } catch (error) {
            console.error(`Error updating style for ${this.ClassName} ${this.Name}:`, error.message);
        }
    }

    Destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        super.Destroy();
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
        try {
            this.element.textContent = this.Text;
            this.element.style.color = `#${this.TextColor.getHexString()}`;
            this.element.style.fontSize = this.TextSize + 'px';
            this.element.style.fontFamily = this.Font;
            this.element.style.whiteSpace = this.TextWrapped ? 'normal' : 'nowrap';
            this.element.style.textAlign = this.TextXAlignment.toLowerCase();
            this.element.style.verticalAlign = this.TextYAlignment.toLowerCase();
        } catch (error) {
            console.error(`Error updating text style for ${this.ClassName} ${this.Name}:`, error.message);
        }
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
            console.error(`Error updating text style for ${this.ClassName} ${this.Name}:`, error.message);
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
            console.error(`Error setting up hover effects for ${this.ClassName} ${this.Name}:`, error.message);
        }
    }
}

class ScreenGui extends GuiObject {
    constructor(name) {
        super('ScreenGui', name);
        this.element.style.position = 'absolute';
        this.element.style.top = '0';
        this.element.style.left = '0';
        this.element.style.width = '100%';
        this.element.style.height = '100%';
        this.element.style.pointerEvents = 'none';
        this.element.style.zIndex = '1000';
        this.BackgroundTransparency = 1; // ScreenGui should be invisible
        this.updateStyle();

        // In test mode, ScreenGui acts as a container that routes to game GUI container
        if (isTestMode) {
            RobloxEnvironment.PlayerGui.AddGui(this);
        }
    }

    updateStyle() {
        // ScreenGui is always full screen and invisible
        this.element.style.position = 'absolute';
        this.element.style.top = '0';
        this.element.style.left = '0';
        this.element.style.width = '100%';
        this.element.style.height = '100%';
        this.element.style.pointerEvents = 'none';
        this.element.style.zIndex = '1000';
        this.element.style.backgroundColor = 'transparent';
    }
}

// Unified GUI container creation - ensure only one exists
if (!document.getElementById('gui-container')) {
    const container = document.createElement('div');
    container.id = 'gui-container';
    container.style.cssText = `
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
    container.style.display = 'none';
    document.body.appendChild(container);
}

// Create ScreenGui container for test mode
if (!document.getElementById('screen-gui-container')) {
    const screenContainer = document.createElement('div');
    screenContainer.id = 'screen-gui-container';
    screenContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
        background-color: transparent;
        box-sizing: border-box;
    `;
    screenContainer.style.display = 'none';
    document.body.appendChild(screenContainer);
}

// Add GUI container to RobloxEnvironment
RobloxEnvironment.PlayerGui = {
    Children: [],
    AddGui: function(gui) {
        try {
            if (gui instanceof GuiObject) {
                let container;
                if (gui.ClassName === 'ScreenGui') {
                    // ScreenGui uses its own container in test mode
                    container = document.getElementById('screen-gui-container');
                } else {
                    container = document.getElementById('gui-container');
                }

                if (container && gui.element) {
                    if (!container.contains(gui.element)) {
                        container.appendChild(gui.element);
                    }
                    if (!this.Children.includes(gui)) {
                        this.Children.push(gui);
                        if (this.Children.length === 1) {
                            container.style.display = 'block';
                        }
                    }

                    // Force update style after adding to DOM
                    gui.updateStyle();
                }
            }
        } catch (error) {
            console.error('Error adding GUI to PlayerGui:', error.message);
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
                if (this.Children.length === 0) {
                    const container = document.getElementById('gui-container');
                    if (container) {
                        container.style.display = 'none';
                    }
                    const screenContainer = document.getElementById('screen-gui-container');
                    if (screenContainer) {
                        screenContainer.style.display = 'none';
                    }
                }
            }
        } catch (error) {
            console.error('Error removing GUI from PlayerGui:', error.message);
        }
    }
};

const guiStyle = document.createElement('style');
guiStyle.textContent = `
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
document.head.appendChild(guiStyle);

// Expose GUI classes globally
window.GuiObject = GuiObject;

// Remove duplicate container creation - handled above

// Ensure global PlayerGui references the unified RobloxEnvironment.PlayerGui
window.PlayerGui = RobloxEnvironment.PlayerGui;

// Make Instance.new available globally for Lua scripts
window.Instance = {
    new: function(className) {
        switch (className) {
            case 'Frame':
                return new Frame('Frame');
            case 'TextLabel':
                return new TextLabel('TextLabel');
            case 'TextButton':
                return new TextButton('TextButton');
            case 'ScreenGui':
                return new ScreenGui('ScreenGui');
            case 'Part':
                return new RobloxInstance('Part', 'Part');
            default:
                return new RobloxInstance(className, className);
        }
    }
};

// Ensure ScreenGui is properly recognized as GuiObject for parenting
// ScreenGui inherits from GuiObject, so it should work, but let's make sure

// Make game object available globally for Lua scripts
window.game = {
    PlayerGui: RobloxEnvironment.PlayerGui,
    Workspace: RobloxEnvironment.Workspace
};

// Make GUI classes available globally for Lua scripts (immediately)
window.Frame = Frame;
window.TextLabel = TextLabel;
window.TextButton = TextButton;
window.ScreenGui = ScreenGui;

// Ensure GUI container is above the game canvas
if (RobloxEnvironment.PlayerGui.element) {
    RobloxEnvironment.PlayerGui.element.style.zIndex = '1000';
}

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
let baseCameraOffset;

let audioListener, walkSound, jumpSound, clickSound, spawnSound, deathSound, ouchSound, launchSound, currentDeathSound, danceMusic;
let isMobile = false; // This will be updated dynamically
let controlOverride = localStorage.getItem('controlOverride'); // 'pc', 'mobile', or null

let renderTarget, postScene, postCamera;
let pixelatedEffectEnabled = localStorage.getItem('rogold_pixelated') !== 'false'; // Default to enabled, but check localStorage
let audioMuted = localStorage.getItem('rogold_muted') === 'true'; // Default to not muted
let isTestMode = false; // Will be set in loadStudioTestObjects

function applyMuteSetting() {
    const defaultVolumes = {
        walkSound: 0.5,
        jumpSound: 0.5,
        clickSound: 0.5,
        spawnSound: 0.5,
        deathSound: 0.5,
        ouchSound: 0.5,
        launchSound: 0.5,
        explosionSound: 0.8,
        danceMusic: 0.7
    };

    [walkSound, jumpSound, clickSound, spawnSound, deathSound, ouchSound, launchSound, explosionSound, danceMusic].forEach((sound, index) => {
        if (sound) {
            const soundName = Object.keys(defaultVolumes)[index];
            sound.setVolume(audioMuted ? 0 : defaultVolumes[soundName]);
        }
    });
}

let socket = null;
let otherPlayers = {};
let playerId;
// De-dup and sync caches
let pendingPlayers = new Set();
let headTemplate = null;
const pendingHats = {};
const pendingFaces = {};

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
    if (msg.toLowerCase() === '/e daniel' && nickname === 'daniel244') {
        socket.emit('danielCommand');
    }
    if (msg.startsWith('/e explode ') && nickname === 'notrealregi') {
        const target = msg.split(' ')[2];
        socket.emit('adminExplode', { target });
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

// Chat listener is now bound after socket connects inside initSocket()

// Append message to chat box
function appendChatBoxMessage(nickname, message) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';
    // Use data attribute for player so CSS can render a retro prefix
    msgDiv.setAttribute('data-player', nickname);
    msgDiv.textContent = `${nickname}: ${message}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}
// Show bubble chat above player
function showBubbleChat(chatPlayerId, nickname, message) {
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
    playerGroup.userData.head = head;

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
    // For physics, keep at y=0 and offset physics body instead.
    playerGroup.position.y = 0;

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
    playerGroup.position.set(playerData.x, playerData.y + 1.0, playerData.z); // Offset visual upward to align feet with physics body bottom
    playerGroup.rotation.y = playerData.rotation;
    playerGroup.userData.targetPosition = new THREE.Vector3(playerData.x, playerData.y, playerData.z);
    playerGroup.userData.targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, playerData.rotation, 0));
    updatePlayerColors(playerGroup, playerData.colors);
    // Hat application is handled in ensureRemotePlayer() to avoid duplicate loads

    // Salve o nickname para uso na lista
    playerGroup.userData.nickname = playerData.nickname || "Guest";

    // Load face for remote player
    const faceId = playerData.faceId || 'OriginalGlitchedFace.webp';
    addFaceToPlayer(playerGroup, faceId);

    return playerGroup;
}

function ensureRemotePlayer(playerData) {
    if (!playerData || playerData.id === playerId) return;
    if (otherPlayers[playerData.id] || pendingPlayers.has(playerData.id)) {
        return;
    }
    pendingPlayers.add(playerData.id);

    const build = (head) => {
        // Normalize head mesh properties as in other loaders
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

        // Apply any pending hat update, falling back to initial hat from snapshot
        const hatId = pendingHats[playerData.id] ?? playerData.hatId;
        if (hatId) {
            addHatToPlayer(remotePlayer, hatId);
            delete pendingHats[playerData.id];
        }

        // Apply any pending face update, falling back to initial face from snapshot
        const faceId = pendingFaces[playerData.id] ?? playerData.faceId ?? 'OriginalGlitchedFace.webp';
        addFaceToPlayer(remotePlayer, faceId);
        delete pendingFaces[playerData.id];

        pendingPlayers.delete(playerData.id);
        updatePlayerList();
    };

    if (headTemplate) {
        build(headTemplate.clone(true));
    } else {
        const loader = new GLTFLoader();
        loader.load('old_roblox_head_2007-2009.glb', (gltf) => {
            const head = gltf.scene;
            build(head);
        }, undefined, () => {
            pendingPlayers.delete(playerData.id);
        });
    }
}

function initSocket() {
    // Get the current host for socket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    // Derive a logical room from the game title in the URL, defaulting to "default"
    const params = new URLSearchParams(window.location.search);
    const room = params.get('game') || 'default';

    socket = io(`${protocol}//${host}`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        // Pass room info to the server so it can isolate traffic per game/room
        auth: { room }
    });
    
    const statusEl = document.getElementById('online-status');
    
    socket.on('connect', () => {
        playerId = socket.id;
        const faceId = localStorage.getItem('rogold_face') || 'OriginalGlitchedFace.webp';
        socket.emit('register', { nickname, faceId }); // <--- ENVIA O NICKNAME E FACE

        console.log('Connected to server');
        statusEl.textContent = `Online (${Object.keys(otherPlayers).length + 1} players)`;
        statusEl.className = 'connected';

        const hatId = localStorage.getItem('rogold_equipped_hat');
        // Always inform server of current hat on connect to clear any stale state
        socket.emit('equipHat', { hatId: hatId || null });
        // Apply locally as source of truth (remove if none)
        if (hatId) {
            addHatToPlayer(player, hatId);
        } else {
            addHatToPlayer(player, null);
        }
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

    // Bind client listeners that must exist on the active socket instance
    socket.on('chat', ({ playerId: chatPlayerId, nickname, message }) => {
        appendChatBoxMessage(nickname, message);
        showBubbleChat(chatPlayerId, nickname, message);
    });

    // Server-authoritative rocket spawns
    socket.on('spawnRocket', (data) => {
        if (data.owner === playerId) return; // Already spawned locally
        spawnRocket(
            new THREE.Vector3(data.position.x, data.position.y, data.position.z),
            new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z),
            data.owner
        );
    });

    // Keep player list in sync
    socket.on('playerJoined', () => updatePlayerList());
    socket.on('playerLeft', () => updatePlayerList());
    socket.on('connect', () => updatePlayerList());
    socket.on('disconnect', () => updatePlayerList());
    
    socket.on('initialPlayers', (serverPlayers) => {
        console.log('Received initial players:', serverPlayers);
        Object.values(serverPlayers).forEach(playerData => {
            ensureRemotePlayer(playerData);
        });
        statusEl.textContent = `Online (${Object.keys(serverPlayers).length} players)`;
        // Ensure the player list reflects all visible players after initial snapshot
        updatePlayerList();
    });
    
    socket.on('playerJoined', (playerData) => {
        ensureRemotePlayer(playerData);
        // Update player count
        statusEl.textContent = `Online (${Object.keys(otherPlayers).length + 1} players)`;
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
                  ensureRemotePlayer(playerData);
            } else {
                  // This is an existing player, update their state for interpolation
                const remotePlayer = otherPlayers[playerData.id];
                remotePlayer.userData.targetPosition.set(playerData.x, playerData.y, playerData.z);
                // Update visual position with offset
                remotePlayer.position.lerp(new THREE.Vector3(playerData.x, playerData.y + 1.0, playerData.z), 0.2);
                
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
        // Keep player list updated for everyone (safe and cheap compared to scene render)
        updatePlayerList();
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
        // Remove name tag
        if (playerNameTags[playerId]) {
            playerNameTags[playerId].remove();
            delete playerNameTags[playerId];
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
    if (data.playerId === playerId) {
        isEquipping = true;
        equipAnimProgress = 0;
        equippedTool = data.tool;
    } else {
        const remotePlayer = otherPlayers[data.playerId];
        if (!remotePlayer) return;
        remotePlayer.userData.isEquipping = true;
        remotePlayer.userData.equipAnimProgress = 0;
        remotePlayer.userData.equippedTool = data.tool;
        // Attach model se ainda não tiver
        if (!remotePlayer.userData.rocketLauncherModel && rocketLauncherModel) {
            const model = rocketLauncherModel.clone();
            attachRocketLauncherToArm(remotePlayer.rightArm, model);
            remotePlayer.userData.rocketLauncherModel = model;
        } else if (remotePlayer.userData.rocketLauncherModel) {
            attachRocketLauncherToArm(remotePlayer.rightArm, remotePlayer.userData.rocketLauncherModel);
        }
    }
});

socket.on("remoteUnequip", (data) => {
    if (data.playerId === playerId) {
        isUnequipping = true;
        unequipAnimProgress = 0;
        equippedTool = null;
    } else {
        const remotePlayer = otherPlayers[data.playerId];
        if (!remotePlayer) return;
        remotePlayer.userData.isUnequipping = true;
        remotePlayer.userData.unequipAnimProgress = 0;
        remotePlayer.userData.equippedTool = null;
        // Remover modelo da mão
        if (remotePlayer.userData.rocketLauncherModel && remotePlayer.userData.rocketLauncherModel.parent) {
            remotePlayer.userData.rocketLauncherModel.parent.remove(remotePlayer.userData.rocketLauncherModel);
            remotePlayer.userData.rocketLauncherModel.visible = false;
        }
    }
});


    socket.on('stopDance', (dancerId) => {
        if (dancerId && otherPlayers[dancerId]) {
            otherPlayers[dancerId].isDancing = false;
        }
    });

    // Removed client-side re-broadcasts. The server is authoritative for relaying these.
    // Rocket spawns and playerHit events are handled by server emissions only.

// Recebe atualização de chapéu de outro jogador
socket.on('playerHatChanged', ({ playerId: changedId, hatId }) => {
    const remotePlayer = otherPlayers[changedId];
    if (remotePlayer) {
        addHatToPlayer(remotePlayer, hatId);
    } else {
        // Cache hat update to apply when the remote player is created
        pendingHats[changedId] = hatId;
    }
});

// Quando receber todos os chapéus ao entrar
socket.on('initialHats', (playerHats) => {
    Object.entries(playerHats).forEach(([id, hatId]) => {
        if (otherPlayers[id]) {
            addHatToPlayer(otherPlayers[id], hatId);
        }
    });
});

// Recebe atualização de face de outro jogador
socket.on('playerFaceChanged', ({ playerId: changedId, faceId }) => {
    const remotePlayer = otherPlayers[changedId];
    if (remotePlayer) {
        addFaceToPlayer(remotePlayer, faceId);
    } else {
        // Cache face update to apply when the remote player is created
        if (!pendingFaces) pendingFaces = {};
        pendingFaces[changedId] = faceId;
    }
});

// Quando receber todas as faces ao entrar
socket.on('initialFaces', (playerFaces) => {
    Object.entries(playerFaces).forEach(([id, faceId]) => {
        if (otherPlayers[id]) {
            addFaceToPlayer(otherPlayers[id], faceId);
        }
    });
});

// On explosion event
socket.on('explosion', (data) => {
    spawnExplosion(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
});

// Player death: show respawn effect to killer and others by hiding victim temporarily.
// Explosion visuals are already handled by the 'explosion' event above.
socket.on('playerDied', ({ killer, victim }) => {
    // Local victim handles its own full respawn flow
    if (victim === playerId) return;

    const remote = otherPlayers[victim];
    if (!remote) return;

    // Hide victim briefly to simulate death/respawn for all other clients
    remote.visible = false;
    setTimeout(() => {
        // The victim's client will reposition on its own respawn;
        // we only restore visibility here for the observers.
        if (otherPlayers[victim]) {
            otherPlayers[victim].visible = true;
        }
    }, 3000);
});

// Evento específico para o Daniel
socket.on('danielEvent', () => {
    // Toca som global
    const danielAudio = new Audio('daniel.mp3');
    danielAudio.play();
    // Mostra imagem na tela
    const img = document.createElement('img');
    img.src = 'daniel.png';
    img.style.position = 'fixed';
    img.style.top = 0;
    img.style.left = 0;
    img.style.width = '100vw';
    img.style.height = '100vh';
    img.style.zIndex = 9999;
    document.body.appendChild(img);
    setTimeout(() => {
        img.remove();
        danielAudio.pause();
    }, 5000);
});

// Admin commands
socket.on('adminExplode', ({ target }) => {
    if (nickname === target) {
        spawnExplosion(player.position.clone());
        respawnPlayer();
    }
    // Opcional: efeito visual nos outros players
    Object.values(otherPlayers).forEach(p => {
        if (p.userData.nickname === target) {
            spawnExplosion(p.position.clone());
        }
    });
});
}

function updatePlayerList() {
    const playerList = document.getElementById('player-list');
    if (!playerList) return;
    // Combine seu player e outros
    const allPlayers = [
        { id: playerId, nickname },
        ...Object.values(otherPlayers).map(p => ({
            id: p.userData.playerId,
            nickname: p.userData.nickname || "Guest"
        }))
    ];
    playerList.innerHTML = '';
    allPlayers.forEach(p => {
        const li = document.createElement('li');
        li.textContent = (p.id === playerId ? 'You (' + p.nickname + ')' : p.nickname);
        playerList.appendChild(li);
    });
}

// Realtime player list updates are bound within initSocket() after the socket is created.

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

    // Physics world setup with Roblox 2011-style physics
    physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, ROBLOX_GRAVITY, 0),
        allowSleep: false // Classic Roblox physics didn't allow parts to sleep
    });

    physicsWorld.solver.iterations = 50; // Extreme collision stability
    physicsWorld.defaultContactMaterial.friction = ROBLOX_FRICTION;
    physicsWorld.defaultContactMaterial.restitution = ROBLOX_RESTITUTION;

    // Add damping to prevent excessive sliding
    physicsWorld.defaultContactMaterial.contactEquationStiffness = 1e8;
    physicsWorld.defaultContactMaterial.contactEquationRelaxation = 3;

    const groundMaterial = new CANNON.Material("groundMaterial");
    partMaterial = new CANNON.Material("partMaterial");

    // Classic Roblox-style contact materials
    const groundPartContactMaterial = new CANNON.ContactMaterial(
        groundMaterial,
        partMaterial,
        {
            friction: ROBLOX_FRICTION,
            restitution: ROBLOX_RESTITUTION,
            contactEquationStiffness: 1e8, // Much stiffer contacts to prevent falling through
            contactEquationRelaxation: 3 // Faster contact solving
        }
    );
    physicsWorld.addContactMaterial(groundPartContactMaterial);

    // Add contact material for part-part collisions
    const partPartContactMaterial = new CANNON.ContactMaterial(
        partMaterial,
        partMaterial,
        {
            friction: ROBLOX_FRICTION,
            restitution: ROBLOX_RESTITUTION,
            contactEquationStiffness: 1e6,
            contactEquationRelaxation: 3
        }
    );
    physicsWorld.addContactMaterial(partPartContactMaterial);

    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: groundMaterial,
        collisionFilterGroup: 1, // Ground in group 1
        collisionFilterMask: -1 // Collide with all groups
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // horizontal with normal pointing up
    groundBody.position.set(0, 0, 0); // Match baseplate visual position
    groundBody.userData = { isGround: true };
    physicsWorld.addBody(groundBody);

    // Post-processing setup for pixelated effect
    renderTarget = new THREE.WebGLRenderTarget(320, 240);
    renderTarget.texture.minFilter = THREE.NearestFilter;
    renderTarget.texture.magFilter = THREE.NearestFilter;

    updatePixelatedEffect();

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

    let danceMusic;
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

        // Cache a template head for remote players to clone
        headTemplate = head.clone(true);

        // Create player model with the loaded head
        player = createPlayer(head);

        // Load face after player is created
        const savedFace = localStorage.getItem('rogold_face') || 'OriginalGlitchedFace.webp';
        addFaceToPlayer(player, savedFace);
        player.position.set(0, 2, 0); // Place player exactly at ground level
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
        baseCameraOffset = cameraOffset.clone();

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

    // Load studio test objects if in test mode
    loadStudioTestObjects();

    initUI(); // Initialize UI event listeners
    initMobileControls();

    // Load saved options
    audioMuted = localStorage.getItem('rogold_audio_muted') === 'true';
    pixelatedEffectEnabled = localStorage.getItem('rogold_pixelated_enabled') !== 'false'; // Default to true

    // Update UI to reflect saved settings
    document.getElementById('mute-toggle').checked = audioMuted;
    document.getElementById('pixelated-toggle').checked = pixelatedEffectEnabled;
    document.getElementById('options-mute-toggle').checked = audioMuted;
    document.getElementById('options-pixelated-toggle').checked = pixelatedEffectEnabled;

    // Load saved face (will be handled by updateFaceSelector)

    // Apply initial settings
    updatePixelatedEffect();

    // Apply initial mute setting
    applyMuteSetting();

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

// Adicione o corpo físico do player:
function ensurePlayerPhysicsBody() {
    if (player && !player.userData.body) {
        // Create single unified body shape for better ground alignment
        const playerShape = new CANNON.Box(new CANNON.Vec3(1, 2, 1));

        // Create body
        const body = new CANNON.Body({
            mass: 5,
            material: new CANNON.Material({
                friction: ROBLOX_FRICTION,
                restitution: 0 // No bounce to prevent floating
            }),
            linearDamping: ROBLOX_LINEAR_DAMPING,
            angularDamping: ROBLOX_ANGULAR_DAMPING,
            fixedRotation: true,
            collisionFilterGroup: 1,
            collisionFilterMask: -1
        });

        // Add single shape centered on the player model
        body.addShape(playerShape, new CANNON.Vec3(0, 0, 0));

        // Position the physics body at the player's current visual position so
        // collisions and ground detection line up with the mesh.
        if (player.position) {
            body.position.set(player.position.x, player.position.y, player.position.z);
        }

        // Small safety: prevent body from ever going to sleep (classic Roblox behaviour)
        body.allowSleep = false;

        // Listen for collisions on the player body and mark that the player can jump
        // when a contact with an upward-facing normal occurs.
        body.addEventListener('collide', (e) => {
            try {
                const contact = e.contact;
                if (!contact) return;
                // contact.ni is the contact normal (from bi to bj). We accept contacts
                // that have a significant Y component (roughly upwards).
                const ny = contact.ni ? contact.ni.y : 0;
                if (Math.abs(ny) > 0.5) {
                    canJump = true;
                }
            } catch (err) {
                console.warn('Player collide handler error', err);
            }
        });

        player.userData.body = body;
        physicsWorld.addBody(body);
    }
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


async function loadStudioTestObjects() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');

    // Check if we're loading a published game or test mode
    if (gameId) {
        // Load published game from server
        try {
            const response = await fetch(`/api/games/${gameId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const gameData = await response.json();
            await loadPublishedGame(gameData);
        } catch (error) {
            console.error('Failed to load published game:', error);
            // Fallback to default game
        }
    } else if (urlParams.get('test') && urlParams.get('studio')) {
        // Original test mode functionality
        const testData = sessionStorage.getItem('rogold_studio_test');
        if (!testData) return;

        isTestMode = true; // Set test mode flag

        try {
            const data = JSON.parse(testData);
            await loadGameData(data);
        } catch (error) {
            console.error('Failed to load studio test objects:', error);
        }
    }
}

async function loadPublishedGame(gameData) {
    console.log('Loading published game:', gameData.title);
    await loadGameData(gameData, true);
}

async function loadGameData(data, isPublished = false) {
    console.log('Loading game data:', data);
    // Load manual objects (parts, etc.) first so scripts can reference them
    if (data.objects) {
        console.log('Found objects:', data.objects);
        Object.values(data.objects).forEach(objData => {
            console.log('Processing object:', objData);
            if (objData.ClassName === 'Part') {
                console.log('Creating part:', objData.Name);
                const geometry = new THREE.BoxGeometry(
                    objData.Size[0],
                    objData.Size[1],
                    objData.Size[2]
                );
                const material = new THREE.MeshLambertMaterial({
                    color: new THREE.Color(objData.Color[0], objData.Color[1], objData.Color[2])
                });
                const part = new THREE.Mesh(geometry, material);
                part.position.set(objData.Position[0], objData.Position[1], objData.Position[2]);
                if (objData.Rotation) {
                    part.rotation.set(objData.Rotation[0], objData.Rotation[1], objData.Rotation[2]);
                }
                part.castShadow = true;
                part.receiveShadow = true;
                scene.add(part);
                console.log('Part added to scene at position:', part.position.toArray());

                // Create Roblox instance for the part
                const robloxPart = new RobloxInstance('Part', objData.Name);
                robloxPart.threeObject = part;
                robloxPart.Position = part.position.clone();
                robloxPart.Size = new THREE.Vector3(objData.Size[0], objData.Size[1], objData.Size[2]);
                robloxPart.Color = new THREE.Color(objData.Color[0], objData.Color[1], objData.Color[2]);
                robloxPart.CanCollide = objData.CanCollide !== false;
                robloxPart.Anchored = objData.Anchored !== false;
                robloxPart.Transparency = objData.Transparency || 0;

                // Apply transparency
                if (robloxPart.Transparency > 0) {
                    part.material.transparent = true;
                    part.material.opacity = 1 - robloxPart.Transparency;
                }

                luaObjects[objData.Name] = robloxPart;

                // Add physics if canCollide
                if (robloxPart.CanCollide && physicsWorld) {
                    const shape = new CANNON.Box(new CANNON.Vec3(
                        objData.Size[0] / 2,
                        objData.Size[1] / 2,
                        objData.Size[2] / 2
                    ));
                    const body = new CANNON.Body({
                        mass: robloxPart.Anchored ? 0 : 1,
                        position: new CANNON.Vec3(
                            objData.Position[0],
                            objData.Position[1],
                            objData.Position[2]
                        ),
                        shape: shape,
                        material: partMaterial,
                        collisionFilterGroup: 1, // Dynamic parts group
                        collisionFilterMask: -1 // Collide with all
                    });
                    body.userData = { mesh: part, instance: robloxPart };

                    // Add collision event listener
                    body.addEventListener('collide', (e) => {
                        const otherBody = e.body;
                        const contact = e.contact;

                        // Trigger Touched event if the instance has a Touched connection
                        if (robloxPart.touched && typeof robloxPart.touched === 'function') {
                            robloxPart.touched(otherBody.userData?.instance || otherBody);
                        }

                        // Apply Roblox-style collision response
                        if (contact.getImpactVelocityAlongNormal() > 5) {
                            const bounceForce = contact.getImpactVelocityAlongNormal() * 0.5;
                            const normal = contact.ni;
                            body.applyImpulse(
                                new CANNON.Vec3(
                                    normal.x * bounceForce,
                                    normal.y * bounceForce,
                                    normal.z * bounceForce
                                ),
                                new CANNON.Vec3(0, 0, 0)
                            );
                        }
                    });

                    physicsWorld.addBody(body);
                    robloxPart.cannonBody = body;
                }
            }
        });
    }

    // Load and execute scripts after objects are loaded
    if (data.scripts) {
        for (const [scriptName, scriptData] of Object.entries(data.scripts)) {
            // Skip 'Main Script' for published games to prevent duplicate objects and unintended execution
            if (isPublished && scriptName === 'Main Script') {
                console.log('Skipping Main Script for published game');
                continue;
            }

            if (scriptData && typeof scriptData === 'string') {
                // Handle case where scriptData is just the source string
                const source = scriptData;
                try {
                    console.log('Executing script:', scriptName);
                    const actions = interpretLuaScript(source);
                    console.log('Parsed actions for script:', scriptName, actions);
                    await executeLuaActions(actions);
                    console.log('Successfully executed script:', scriptName);
                } catch (error) {
                    console.error('Failed to execute script:', scriptName, error);
                }
            } else if (scriptData.source) {
                // Handle case where scriptData is an object with source property
                try {
                    console.log('Executing script:', scriptName);
                    const actions = interpretLuaScript(scriptData.source);
                    console.log('Parsed actions for script:', scriptName, actions);
                    await executeLuaActions(actions);
                    console.log('Successfully executed script:', scriptName);
                } catch (error) {
                    console.error('Failed to execute script:', scriptName, error);
                }
            }
        }
    }

    console.log('Loaded game objects and scripts');
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

    // Listen for face changes from catalog (index.js)
    window.addEventListener('rogold_equipped_face_changed', () => {
        const equippedFace = localStorage.getItem('rogold_face');
        if (equippedFace && ownedFaces.includes(equippedFace)) {
            addFaceToPlayer(player, equippedFace);
            // Update the face selector to match
            const faceSelect = document.getElementById('face-select');
            if (faceSelect) {
                faceSelect.value = equippedFace;
            }
        }
    });

    // For testing: unlock Epic face (remove this in production)
    // unlockFace('epicface.png');

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
            if (player.userData.body) {
                // Reset vertical velocity and clear most horizontal momentum before jumping
                player.userData.body.velocity.y = 0;
                player.userData.body.velocity.x = 0;
                player.userData.body.velocity.z = 0;
                // Apply upward impulse
                player.userData.body.applyImpulse(new CANNON.Vec3(0, JUMP_IMPULSE, 0), CANNON.Vec3.ZERO);
            }
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
    playerHealth = 0;
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
            linearDamping: 0.1,
            collisionFilterGroup: 1, // Dynamic parts group
            collisionFilterMask: -1 // Collide with all
        });

        // Apply explosion-like impulse
        const impulse = new CANNON.Vec3(
             (Math.random() - 0.5) * 40,
             Math.random() * 30 + 10,
             (Math.random() - 0.5) * 40
        );
        body.applyImpulse(impulse, CANNON.Vec3.ZERO);

        // Set collision filtering for fallen parts
        body.collisionFilterGroup = 1; // Dynamic parts group
        body.collisionFilterMask = -1; // Collide with all

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

        player.position.set(0, -2
            , 0);
        if (player.userData.body) {
            player.userData.body.position.set(0, 3, 0);
            player.userData.body.velocity.set(0, 0, 0);
        }
        player.visible = true;

        // Update health to 100 when respawning
        playerHealth = 100;
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

    updatePixelatedEffect();
}

function updatePixelatedEffect() {
    if (pixelatedEffectEnabled) {
        // Use a fixed low resolution that's independent of screen size
        const lowResWidth = 1600;
        const lowResHeight = 600;
        renderTarget.setSize(lowResWidth, lowResHeight);
        renderTarget.texture.minFilter = THREE.NearestFilter;
        renderTarget.texture.magFilter = THREE.NearestFilter;
    } else {
        // Render at full resolution
        const renderTargetSize = new THREE.Vector2();
        renderer.getDrawingBufferSize(renderTargetSize);
        renderTarget.setSize(renderTargetSize.x, renderTargetSize.y);
        renderTarget.texture.minFilter = THREE.LinearFilter;
        renderTarget.texture.magFilter = THREE.LinearFilter;
    }
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
                if (player.userData.body) {
                    // Reset vertical velocity and clear most horizontal momentum before jumping
                    player.userData.body.velocity.y = 0;
                    player.userData.body.velocity.x = 0;
                    player.userData.body.velocity.z = 0;
                    // Apply upward impulse
                    player.userData.body.applyImpulse(new CANNON.Vec3(0, JUMP_IMPULSE, 0), CANNON.Vec3.ZERO);
                }
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
    playDanceSoundAt(player);
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
    if (danceSound && danceSound.isPlaying) {
        danceSound.stop();
    }
}

function playDanceSoundAt(playerObject) {
    const sound = new THREE.PositionalAudio(audioListener);

    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('dance.mp3', buffer => {
        sound.setBuffer(buffer);
        sound.setRefDistance(10);   // distância onde o som toca no volume original
        sound.setMaxDistance(50);   // distância máxima que ainda é audível
        sound.setRolloffFactor(1);  // quanto mais rápido o volume cai
        sound.setLoop(true);
        sound.play();
    });

    playerObject.add(sound); // O som segue o player
}

function startLoadingScreen() {
    const studsTotal = 5210; // número total fake de studs
    let currentStuds = 0;
    const studsText = document.getElementById('loading-studs');

    const interval = setInterval(() => {
        currentStuds += Math.floor(Math.random() * 60) + 30; // velocidade aleatória
        if (currentStuds >= studsTotal) {
            currentStuds = studsTotal;
            clearInterval(interval);

            // Esconde a tela após carregar
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
            }, 800);
        }
        studsText.textContent = `Loading Studs: ${currentStuds}/${studsTotal}`;
    }, 40);
}

startLoadingScreen();

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

    scene.remove(rocketLauncherModel);
    attachRocketLauncherToArm(player.rightArm, rocketLauncherModel);
    equippedTool = 'rocketLauncher';

    if (socket && socket.connected) {
        socket.emit("equipTool", { tool: "rocketLauncher" });
    }

    document.getElementById('equip-tool-btn').classList.add('equipped');
}

function launchRocket() {
    if (equippedTool !== 'rocketLauncher' || !canShoot) return;

    canShoot = false;
    setTimeout(() => { canShoot = true; }, cooldownTime);

    // Get direction from camera and mouse
    raycaster.setFromCamera(mouse, camera);
    const direction = raycaster.ray.direction.clone().normalize();
    const startPos = new THREE.Vector3();
    rocketLauncherModel.getWorldPosition(startPos);

    // Emit to server so others spawn the rocket in this room
    if (socket && socket.connected) {
        socket.emit('launchRocket', {
            position: { x: startPos.x, y: startPos.y, z: startPos.z },
            direction: { x: direction.x, y: direction.y, z: direction.z },
            owner: playerId
        });
    }

    // Spawn locally immediately for the shooter (server will not echo back to sender)
    spawnRocket(startPos, direction, playerId);

    // Play launch sound locally
    if (launchSound && launchSound.buffer) {
        if (launchSound.isPlaying) launchSound.stop();
        launchSound.play();
    }
}

function unequipTool() {
    if (!rocketLauncherModel || equippedTool !== 'rocketLauncher') return;
    if (rocketLauncherModel.parent) rocketLauncherModel.parent.remove(rocketLauncherModel);
    scene.add(rocketLauncherModel);
    rocketLauncherModel.visible = false;
    equippedTool = null;
    player.rightArm.rotation.x = 0;
    document.getElementById('equip-tool-btn').classList.remove('equipped');

    if (socket && socket.connected) {
        socket.emit("unequipTool", { tool: "rocketLauncher" });
    }
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

 // spawnRocket listener is now bound after socket connects inside initSocket()

const activeRockets = []; // [{mesh, direction, ownerId, traveled}]
const rocketSpeed = 20; // units per second
const rocketMaxDistance = 30; // units

function spawnRocket(startPos, direction, ownerId) {
    const rocketGeometry = new THREE.BoxGeometry(1, 1, 1);
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('roblox-stud.png');
    const rocketMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color('#89CFF0'),
        blending: THREE.MultiplyBlending,
        transparent: true
    });
    const rocket = new THREE.Mesh(rocketGeometry, rocketMaterial);
    rocket.position.copy(startPos);
    rocket.lookAt(startPos.clone().add(direction));
    scene.add(rocket);

    activeRockets.push({
        mesh: rocket,
        direction: direction.clone().normalize(),
        ownerId,
        traveled: 0
    });
}

function spawnExplosion(position) {
    for (let i = 0; i < 18; i++) {
        const geometry = new THREE.SphereGeometry(0.25, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true, opacity: 1 });
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        // Direção aleatória
        const dir = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            Math.random() * 2,
            (Math.random() - 0.5) * 2
        ).normalize();
        particle.userData.velocity = dir.multiplyScalar(Math.random() * 12 + 6);
        particle.userData.creationTime = performance.now();
        scene.add(particle);
        explodingParticles.push(particle);
    }
    // Som de explosão
    if (explosionSound && explosionSound.buffer) {
        if (explosionSound.isPlaying) explosionSound.stop();
        explosionSound.play();
    }
}

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

    // Interpolate other players (optimized)
    if (performance.now() % 3 < 1) { // Only interpolate every 3 frames
        for (const id in otherPlayers) {
            const remotePlayer = otherPlayers[id];
            if (remotePlayer.userData.targetPosition && remotePlayer.userData.targetQuaternion) {
                remotePlayer.position.lerp(remotePlayer.userData.targetPosition, 0.2);
                remotePlayer.quaternion.slerp(remotePlayer.userData.targetQuaternion, 0.2);
            }
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
    const start = (typeof remotePlayer.userData.equipStartRotation === 'number') ? remotePlayer.userData.equipStartRotation : remotePlayer.rightArm.rotation.x;
    const target = (typeof remotePlayer.userData.equipTargetRotation === 'number') ? remotePlayer.userData.equipTargetRotation : equipTargetRotation;
    remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(start, target, t);

    if (t >= 1) {
    remotePlayer.userData.isEquipping = false;
    remotePlayer.userData.isEquipped = true; // <--- novo
    remotePlayer.rightArm.rotation.x = target; // braço reto
}
}

// UNEQUIP animação
if (remotePlayer.userData.isUnequipping) {
    remotePlayer.userData.unequipAnimProgress += delta;
    const t = Math.min(remotePlayer.userData.unequipAnimProgress / equipAnimDuration, 1);
    const start = (typeof remotePlayer.userData.unequipStartRotation === 'number') ? remotePlayer.userData.unequipStartRotation : remotePlayer.rightArm.rotation.x;
    const target = (typeof remotePlayer.userData.unequipTargetRotation === 'number') ? remotePlayer.userData.unequipTargetRotation : 0;
    remotePlayer.rightArm.rotation.x = THREE.MathUtils.lerp(start, target, t);

    if (t >= 1) {
        remotePlayer.userData.isUnequipping = false;
        remotePlayer.userData.isEquipped = false; // <--- solta arma
        remotePlayer.rightArm.rotation.x = target; // volta pro normal
        if (model && model.parent) model.parent.remove(model);
        if (model) model.visible = false;
}
}

if (remotePlayer.userData.isEquipped) {
    remotePlayer.rightArm.rotation.x = equipTargetRotation; // mantém arma levantada
}
}


    // Step physics world
    physicsWorld.step(fixedTimeStep, delta, 20); // Much higher iterations for stability


    // Animate fallen parts with physics
    if (isRespawning) {
        fallenParts.forEach(part => {
            // Update mesh position and rotation from physics body
            part.mesh.position.copy(part.body.position);
            part.mesh.quaternion.copy(part.body.quaternion);
        });
    }

    // Sync physics bodies with three.js objects for script-created parts
    Object.values(luaObjects).forEach(obj => {
        if (obj.cannonBody && obj.threeObject) {
            if (obj.Anchored) {
                // For anchored parts, sync physics body to three.js object
                obj.cannonBody.position.copy(obj.threeObject.position);
                obj.cannonBody.quaternion.setFromEuler(
                    obj.threeObject.rotation.x,
                    obj.threeObject.rotation.y,
                    obj.threeObject.rotation.z
                );
            } else {
                // For unanchored parts, sync three.js object to physics body
                obj.threeObject.position.copy(obj.cannonBody.position);
                obj.threeObject.quaternion.copy(obj.cannonBody.quaternion);
            }
        }
    });


    // Animate spinning parts from Lua scripts
    Object.values(luaObjects).forEach(obj => {
        if (obj.isSpinning && obj.threeObject) {
            const rotationSpeed = 4; // radians per second
            const axis = obj.spinAxis || new THREE.Vector3(0, 1, 0);
            obj.threeObject.rotateOnAxis(axis.normalize(), rotationSpeed * delta);
            obj.Rotation.x += axis.x * rotationSpeed * delta;
            obj.Rotation.y += axis.y * rotationSpeed * delta;
            obj.Rotation.z += axis.z * rotationSpeed * delta;
            if (obj.cannonBody) {
                obj.cannonBody.quaternion.setFromEuler(obj.Rotation.x, obj.Rotation.y, obj.Rotation.z);
            }
        }
    });

    // Animate spinning parts from RobloxEnvironment
    spinningParts.forEach(part => {
        if (part.threeObject) {
            const rotationSpeed = 4; // radians per second
            const axis = part.spinAxis || new THREE.Vector3(0, 1, 0);
            part.threeObject.rotateOnAxis(axis.normalize(), rotationSpeed * delta);
            part.Rotation.x += axis.x * rotationSpeed * delta;
            part.Rotation.y += axis.y * rotationSpeed * delta;
            part.Rotation.z += axis.z * rotationSpeed * delta;
            if (part.cannonBody) {
                part.cannonBody.quaternion.setFromEuler(part.Rotation.x, part.Rotation.y, part.Rotation.z);
            }
        }
    });

    // Handle camera keyboard controls (optimized)
    if (true) { // Always update camera for smooth movement
        const cameraRotationSpeed = 3.0; // Higher rotation speed
        const cameraZoomSpeed = 20.0;

        // Update camera rotation
        if (rotateCameraLeft) {
            const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotationSpeed * delta);
            cameraOffset.applyQuaternion(rotation);
            // Also rotate the movement reference
            baseCameraOffset.applyQuaternion(rotation);
        }
        if (rotateCameraRight) {
            const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -cameraRotationSpeed * delta);
            cameraOffset.applyQuaternion(rotation);
            // Also rotate the movement reference
            baseCameraOffset.applyQuaternion(rotation);
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

        // Update baseCameraOffset to reflect current rotation for movement calculations
        baseCameraOffset.copy(cameraOffset).normalize().multiplyScalar(baseCameraOffset.length());
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

    // Physics-based movement with proper velocity accumulation
    ensurePlayerPhysicsBody();
    let isMoving = false;
    if (player.userData.body) {
        // Build raw input from digital keys / joystick axes
        const inputX = Number(moveRight) - Number(moveLeft);
        const inputZ = Number(moveForward) - Number(moveBackward);

        // Preserve analog magnitude when available; clamp magnitude to 1 for digital input so diagonals aren't faster
        const inputVec2 = new THREE.Vector2(inputX, inputZ);
        let inputMag = inputVec2.length();
        if (inputMag > 1) {
            inputVec2.normalize();
            inputMag = 1.2;
        }

        isMoving = inputMag > 0.001;

        if (isMoving) {
            // Calculate precise camera-relative movement vectors using world quaternion
            const camQuat = new THREE.Quaternion();
            camera.getWorldQuaternion(camQuat);

            // Get forward and right from camera quaternion, then remove vertical component
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
            forward.y = 0; forward.normalize();
            right.y = 0; right.normalize();

            // Create movement vector using precise directional control
            const moveDir = new THREE.Vector3();

            // Handle diagonal movement with proper normalization
            if (Math.abs(inputVec2.x) > 0.001 || Math.abs(inputVec2.y) > 0.001) {
                // Add forward/backward movement
                if (Math.abs(inputVec2.y) > 0.001) {
                    moveDir.add(forward.multiplyScalar(inputVec2.y));
                }
                
                // Add left/right movement
                if (Math.abs(inputVec2.x) > 0.001) {
                    moveDir.add(right.multiplyScalar(inputVec2.x));
                }

                // Normalize to ensure consistent speed in all directions
                moveDir.normalize();

                // For diagonal movement, maintain proper 45-degree angles
                if (Math.abs(inputVec2.x) > 0.001 && Math.abs(inputVec2.y) > 0.001) {
                    moveDir.multiplyScalar(Math.SQRT2);
                }
            }

            // Fixed speed calculation for perfect directional control
            const targetSpeed = 45; // Base movement speed
            const airControlFactor = player.userData.body && typeof canJump === 'boolean' ? (canJump ? 1.0 : 0.25) : 1.0;
            // Calculate speed while preserving directional precision
            const speed = targetSpeed * airControlFactor * (moveDir.length() > 0 ? 1 : 0);

            // Apply velocity
            playerVelocity.copy(moveDir).multiplyScalar(speed);
            player.userData.body.velocity.x = playerVelocity.x;
            player.userData.body.velocity.z = playerVelocity.z;

            if (moveDir.length() > 0.1) {
                // Compute desired yaw so the player's forward axis aligns with movement.
                // Use atan2(x, z) to match the model's forward orientation.
                // Only update rotation when actually moving (not just camera rotating)
                if (Math.abs(inputVec2.x) > 0.001 || Math.abs(inputVec2.y) > 0.001) {
                    const desiredYaw = Math.atan2(moveDir.x, moveDir.z);
                    
                    // Smooth rotation instead of instant
                    const rotationSpeed = 10;
                    // Compute shortest signed angle difference between current and desired yaw
                    const diff = desiredYaw - player.rotation.y;
                    const TWO_PI = Math.PI * 2;
                    let deltaAngle = ((diff + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
                    player.rotation.y += deltaAngle * Math.min(1, rotationSpeed * delta);
                    
                    // Sync physics body rotation
                    player.userData.body.quaternion.setFromEuler(0, player.rotation.y, 0);
                }
            }
        } else {
            // Stop immediately when no input (only damp horizontal while on ground)
            if (canJump) {
                playerVelocity.set(0, 0, 0);
                player.userData.body.velocity.x = 0;
                player.userData.body.velocity.z = 0;
                if (walkSound && walkSound.isPlaying) walkSound.stop();
            } else {
                // While airborne, do not abruptly zero horizontal velocity (keeps natural arc)
                // Optionally apply mild damping in air
                player.userData.body.velocity.x *= 0.98;
                player.userData.body.velocity.z *= 0.98;
            }
        }
    } else {
        console.error('Debug: Player physics body not found!');
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
        // Choose swing direction based on local movement (so strafing animates correctly)
        let swingSign = 1;
        try {
            const worldVel = new THREE.Vector3(player.userData.body.velocity.x, 0, player.userData.body.velocity.z);
            if (worldVel.length() > 0.001) {
                // Player forward in world space (-Z) rotated by player's Y rotation
                const forwardVec = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, player.rotation.y, 0));
                const rightVec = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, player.rotation.y, 0));
                const localZ = worldVel.dot(forwardVec);
                const localX = worldVel.dot(rightVec);
                // Use the dominant axis to determine sign (forward/back vs strafe)
                const dominant = Math.abs(localZ) >= Math.abs(localX) ? localZ : localX;
                swingSign = dominant >= 0 ? 1 : -1;
            }
        } catch (e) {
            swingSign = 1;
        }

        player.leftArm.rotation.x = swingAngle * swingSign;
        player.rightArm.rotation.x = -swingAngle * swingSign;
        player.leftLeg.rotation.x = -swingAngle * swingSign;
        player.rightLeg.rotation.x = swingAngle * swingSign;
    } else {
        animationTime = 0;
        player.leftArm.rotation.x = THREE.MathUtils.lerp(player.leftArm.rotation.x, 0, 0.1);
        player.rightArm.rotation.x = THREE.MathUtils.lerp(player.rightArm.rotation.x, 0, 0.1);
        player.leftLeg.rotation.x = THREE.MathUtils.lerp(player.leftLeg.rotation.x, 0, 0.1);
        player.rightLeg.rotation.x = THREE.MathUtils.lerp(player.rightLeg.rotation.x, 0, 0.1);
    }

    // Ground collision detection for jumping
    if (player.userData.body) {
        // Check if player is on ground or parts by checking contacts
        const contacts = physicsWorld.contacts;
        canJump = false;
        let groundContacts = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const isPlayerContact = (contact.bi === player.userData.body || contact.bj === player.userData.body);
            const isGroundContact = (contact.bi.userData?.isGround || contact.bj.userData?.isGround);
            const isPartContact = (contact.bi.userData?.instance || contact.bj.userData?.instance);
            
            if (isPlayerContact && (isGroundContact || isPartContact)) {
                // Check if the contact normal is pointing upward (ground contact)
                const normal = contact.ni;
                if (normal.y > 0.5) {  // Contact is mostly vertical
                    canJump = true;
                    groundContacts++;
                }
            }
        }
    }

    // Send player position to server (throttled)
    if (socket && socket.connected && time > lastSentTime + sendInterval) {
        const pos = player.userData.body ? player.userData.body.position : player.position;
        socket.emit('playerMove', {
            x: pos.x,
            y: pos.y,
            z: pos.z,
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
        const baseY = player.userData.body ? player.userData.body.position.y : 3;
        player.position.y = baseY + Math.abs(Math.sin(animationTime) * 0.2);
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

    // Animate other players' dances (optimized)
    if (performance.now() % 4 < 1) { // Only update every 4 frames
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
                const baseY = otherPlayer.userData.body ? otherPlayer.userData.body.position.y : 3;
                otherPlayer.position.y = baseY + Math.abs(Math.sin(otherPlayer.animationTime) * 0.2);
            }
        });
    }

    // Update name tags (throttled)
    if (performance.now() % 4 < 1) { // Only update every 4 frames
        for (const id in otherPlayers) {
            const remotePlayer = otherPlayers[id];
            if (!remotePlayer) continue;

            let nameTag = playerNameTags[id];
            if (!nameTag) {
                nameTag = document.createElement('div');
                nameTag.className = 'player-name-tag';
                nameTag.textContent = remotePlayer.userData.nickname || 'Guest';
                nameTag.style.position = 'absolute';
                nameTag.style.color = 'white';
                nameTag.style.fontSize = '14px';
                nameTag.style.fontFamily = 'Arial, sans-serif';
                nameTag.style.textShadow = '1px 1px 1px black';
                nameTag.style.pointerEvents = 'none';
                nameTag.style.zIndex = 100;
                document.body.appendChild(nameTag);
                playerNameTags[id] = nameTag;
            }

            // Position above head
            let headPos = new THREE.Vector3();
            let headMesh = null;
            remotePlayer.traverse(child => {
                if (child.isMesh && child.name === "Head") headMesh = child;
            });
            const target = headMesh || remotePlayer;
            target.getWorldPosition(headPos);
            headPos.y += 2.5; // Above head

            let screenPos = headPos.clone().project(camera);
            let x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
            let y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

            nameTag.style.left = `${x - nameTag.offsetWidth / 2}px`;
            nameTag.style.top = `${y - 20}px`;
        }
    }

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
        player.rightArm.rotation.x = -Math.PI /  2;
 }
    // --- Equip animation for rocket launcher ---

    if (isEquipping) {

        equipAnimProgress += delta;
        const t = Math.min(equipAnimProgress / equipAnimDuration,  1);
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

    if ( player.userData.body) {
        // Sync visual position from physics body
        const oldPosition = player.position.clone();
        player.position.copy(player.userData.body.position);
        player.position.y += 1.0; // Offset visual upward to align feet with physics body bottom

        console.log('Debug: Body position after sync:', player.userData.body.position);
        console.log('Debug: Visual position after sync:', player.position);

        // Sync physics body rotation to match visual rotation
        player.userData.body.quaternion.setFromEuler(0, player.rotation.y, 0);
    }

    ensurePlayerPhysicsBody();

    // Atualiza e remove rockets (optimized)
    for (let i = activeRockets.length - 1; i >= 0; i--) {
        const rocketObj = activeRockets[i];
        const { mesh, direction, ownerId } = rocketObj;
        const moveStep = rocketSpeed * delta;
        mesh.position.add(direction.clone().multiplyScalar(moveStep));
        rocketObj.traveled += moveStep;

        // Colisão simples com player local (AABB) - only check every few frames
        if (performance.now() % 3 < 1) { // Check collision every 3 frames
            if (
                ownerId !== playerId &&
                player.visible &&
                mesh.position.distanceTo(player.position) < 2
            ) {
                // Take damage
                playerHealth -= 25;
                if (playerHealth <= 0) {
                    respawnPlayer();
                } else {
                    // Update UI
                    document.getElementById('health-text').textContent = playerHealth;
                    document.getElementById('health-fill').style.width = `${(playerHealth / maxHealth) * 100}%`;
                }
                if (socket && socket.connected) {
                    socket.emit('playerHit', { killer: ownerId, victim: playerId });
                    socket.emit('explosion', { position: mesh.position });
                }
                scene.remove(mesh);
                activeRockets.splice(i, 1);
                continue;
            }
        }

        // Checa colisão com o chão (y <= 0)
        if (mesh.position.y <= 0) {
            if (socket && socket.connected) {
                socket.emit('explosion', { position: mesh.position });
            }
            scene.remove(mesh);
            activeRockets.splice(i, 1);
            continue;
        }

        // Remove se passou da distância máxima
        if (rocketObj.traveled > rocketMaxDistance) {
            if (socket && socket.connected) {
                socket.emit('explosion', { position: mesh.position });
            }
            scene.remove(mesh);
            activeRockets.splice(i, 1);
        }
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
    const optionsMenu = document.getElementById('options-menu');
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
        gameMenu.style.display = 'none';
        optionsMenu.style.display = 'block';
    });

    const backToMenuBtn = document.getElementById('back-to-menu-btn');
    const muteToggle = document.getElementById('mute-toggle');
    const pixelatedToggle = document.getElementById('pixelated-toggle');
    const optionsMuteToggle = document.getElementById('options-mute-toggle');
    const optionsPixelatedToggle = document.getElementById('options-pixelated-toggle');

    backToMenuBtn.addEventListener('click', () => {
        optionsMenu.style.display = 'none';
        gameMenu.style.display = 'block';
    });

    muteToggle.addEventListener('change', () => {
        audioMuted = muteToggle.checked;
        applyMuteSetting();
        localStorage.setItem('rogold_audio_muted', audioMuted);
        // Sync options menu toggle
        if (optionsMuteToggle) optionsMuteToggle.checked = audioMuted;
    });

    pixelatedToggle.addEventListener('change', () => {
        pixelatedEffectEnabled = pixelatedToggle.checked;
        updatePixelatedEffect();
        localStorage.setItem('rogold_pixelated_enabled', pixelatedEffectEnabled);
        // Sync options menu toggle
        if (optionsPixelatedToggle) optionsPixelatedToggle.checked = pixelatedEffectEnabled;
    });

    // Options menu toggles
    optionsMuteToggle.addEventListener('change', () => {
        audioMuted = optionsMuteToggle.checked;
        applyMuteSetting();
        localStorage.setItem('rogold_audio_muted', audioMuted);
        // Sync main toggle
        if (muteToggle) muteToggle.checked = audioMuted;
    });

    optionsPixelatedToggle.addEventListener('change', () => {
        pixelatedEffectEnabled = optionsPixelatedToggle.checked;
        updatePixelatedEffect();
        localStorage.setItem('rogold_pixelated_enabled', pixelatedEffectEnabled);
        // Sync main toggle
        if (pixelatedToggle) pixelatedToggle.checked = pixelatedEffectEnabled;
    });

    exitBtn.addEventListener('click', () => {
        window.location.href = '/'; // Or any exit logic you want
    });

    // Help button event listener
    const helpBtn = document.getElementById('help-btn');
    const helpTutorial = document.getElementById('help-tutorial');
    const closeTutorialBtn = document.getElementById('close-tutorial-btn');

    console.log('Debug: helpBtn found:', !!helpBtn);
    console.log('Debug: helpTutorial found:', !!helpTutorial);
    console.log('Debug: closeTutorialBtn found:', !!closeTutorialBtn);

    if (helpBtn) {
        helpBtn.addEventListener('click', () => {
            console.log('Help button clicked: hiding game menu and showing tutorial');
            console.log('Debug: gameMenu before:', gameMenu.style.display);
            console.log('Debug: helpTutorial before:', helpTutorial.style.display);
            gameMenu.style.display = 'none';
            helpTutorial.style.display = 'block';
            console.log('Debug: gameMenu after:', gameMenu.style.display);
            console.log('Debug: helpTutorial after:', helpTutorial.style.display);
        });
    } else {
        console.error('Debug: helpBtn not found!');
    }

    if (closeTutorialBtn) {
        closeTutorialBtn.addEventListener('click', (event) => {
            console.log('Close tutorial button clicked: hiding tutorial and showing game menu');
            console.log('Debug: event target:', event.target);
            console.log('Debug: helpTutorial before:', helpTutorial.style.display);
            console.log('Debug: gameMenu before:', gameMenu.style.display);
            helpTutorial.style.display = 'none';
            gameMenu.style.display = 'block';
            console.log('Debug: helpTutorial after:', helpTutorial.style.display);
            console.log('Debug: gameMenu after:', gameMenu.style.display);
        });
        console.log('Debug: closeTutorialBtn event listener added successfully');
    } else {
        console.error('Debug: closeTutorialBtn not found!');
    }

    // Add debug logging for menu button to ensure menu opens
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            console.log('Menu button clicked: opening game menu');
            console.log('Debug: gameMenu display before:', gameMenu.style.display);
            gameMenu.style.display = 'block';
            isMenuOpen = true;
            console.log('Debug: gameMenu display after:', gameMenu.style.display);
        });
    }

    // ESC key closes menu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            gameMenu.style.display = 'none';
            isMenuOpen = false;
        }
 });
});

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('click', launchRocket);


initGame();

function addHatToPlayer(player, hatId) {
    // Remove chapéu antigo se houver
    if (player.userData.currentHat) {
    if (player.userData.currentHat.parent) {
        player.userData.currentHat.parent.remove(player.userData.currentHat);
    } else {
        console.warn("Chapéu antigo sem parent, pode estar bugado:", player.userData.currentHatId);
    }
    player.userData.currentHat = null;
    player.userData.currentHatId = null;
}
    if (!hatId) return;

   

    // Mapeamento dos modelos
    const hatMap = {
        'hat_red': 'roblox_r_baseball_cap_r6.glb',
        'hat_doge': 'doge_roblox_hat.glb',
        'hat_fedora_black': 'roblox_fedora.glb'
    };
    const hatModelPath = hatMap[hatId];
    if (!hatModelPath) return;

    const loader = new GLTFLoader();
    loader.load(hatModelPath, (gltf) => {
        const hat = gltf.scene;
        // Ajuste escala e posição conforme o chapéu
        if (hatId === 'hat_red' || hatId === 'hat_fedora_black') {
            hat.scale.set(1, 1, 1);             // tamanho original
    hat.position.set(0, 0.256, -0.4);       // encaixe no head
    hat.rotation.set(1.9, Math.PI / 2, 0);
        } else if (hatId === 'hat_doge') {
            hat.scale.set(1.2, 1.2, 1.2);
            hat.position.set(0, 0.2, 0);
            hat.rotation.set(2, Math.PI, 0); // gira 180 graus no Y
        }
        // Encontre a cabeça do player
        let head = null;
        player.traverse(child => {
            if (child.isMesh && child.name === "Head") head = child;
        });
        if (head) {
            head.add(hat);
            player.userData.currentHat = hat;
            player.userData.currentHatId = hatId;
        }
    });
}

window.addEventListener('rogold_equipped_hat_changed', () => {
    const hatId = localStorage.getItem('rogold_equipped_hat'); // 'hat_red', 'hat_doge', etc.

    // Emit to server so other clients update, even if hatId is null (clears previous)
    if (socket && socket.connected) {
        socket.emit('equipHat', { hatId: hatId || null });
    }

    // Apply locally
    if (hatId) {
        addHatToPlayer(player, hatId);
    } else {
        addHatToPlayer(player, null); // remove chapéu se não tiver
    }
});

function attachRocketLauncherToArm(arm, model) {
    model.position.set(0, -1, 0.5);
    model.rotation.set(1.5, Math.PI / 2, 0);
    model.visible = true;
    arm.add(model);
}

function addFaceToPlayer(player, faceId) {
    if (!player || !faceId) return;

    // Remove existing face if any
    if (player.userData.facePlane) {
        player.userData.facePlane.parent.remove(player.userData.facePlane);
    }

    // Load new face texture with callback
    const faceTextureLoader = new THREE.TextureLoader();
    faceTextureLoader.load(faceId, (faceTexture) => {
        faceTexture.minFilter = THREE.NearestFilter;
        faceTexture.magFilter = THREE.NearestFilter;
        const faceMaterial = new THREE.MeshLambertMaterial({
            map: faceTexture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide // Make face visible from both sides
        });

        const faceGeometry = new THREE.PlaneGeometry(1.05, 1.05);
        const facePlane = new THREE.Mesh(faceGeometry, faceMaterial);
        facePlane.position.set(0, 0, 0.75);
        facePlane.rotation.y = Math.PI; // Rotate to face forward

        // Use stored head reference or find it
        let head = player.userData.head;
        if (!head) {
            player.traverse(child => {
                if (child.isMesh && child.name === "Head") head = child;
            });
        }
        if (head) {
            head.add(facePlane);
            player.userData.faceId = faceId;
            player.userData.facePlane = facePlane;
        } else {
            console.error('Head not found for face attachment');
        }
    }, undefined, (error) => {
        console.error('Error loading face texture:', faceId, error);
    });
}

function updateFaceSelector() {
    const faceSelect = document.getElementById('face-select');
    if (!faceSelect) return;

    // Clear existing options
    faceSelect.innerHTML = '';

    // Define all available faces with their display names
    const allFaces = {
        'OriginalGlitchedFace.webp': 'Classic',
        'epicface.png': 'Epic',
        'daniel.png': 'Daniel'
    };

    // Add owned faces to selector
    ownedFaces.forEach(faceId => {
        if (allFaces[faceId]) {
            const option = document.createElement('option');
            option.value = faceId;
            option.textContent = allFaces[faceId];
            faceSelect.appendChild(option);
        }
    });

    // Set current face if it's owned
    const currentFace = localStorage.getItem('rogold_face') || 'OriginalGlitchedFace.webp';
    if (ownedFaces.includes(currentFace)) {
        faceSelect.value = currentFace;
    } else {
        // Default to first owned face
        faceSelect.value = ownedFaces[0] || 'OriginalGlitchedFace.webp';
    }
}

function unlockFace(faceId) {
    if (!ownedFaces.includes(faceId)) {
        ownedFaces.push(faceId);
        localStorage.setItem('rogold_owned_faces', JSON.stringify(ownedFaces));
        updateFaceSelector();
    }
}

