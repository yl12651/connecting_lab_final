let subjectData = {};
let slotState = {};
let dragging = null;
let socket = io();
let remoteDrags = new Map();
let nextItemId = 0;
let nextDragId = 0;
let simulateButton;
let simulateLoading;
let simulateError;
let actionsContainer;
let isSimulating = false;
let HELP_HINT_TEXT = 
  'Welcome to The Lumen Café!\n\nHover subjects for descriptions, and drag and drop to assign them to a position;\n\nPlay around the arrangement with your friends and start Simulation to generate an ending when you are ready!\n\nP.S. One slot should only have at most four staff members at the same time because we can\'t afford it!\n\nP.P.S. No subjects are harmed in the making of this simulation.';
let introLines = [
  'Clotho: Hey there! Welcome to The Lumen Café!',
  "Clotho: Oooh… you already squeezed those little subjects into existence? Not bad for a first-timer.",
  "Clotho: C'mon, show me. Let me see how you plan to use them~",
  "Clotho: Each one comes with their own personality, you know. Emo, Rep, Log… they all behave differently if you stick them in the wrong place.",
  "Clotho: And these roles? Counter is for handling customers, Barista sets the pace, Kitchen keeps things running, and Floor stops the café from turning into a mess.",
  "Clotho: So… talk it over with your friends, okay? I wanna see where you think each of them fits.",
  "Clotho: Don't disappoint me now~"
];
let introIndex = 0;
let introOverlay;
let introText;
let introDialog;

// local debug override
let introDebugForce = false;

/* 
  Hovering hint related utilities.
  Automatically attach hint boxes to target elements with respective to their positions.
*/

// position a hint box relative to a target element
function positionHint(element, box, alignment) {
  let rect = element.getBoundingClientRect();
  let scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  let scrollTop = window.pageYOffset || document.documentElement.scrollTop;

  if (alignment === 'bottom-right') {
    box.style.left = `${rect.right + scrollLeft + 8}px`;
    box.style.top = `${rect.bottom + scrollTop + 8}px`;
  } else if (alignment === 'left') {
    let boxRect = box.getBoundingClientRect();
    let boxHeight = boxRect.height;
    let boxWidth = boxRect.width;
    box.style.left = `${rect.left + scrollLeft - boxWidth - 8}px`;
    box.style.top = `${rect.top + scrollTop}px`;
  } else {
    box.style.left = `${rect.left + scrollLeft}px`;
    box.style.top = `${rect.bottom + scrollTop + 8}px`;
  }
}

// attach generic hover hints
function attachHoverHints(targets, getText, getAlign) {
  if (!targets || !targets.length) return;
  let box = document.createElement('div');
  box.className = 'hint-box hidden';
  document.body.appendChild(box);

  targets.forEach((el) => {
    el.addEventListener('mouseenter', () => {
      let text = typeof getText === 'function' ? getText(el) : '';
      let align = typeof getAlign === 'function' ? getAlign(el) : 'bottom';
      box.textContent = text || '';
      box.classList.remove('hidden');
      positionHint(el, box, align);
    });
    el.addEventListener('mouseleave', () => {
      box.classList.add('hidden');
    });
  });
}

/* 
  Drag and drop utilities; 
  Slot state update and syncing management.
  Rendering of drag ghosts and placed items.
*/

// add an item to a slot (returns item id if placed)
function addToSlot(slotId, subjectKey, src, alt, itemId) {
  let slotInfo = slotState[slotId];
  if (!slotInfo) return null;
  let existing = slotInfo.items.find((entry) => entry.id === itemId);
  if (existing) {
    return existing.id;
  }
  let finalId = itemId || genItemId();
  let placed = document.createElement('img');
  placed.src = src;
  placed.alt = alt || subjectKey;
  placed.className = 'placed-subject';
  placed.dataset.slot = slotId;
  placed.dataset.itemId = finalId;
  placed.dataset.subject = subjectKey;
  slotInfo.items.push({ id: finalId, key: subjectKey, node: placed });
  attachDragHandler(placed);
  slotInfo.contents.appendChild(placed);
  return finalId;
}

