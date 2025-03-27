import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
// If using OrbitControls as a module:
// import { OrbitControls } from 'https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js';
// Make sure the path is correct or hosted locally.

// --- Constants ---
// ... (Keep existing constants like COOLDOWNS, TIMES, PLAYER_COLORS)
const PLAYER_AVATAR_HEIGHT = 1.5;
const PLAYER_AVATAR_RADIUS = 0.4;
const MOVEMENT_SPEED = 15.0; // Units per second for animation
const ROOM_DIMENSIONS = { width: 8, height: 0.2, depth: 8 };
const TASK_OBJECT_SIZE = 0.8;
const BODY_MARKER_RADIUS = 0.5;
const BUTTON_SIZE = 0.6;
const HIGHLIGHT_COLOR = 0xffff00; // Yellow highlight

// --- DOM Elements ---
// ... (Keep existing uiElements)
// Add Minigame Overlay Elements
uiElements.minigameOverlay = document.getElementById('minigameOverlay');
uiElements.minigameTitle = document.getElementById('minigameTitle');
uiElements.minigameInstruction = document.getElementById('minigameInstruction');
uiElements.minigameInput = document.getElementById('minigameInput');
uiElements.minigameSubmit = document.getElementById('minigameSubmit');
uiElements.minigameTimer = document.getElementById('minigameTimer');
uiElements.minigameTimeRemaining = document.getElementById('minigameTimeRemaining');
uiElements.minigameRapidPressArea = document.getElementById('minigameRapidPressArea');
uiElements.minigameRapidButton = document.getElementById('minigameRapidButton');
uiElements.minigameProgress = document.getElementById('minigameProgress');
uiElements.minigameTarget = document.getElementById('minigameTarget');
uiElements.minigameTimedHoldArea = document.getElementById('minigameTimedHoldArea');
uiElements.minigameHoldButton = document.getElementById('minigameHoldButton');
uiElements.minigameHoldTimer = document.getElementById('minigameHoldTimer');


// --- Game State ---
let game;
let scene, camera, renderer, clock, raycaster, mouse;
// let controls; // For OrbitControls
const playerMeshes = {};
const roomMeshes = {}; // Floor meshes mainly
const taskObjects = {}; // { taskId: mesh } - Use unique task IDs if possible
const bodyMeshes = {}; // { playerId: mesh }
const interactiveObjects = []; // Objects clickable by raycaster
let highlightedObject = null;
let emergencyButtonMesh = null;
let currentAction = null; // Track ongoing actions like movement or minigame

// --- Classes (Modify Player and Room slightly) ---
class Task {
    constructor(id, name, roomName, type, description) {
        this.id = `task_${id}`; // Ensure unique string ID
        this.name = name;
        this.roomName = roomName;
        this.type = type;
        this.description = description;
        this.isComplete = false;
        this.mesh = null; // Reference to the 3D object
        this.sabotageContext = null; // Store linked sabotage if it's a fix task
    }
}

class Player {
    constructor(id, name, color) {
        // ... (keep existing properties: id, name, color, role, isAlive, tasks, kill/sabotage timers etc)
        this.id = id;
        this.name = `Player ${id}`;
        this.color = color;
        this.role = 'crewmate';
        this.isAlive = true;
        this.tasks = [];
        this.currentRoom = 'Command Center';
        this.killCooldownTimer = 0;
        this.sabotageCooldownTimer = 0;
        this.taskProgress = null;
        this.canVote = true;
        this.mesh = null; // Reference to the 3D avatar mesh
        this.isMoving = false; // Flag for animation state
    }

    // ... (keep existing methods: canKill, canSabotage, startCooldowns, updateCooldowns, getCompletedTaskCount)
     getTaskById(taskId) {
        return this.tasks.find(t => t.id === taskId);
    }
}

class Room {
    constructor(name, description, connections, taskTypes = [], hasButton = false) { // Allow multiple task types
        // ... (keep existing properties: name, description, connections, hasButton, sabotage, bodies)
        this.name = name;
        this.description = description;
        this.connections = connections;
        this.taskTypes = taskTypes; // Store types of tasks possible here
        this.hasButton = hasButton;
        this.sabotage = { type: null, isActive: false, timer: 0, doorLockedTo: [] };
        this.bodies = [];
        this.mesh = null; // Reference to the floor mesh (or main room object)
        this.taskObjectMeshes = []; // References to task object meshes within this room
    }
    // ... (keep existing methods: addBody, removeBody, clearBodies)
}

class Game {
    // ... (Keep constructor, calculateImposterCount)

    setup() {
        this.createRooms();
        this.createPlayers();
        this.assignRoles();
        this.assignTasks(); // AssignTasks now also creates task objects
        this.updateGlobalTaskCount();
        setupThreeJS(); // Setup scene, camera, renderer, raycaster
        createEnvironment(); // Create 3D rooms, connections, button
        this.createTaskObjects3D(); // Create 3D objects for assigned tasks
        this.players.forEach(p => createPlayerAvatar(p)); // Create 3D avatars
        this.currentTurnPlayerIndex = Math.floor(Math.random() * this.numPlayers); // Random start
        logMessage(`Game starting with ${this.numPlayers} players (${this.imposterCount} Imposter${this.imposterCount > 1 ? 's' : ''}).`);
        logMessage(`Crewmates must complete ${this.crewmateTasksTotal} tasks.`);
        this.players.forEach(p => console.log(`DEBUG: Player ${p.id} (${p.name}) is a ${p.role}`));

        updateCameraFocus(this.getCurrentPlayer()); // Focus camera on starting player
        updateUI();
        this.promptPlayerAction();
    }

    createRooms() {
        // Updated to include taskTypes array
        this.rooms = {
             'Power Room': new Room('Power Room', 'Sparks fly...', ['Hallway West'], ['power_grid', 'power_calib'], false),
             'Storage': new Room('Storage', 'Crates piled high...', ['Hallway North'], ['organize_supplies', 'secure_crates'], false),
             'Weapons Bay': new Room('Weapons Bay', 'Turrets line walls...', ['Hallway East'], ['fix_turret', 'clean_optics'], false),
             'Command Center': new Room('Command Center', 'Consoles display status...', ['Hallway North', 'Hallway South', 'Hallway West', 'Hallway East'], [], true), // No regular tasks, has button
             'Oxygen Room': new Room('Oxygen Room', 'Filters hum loudly...', ['Hallway West', 'Hallway South'], ['oxygen_filter', 'monitor_levels'], false),
             'Hallway North': new Room('Hallway North', 'Corridor north.', ['Command Center', 'Storage', 'Weapons Bay']),
             'Hallway South': new Room('Hallway South', 'Corridor south.', ['Command Center', 'Oxygen Room']),
             'Hallway West': new Room('Hallway West', 'Corridor west.', ['Command Center', 'Power Room', 'Oxygen Room']),
             'Hallway East': new Room('Hallway East', 'Corridor east.', ['Command Center', 'Weapons Bay']),
        };

         // Define task templates
         let taskIdCounter = 0;
         this.availableTasks = [
             new Task(taskIdCounter++, 'Repair Power Grid', 'Power Room', 'sequence', 'Match the blinking light sequence.'),
             new Task(taskIdCounter++, 'Organize Supplies', 'Storage', 'rapid_press', 'Quickly sort the fallen crates!'),
             new Task(taskIdCounter++, 'Fix Jammed Turret', 'Weapons Bay', 'timed_hold', 'Hold the release valve carefully.'), // Now room sabotage fix
             new Task(taskIdCounter++, 'Replace Oxygen Filter', 'Oxygen Room', 'rapid_press', 'Manually pump the filter bellows!'),
             new Task(taskIdCounter++, 'Calibrate Power Flow', 'Power Room', 'sequence', 'Input the calibration codes.'),
             new Task(taskIdCounter++, 'Secure Storage Crates', 'Storage', 'rapid_press', 'Lock down loose items.'),
             new Task(taskIdCounter++, 'Clean Turret Optics', 'Weapons Bay', 'timed_hold', 'Hold steady while cleaning.'),
             new Task(taskIdCounter++, 'Monitor Oxygen Levels', 'Oxygen Room', 'sequence', 'Enter the confirmation sequence.')
         ];
    }

