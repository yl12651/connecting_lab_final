let dotenv = require('dotenv'); // LLM environment variables
dotenv.config();

let express = require('express');
let http = require('http');
let socketIo = require('socket.io');

let app = express();
let port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use('/assets', express.static('assets'));
app.use('/data', express.static('data'));

let server = http.createServer(app);
let io = new socketIo.Server(server);

/*
  Server-side validation and state management for slot updates
  Example slotState structure:
  {
    counter: [
      { itemId: 'itm-1', subjectKey: 'Cor', src: 'assets/subjectC.png', alt: 'Subject C' },
      { itemId: 'itm-2', subjectKey: 'Emo', src: 'assets/subjectE.png', alt: 'Subject E' }
    ],
    barista: [],
    kitchen: [{ itemId: 'itm-3', subjectKey: 'Rep', src: 'assets/subjectR.png', alt: 'Subject R' }],
    floor: []
  }
*/

// maintain a global slot state to update new clients and keep everyone in sync
let SLOT_CAPACITY = 4;
let slotState = {
  counter: [],
  barista: [],
  kitchen: [],
  floor: [],
};

function isValidSlot(slotId) {
  return Object.prototype.hasOwnProperty.call(slotState, slotId);
}

function isValidAdd(payload) {
  return payload.itemId && payload.subjectKey && payload.toSlot && isValidSlot(payload.toSlot);
}

function isValidMove(payload) {
  return (
    payload.itemId &&
    payload.fromSlot &&
    payload.toSlot &&
    isValidSlot(payload.fromSlot) &&
    isValidSlot(payload.toSlot)
  );
}

function isValidRemove(payload) {
  return payload.itemId && payload.fromSlot && isValidSlot(payload.fromSlot);
}

function removeItem(slotId, itemId) {
  if (!isValidSlot(slotId)) return null;
  let idx = slotState[slotId].findIndex((it) => it.itemId === itemId);
  if (idx >= 0) {
    let removed = slotState[slotId].splice(idx, 1)[0];
    return removed;
  }
  return null;
}

function addItem(slotId, payload) {
  if (!isValidSlot(slotId)) return false;
  if (slotState[slotId].length >= SLOT_CAPACITY) return false;
  slotState[slotId].push({
    itemId: payload.itemId,
    subjectKey: payload.subjectKey,
    src: payload.src,
    alt: payload.alt,
  });
  return true;
}

function applySlotUpdate(payload = {}) {
  let { action, itemId, subjectKey, fromSlot, toSlot, src, alt } = payload;

  switch (action) {
    case 'add':
      if (!isValidAdd(payload)) return null;
      return addItem(toSlot, { itemId, subjectKey, src, alt }) ? payload : null;

    case 'move': {
      if (!isValidMove(payload)) return null;
      let removed = removeItem(fromSlot, itemId);
      if (!removed) return null;
      let added = addItem(toSlot, {
        itemId,
        subjectKey: subjectKey || removed.subjectKey,
        src: src || removed.src,
        alt: alt || removed.alt,
      });
      if (!added) {
        addItem(fromSlot, removed);
        return null;
      }
      return payload;
    }

    case 'remove': {
      if (!isValidRemove(payload)) return null;
      let removed = removeItem(fromSlot, itemId);
      return removed ? payload : null;
    }

    default:
      return null;
  }
}

// All socket.io events including slot updates and drag ghosting
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.emit('slot:sync', slotState);

  socket.on('drag:start', (payload) => {
    socket.broadcast.emit('drag:start', { ...payload, peerId: socket.id });
  });

  socket.on('drag:move', (payload) => {
    socket.broadcast.emit('drag:move', { ...payload, peerId: socket.id });
  });

  socket.on('drag:end', (payload) => {
    socket.broadcast.emit('drag:end', { ...payload, peerId: socket.id });
  });

  socket.on('slot:update', (payload) => {
    let accepted = applySlotUpdate(payload);
    if (accepted) {
      io.emit('slot:update', { ...payload, peerId: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});


/* 
  API endpoint to simulate the cafeteria ending using OpenAI 
*/

app.use(express.json({ limit: '1mb' }));

app.post('/api/simulate', async (req, res) => {
  let OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  try {
    console.log('simulate: current slot state', JSON.stringify(slotState, null, 2));
    // build the prompt from data/ending_prompt.md
    // dynamically insert the current slot state as JSON
    let promptTemplate = `
      ${require('fs').readFileSync(require('path').join(__dirname, 'data/ending_prompt.md'), 'utf8')}
      `.trim();

    let prompt = promptTemplate.replace('{{SLOT_STATE_JSON}}', JSON.stringify(slotState, null, 2));

    let completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
        // temperature: 0.7, // This is for Gpt-4o and earlier
      }),
    });

    if (!completionRes.ok) {
      let text = await completionRes.text();
      return res.status(500).json({ error: 'OpenAI request failed', details: text });
    }

    let data = await completionRes.json();
    let endingText = data.choices?.[0]?.message?.content || '';

    // clear state and notify clients
    slotState = {
      counter: [],
      barista: [],
      kitchen: [],
      floor: [],
    };
    io.emit('slot:sync', slotState);

    return res.json({ ending: endingText });
  } catch (err) {
    console.error('simulate error', err);
    return res.status(500).json({ error: 'Simulation failed', details: err.message });
  }
});

server.listen(port, () => {
  console.log(`The Cafeteria listening on port ${port}`);
});