// clear and reapply slot contents from a snapshot
function syncSlots(snapshot = {}) {
  Object.keys(slotState).forEach((slotId) => {
    let slotInfo = slotState[slotId];
    if (!slotInfo) return;
    slotInfo.items.forEach((entry) => {
      if (entry.node && entry.node.parentElement) {
        entry.node.parentElement.removeChild(entry.node);
      }
    });
    slotInfo.items = [];
    if (slotInfo.contents) {
      slotInfo.contents.innerHTML = '';
    }
  });

  Object.entries(snapshot).forEach(([slotId, items]) => {
    if (!slotState[slotId]) return;
    (items || []).forEach((item) => {
      addToSlot(slotId, item.subjectKey || item.key, item.src, item.alt, item.itemId || item.id);
    });
  });
}

// generate a unique id for placed items
function genItemId() {
  nextItemId += 1;
  return `itm-${nextItemId}`;
}

// generate a unique id for drag sessions
function genDragId() {
  nextDragId += 1;
  return `drag-${nextDragId}`;
}

// initialize slot tracking data
function initSlotState(slots) {
  slots.forEach((slot) => {
    let id = slot.dataset.slot;
    let contents = slot.querySelector('.slot-contents') || slot;
    slotState[id] = {
      el: slot, // the slot DOM element
      contents, // tge .slot-contents element
      items: [], // placed ietms' key value pairs
    };
  });
}

// remove a placed item from a slot
function removeFromSlot(slotId, nodeOrId) {
  let slotInfo = slotState[slotId];
  if (!slotInfo) return null;
  let idx = slotInfo.items.findIndex(
    (entry) => entry.node === nodeOrId || entry.id === nodeOrId,
  );
  if (idx >= 0) {
    let removed = slotInfo.items.splice(idx, 1)[0];
    if (removed && removed.node && removed.node.parentElement) {
      removed.node.parentElement.removeChild(removed.node);
    }
    return removed;
  }
  return null;
}

// drag and drop from a subject image
function startDrag(img, event) {
  let subjectKey = img.dataset.subject || '';
  let fromSlot = img.dataset.slot || null;
  let itemId = img.dataset.itemId || null;
  let dragId = genDragId();
  let dragImg = img.cloneNode(true);
  dragImg.classList.add('drag-clone');
  dragImg.style.width = `${img.getBoundingClientRect().width}px`;
  document.body.appendChild(dragImg);

  dragging = {
    dragId,
    subjectKey,
    src: img.src,
    alt: img.alt,
    node: dragImg,
    fromSlot,
    itemId,
    sourceNode: img,
  };

  // ghosting the drag start to other clients
  socket.emit('drag:start', {
    dragId,
    subjectKey,
    src: dragging.src,
    alt: dragging.alt,
    fromSlot,
    itemId,
    x: event.clientX,
    y: event.clientY,
  });

  moveDrag(event);
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('mouseup', endDrag);
}

// move a clone of the subject image with the mouse
function moveDrag(event) {
  if (!dragging) return;
  dragging.node.style.position = 'fixed';
  dragging.node.style.pointerEvents = 'none';
  dragging.node.style.left = `${event.clientX - dragging.node.offsetWidth / 2}px`;
  dragging.node.style.top = `${event.clientY - dragging.node.offsetHeight / 2}px`;
  socket.emit('drag:move', {
    dragId: dragging.dragId,
    x: event.clientX,
    y: event.clientY,
  });
}