     // assignTasks remains similar logic, but links Task instance to Player
     assignTasks() {
        const crewmates = this.players.filter(p => p.role === 'crewmate');
        const numTasksPerCrewmate = 3; // Fixed 3 tasks per crewmate for simplicity

        const taskPool = [...this.availableTasks];
        taskPool.sort(() => Math.random() - 0.5);

        crewmates.forEach(crewmate => {
            let assignedCount = 0;
            while(assignedCount < numTasksPerCrewmate && taskPool.length > 0) {
                const taskTemplate = taskPool.pop();
                 // Create a unique *instance* of the task for this player
                 const newTask = new Task(
                     `${crewmate.id}_${taskTemplate.id}`, // Player-specific unique ID
                     taskTemplate.name,
                     taskTemplate.roomName,
                     taskTemplate.type,
                     taskTemplate.description
                 );
                 crewmate.tasks.push(newTask);
                 assignedCount++;
            }
        });
    }

     // NEW: Create 3D objects for assigned tasks after players/tasks exist
     createTaskObjects3D() {
         const taskMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.6 }); // Grey default
         const taskGeometry = new THREE.BoxGeometry(TASK_OBJECT_SIZE, TASK_OBJECT_SIZE, TASK_OBJECT_SIZE);

         this.players.forEach(player => {
             if (player.role === 'crewmate') {
                 player.tasks.forEach(task => {
                     const room = this.rooms[task.roomName];
                     const roomPos = ROOM_POSITIONS[task.roomName];
                     if (room && roomPos && !taskObjects[task.id]) { // Create only once per unique task ID
                         const taskMesh = new THREE.Mesh(taskGeometry, taskMaterial.clone());
                         taskMesh.name = `TaskObject_${task.name}`;
                         taskMesh.userData = { type: 'task', taskId: task.id, roomName: task.roomName }; // Store info

                         // Position task object within the room, avoiding center maybe
                         taskMesh.position.set(
                             roomPos.x + (Math.random() - 0.5) * (ROOM_DIMENSIONS.width * 0.6),
                             roomPos.y + ROOM_DIMENSIONS.height / 2 + TASK_OBJECT_SIZE / 2,
                             roomPos.z + (Math.random() - 0.5) * (ROOM_DIMENSIONS.depth * 0.6)
                         );
                         taskMesh.castShadow = true;
                         scene.add(taskMesh);
                         taskObjects[task.id] = taskMesh; // Store mesh reference globally
                         task.mesh = taskMesh; // Link mesh to task instance
                         room.taskObjectMeshes.push(taskMesh); // Link to room
                         interactiveObjects.push(taskMesh); // Make it clickable
                     } else if (taskObjects[task.id]) {
                         // If task object already exists (e.g., multiple players have same task type in room),
                         // still link the existing mesh to this player's task instance.
                         task.mesh = taskObjects[task.id];
                     }
                 });
             }
         });
         // Initial update of task object appearances
         this.updateTaskObjectAppearances();
     }

    // --- Interaction Handling (Replaces handlePlayerInput) ---
    handleCanvasClick(event) {
        if (!game || game.gameOver || currentAction) return; // Don't process clicks during animations/minigames

        // Calculate mouse position in normalized device coordinates (-1 to +1)
        mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
        mouse.y = -((event.clientY - renderer.domElement.offsetTop) / renderer.domElement.clientHeight) * 2 + 1; // Adjust for canvas offset if any

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(interactiveObjects, false); // Only check designated interactive objects

        if (intersects.length > 0) {
            const clickedObject = intersects[0].object;
            const data = clickedObject.userData;
            const player = this.getCurrentPlayer();

            logMessage(`Player ${player.id} clicked on ${clickedObject.name}`, 'input');

            // --- Determine Action based on Clicked Object ---
            let actionTaken = false;

            // 1. Clicked on a Room Floor? -> Move
            if (data.type === 'room' && data.roomName !== player.currentRoom) {
                actionTaken = this.tryMove(player, data.roomName);
            }
            // 2. Clicked on a Task Object? -> Start Task/Fix
            else if (data.type === 'task') {
                 // Check if it's a regular task for the player OR a sabotage fix
                 const playerTask = player.getTaskById(data.taskId);
                 const roomSabotage = this.rooms[data.roomName]?.sabotage;
                 const globalSabotageType = this.globalSabotage.type;

                 if (playerTask && !playerTask.isComplete && player.role === 'crewmate') {
                     actionTaken = this.tryStartTask(player, playerTask);
                 } else {
                      // Check if it corresponds to a fixable sabotage in THIS room
                      actionTaken = this.tryFixSabotage(player, data.roomName); // Pass room name to check context
                 }
            }
            // 3. Clicked on another Player? -> Kill (Imposter) / Vote (Meeting)
            else if (data.type === 'player' && data.playerId !== player.id) {
                if (this.emergencyMeeting.isActive) {
                     this.castVote(player.id, data.playerId); // No need for actionTaken, vote handles turn
                     return; // Vote logic progresses turn
                 } else if (player.role === 'imposter') {
                    actionTaken = this.tryKill(player, data.playerId);
                } else {
                    logMessage("Cannot interact with player directly now.");
                }
            }
            // 4. Clicked on a Body? -> Report
            else if (data.type === 'body') {
                 actionTaken = this.tryReportBody(player, data.playerId); // Pass body ID
            }
            // 5. Clicked on Emergency Button? -> Meeting
            else if (data.type === 'emergency_button') {
                actionTaken = this.tryCallMeeting(player);
            }
            // 6. Clicked on self? (Maybe open personal menu later - ignore for now)
            else if (data.type === 'player' && data.playerId === player.id) {
                logMessage("Clicked on self.");
            }

            // If an action was successfully initiated that DOESN'T involve animation/minigame, advance turn
            if (actionTaken && !currentAction) {
                // Actions like kill, report, meeting call might not have animations here
                 // Ensure checkWinConditions runs if relevant (e.g., after kill/meeting)
                 if (!this.gameOver) this.nextTurn();
            } else if (!actionTaken && !currentAction) {
                // If click didn't result in a valid action, re-prompt (or just do nothing)
                 this.promptPlayerAction(); // Re-display helper text
            }
             // If currentAction is set (e.g., movement animation started), the animation callback will call nextTurn.
             // If a minigame started, its completion/failure callback will call nextTurn.

        } else {
            // Clicked on empty space or non-interactive object
            logMessage("Clicked empty space.");
        }
    }

     // Simplified prompt - just updates status text
     promptPlayerAction() {
         if (this.gameOver) return;
         const player = this.getCurrentPlayer();
          if (!player || !player.isAlive) return;

         let prompt = `Player ${player.id}'s turn (${player.role}). Location: ${player.currentRoom}. `;
         if (this.emergencyMeeting.isActive) {
             prompt += `VOTE! Click a player or the 'Skip Vote' button in UI.`;
              // Add skip vote button to UI dynamically? Or handle via text command still?
              // For now, let's assume clicking empty space or a dedicated UI button skips.
         } else if (currentAction) {
             prompt += `Performing action: ${currentAction}...`;
         }
         else {
             prompt += `Click interactable objects (highlighted on hover).`;
         }
         uiElements.actionPrompt.innerHTML = `<p>${prompt}</p>`;
         // Ensure input field is hidden unless needed for minigame
         uiElements.playerInput.style.display = 'none';
          uiElements.minigameOverlay.style.display = 'none';

         // Update task object visuals for the current player/state
          this.updateTaskObjectAppearances();
     }

    // --- Modified Action Methods ---

    tryMove(player, targetRoomName) {
        // ... (Keep checks for validity, connections, locked doors)
         const currentRoom = this.rooms[player.currentRoom];
         // targetRoomName = this.findBestRoomMatch(targetRoomName, currentRoom.connections); // Match logic less needed with direct clicks

         if (!currentRoom.connections.includes(targetRoomName)) {
              logMessage(`Cannot move directly from ${player.currentRoom} to ${targetRoomName}.`);
              return false;
         }
        const targetRoom = this.rooms[targetRoomName];
         if (!targetRoom) {
            logMessage(`Invalid move target room: ${targetRoomName}`);
            return false;
         }
         // Check locks (same as before)
         if (currentRoom.sabotage.isActive && currentRoom.sabotage.type === 'door_jam' && currentRoom.sabotage.doorLockedTo.includes(targetRoomName)) {
             logMessage(`Door from ${player.currentRoom} to ${targetRoomName} is jammed!`); return false; }
         if (targetRoom.sabotage.isActive && targetRoom.sabotage.type === 'door_jam' && targetRoom.sabotage.doorLockedTo.includes(player.currentRoom)) {
             logMessage(`Door from ${targetRoomName} to ${player.currentRoom} is jammed!`); return false; }


        // --- Start Movement Animation ---
        const startPos = player.mesh.position.clone();
        const targetPos = this.getRoomCenterPosition(targetRoomName);
        targetPos.y = PLAYER_AVATAR_HEIGHT / 2; // Keep avatar on floor plane

         const distance = startPos.distanceTo(targetPos);
         const duration = (distance / MOVEMENT_SPEED) * 1000; // duration in ms

         logMessage(`Player ${player.id} moving to ${targetRoomName}...`);
         player.isMoving = true;
         currentAction = 'move'; // Set global action lock
         updateUI(); // Reflect moving state

         new TWEEN.Tween(startPos)
            .to(targetPos, duration)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onUpdate(() => {
                if (player.mesh) {
                    player.mesh.position.copy(startPos);
                }
            })
            .onComplete(() => {
                 player.currentRoom = targetRoomName;
                 player.isMoving = false;
                 currentAction = null; // Release action lock
                 logMessage(`Player ${player.id} arrived in ${targetRoomName}.`);
                 updateCameraFocus(player); // Optionally refocus camera
                 updateUI();
                 if (!this.checkWinConditions()) { // Check win after move completes
                     this.nextTurn(); // Proceed to next turn *after* animation
                 }
            })
            .start();

        return true; // Action initiated (animation handles turn progression)
    }

     getRoomCenterPosition(roomName) {
        const roomPos = ROOM_POSITIONS[roomName];
         // Return center y=0 position for movement target
         return new THREE.Vector3(roomPos.x, 0, roomPos.z);
     }

    tryStartTask(player, task) {
        if (player.role === 'imposter') { logMessage("Imposters cannot do tasks."); return false; }
         if (!task || task.isComplete) { logMessage("Task not available or already complete."); return false;}
         if (player.currentRoom !== task.roomName) { logMessage(`Task '${task.name}' is in ${task.roomName}.`); return false;}

         // Check power outage (same as before)
         if (this.globalSabotage.type === 'power' && this.globalSabotage.isActive && task.roomName !== 'Power Room') {
             logMessage("Power is out! Cannot perform task."); return false; }

        logMessage(`Player ${player.id} starting task: ${task.name}...`);
        // Instead of direct minigame, show overlay and lock action state
        this.initiateMinigameVisual(player, task);

        return true; // Action initiated (minigame overlay handles progression)
    }

     tryFixSabotage(player, roomName) {
         const room = this.rooms[roomName];
         if (!room) return false;
         let fixableSabotage = null;
         let taskToStart = null; // This will be a temporary task object for the minigame

         // Determine which sabotage is active and fixable HERE
         // Global Sabotages
          if (this.globalSabotage.isActive) {
             if (this.globalSabotage.type === 'oxygen' && room.name === 'Oxygen Room') {
                 fixableSabotage = this.globalSabotage;
                 taskToStart = new Task('fix_oxygen', 'Fix Oxygen Sabotage', room.name, 'rapid_press', 'Seal the leak!');
             } else if (this.globalSabotage.type === 'power' && room.name === 'Power Room') {
                 fixableSabotage = this.globalSabotage;
                 taskToStart = new Task('fix_power', 'Restore Power', room.name, 'sequence', 'Reconnect conduits.');
             }
         }
         // Room Sabotages (check if a task object clicked corresponds to THIS room's active sabotage)
         else if (room.sabotage.isActive) {
             if (room.sabotage.type === 'door_jam') {
                  // Find *any* task object in the room to interact with for fixing doors? Or a dedicated "fix point"?
                  // Let's assume clicking *any* task object in a door-jammed room starts the fix.
                 fixableSabotage = room.sabotage;
                 taskToStart = new Task('fix_door_'+room.name, 'Repair Jammed Door', room.name, 'timed_hold', `Hold bypass for ${DOOR_REPAIR_TIME}s.`);
                 taskToStart.duration = DOOR_REPAIR_TIME;
             } else if (room.sabotage.type === 'turret_malfunction' && room.name === 'Weapons Bay') {
                 fixableSabotage = room.sabotage;
                 taskToStart = new Task('fix_turret', 'Fix Malfunctioning Turret', room.name, 'rapid_press', 'Quickly reset targeting.');
             }
         }

         if (!taskToStart) {
             logMessage(`No active sabotage fixable via this interaction in ${room.name}.`);
             return false;
         }

         logMessage(`Player ${player.id} starts fixing: ${taskToStart.name}`);
         taskToStart.sabotageContext = fixableSabotage; // Link the sabotage object
         this.initiateMinigameVisual(player, taskToStart); // Use the temporary task object
         return true;
     }


    // --- Minigame Visual Overlay ---
    initiateMinigameVisual(player, task) {
        currentAction = 'minigame'; // Lock actions
        player.taskProgress = {
            task,
            startTime: Date.now(),
            sabotageContext: task.sabotageContext, // Get from task if it's a fix task
            timerId: null, // For countdown timer
            duration: 0, // Minigame time limit
            // Specific progress tracking
             sequence: null,
             presses: 0,
             target: 0,
             holdStartTime: null,
             holdDuration: 0,
        };

        // Configure and show the overlay
         uiElements.minigameTitle.textContent = task.name;
         uiElements.minigameInstruction.textContent = task.description;
         uiElements.minigameOverlay.style.display = 'block';
         uiElements.playerInput.style.display = 'none'; // Hide general input
         uiElements.minigameInput.style.display = 'none';
         uiElements.minigameSubmit.style.display = 'none';
         uiElements.minigameRapidPressArea.style.display = 'none';
         uiElements.minigameTimedHoldArea.style.display = 'none';
         uiElements.minigameInput.value = '';

         let duration = 15; // Default duration

        switch (task.type) {
            case 'sequence':
                const sequenceLength = 3 + Math.floor(Math.random() * 3);
                player.taskProgress.sequence = Array.from({ length: sequenceLength }, () => Math.floor(Math.random() * 9) + 1);
                duration = POWER_FIX_TIME;
                uiElements.minigameInstruction.textContent += ` Enter: [ ${player.taskProgress.sequence.join(' ')} ]`;
                uiElements.minigameInput.style.display = 'block';
                uiElements.minigameSubmit.style.display = 'block';
                uiElements.minigameInput.focus();
                break;
            case 'rapid_press':
                player.taskProgress.target = OXYGEN_REFILL_TARGET;
                duration = 10;
                 uiElements.minigameRapidPressArea.style.display = 'block';
                 uiElements.minigameProgress.textContent = 0;
                 uiElements.minigameTarget.textContent = player.taskProgress.target;
                 uiElements.minigameRapidButton.onclick = () => this.handleMinigameInputVisual('rapid_press'); // Assign click handler
                break;
            case 'timed_hold':
                duration = task.duration || DOOR_REPAIR_TIME; // Use task duration or default
                player.taskProgress.holdDuration = duration;
                uiElements.minigameTimedHoldArea.style.display = 'block';
                 uiElements.minigameHoldTimer.textContent = '0.0';
                 // Add listeners for press and release
                 uiElements.minigameHoldButton.onmousedown = () => this.handleMinigameInputVisual('hold_start');
                 uiElements.minigameHoldButton.onmouseup = () => this.handleMinigameInputVisual('hold_end');
                 uiElements.minigameHoldButton.ontouchstart = () => this.handleMinigameInputVisual('hold_start'); // Mobile support
                 uiElements.minigameHoldButton.ontouchend = () => this.handleMinigameInputVisual('hold_end');
                 duration += 5; // Allow extra time for release window
                break;
            default:
                 logMessage(`Unknown minigame type: ${task.type}. Autocompleting.`);
                 this.completeTask(player, task, player.taskProgress.sabotageContext);
                 this.closeMinigameVisual(true); // Close overlay, success = true
                 return;
        }

        player.taskProgress.duration = duration;
         uiElements.minigameTimeRemaining.textContent = duration.toFixed(1);

        // Start countdown timer
        player.taskProgress.timerId = setInterval(() => {
            if (!player.taskProgress) {
                clearInterval(player.taskProgress.timerId); return;
            }
            const elapsed = (Date.now() - player.taskProgress.startTime) / 1000;
            const remaining = Math.max(0, player.taskProgress.duration - elapsed);
            uiElements.minigameTimeRemaining.textContent = remaining.toFixed(1);

            // Update hold timer display if active
            if (task.type === 'timed_hold' && player.taskProgress.holdStartTime) {
                const holdElapsed = (Date.now() - player.taskProgress.holdStartTime) / 1000;
                uiElements.minigameHoldTimer.textContent = holdElapsed.toFixed(1);
            }


            if (remaining <= 0) {
                 logMessage(`Time's up for ${task.name}! Task failed.`);
                 this.closeMinigameVisual(false); // Close overlay, success = false
            }
        }, 100); // Update timer display frequently

         // Handle submit button for sequence
         uiElements.minigameSubmit.onclick = () => this.handleMinigameInputVisual('sequence_submit');
    }

    handleMinigameInputVisual(actionType) {
         const player = this.getCurrentPlayer();
         if (!player || !player.taskProgress || currentAction !== 'minigame') return;

         const { task, startTime, sequence, presses, target, holdStartTime, holdDuration, sabotageContext, duration } = player.taskProgress;
         const currentTime = Date.now();
         const elapsed = (currentTime - startTime) / 1000;
         let success = false;

         if (elapsed > duration) {
             // Should be caught by timer, but double check
             logMessage("Minigame action received too late!", "warning");
             this.closeMinigameVisual(false);
             return;
         }

         switch (actionType) {
             case 'sequence_submit':
                 const playerSequence = uiElements.minigameInput.value.replace(/\s+/g, '');
                 const expectedSequence = sequence.join('');
                 if (playerSequence === expectedSequence) {
                     logMessage("Correct sequence!"); success = true;
                 } else {
                     logMessage(`Incorrect sequence. Expected ${expectedSequence}.`);
                 }
                 this.closeMinigameVisual(success);
                 break;

             case 'rapid_press':
                 player.taskProgress.presses++;
                 uiElements.minigameProgress.textContent = player.taskProgress.presses;
                 if (player.taskProgress.presses >= target) {
                     logMessage("Reached target presses!"); success = true;
                     this.closeMinigameVisual(success);
                 }
                 // Otherwise, keep overlay open, waiting for more presses or timeout
                 break;

             case 'hold_start':
                  if (!player.taskProgress.holdStartTime) { // Prevent resetting timer if already holding
                      player.taskProgress.holdStartTime = currentTime;
                      uiElements.minigameHoldTimer.textContent = '0.0';
                  }
                 break;

             case 'hold_end':
                 if (!player.taskProgress.holdStartTime) return; // Released without pressing
                 const timeHeld = (currentTime - player.taskProgress.holdStartTime) / 1000;
                 player.taskProgress.holdStartTime = null; // Reset for next potential press

                 if (timeHeld >= holdDuration && timeHeld < holdDuration + 5) {
                      logMessage(`Held for ${timeHeld.toFixed(1)}s. Success!`); success = true;
                 } else if (timeHeld < holdDuration) {
                      logMessage(`Held for ${timeHeld.toFixed(1)}s. Too short!`);
                 } else {
                     logMessage(`Held for ${timeHeld.toFixed(1)}s. Too long!`);
                 }
                 this.closeMinigameVisual(success);
                 break;
         }
    }

     closeMinigameVisual(success) {
        const player = this.getCurrentPlayer();
         if (!player || !player.taskProgress) return;

         const { task, sabotageContext, timerId } = player.taskProgress;

         clearInterval(timerId); // Stop the countdown timer
         uiElements.minigameOverlay.style.display = 'none';
          // Remove button listeners to prevent memory leaks
         uiElements.minigameRapidButton.onclick = null;
         uiElements.minigameSubmit.onclick = null;
         uiElements.minigameHoldButton.onmousedown = null;
         uiElements.minigameHoldButton.onmouseup = null;
         uiElements.minigameHoldButton.ontouchstart = null;
         uiElements.minigameHoldButton.ontouchend = null;


         player.taskProgress = null; // Clear progress state
         currentAction = null; // Release action lock

         if (success) {
             this.completeTask(player, task, sabotageContext);
         }

          updateUI(); // Refresh UI state
          this.updateTaskObjectAppearances(); // Update task visuals

         if (!this.gameOver) {
             this.nextTurn(); // Proceed to next turn after minigame attempt
         }
     }


    completeTask(player, task, sabotageContext) {
        // ... (Logic for completing task / fixing sabotage is IDENTICAL to previous version)
         if (task.id.startsWith('fix_')) { // Sabotage fix task
            logMessage(`Player ${player.id} successfully fixed: ${task.name}!`);
            if (sabotageContext) {
                sabotageContext.isActive = false;
                sabotageContext.timer = 0;
                 if (sabotageContext.type === 'door_jam') sabotageContext.doorLockedTo = [];
                logMessage(`${sabotageContext.type.toUpperCase()} sabotage resolved.`);
                if (this.globalSabotage === sabotageContext) this.globalSabotage.type = null; // Clear global type
                 // Trigger visual updates
                 updateSabotageVisuals();
                 this.updateTaskObjectAppearances(); // Sabotage fixes might affect task availability visuals
            }
         } else { // Regular crewmate task
             const playerTaskInstance = player.tasks.find(t => t.id === task.id && !t.isComplete);
             if (playerTaskInstance) {
                 playerTaskInstance.isComplete = true;
                 this.crewmateTasksCompleted++;
                 logMessage(`Player ${player.id} completed task: ${task.name}. (${this.crewmateTasksCompleted}/${this.crewmateTasksTotal} total)`);
                 this.updateGlobalTaskCount();
                 // Update task object appearance (e.g., turn green or disappear)
                  if (playerTaskInstance.mesh) {
                       // Maybe change color, or make it non-interactive for this player?
                       // For simplicity, let's rely on updateTaskObjectAppearances
                  }
                 this.checkWinConditions();
             } else { /* Error log */ }
         }
    }


    tryKill(imposter, targetPlayerId) {
        // ... (Checks for cooldown, range, target validity, witnesses remain the same)
        if (!imposter.canKill()) { /* log message */ return false; }
        const target = this.getPlayerById(targetPlayerId);
        if (!target || !target.isAlive || target.id === imposter.id || target.role === 'imposter') { /* log */ return false;}
        if (target.currentRoom !== imposter.currentRoom) { /* log */ return false; }
        const playersInRoom = this.getPlayersInRoom(imposter.currentRoom);
         const witnesses = playersInRoom.filter(p => p.id !== imposter.id && p.id !== target.id);
         if (witnesses.length > 0) { logMessage(`Cannot kill, witnesses!`); return false; }


        // --- Kill Successful ---
        logMessage(`Player ${imposter.id} eliminates Player ${target.id}!`, 'kill');
        target.isAlive = false;
         // target.tasks = []; // Keep tasks maybe for role reveal?
        imposter.startKillCooldown();

        // Visual Updates
        removePlayerAvatar(target.id); // Remove player mesh
        createBodyMarker(target.id, imposter.currentRoom); // Add body mesh

        // Place body data in room (for reporting logic)
        const room = this.rooms[imposter.currentRoom];
        room.addBody(target.id); // addBody method now just manages the list

        this.checkWinConditions();
        return true; // Action taken, no animation needed here beyond mesh changes
    }

     tryReportBody(player, bodyPlayerId) {
         const room = this.rooms[player.currentRoom];
         // Check if the specific body clicked is actually in this room's data
          if (room.bodies.includes(bodyPlayerId)) {
             const deadPlayer = this.getPlayerById(bodyPlayerId);
             logMessage(`Player ${player.id} reported body of Player ${bodyPlayerId} (${deadPlayer?.role || 'Unknown'})!`);
             this.startEmergencyMeeting(player.id, bodyPlayerId);
             return true;
         } else {
             logMessage("Cannot report that - body not found here or already reported.");
             return false;
         }
     }

      tryCallMeeting(player) {
        if (player.currentRoom !== 'Command Center') {
             logMessage("Emergency button is in Command Center."); return false;
        }
        // Add cooldown check if desired
        logMessage(`Player ${player.id} pressed the emergency button!`);
        this.startEmergencyMeeting(player.id, null);
        return true;
    }

    // Sabotage remains largely the same logic, but triggers visual updates
    trySabotage(imposter, argument) {
       if (!imposter.canSabotage()) { /* log */ return false; }
        // ... (parse argument, check type: power, oxygen, door, turret)
         // ... (check if sabotage already active)

         let success = false;
         // ... (switch statement based on type) ...
         // Inside each successful sabotage case:
         // 1. Update game state (globalSabotage or room.sabotage)
         // 2. Log message
         // 3. imposter.startSabotageCooldown()
         // 4. updateSabotageVisuals(); // <--- Trigger visual change
         // 5. success = true;
         // Example for Power:
         /*
            case 'power':
                 if(this.globalSabotage.isActive) { logMessage("Global sabotage active."); return false; }
                logMessage(`Player ${imposter.id} sabotages Power!`, 'sabotage');
                 this.globalSabotage.type = 'power';
                 this.globalSabotage.isActive = true;
                 this.globalSabotage.timer = 0;
                 imposter.startSabotageCooldown();
                 updateSabotageVisuals(); // Make scene darker etc.
                 success = true;
                 break;
         */
        // Make sure to implement the logic within the switch cases correctly.
        const parts = argument.toLowerCase().split(' ');
        const type = parts[0];
        const roomNameArg = parts.slice(1).join(' ');

         switch (type) {
            case 'power':
                 if(this.globalSabotage.isActive) { logMessage("Global sabotage active."); return false; }
                logMessage(`Player ${imposter.id} sabotages Power!`, 'sabotage');
                 this.globalSabotage.type = 'power';
                 this.globalSabotage.isActive = true;
                 this.globalSabotage.timer = 0; // State until fixed
                 imposter.startSabotageCooldown();
                 updateSabotageVisuals();
                 this.updateTaskObjectAppearances(); // Power affects tasks
                 success = true;
                 break;
            case 'oxygen':
                 if(this.globalSabotage.isActive) { logMessage("Global sabotage active."); return false; }
                logMessage(`Player ${imposter.id} sabotages Oxygen!`, 'sabotage');
                 this.globalSabotage.type = 'oxygen';
                 this.globalSabotage.isActive = true;
                 this.globalSabotage.timer = OXYGEN_DEPLETION_TIME;
                 imposter.startSabotageCooldown();
                 updateSabotageVisuals();
                 success = true;
                 break;
            case 'door':
                 // ... (Find targetRoom based on roomNameArg)
                 const targetRoom = this.rooms[this.findBestRoomMatch(roomNameArg, Object.keys(this.rooms))];
                 if (!targetRoom || targetRoom.sabotage.isActive) { /* log */ return false; }
                 logMessage(`Player ${imposter.id} jams doors to ${targetRoom.name}!`, 'sabotage');
                 targetRoom.sabotage.type = 'door_jam';
                 targetRoom.sabotage.isActive = true;
                 targetRoom.sabotage.timer = 0;
                 targetRoom.sabotage.doorLockedTo = [...targetRoom.connections];
                 imposter.startSabotageCooldown();
                 updateSabotageVisuals(); // Maybe change connection line colors?
                 success = true;
                 break;
              case 'turret':
                  const weaponsBay = this.rooms['Weapons Bay'];
                   if (!weaponsBay || weaponsBay.sabotage.isActive) { /* log */ return false; }
                   // Add check if imposter is IN weapons bay? Or allow remote? Let's allow remote for now.
                  logMessage(`Player ${imposter.id} sabotages Turrets!`, 'sabotage');
                  weaponsBay.sabotage.type = 'turret_malfunction';
                  weaponsBay.sabotage.isActive = true;
                  weaponsBay.sabotage.timer = 0;
                  imposter.startSabotageCooldown();
                  updateSabotageVisuals();
                  success = true;
                  break;
             default: logMessage(`Unknown sabotage type: '${type}'.`); return false;
         }

        return success; // Return if sabotage was successfully initiated
    }


    // --- Meeting Logic ---
     startEmergencyMeeting(reporterId, bodyFoundId = null) {
         if (this.emergencyMeeting.isActive) return;
         if (currentAction) { // Stop any ongoing animation/minigame
            if(currentAction === 'move') TWEEN.removeAll(); // Stop movement tweens
             if(currentAction === 'minigame' && this.getCurrentPlayer()?.taskProgress) {
                 clearInterval(this.getCurrentPlayer().taskProgress.timerId); // Stop minigame timer
                  this.getCurrentPlayer().taskProgress = null;
                  uiElements.minigameOverlay.style.display = 'none';
             }
             currentAction = null;
             this.getCurrentPlayer().isMoving = false; // Reset moving flag if interrupted
         }


        logMessage(`--- EMERGENCY MEETING ---`, 'meeting');
        // ... (Log reporter/body)

        this.emergencyMeeting.isActive = true;
        // ... (reset votes, timer, player.canVote)

        // Teleport all ALIVE players visually to Command Center for the meeting
         const meetingPos = this.getRoomCenterPosition('Command Center');
         this.players.forEach(p => {
            if (p.isAlive && p.mesh) {
                 // Add small random offset
                p.mesh.position.set(
                    meetingPos.x + (Math.random() - 0.5) * 4,
                    PLAYER_AVATAR_HEIGHT / 2,
                    meetingPos.z + (Math.random() - 0.5) * 4
                );
            }
         });
         updateCameraFocus(null, 'Command Center'); // Zoom out or focus on Command Center

         // Clear all bodies from rooms and visuals
         Object.values(this.rooms).forEach(room => room.clearBodies());
         clearAllBodyMarkers();

         this.currentTurnPlayerIndex = this.players.findIndex(p => p.isAlive); // First alive player votes
         updateUI();
         this.promptPlayerAction(); // Prompt first voter
    }

     // castVote, nextMeetingVoter, tallyVotes remain mostly the same logic
     castVote(voterId, votedPlayerId) {
        // ... same logic ...
         if (votedPlayerId === null) logMessage(`Player ${voterId} voted to skip.`);
         else logMessage(`Player ${voterId} voted for Player ${votedPlayerId}.`);
        // ... check if all voted ...
         this.nextMeetingVoter(); // Always go to next voter after a vote is cast
     }

     nextMeetingVoter() {
         // ... same logic find next alive, eligible voter ...
         // If found:
         updateUI();
         this.promptPlayerAction();
         // If not found (all voted):
         // this.tallyVotes(); // tallyVotes should be called when last vote is cast
     }

     tallyVotes() {
        // ... same logic ...
         if (ejectedPlayer) {
            logMessage(`Player ${ejectedPlayer.id} was ejected. Role: ${ejectedPlayer.role}.`, 'eject');
             ejectedPlayer.isAlive = false;
             removePlayerAvatar(ejectedPlayer.id); // Remove avatar
             // Player becomes a ghost (conceptually)
         }
         this.endEmergencyMeeting(); // End meeting after tally
     }


     endEmergencyMeeting() {
        logMessage("--- Meeting Ended ---", 'meeting');
        this.emergencyMeeting.isActive = false;
        // ... reset meeting state ...

         // Move players back to their original rooms visually? Or keep them in CC until they move?
         // Let's keep them in CC - simplifies state. They have to 'move' out next turn.
         // Make sure their logical `currentRoom` is updated if we did teleport them.
         // For simplicity now, we didn't change logical currentRoom, just visual mesh position.
         // Let's teleport them back visually to where they *logically* are.
         this.players.forEach(p => {
             if (p.isAlive && p.mesh) {
                 const roomPos = this.getRoomCenterPosition(p.currentRoom);
                  // Add small random offset
                p.mesh.position.set(
                    roomPos.x + (Math.random() - 0.5) * 2,
                    PLAYER_AVATAR_HEIGHT / 2,
                    roomPos.z + (Math.random() - 0.5) * 2
                );
             }
         });


        if (!this.checkWinConditions()) {
            // Find next alive player to start turn AFTER meeting finishes
            // ... (find next alive player index logic) ...
             this.currentTurnPlayerIndex = (this.currentTurnPlayerIndex + 1) % this.numPlayers; // Start after last voter
             while(!this.getCurrentPlayer().isAlive) {
                  this.currentTurnPlayerIndex = (this.currentTurnPlayerIndex + 1) % this.numPlayers;
             }

             updateCameraFocus(this.getCurrentPlayer()); // Focus on next player
             updateUI();
             this.promptPlayerAction();
        }
         // Win condition check inside endEmergencyMeeting handles game over state
    }

     // nextTurn needs slight adjustment for action locks
     nextTurn() {
         if (currentAction) {
             logMessage("Waiting for current action to complete...", "warning");
             return; // Don't advance turn if an action is in progress
         }
         clearTimeout(this.actionTimeout); // Clear any potential leftover timers (though overlay handles its own now)
         this.actionTimeout = null;
         const lastPlayer = this.getCurrentPlayer();
         if(lastPlayer) lastPlayer.taskProgress = null; // Reset task progress

         if (this.emergencyMeeting.isActive) {
             // This shouldn't be called during active meeting, handleMeetingTurn does it
             console.warn("nextTurn called during active meeting?");
             this.handleMeetingTurn();
             return;
         }
         if (this.checkWinConditions()) return; // Check win conditions

         // Find the next alive player (same logic as before)
         let attempts = 0;
         do {
             this.currentTurnPlayerIndex = (this.currentTurnPlayerIndex + 1) % this.numPlayers;
             attempts++;
         } while (!this.getCurrentPlayer().isAlive && attempts <= this.numPlayers);

          if (!this.getCurrentPlayer().isAlive) { /* Error or Game Over */ return; }


         updateCameraFocus(this.getCurrentPlayer()); // Focus camera on new player
         updateUI();
         this.promptPlayerAction(); // Prompt the new player
     }

      // updateTaskObjectAppearances - NEW function for visual feedback
     updateTaskObjectAppearances() {
        const player = this.getCurrentPlayer();
         if (!player) return;

         Object.values(taskObjects).forEach(mesh => {
             const taskId = mesh.userData.taskId;
             const taskInstance = player.tasks.find(t => t.id === taskId); // Player's instance
             const roomInstance = this.rooms[mesh.userData.roomName];
             let isFixableSabotage = false;

             // Check if this task object location corresponds to a fixable sabotage
              if (roomInstance?.sabotage.isActive) {
                  if ((roomInstance.sabotage.type === 'door_jam' || roomInstance.sabotage.type === 'turret_malfunction') && roomInstance.name === mesh.userData.roomName) {
                     isFixableSabotage = true;
                  }
              }
              if (this.globalSabotage.isActive) {
                   if ((this.globalSabotage.type === 'power' && mesh.userData.roomName === 'Power Room') ||
                       (this.globalSabotage.type === 'oxygen' && mesh.userData.roomName === 'Oxygen Room')) {
                       isFixableSabotage = true;
                   }
              }


             if (taskInstance && !taskInstance.isComplete && player.role === 'crewmate' && player.currentRoom === taskInstance.roomName) {
                  // Task is available for current player in this room
                 mesh.material.color.setHex(0x00ff00); // Green: Available task
                 mesh.material.emissive.setHex(0x003300); // Slight glow
             } else if (isFixableSabotage && player.currentRoom === mesh.userData.roomName) {
                  // Sabotage is fixable via this object's location for current player
                 mesh.material.color.setHex(0xff8c00); // Orange: Sabotage fix point
                 mesh.material.emissive.setHex(0x331a00); // Slight glow
             }
             else {
                 // Task done, not for this player, wrong room, or imposter
                 mesh.material.color.setHex(0xaaaaaa); // Grey: Default/Inactive
                  mesh.material.emissive.setHex(0x000000); // No glow
             }
         });
     }


    // --- Win Conditions & End Game (Mostly Unchanged) ---
    // checkWinConditions, endGame remain the same logically, but endGame might trigger final camera sweep etc.

} // --- End of Game Class ---


