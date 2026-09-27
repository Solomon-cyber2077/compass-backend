const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors()); // lets pages on other domains (your published site) call this API
app.use(express.json()); // lets the server understand JSON sent in requests

const DATA_FILE = path.join(__dirname, 'data', 'posts.json');

function readPosts() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writePosts(posts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2));
}

// GET / -> simple health check so you can confirm the server is alive
app.get('/', (req, res) => {
  res.send('The Compass backend is running.');
});

// GET /api/posts -> send back every post as JSON
app.get('/api/posts', (req, res) => {
  res.json(readPosts());
});

// POST /api/posts -> create a new post and save it
app.post('/api/posts', (req, res) => {
  const { title, category, snippet, author } = req.body;

  if (!title || !category || !snippet || !author) {
    return res.status(400).json({ error: 'title, category, snippet, and author are all required.' });
  }

  const posts = readPosts();
  const newPost = {
    id: Date.now(),
    title,
    category,
    snippet,
    author,
    createdAt: new Date().toISOString()
  };

  posts.unshift(newPost); // add it to the front (newest first)
  writePosts(posts);

  res.status(201).json(newPost);
});

const PORT = process.env.PORT || 3001; // Render assigns its own PORT when deployed
app.listen(PORT, () => console.log(`Compass backend running on port ${PORT}`));