// finish drag and handle drop
function endDrag(event) {
  if (!dragging) return;
  let dragId = dragging.dragId;

  let slotElems = Object.values(slotState).map((s) => s.el);
  let targetSlot = slotElems.find((slot) => {
    let rect = slot.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });

  if (targetSlot) {
    let slotId = targetSlot.dataset.slot;
    if (slotState[slotId]) {
      let isSameSlot = dragging.fromSlot && dragging.fromSlot === slotId;
      if (!isSameSlot) {
        let itemId = dragging.itemId || genItemId();
        socket.emit('slot:update', {
          action: dragging.fromSlot ? 'move' : 'add',
          itemId,
          subjectKey: dragging.subjectKey,
          fromSlot: dragging.fromSlot,
          toSlot: slotId,
          src: dragging.src,
          alt: dragging.alt,
        });
      }
    }
  } else if (dragging.fromSlot) {
    // Dropped outside: request delete
    socket.emit('slot:update', {
      action: 'remove',
      itemId: dragging.itemId,
      subjectKey: dragging.subjectKey,
      fromSlot: dragging.fromSlot,
    });
  }

  dragging.node.remove();
  dragging = null;
  window.removeEventListener('mousemove', moveDrag);
  window.removeEventListener('mouseup', endDrag);

  socket.emit('drag:end', {
    dragId,
  });
}

// attach drag handler to images
function attachDragHandler(targets) {
  let list = Array.isArray(targets) ? targets : [targets];
  list.forEach((img) => {
    if (!img) return;
    img.addEventListener('mousedown', (event) => {
      event.preventDefault();
      startDrag(img, event);
    });
  });
}

// render remote drag start
function handleRemoteDragStart(payload) {
  let { dragId, subjectKey, src, alt, x, y } = payload;
  if (!dragId || remoteDrags.has(dragId)) return;
  let ghost = document.createElement('img');
  ghost.src = src;
  ghost.alt = alt || subjectKey;
  ghost.className = 'remote-drag placed-subject';
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
  document.body.appendChild(ghost);
  remoteDrags.set(dragId, { node: ghost });
}

// update remote drag position
function handleRemoteDragMove(payload) {
  let { dragId, x, y } = payload;
  let ghost = remoteDrags.get(dragId);
  if (!ghost || !ghost.node) return;
  ghost.node.style.left = `${x}px`;
  ghost.node.style.top = `${y}px`;
}

// remove remote drag ghost
function handleRemoteDragEnd(payload) {
  let { dragId } = payload;
  let ghost = remoteDrags.get(dragId);
  if (ghost && ghost.node && ghost.node.parentElement) {
    ghost.node.parentElement.removeChild(ghost.node);
  }
  remoteDrags.delete(dragId);
}

// apply remote slot updates
function applyRemoteSlotUpdate(payload) {
  let { action, itemId, subjectKey, fromSlot, toSlot, src, alt } = payload;
  if (action === 'add') {
    addToSlot(toSlot, subjectKey, src, alt, itemId);
  } else if (action === 'move') {
    if (fromSlot) {
      removeFromSlot(fromSlot, itemId);
    }
    addToSlot(toSlot, subjectKey, src, alt, itemId);
  } else if (action === 'remove') {
    if (fromSlot) {
      removeFromSlot(fromSlot, itemId);
    }
  }
}

// load subject metadata from characters.json
function loadSubjectData() {
  fetch('/data/characters.json')
    .then((res) => res.json())
    .then((json) => {
      subjectData = json;
    })
    .catch(() => {
      subjectData = {};
    });
}

/*
  Simulation API endpoint interaction
*/

// trigger simulation
async function runSimulation() {
  if (!simulateButton) return;
  if (isSimulating) return;

  // send the request and will be driven by socket events
  try {
    let res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      let text = await res.text();
      throw new Error(text || 'Simulation failed');
    }
    // success case is handled by sim:pending / sim:done events
  } catch (err) {
    // only for network or HTTP errors
    if (simulateError) {
      simulateError.textContent = err.message || 'Simulation failed';
      simulateError.classList.remove('hidden');
    }
  }
}

// simulation state handlers driven by socket events
function handleSimPending() {
  setSimulating(true);
}