// --- UI Update Functions ---
function logMessage(message, type = 'info') { /* ... (same as before) ... */ }

function updateUI() {
    if (!game) return; // Add check for game existence

     // Update Global Info always
     uiElements.globalTasksCompleted.textContent = game.crewmateTasksCompleted;
     uiElements.globalTasksTotal.textContent = game.crewmateTasksTotal;
     // Sabotage status updated by updateSabotageTimers/Visuals
     uiElements.sabotageStatus.textContent = game.globalSabotage.isActive
            ? `${game.globalSabotage.type.toUpperCase()} ACTIVE`
            : (Object.values(game.rooms).some(r => r.sabotage.isActive) ? 'Room Sabotage Active' : 'None');
     uiElements.oxygenTimer.textContent = game.globalSabotage.isActive && game.globalSabotage.type === 'oxygen'
            ? `${game.globalSabotage.timer.toFixed(1)}s` : 'OK';
     uiElements.oxygenTimer.style.color = game.globalSabotage.timer < 15 ? '#f00' : '#0f0';


    const player = game.getCurrentPlayer();
    if (!player) return; // Player might not exist yet during initial setup

     const room = game.rooms[player.currentRoom];

     // Room Info - based on current player's logical location
     uiElements.roomName.textContent = player.currentRoom;
     uiElements.roomDesc.textContent = room?.description + (room?.hasButton ? ' [Emergency Button Here]' : '') || 'Unknown Room';
     const playersHere = game.getPlayersInRoom(player.currentRoom).map(p => `P${p.id}${p.id === player.id ? '(You)' : ''}`);
     uiElements.playersInRoom.textContent = playersHere.length > 0 ? playersHere.join(', ') : 'None';
     const bodiesHere = game.getBodiesInRoom(player.currentRoom).map(id => `Body P${id}`);
     uiElements.bodiesInRoom.textContent = bodiesHere.length > 0 ? bodiesHere.join(', ') : 'None';
     uiElements.bodiesInRoom.style.color = bodiesHere.length > 0 ? 'red' : '#0f0';
      // Show task OBJECTS in the current room (not player-specific list)
      const taskObjectsHere = room ? room.taskObjectMeshes.map(mesh => mesh.name.replace('TaskObject_', '')) : [];
      uiElements.tasksInRoom.textContent = taskObjectsHere.length > 0 ? taskObjectsHere.join(', ') : 'None';


     // Player Info (Current Turn Player)
     uiElements.playerId.textContent = player.id;
     uiElements.playerRole.textContent = (game.emergencyMeeting.isActive || player.role === 'imposter') ? player.role : 'Crewmate'; // Reveal role if imposter or meeting
     uiElements.playerStatus.textContent = player.isAlive ? (player.isMoving ? 'Moving...' : 'Alive') : 'Dead';
     uiElements.tasksCompleted.textContent = player.getCompletedTaskCount();
     uiElements.tasksTotal.textContent = player.tasks.length;

     // Task List (Still useful for overview)
     uiElements.taskList.innerHTML = '';
     if (player.role === 'crewmate') {
         player.tasks.forEach(task => {
             const li = document.createElement('li');
             // Highlight task if it's in the current room and not done
             const highlight = !task.isComplete && task.roomName === player.currentRoom;
             li.innerHTML = `${task.name} (${task.roomName})${highlight ? ' <span style="color: yellow;">&lt;-- HERE</span>': ''}`;
             if (task.isComplete) li.classList.add('complete');
             uiElements.taskList.appendChild(li);
         });
     } else { /* Imposter message */ }

     // Imposter Cooldowns
     if (player.role === 'imposter') {
         uiElements.killCooldown.textContent = player.killCooldownTimer > 0 ? `${player.killCooldownTimer.toFixed(1)}s` : 'Ready';
         uiElements.killCooldown.style.color = player.canKill() ? '#0f0' : '#f55';
         uiElements.sabotageCooldown.textContent = player.sabotageCooldownTimer > 0 ? `${player.sabotageCooldownTimer.toFixed(1)}s` : 'Ready';
          uiElements.sabotageCooldown.style.color = player.canSabotage() ? '#0f0' : '#f55';
     } else { /* N/A message */ }

     // Update prompt text via promptPlayerAction()
}


// --- Three.js Setup and Functions (Modified) ---

function setupThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2a);
    scene.fog = new THREE.Fog(0x1a1a2a, 20, 60); // Add fog for atmosphere

    const canvas = uiElements.gameCanvas;
    camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 25, 25); // Higher, angled overview
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows


    // Lighting (Adjusted for potentially darker power out)
    const ambientLight = new THREE.AmbientLight(0x404055, 0.7); // Slightly dimmer ambient
    ambientLight.name = 'AmbientLight';
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.0); // Brighter main light
     mainLight.name = 'MainLight';
    mainLight.position.set(10, 15, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 50;
    // Adjust shadow camera bounds if needed based on map size
    mainLight.shadow.camera.left = -30;
    mainLight.shadow.camera.right = 30;
    mainLight.shadow.camera.top = 30;
    mainLight.shadow.camera.bottom = -30;
    scene.add(mainLight);

    // Add point lights in rooms for more local illumination? (Optional)


    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Optional: OrbitControls for debugging
    // controls = new OrbitControls(camera, renderer.domElement);
    // controls.enableDamping = true;
    // controls.dampingFactor = 0.1;

    // Event Listeners for Interaction
     renderer.domElement.addEventListener('mousemove', onMouseMove, false);
     renderer.domElement.addEventListener('click', onMouseClick, false);
     window.addEventListener('resize', onWindowResize, false);

    animate();
}

 function createEnvironment() {
     const roomMaterial = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.9 });
     const floorGeometry = new THREE.PlaneGeometry(ROOM_DIMENSIONS.width, ROOM_DIMENSIONS.depth);

     for (const roomName in ROOM_POSITIONS) {
         const pos = ROOM_POSITIONS[roomName];
         const floorMesh = new THREE.Mesh(floorGeometry, roomMaterial.clone());
         floorMesh.rotation.x = -Math.PI / 2; // Lay flat
         floorMesh.position.set(pos.x, pos.y, pos.z); // y=0 is floor level
         floorMesh.receiveShadow = true;
         floorMesh.name = `RoomFloor_${roomName}`;
         floorMesh.userData = { type: 'room', roomName: roomName }; // Raycasting info
         scene.add(floorMesh);
         roomMeshes[roomName] = floorMesh; // Store floor mesh
         if (game.rooms[roomName]) game.rooms[roomName].mesh = floorMesh; // Link to room object
         interactiveObjects.push(floorMesh); // Make floor clickable for movement

         // Add simple walls (optional visual)
         /*
         const wallHeight = 3;
         const wallGeo = new THREE.BoxGeometry(ROOM_DIMENSIONS.width, wallHeight, 0.2);
         const wallMat = new THREE.MeshStandardMaterial({color: 0x666677});
         // Create 4 walls around floorMesh.position, offset correctly
         */
     }

     // Create Emergency Button in Command Center
      if (ROOM_POSITIONS['Command Center']) {
         const btnPos = ROOM_POSITIONS['Command Center'];
         const btnGeo = new THREE.CylinderGeometry(BUTTON_SIZE / 2, BUTTON_SIZE / 2, BUTTON_SIZE / 3, 16);
         const btnMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });
         emergencyButtonMesh = new THREE.Mesh(btnGeo, btnMat);
         emergencyButtonMesh.position.set(btnPos.x, btnPos.y + BUTTON_SIZE / 6, btnPos.z - ROOM_DIMENSIONS.depth * 0.4); // Position near edge
         emergencyButtonMesh.name = 'EmergencyButton';
         emergencyButtonMesh.userData = { type: 'emergency_button' };
         emergencyButtonMesh.castShadow = true;
         scene.add(emergencyButtonMesh);
         interactiveObjects.push(emergencyButtonMesh);
      }

     // Connections (optional lines, maybe change color on lock?)
     const lineMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });
      // ... (logic to draw lines between room centers, store line references if needed for color change)
 }

 function createPlayerAvatar(player) {
     // Use Capsule Geometry for a simple avatar shape
     const capsule = new THREE.CapsuleGeometry(PLAYER_AVATAR_RADIUS, PLAYER_AVATAR_HEIGHT - 2 * PLAYER_AVATAR_RADIUS, 4, 16);
     const material = new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.5 });
     const mesh = new THREE.Mesh(capsule, material);
     mesh.castShadow = true;
     mesh.name = `PlayerAvatar_${player.id}`;
     mesh.userData = { type: 'player', playerId: player.id }; // Raycasting info

     const roomPos = game.getRoomCenterPosition(player.currentRoom); // Get y=0 position
     mesh.position.set(
         roomPos.x + (Math.random() - 0.5) * 2,
         PLAYER_AVATAR_HEIGHT / 2, // Position center of capsule correctly
         roomPos.z + (Math.random() - 0.5) * 2
     );
     scene.add(mesh);
     player.mesh = mesh; // Link mesh to player object
     playerMeshes[player.id] = mesh; // Store globally
     interactiveObjects.push(mesh); // Make players clickable
 }


 function removePlayerAvatar(playerId) {
    const mesh = playerMeshes[playerId];
    if (mesh) {
        scene.remove(mesh);
        // Remove from interactive objects array
        const index = interactiveObjects.findIndex(obj => obj === mesh);
        if (index > -1) interactiveObjects.splice(index, 1);
        delete playerMeshes[playerId];
         const player = game.getPlayerById(playerId);
         if (player) player.mesh = null;
    }
}

 function createBodyMarker(playerId, roomName) {
     const roomPos = game.getRoomCenterPosition(roomName);
     if (!roomPos) return;

     // Use a flattened capsule or specific 'body' shape
      const bodyGeo = new THREE.CapsuleGeometry(PLAYER_AVATAR_RADIUS * 1.2, (PLAYER_AVATAR_HEIGHT - 2 * PLAYER_AVATAR_RADIUS) * 0.2, 4, 8);
      const deadPlayer = game.getPlayerById(playerId);
      const bodyMat = new THREE.MeshBasicMaterial({ color: deadPlayer ? deadPlayer.color : 0x888888 }); // Use player color
      const mesh = new THREE.Mesh(bodyGeo, bodyMat);
      mesh.name = `Body_${playerId}`;
      mesh.userData = { type: 'body', playerId: playerId }; // Raycasting info
      mesh.rotation.z = Math.PI / 2; // Lay it flat


     // Position slightly offset
     mesh.position.set(
         roomPos.x + (Math.random() - 0.5) * 3,
         PLAYER_AVATAR_RADIUS * 0.5, // Low to the ground
         roomPos.z + (Math.random() - 0.5) * 3
     );
     scene.add(mesh);
     bodyMeshes[playerId] = mesh;
     interactiveObjects.push(mesh); // Make bodies clickable
 }

 function removeBodyMarker(playerId) {
     const mesh = bodyMeshes[playerId];
     if (mesh) {
         scene.remove(mesh);
         const index = interactiveObjects.findIndex(obj => obj === mesh);
         if (index > -1) interactiveObjects.splice(index, 1);
         delete bodyMeshes[playerId];
     }
 }
 function clearAllBodyMarkers() {
     Object.keys(bodyMeshes).forEach(playerId => {
         removeBodyMarker(parseInt(playerId));
     });
 }

 function updateCameraFocus(player, roomName = null) {
     let targetPosition = new THREE.Vector3(0, 0, 0); // Default look at center

     if (player && player.mesh) {
         targetPosition.copy(player.mesh.position);
     } else if (roomName && ROOM_POSITIONS[roomName]) {
         const roomPos = ROOM_POSITIONS[roomName];
         targetPosition.set(roomPos.x, 0, roomPos.z);
     } else if (player) { // Player exists but maybe mesh doesn't (e.g., dead) - use logical room
          const roomPos = ROOM_POSITIONS[player.currentRoom];
          if(roomPos) targetPosition.set(roomPos.x, 0, roomPos.z);
     }


     // Simple lookAt adjustment - Could implement smooth camera panning later
      // camera.lookAt(targetPosition);

     // Or, move camera position slightly relative to target
      const offset = new THREE.Vector3(0, 20, 15); // Maintain overview angle
      const newCamPos = targetPosition.clone().add(offset);

      // Smooth transition (optional, requires TWEEN)
       new TWEEN.Tween(camera.position)
          .to(newCamPos, 500) // 500ms transition
          .easing(TWEEN.Easing.Quadratic.InOut)
          .start();
       // Smooth lookAt transition (if not using OrbitControls)
       // new TWEEN.Tween(camera.up).to(...) // Might need to tween quaternion or use controls.target

       // If using OrbitControls, update the target
       // new TWEEN.Tween(controls.target)
       //     .to(targetPosition, 500)
       //     .easing(TWEEN.Easing.Quadratic.InOut)
       //     .start();

 }