function handleSimDone(payload) {
  setSimulating(false);
  if (simulateError) {
    simulateError.textContent = '';
    simulateError.classList.add('hidden');
  }
  let ending = (payload && payload.ending) || 'No ending generated.';
  sessionStorage.setItem('cafeteria_ending', ending);
  window.location.href = '/ending.html';
}

function handleSimError(payload) {
  setSimulating(false);
  let message = (payload && payload.message) || 'Simulation failed';
  if (simulateError) {
    simulateError.textContent = message;
    simulateError.classList.remove('hidden');
  }
}

function setSimulating(isOn) {
  isSimulating = isOn;

  if (simulateLoading) {
    simulateLoading.classList.toggle('hidden', !isOn);
  }

  if (simulateButton) {
    simulateButton.disabled = isOn;
  }
}

/*
  Landing intro dialog overlay logic
  Only shown if not seen before
*/

function initIntroOverlay() {
  if (!introOverlay || !introText || !introDialog) return;

  // use localStorage flag so it is universal for all users on the same browser on the system
  if (!introDebugForce && localStorage.getItem('cafeteria_intro_seen') === '1') {
    introOverlay.classList.add('hidden');
    introOverlay.style.display = 'none';
    if (actionsContainer) actionsContainer.classList.remove('hidden');
    return;
  }

  introIndex = 0;
  introText.textContent = introLines[introIndex] || '';
  introOverlay.classList.remove('hidden');
  introOverlay.style.display = 'flex';
  if (actionsContainer) actionsContainer.classList.add('hidden');
  introOverlay.addEventListener('click', advanceIntro);
}

function advanceIntro() {
  introIndex += 1;
  if (introIndex < introLines.length) {
    introText.textContent = introLines[introIndex];
  } else {
    localStorage.setItem('cafeteria_intro_seen', '1');
    introOverlay.classList.add('hidden');
    introOverlay.style.display = 'none';
    if (actionsContainer) actionsContainer.classList.remove('hidden');
    introDialog.removeEventListener('click', advanceIntro);
  }
}

// initialize ui, sockets, and hints after the page loads
function setup() {
  noCanvas();
  loadSubjectData();

  const helpIcon = document.getElementById('help-icon');
  if (helpIcon) {
    attachHoverHints([helpIcon], () => HELP_HINT_TEXT, () => 'left');
  }

  const subjectImages = Array.from(document.querySelectorAll('.subjects img'));
  if (subjectImages.length) {
    attachHoverHints(
      subjectImages,
      (img) => {
        let key = img.dataset.subject;
        return (subjectData[key] && subjectData[key].description) || 'No description available.';
      },
      () => 'bottom',
    );
    attachDragHandler(subjectImages);
  }

  const scheduleHints = Array.from(document.querySelectorAll('.slot-hint'));
  if (scheduleHints.length) {
    attachHoverHints(
      scheduleHints,
      (slot) => slot.dataset.hint || 'Slot',
      () => 'left',
    );
  }

  const dropSlots = Array.from(document.querySelectorAll('.slot-target'));
  if (dropSlots.length) {
    initSlotState(dropSlots);
  }

  socket.on('drag:start', handleRemoteDragStart);
  socket.on('drag:move', handleRemoteDragMove);
  socket.on('drag:end', handleRemoteDragEnd);
  socket.on('slot:update', applyRemoteSlotUpdate);
  socket.on('slot:sync', (snapshot) => {
    syncSlots(snapshot);
  });
  socket.on('sim:pending', handleSimPending);
  socket.on('sim:done', handleSimDone);
  socket.on('sim:error', handleSimError);

  simulateButton = document.getElementById('start-sim');
  simulateLoading = document.getElementById('sim-loading');
  simulateError = document.getElementById('sim-error');
  introOverlay = document.getElementById('intro-overlay');
  introText = document.getElementById('intro-text');
  introDialog = document.getElementById('intro-dialog');
  actionsContainer = document.querySelector('.actions');

  if (simulateButton) {
    simulateButton.addEventListener('click', runSimulation);
  }

  initIntroOverlay();
}