// --- Visual Feedback ---

function updateSabotageVisuals() {
    const powerOut = game.globalSabotage.isActive && game.globalSabotage.type === 'power';
    const oxygenLeak = game.globalSabotage.isActive && game.globalSabotage.type === 'oxygen';

     // Lights
    const mainLight = scene.getObjectByName('MainLight');
    const ambientLight = scene.getObjectByName('AmbientLight');
    if (mainLight) mainLight.intensity = powerOut ? 0.1 : 1.0; // Dim directional light
    if (ambientLight) ambientLight.intensity = powerOut ? 0.2 : 0.7; // Keep ambient slightly higher

     // Oxygen: Screen effect via CSS or a plane? CSS is easier.
     document.body.style.setProperty('--oxygen-overlay-opacity', oxygenLeak ? '0.15' : '0');

     // Doors: Change connection line colors? Or room floor borders?
      Object.values(game.rooms).forEach(room => {
          if (room.mesh) { // Assuming room.mesh is the floor
              const doorJammed = room.sabotage.isActive && room.sabotage.type === 'door_jam';
              // Example: change floor color slightly (subtle)
              room.mesh.material.color.setHex(doorJammed ? 0x553333 : 0x444455);
          }
      });


     // Turrets: Change Weapons Bay color/indicator
     const weaponsBayMesh = roomMeshes['Weapons Bay'];
     if (weaponsBayMesh) {
        const turretSabotaged = game.rooms['Weapons Bay']?.sabotage.isActive && game.rooms['Weapons Bay'].sabotage.type === 'turret_malfunction';
         weaponsBayMesh.material.color.setHex(turretSabotaged ? 0x774444 : 0x444455); // More noticeable red tint
     }

     // Update UI text status as well
     updateUI();
}
// Add CSS variable for overlay
const styleSheet = document.styleSheets[0];
styleSheet.insertRule(`
    body::after {
        content: '';
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(255, 0, 0, var(--oxygen-overlay-opacity, 0));
        pointer-events: none;
        z-index: 5; /* Below UI */
        transition: background-color 0.5s ease-in-out;
    }
`, styleSheet.cssRules.length);



function highlightObject(object) {
    if (highlightedObject === object) return;

    // Remove previous highlight
    if (highlightedObject && highlightedObject.material) {
        if (highlightedObject.userData.originalEmissive) {
            highlightedObject.material.emissive.setHex(highlightedObject.userData.originalEmissive);
        } else {
             highlightedObject.material.emissive.setHex(0x000000); // Default to no emissive
        }
         highlightedObject.userData.originalEmissive = undefined;
    }

    highlightedObject = object;

    if (highlightedObject && highlightedObject.material) {
         // Store original emissive color before applying highlight
         highlightedObject.userData.originalEmissive = highlightedObject.material.emissive.getHex();
         highlightedObject.material.emissive.setHex(HIGHLIGHT_COLOR);
         uiElements.gameCanvas.style.cursor = 'pointer';
    } else {
         uiElements.gameCanvas.style.cursor = 'default';
    }
}


// --- Event Handlers ---
function onMouseMove(event) {
     // Calculate mouse position
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - renderer.domElement.offsetTop) / renderer.domElement.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(interactiveObjects, false);

    if (intersects.length > 0) {
        // Check if the object is actually interactable *now*
        const object = intersects[0].object;
        // Add logic here later to check if the current player *can* interact with this object
        // e.g., is it their task? Is it in range? Is kill cooldown ready?
        // For now, just highlight any interactive object.
        highlightObject(object);
    } else {
        highlightObject(null); // No intersection or non-interactive
    }
}

function onMouseClick(event) {
    // Use the game's handler
    if (game) {
        game.handleCanvasClick(event);
    }
}

function onWindowResize() { /* ... (same as before) ... */ }

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    // Update TWEEN for animations
    TWEEN.update();

    // Update game logic timers (cooldowns, sabotage)
    if (game && !game.gameOver) {
        game.players.forEach(p => { if (p.isAlive) p.updateCooldowns(deltaTime); });
        game.updateSabotageTimers(deltaTime); // Updates timers and checks oxygen loss

        // Check if game ended due to timer in updateSabotageTimers
        if (game.gameOver) {
            // Potentially trigger game over sequence/display here if not already handled
        }
    }

     // Update OrbitControls if used
    // if (controls) controls.update();

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}


// --- Game Initialization ---
function initGame() {
    // ... (Prompt for player count remains the same) ...
     let numPlayers = 0;
     while (numPlayers < 4 || numPlayers > 10) { /* ... prompt ... */ }

    try {
        game = new Game(numPlayers);
        game.setup(); // Setup includes Three.js init now
        // updateUI() and promptPlayerAction() are called at the end of game.setup()
    } catch (error) {
        logMessage(`Error initializing game: ${error.message}`, 'error');
        console.error(error);
    }
}

// --- Start ---
initGame();